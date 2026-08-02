import { z } from "zod";

/**
 * Mira AI assistant org settings (`/settings/mira`) — each org brings its own
 * OpenRouter API key and picks its own model string. `openRouterApiKey` is
 * OPTIONAL on submit: the form only sends it when the admin is setting or
 * replacing the key (the stored value is never round-tripped back to the
 * browser — see src/server/mira-settings.ts), so an empty/omitted value means
 * "leave the currently-configured key alone," not "clear it" (that's the
 * separate, explicit disconnect action).
 */
export const DEFAULT_MIRA_MODEL = "anthropic/claude-sonnet-4.5";

export const miraSettingsSchema = z.object({
  openRouterApiKey: z.string().trim().min(20, "That doesn't look like a full OpenRouter API key").optional().or(z.literal("")),
  model: z.string().trim().min(1, "Pick a model").max(200),
  writeAccessEnabled: z.boolean(),
});

export type MiraSettingsFormValues = z.input<typeof miraSettingsSchema>;
