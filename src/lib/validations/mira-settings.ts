import { z } from "zod";

/**
 * Mira AI assistant org settings (`/settings/mira`) — each org brings its own
 * API key and picks its own model string. Defaults to OpenRouter; `baseUrl`
 * lets an org instead BYO any OpenAI-compatible endpoint (Azure OpenAI, a
 * self-hosted vLLM/Ollama/LM Studio server, ...) — see
 * `src/lib/mira/llm-client.ts`. `openRouterApiKey` is OPTIONAL on submit: the
 * form only sends it when the admin is setting or replacing the key (the
 * stored value is never round-tripped back to the browser — see
 * src/server/mira-settings.ts), so an empty/omitted value means "leave the
 * currently-configured key alone," not "clear it" (that's the separate,
 * explicit disconnect action). `baseUrl` is NOT a secret — it round-trips
 * normally; empty means "use the default (OpenRouter)."
 */
export const DEFAULT_MIRA_MODEL = "anthropic/claude-sonnet-4.5";

export const miraSettingsSchema = z.object({
  openRouterApiKey: z.string().trim().min(20, "That doesn't look like a full API key").optional().or(z.literal("")),
  model: z.string().trim().min(1, "Pick a model").max(200),
  baseUrl: z.string().trim().url("Enter a full URL, e.g. https://your-endpoint.example.com/v1").max(500).optional().or(z.literal("")),
  writeAccessEnabled: z.boolean(),
});

export type MiraSettingsFormValues = z.input<typeof miraSettingsSchema>;
