"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { generateApiKey, assertScopesWithinActor } from "@/lib/api-key";
import { getAmbientActor } from "@/lib/request-actor";

/**
 * Management for agent-accessible API keys (docs/designs/api-mcp-agent-access.md).
 * Creating/revoking a key and flipping the org kill switch are org-settings writes;
 * listing is an org-scoped read. The raw secret is returned exactly ONCE, at
 * creation — only its SHA-256 hash is ever stored.
 */

const READ_SHAPE = {
  id: true,
  name: true,
  prefix: true,
  scopes: true,
  isActive: true,
  actingUserId: true,
  expiresAt: true,
  lastUsedAt: true,
  lastRotatedAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

/** List this org's API keys (never returns a secret — only the display prefix). */
export async function listApiKeys() {
  const { organizationId } = await getOrgContext();
  const keys = await prisma.apiKey.findMany({
    where: { organizationId },
    select: READ_SHAPE,
    orderBy: { createdAt: "desc" },
  });
  const killSwitch = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { apiKillSwitchAt: true },
  });
  return serialize({ keys, apiKillSwitchAt: killSwitch?.apiKillSwitchAt ?? null });
}

/**
 * Mint a new key. Returns the raw token ONCE — show it to the user immediately;
 * it can never be retrieved again. The key acts as `actingUserId` (defaults to the
 * creator); effective permission is the intersection of these scopes and that
 * user's live RBAC.
 */
export async function createApiKey(input: {
  name: string;
  scopes: string[];
  actingUserId?: string;
  expiresAt?: Date | string | null;
}) {
  const { organizationId, userId, userName } = await requirePermission(
    "orgSettings",
    "update",
  );

  const name = input.name?.trim();
  if (!name) throw new Error("A key name is required.");

  const actingUserId = input.actingUserId ?? userId;
  // The acting user must be a member of this org (keys can't act as outsiders).
  const member = await prisma.member.findFirst({
    where: { organizationId, userId: actingUserId },
    select: { id: true },
  });
  if (!member) throw new Error("The acting user must be a member of this organization.");

  const scopes = Array.isArray(input.scopes) ? input.scopes.filter((s) => typeof s === "string") : [];

  // A key may not mint a key more powerful than itself. No-op for human sessions,
  // which are already bounded by the acting user's role.
  const actor = getAmbientActor();
  if (actor) assertScopesWithinActor(actor, scopes);

  const { raw, prefix, tokenHash } = generateApiKey();

  const created = await prisma.apiKey.create({
    data: {
      organizationId,
      name,
      prefix,
      tokenHash,
      scopes: JSON.stringify(scopes),
      actingUserId,
      createdById: userId,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    },
    select: READ_SHAPE,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "create",
    entityType: "apiKey",
    entityId: created.id,
    entityName: name,
    summary: `Created API key "${name}"`,
    metadata: { scopes, actingUserId },
  });

  // `token` is the only time the raw secret is ever exposed.
  return serialize({ token: raw, key: created });
}

/** Revoke a single key (deactivate + stamp revokedAt). Idempotent. */
export async function revokeApiKey(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "orgSettings",
    "update",
  );

  const key = await prisma.apiKey.findFirst({
    where: { id, organizationId },
    select: { id: true, name: true },
  });
  if (!key) throw new Error("API key not found.");

  await prisma.apiKey.update({
    where: { id },
    data: { isActive: false, revokedAt: new Date() },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "delete",
    entityType: "apiKey",
    entityId: id,
    entityName: key.name,
    summary: `Revoked API key "${key.name}"`,
  });

  return serialize({ success: true });
}

/**
 * Flip the org-wide API kill switch. When on, EVERY key for this org is rejected
 * instantly (blast-radius containment), regardless of per-key state.
 */
export async function setOrgApiKillSwitch(enabled: boolean) {
  const { organizationId, userId, userName } = await requirePermission(
    "orgSettings",
    "update",
  );

  await prisma.organization.update({
    where: { id: organizationId },
    data: { apiKillSwitchAt: enabled ? new Date() : null },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "update",
    entityType: "organization",
    entityId: organizationId,
    entityName: "API access",
    summary: enabled
      ? "Enabled org-wide API kill switch (all keys disabled)"
      : "Disabled org-wide API kill switch (keys re-enabled)",
  });

  return serialize({ apiKillSwitchAt: enabled ? new Date() : null });
}
