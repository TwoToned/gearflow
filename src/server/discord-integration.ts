"use server";

import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import {
  discordCredentialsSchema,
  discordIntegrationConfigSchema,
  type DiscordCredentialsValues,
  type DiscordIntegrationConfigValues,
} from "@/lib/validations/discord-integration";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-vault";
import { deployCommands as deployCommandsToDiscord } from "@/lib/discord/deploy-commands";

function generateSecret(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Everything the admin page renders — config + connection health + the FULL crew
 * roster (linked AND unlinked, partial is the steady state) + recent activity.
 * All from the DB; the page derives online/offline from `lastHeartbeatAt` and
 * never blocks on the bot.
 *
 * Sensitive fields: `signingSecret` is returned (admin needs to see+copy/rotate it),
 * `discordBotToken` is NEVER returned — the admin can replace it via setDiscordCredentials
 * but cannot read it back. Storing it encrypted is belt; not exposing it is suspenders.
 */
export async function getDiscordIntegrationSettings() {
  const { organizationId } = await requirePermission("orgSettings", "read");

  const rawIntegration = await prisma.discordIntegration.findUnique({
    where: { organizationId },
  });
  // Strip the encrypted token; surface presence so the UI shows "configured" vs "not set".
  const integration = rawIntegration
    ? {
        ...rawIntegration,
        discordBotToken: undefined,
        hasDiscordBotToken: !!rawIntegration.discordBotToken,
      }
    : null;

  const crew = await prisma.crewMember.findMany({
    where: { organizationId, status: "ACTIVE" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      discordLink: { select: { discordUserId: true, linkedAt: true } },
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });

  const roster = crew.map((c) => ({
    crewMemberId: c.id,
    name: `${c.firstName} ${c.lastName}`.trim(),
    email: c.email,
    discordUserId: c.discordLink?.discordUserId ?? null,
    linkedAt: c.discordLink?.linkedAt ?? null,
  }));
  const linkedCount = roster.filter((r) => r.discordUserId).length;

  const recentActivity = await prisma.activityLog.findMany({
    where: { organizationId, entityType: { in: ["discord_integration", "discord_account_link"] } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, action: true, summary: true, userName: true, createdAt: true },
  });

  return serialize({
    integration,
    roster,
    summary: { linkedCount, totalCrew: roster.length },
    recentActivity,
  });
}

/** Create the integration row on first visit (never-configured → configured). */
export async function ensureDiscordIntegration() {
  const { organizationId } = await requirePermission("orgSettings", "update");
  const existing = await prisma.discordIntegration.findUnique({ where: { organizationId } });
  if (existing) return serialize(existing);
  const created = await prisma.discordIntegration.create({
    data: { organizationId, signingSecret: generateSecret() },
  });
  return serialize(created);
}

export async function updateDiscordIntegrationConfig(data: DiscordIntegrationConfigValues) {
  const { organizationId, userId, userName } = await requirePermission("orgSettings", "update");
  const parsed = discordIntegrationConfigSchema.parse(data);
  const existing = await prisma.discordIntegration.findUnique({ where: { organizationId } });

  const fields = {
    guildId: parsed.guildId || null,
    discordApplicationId: parsed.discordApplicationId || null,
    projectCategoryId: parsed.projectCategoryId || null,
    archiveCategoryId: parsed.archiveCategoryId || null,
    alertChannelId: parsed.alertChannelId || null,
    auditChannelId: parsed.auditChannelId || null,
    channelCreateOnStatuses: parsed.channelCreateOnStatuses,
    channelArchiveOnStatuses: parsed.channelArchiveOnStatuses,
    postWelcomeOnCreate: parsed.postWelcomeOnCreate,
    postFaultsToProjectChannel: parsed.postFaultsToProjectChannel,
    linkTokenTtlMinutes: parsed.linkTokenTtlMinutes,
    enrollmentOpen: parsed.enrollmentOpen,
  };

  const result = await prisma.discordIntegration.upsert({
    where: { organizationId },
    create: { organizationId, signingSecret: existing?.signingSecret ?? generateSecret(), ...fields },
    update: fields,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "discord_integration",
    entityId: result.id,
    entityName: "Discord Integration",
    summary: "Updated Discord integration settings",
  });

  return serialize(result);
}

export async function setDiscordIntegrationEnabled(enabled: boolean) {
  const { organizationId, userId, userName } = await requirePermission("orgSettings", "update");
  const existing = await prisma.discordIntegration.findUnique({ where: { organizationId } });

  const result = await prisma.discordIntegration.upsert({
    where: { organizationId },
    create: { organizationId, signingSecret: existing?.signingSecret ?? generateSecret(), isEnabled: enabled },
    update: { isEnabled: enabled },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "discord_integration",
    entityId: result.id,
    entityName: "Discord Integration",
    summary: enabled ? "Enabled Discord integration" : "Disabled Discord integration",
  });

  return serialize(result);
}

/**
 * Set or clear the Discord bot token. The token is encrypted at rest via
 * secret-vault (AES-256-GCM, key derived from BETTER_AUTH_SECRET). Pass `null`
 * to clear; pass a fresh string to replace. The token is never returned by
 * getDiscordIntegrationSettings — only `hasDiscordBotToken: boolean` is exposed.
 */
export async function setDiscordCredentials(data: DiscordCredentialsValues) {
  const { organizationId, userId, userName } = await requirePermission("orgSettings", "update");
  const parsed = discordCredentialsSchema.parse(data);
  const existing = await prisma.discordIntegration.findUnique({ where: { organizationId } });

  const encryptedToken =
    parsed.discordBotToken === null
      ? null
      : parsed.discordBotToken.trim() === ""
        ? existing?.discordBotToken ?? null // empty string = no change
        : encryptSecret(parsed.discordBotToken.trim());

  const result = await prisma.discordIntegration.upsert({
    where: { organizationId },
    create: {
      organizationId,
      signingSecret: existing?.signingSecret ?? generateSecret(),
      discordBotToken: encryptedToken,
    },
    update: { discordBotToken: encryptedToken },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "discord_integration",
    entityId: result.id,
    entityName: "Discord Integration",
    summary:
      parsed.discordBotToken === null
        ? "Cleared Discord bot token"
        : "Updated Discord bot token",
  });

  return { hasDiscordBotToken: !!encryptedToken };
}

/**
 * Push the slash command registry to Discord (guild-scoped, instant). Replaces
 * the old `npm run deploy-commands` CLI now that the bot runs in-process. Reads
 * the encrypted bot token, app id, and guild id straight from the integration
 * row; surfaces the most likely operator-fixable failure modes with a clear
 * error rather than the raw Discord exception.
 */
export async function deployDiscordCommands() {
  const { organizationId, userId, userName } = await requirePermission("orgSettings", "update");
  const row = await prisma.discordIntegration.findUnique({ where: { organizationId } });
  if (!row) {
    throw new Error("Discord integration is not configured yet.");
  }
  const missing: string[] = [];
  if (!row.discordBotToken) missing.push("bot token");
  if (!row.discordApplicationId) missing.push("application id");
  if (!row.guildId) missing.push("guild id");
  if (missing.length > 0) {
    throw new Error(
      `Cannot deploy commands — missing: ${missing.join(", ")}. Fill these in above and save first.`,
    );
  }
  let token: string;
  try {
    token = decryptSecret(row.discordBotToken!);
  } catch {
    throw new Error("Failed to decrypt the stored Discord bot token. Re-paste it and try again.");
  }

  const result = await deployCommandsToDiscord({
    discordBotToken: token,
    discordApplicationId: row.discordApplicationId!,
    guildId: row.guildId!,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "discord_integration",
    entityId: row.id,
    entityName: "Discord Integration",
    summary: `Deployed ${result.deployed} slash commands to guild`,
    details: { commands: result.commandNames },
  });

  return result;
}

export async function regenerateDiscordSigningSecret() {
  const { organizationId, userId, userName } = await requirePermission("orgSettings", "update");
  const secret = generateSecret();
  const result = await prisma.discordIntegration.upsert({
    where: { organizationId },
    create: { organizationId, signingSecret: secret },
    update: { signingSecret: secret },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "discord_integration",
    entityId: result.id,
    entityName: "Discord Integration",
    summary: "Regenerated Discord signing secret",
  });

  return { secret };
}

/** Admin unlink (the `/unlink @user` equivalent, from the UI). */
export async function unlinkDiscordAccount(crewMemberId: string) {
  const { organizationId, userId, userName } = await requirePermission("orgSettings", "update");

  const link = await prisma.discordAccountLink.findFirst({
    where: { organizationId, crewMemberId },
    include: { crewMember: { select: { firstName: true, lastName: true } } },
  });
  if (!link) throw new Error("No linked Discord account for this crew member.");

  await prisma.discordAccountLink.delete({ where: { id: link.id } });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "discord_account_link",
    entityId: link.id,
    entityName: `${link.crewMember.firstName} ${link.crewMember.lastName}`.trim(),
    summary: `Unlinked Discord account from ${link.crewMember.firstName} ${link.crewMember.lastName}`,
  });

  return { success: true };
}
