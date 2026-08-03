import { env } from "@/env";

/**
 * A minimal OpenAI-compatible chat-completions client. Plain fetch, no SDK
 * dependency: this is the ONE endpoint Mira's agent loop needs (non-streaming
 * request/response — see FEATUREDOCS/68 for why), so a typed wrapper is
 * simpler than a general-purpose client library this codebase would
 * otherwise have zero other use for.
 *
 * Defaults to OpenRouter, but any org can point Mira at a different
 * OpenAI-compatible endpoint instead (`miraOrgSettings.baseUrl` —
 * `/settings/mira`) — Azure OpenAI, a self-hosted vLLM/Ollama/LM Studio
 * server, anything that implements `POST {baseUrl}/chat/completions` with
 * the same request/response shape. Each org supplies its OWN API key
 * (src/server/mira-settings.ts) — there is no platform-level LLM credential.
 */

export const DEFAULT_LLM_BASE_URL = "https://openrouter.ai/api/v1";

function normalizeBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl?.trim() || DEFAULT_LLM_BASE_URL).replace(/\/+$/, "");
}

interface LlmToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: LlmToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface LlmToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface LlmChatResult {
  message: LlmMessage;
  finishReason: string | null;
}

export class LlmClientError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "LlmClientError";
  }
}

export interface ChatCompletionParams {
  apiKey: string;
  model: string;
  messages: LlmMessage[];
  tools?: LlmToolDef[];
  /** An OpenAI-compatible API base (no trailing `/chat/completions`) — omit
   *  to use OpenRouter. See `DEFAULT_LLM_BASE_URL`. */
  baseUrl?: string;
  signal?: AbortSignal;
}

/** Attribution headers OpenRouter itself reads (org/model breakdowns on
 *  openrouter.ai) — meaningless, and not this app's business to send, to an
 *  arbitrary third-party/self-hosted endpoint an org points Mira at instead. */
function attributionHeaders(baseUrl: string): Record<string, string> {
  if (baseUrl !== DEFAULT_LLM_BASE_URL) return {};
  return {
    "HTTP-Referer": env.NEXT_PUBLIC_APP_URL,
    // Header values must be ASCII (the Fetch spec requires a ByteString) —
    // no em dash/smart quotes/etc. here, or `fetch()` throws "Cannot convert
    // argument to a ByteString" at CALL time, not build time (a prod outage
    // this shipped as, once — keep this string plain ASCII).
    "X-Title": "RVLT Flow - Mira",
  };
}

export async function chatCompletion(params: ChatCompletionParams): Promise<LlmChatResult> {
  const baseUrl = normalizeBaseUrl(params.baseUrl);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`,
        ...attributionHeaders(baseUrl),
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        ...(params.tools?.length ? { tools: params.tools, tool_choice: "auto" } : {}),
      }),
      signal: params.signal,
    });
  } catch (err) {
    throw new LlmClientError(`Couldn't reach the language model at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new LlmClientError(`Language model request failed (${res.status}): ${text.slice(0, 500)}`, res.status);
  }

  const json = (await res.json()) as { choices?: { message: LlmMessage; finish_reason: string | null }[] };
  const choice = json.choices?.[0];
  if (!choice) throw new LlmClientError("The language model returned no choices.");
  return { message: choice.message, finishReason: choice.finish_reason };
}
