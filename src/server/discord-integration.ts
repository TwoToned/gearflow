"use server";

import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import {
  discordIntegrationConfigSchema,
  type DiscordIntegrationConfigValues,
} from "@/lib/validations/discord-integration";

function generateSecret(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Everything the admin page renders — config + connection health + the FULL crew
 * roster (linked AND unlinked, partial is the steady state) + recent activity.
 * All from the DB; the page derives online/offline from `lastHeartbeatAt` and
 * never blocks on the bot.
 */
export async function getDiscordIntegrationSettings() {
  const { organizationId } = await requirePermission("orgSettings", "read");

  const integration = await prisma.discordIntegration.findUnique({
    where: { organizationId },
  });

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
    projectCategoryId: parsed.projectCategoryId || null,
    alertChannelId: parsed.alertChannelId || null,
    auditChannelId: parsed.auditChannelId || null,
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
