import { z } from "zod";
import { ProjectStatus } from "@/generated/prisma/client";

/**
 * Discord integration admin config. v1 uses plain text inputs for the guild /
 * category / channel ids (NOT live Discord dropdowns) — the admin page must render
 * entirely from the DB and never block on a live bot call (design review, locked).
 */
const projectStatusSchema = z.nativeEnum(ProjectStatus);

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
  channelCreateOnStatuses: z.array(projectStatusSchema).default([ProjectStatus.CONFIRMED]),
  channelArchiveOnStatuses: z
    .array(projectStatusSchema)
    .default([
      ProjectStatus.COMPLETED,
      ProjectStatus.INVOICED,
      ProjectStatus.RETURNED,
      ProjectStatus.CANCELLED,
    ]),

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
