"use server";

import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { generateApiKey, assertScopesWithinActor } from "@/lib/api-key";
import { getAmbientActor } from "@/lib/request-actor";

// ApiKey is a Convex domain now (the Postgres `api_key` table is frozen). The
// Better-Auth `member` (acting-user membership) + `organization` (kill switch) reads
// below stay on Postgres by design. Convex stores date fields as epoch-ms; map them
// back to Date so the serialized shape matches the old Prisma `select`.
type ConvexApiKey = {
  id: string; name: string; prefix: string; scopes?: string; isActive?: boolean;
  actingUserId: string; expiresAt?: number; lastUsedAt?: number;
  lastRotatedAt?: number; revokedAt?: number; createdAt?: number;
};
function toKeyRow(k: ConvexApiKey) {
  const d = (n: number | undefined | null) => (n != null ? new Date(n) : null);
  return {
    id: k.id, name: k.name, prefix: k.prefix,
    scopes: k.scopes ?? "[]",
    isActive: k.isActive ?? true,
    actingUserId: k.actingUserId,
    expiresAt: d(k.expiresAt),
    lastUsedAt: d(k.lastUsedAt),
    lastRotatedAt: d(k.lastRotatedAt),
    revokedAt: d(k.revokedAt),
    createdAt: k.createdAt != null ? new Date(k.createdAt) : new Date(0),
  };
}

/**
 * Management for agent-accessible API keys (docs/designs/api-mcp-agent-access.md).
 * Creating/revoking a key and flipping the org kill switch are org-settings writes;
 * listing is an org-scoped read. The raw secret is returned exactly ONCE, at
 * creation — only its SHA-256 hash is ever stored.
 */

/** List this org's API keys (never returns a secret — only the display prefix). */
export async function listApiKeys() {
  const { organizationId } = await getOrgContext();
  const rawKeys = await (await getConvexClient()).query(api.apiKeys.list, {
    orgId: organizationId,
  });
  const keys = rawKeys.map(toKeyRow); // strips tokenHash — never leaves the backend
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

  const id = createId();
  const now = Date.now();
  const expiresAtMs = input.expiresAt ? new Date(input.expiresAt).getTime() : undefined;
  if (expiresAtMs !== undefined && !Number.isFinite(expiresAtMs)) {
    throw new Error("Invalid expiry date.");
  }
  await (await getConvexClient()).mutation(api.apiKeys.create, {
    id,
    organizationId,
    name,
    prefix,
    tokenHash,
    scopes: JSON.stringify(scopes),
    isActive: true,
    actingUserId,
    createdById: userId,
    expiresAt: expiresAtMs,
    createdAt: now,
  });
  const created = toKeyRow({
    id, name, prefix, scopes: JSON.stringify(scopes), isActive: true,
    actingUserId, expiresAt: expiresAtMs, createdAt: now,
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

  let key: { id: string; name: string };
  try {
    key = await (await getConvexClient()).mutation(api.apiKeys.revoke, {
      id,
      orgId: organizationId,
    });
  } catch {
    // Convex throws ConvexError("apiKey not found") when the key is missing or
    // belongs to another org — same 404 semantics as the old org-scoped findFirst.
    throw new Error("API key not found.");
  }

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
