import { z } from "zod";

/**
 * Discord integration admin config. v1 uses plain text inputs for the guild /
 * category / channel ids (NOT live Discord dropdowns) — the admin page must render
 * entirely from the DB and never block on a live bot call (design review, locked).
 */
export const discordIntegrationConfigSchema = z.object({
  guildId: z.string().trim().optional().default(""),
  projectCategoryId: z.string().trim().optional().default(""),
  alertChannelId: z.string().trim().optional().default(""),
  auditChannelId: z.string().trim().optional().default(""),
  linkTokenTtlMinutes: z.coerce.number().int().min(5).max(1440).default(15),
  enrollmentOpen: z.boolean().default(true),
});

export type DiscordIntegrationConfigValues = z.input<typeof discordIntegrationConfigSchema>;
