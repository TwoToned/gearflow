import { z } from "zod";

/**
 * Discord integration admin config. v1 uses plain text inputs for the guild /
 * category / channel ids (NOT live Discord dropdowns) — the admin page must render
 * entirely from the DB and never block on a live bot call (design review, locked).
 *
 * NOTE: This file is imported by the admin client page for the zodResolver, so
 * it MUST NOT import from `@/generated/prisma/client` — Prisma's generated client
 * uses `node:module`, which Turbopack's client bundler can't trace. We mirror
 * the ProjectStatus enum as a literal-string z.enum here. CI runs `prisma generate`
 * before tsc, and `prisma migrate deploy` enforces the DB-side enum.
 */
const projectStatusSchema = z.enum([
  "ENQUIRY",
  "QUOTING",
  "QUOTED",
  "CONFIRMED",
  "PREPPING",
  "CHECKED_OUT",
  "ON_SITE",
  "RETURNED",
  "COMPLETED",
  "INVOICED",
  "CANCELLED",
]);

export const discordIntegrationConfigSchema = z.object({
  guildId: z.string().trim().optional().default(""),
  discordApplicationId: z.string().trim().optional().default(""),
  projectCategoryId: z.string().trim().optional().default(""),
  archiveCategoryId: z.string().trim().optional().default(""),
  alertChannelId: z.string().trim().optional().default(""),
  auditChannelId: z.string().trim().optional().default(""),

  // Status-rule arrays — multi-select on the admin page. Must be non-empty for
  // create to do anything useful; empty archive list means channels are never
  // archived (acceptable but flagged in the UI).
  channelCreateOnStatuses: z.array(projectStatusSchema).default(["CONFIRMED"]),
  channelArchiveOnStatuses: z
    .array(projectStatusSchema)
    .default(["COMPLETED", "INVOICED", "RETURNED", "CANCELLED"]),

  postWelcomeOnCreate: z.boolean().default(true),
  postFaultsToProjectChannel: z.boolean().default(true),

  linkTokenTtlMinutes: z.coerce.number().int().min(5).max(1440).default(15),
  enrollmentOpen: z.boolean().default(true),
});

export type DiscordIntegrationConfigValues = z.input<typeof discordIntegrationConfigSchema>;

/** Separate schema for the sensitive credential setter — never merged with the main form. */
export const discordCredentialsSchema = z.object({
  /** Empty string means "no change"; null means "clear". Anything else replaces. */
  discordBotToken: z.string().nullable(),
});
export type DiscordCredentialsValues = z.input<typeof discordCredentialsSchema>;
