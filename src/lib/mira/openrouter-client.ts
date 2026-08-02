import { env } from "@/env";

/**
 * A minimal OpenRouter chat-completions client (OpenAI-compatible surface —
 * https://openrouter.ai/docs/api-reference/chat-completion). Plain fetch, no
 * SDK dependency: this is the ONE endpoint Mira's agent loop needs
 * (non-streaming request/response — see FEATUREDOCS/68 for why streaming was
 * deliberately deferred), so a typed wrapper is simpler than a general-purpose
 * client library this codebase would otherwise have zero other use for.
 *
 * Each org supplies its OWN API key (src/server/mira-settings.ts) — there is
 * no platform-level OpenRouter credential and no env var for one.
 */

interface OpenRouterToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenRouterToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface OpenRouterToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface OpenRouterChatResult {
  message: OpenRouterMessage;
  finishReason: string | null;
}

export class OpenRouterError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface ChatCompletionParams {
  apiKey: string;
  model: string;
  messages: OpenRouterMessage[];
  tools?: OpenRouterToolDef[];
  signal?: AbortSignal;
}

export async function chatCompletion(params: ChatCompletionParams): Promise<OpenRouterChatResult> {
  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`,
        "HTTP-Referer": env.NEXT_PUBLIC_APP_URL,
        "X-Title": "RVLT Flow — Mira",
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        ...(params.tools?.length ? { tools: params.tools, tool_choice: "auto" } : {}),
      }),
      signal: params.signal,
    });
  } catch (err) {
    throw new OpenRouterError(`Couldn't reach OpenRouter: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new OpenRouterError(`OpenRouter request failed (${res.status}): ${text.slice(0, 500)}`, res.status);
  }

  const json = (await res.json()) as { choices?: { message: OpenRouterMessage; finish_reason: string | null }[] };
  const choice = json.choices?.[0];
  if (!choice) throw new OpenRouterError("OpenRouter returned no choices.");
  return { message: choice.message, finishReason: choice.finish_reason };
}
