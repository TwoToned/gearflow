import { chatCompletion, OpenRouterError, type OpenRouterMessage, type OpenRouterToolDef } from "@/lib/mira/openrouter-client";
import type { MiraTool } from "@/lib/mira/tool-defs";

/**
 * Mira's tool-call loop: call the model, execute whatever tool calls it
 * returns via `dispatch()` (injected as `executeTool` — see
 * src/server/mira.ts), feed the results back, repeat until the model answers
 * in plain text or a high-danger op needs a human to confirm it.
 *
 * Deliberately NON-streaming (a single request/response per model turn, not
 * token-by-token SSE) — see FEATUREDOCS/68 for why. Bounded by both an
 * iteration count and a wall-clock timeout so a confused model (or an org's
 * own OpenRouter spend) can't run away.
 */

export interface PendingConfirmation {
  operation: string;
  args: Record<string, unknown>;
  idempotencyKey: string;
  summary: string;
}

export interface ToolExecOk {
  ok: true;
  data: unknown;
}
interface ToolExecConfirmRequired {
  ok: false;
  needsConfirmation: true;
  pending: PendingConfirmation;
}
export interface ToolExecError {
  ok: false;
  needsConfirmation?: false;
  error: { message: string; code?: string };
}
type ToolExecResult = ToolExecOk | ToolExecConfirmRequired | ToolExecError;

export type ExecuteTool = (toolName: string, args: Record<string, unknown>) => Promise<ToolExecResult>;

export interface RunAgentLoopParams {
  apiKey: string;
  model: string;
  /** Full conversation so far, ending in the newest input turn (a user
   *  message, or — when resuming after a confirmation — a tool-result
   *  message). The loop appends to a copy; it never mutates this array. */
  messages: OpenRouterMessage[];
  tools: MiraTool[];
  executeTool: ExecuteTool;
  maxIterations?: number;
  timeoutMs?: number;
}

export interface RunAgentLoopResult {
  /** Messages produced during the loop (assistant/tool turns) — append these
   *  to persisted history; `messages` passed in is not repeated. Each `tool`
   *  message's `content` IS the trace: what ran and what it returned. */
  appended: OpenRouterMessage[];
  pendingConfirmation: PendingConfirmation | null;
}

const DEFAULT_MAX_ITERATIONS = 6;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TOOL_RESULT_CHARS = 6_000;

function truncate(text: string): string {
  return text.length > MAX_TOOL_RESULT_CHARS ? text.slice(0, MAX_TOOL_RESULT_CHARS) + "\n…(truncated)" : text;
}

function toolResultContent(result: ToolExecResult): string {
  if (result.ok) return truncate(JSON.stringify(result.data ?? null));
  if (result.needsConfirmation) {
    return JSON.stringify({
      error: "CONFIRMATION_REQUIRED",
      summary: result.pending.summary,
      note: "This action needs a human to click Confirm in the chat UI before it runs. Do not retry this call — explain to the user what you're about to do (using the summary) and that you're waiting for their confirmation.",
    });
  }
  return JSON.stringify({ error: result.error.code ?? "ERROR", message: result.error.message });
}

function parseToolCallArgs(raw: string): { args: Record<string, unknown> } | { parseError: string } {
  try {
    const parsed: unknown = raw.trim() === "" ? {} : JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { parseError: "Tool arguments must be a JSON object." };
    }
    return { args: parsed as Record<string, unknown> };
  } catch {
    return { parseError: "Tool arguments were not valid JSON." };
  }
}

function toOpenRouterTools(tools: readonly MiraTool[]): OpenRouterToolDef[] | undefined {
  if (!tools.length) return undefined;
  return tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

/** Run every tool call in one assistant turn, appending a `tool` result
 *  message per call (required by the chat-completions contract — one result
 *  per tool_call_id) and returning the first confirmation this turn hit, if
 *  any. Tool calls run sequentially, not in parallel — Mira's tools mutate
 *  shared org state, and a later call in the same turn may depend on an
 *  earlier one's effect (e.g. create_project then add_line_items). */
async function runToolCalls(
  message: OpenRouterMessage,
  executeTool: ExecuteTool,
  messages: OpenRouterMessage[],
  appended: OpenRouterMessage[],
): Promise<PendingConfirmation | null> {
  let pendingConfirmation: PendingConfirmation | null = null;
  for (const call of message.tool_calls ?? []) {
    const parsed = parseToolCallArgs(call.function.arguments);
    const result: ToolExecResult =
      "parseError" in parsed ? { ok: false, error: { message: parsed.parseError, code: "INVALID_ARGUMENTS" } } : await executeTool(call.function.name, parsed.args);

    const toolResultMessage: OpenRouterMessage = {
      role: "tool",
      tool_call_id: call.id,
      name: call.function.name,
      content: toolResultContent(result),
    };
    messages.push(toolResultMessage);
    appended.push(toolResultMessage);

    if (!result.ok && result.needsConfirmation && !pendingConfirmation) {
      pendingConfirmation = result.pending;
    }
  }
  return pendingConfirmation;
}

export async function runMiraAgentLoop(params: RunAgentLoopParams): Promise<RunAgentLoopResult> {
  const maxIterations = params.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const toolDefs = toOpenRouterTools(params.tools);
  const messages = [...params.messages];
  const appended: OpenRouterMessage[] = [];

  try {
    for (let i = 0; i < maxIterations; i++) {
      const { message } = await chatCompletion({
        apiKey: params.apiKey,
        model: params.model,
        messages,
        tools: toolDefs,
        signal: controller.signal,
      });
      messages.push(message);
      appended.push(message);

      if (!message.tool_calls?.length) {
        return { appended, pendingConfirmation: null };
      }

      const pendingConfirmation = await runToolCalls(message, params.executeTool, messages, appended);

      if (pendingConfirmation) {
        // One last turn, tools disabled, so the model explains what it's
        // waiting on in plain text instead of immediately retrying the same
        // call (which it structurally can't confirm itself — see tool-defs.ts).
        const { message: explanation } = await chatCompletion({
          apiKey: params.apiKey,
          model: params.model,
          messages,
          tools: undefined,
          signal: controller.signal,
        });
        appended.push(explanation);
        return { appended, pendingConfirmation };
      }
    }

    appended.push({
      role: "assistant",
      content: "I made several tool calls but didn't reach a final answer yet — try asking me to continue, or narrow the question.",
    });
    return { appended, pendingConfirmation: null };
  } catch (err) {
    const content =
      err instanceof OpenRouterError
        ? `I hit an error talking to the language model: ${err.message}`
        : controller.signal.aborted
          ? "That took too long, so I stopped — try a narrower question."
          : `Something went wrong: ${err instanceof Error ? err.message : String(err)}`;
    appended.push({ role: "assistant", content });
    return { appended, pendingConfirmation: null };
  } finally {
    clearTimeout(timer);
  }
}
