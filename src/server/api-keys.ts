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
import { readOrgSettings, setApiKillSwitchConvex } from "@/lib/org-settings-read";

// ApiKey is a Convex domain now (the Postgres `api_key` table is frozen). The
// Better-Auth `member` (acting-user membership) + `organization` (kill switch) reads
// below stay on Postgres by design. Convex stores date fields as epoch-ms; map them
// back to Date so the serialized shape matches the old Prisma `select`.
type ConvexApiKey = {
  id: string; name: string; prefix: string; scopes?: string; isActive?: boolean;
  actingUserId: string; expiresAt?: number; lastUsedAt?: number;
  lastRotatedAt?: number; revokedAt?: number; createdAt?: number;
  noFinancials?: boolean;
  // Phase 7 (#1003) — OAuth-issued grants only; absent on every manually-minted key.
  origin?: "manual" | "oauth";
  oauthClientId?: string;
};
function toKeyRow(k: ConvexApiKey, clientNameById: Record<string, string>) {
  const d = (n: number | undefined | null) => (n != null ? new Date(n) : null);
  return {
    id: k.id, name: k.name, prefix: k.prefix,
    scopes: k.scopes ?? "[]",
    isActive: k.isActive ?? true,
    actingUserId: k.actingUserId,
    noFinancials: k.noFinancials ?? false,
    origin: k.origin ?? "manual",
    oauthClientName: k.oauthClientId ? clientNameById[k.oauthClientId] ?? k.oauthClientId : null,
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
 *
 * OAuth grants (#1003) are `apiKeys` rows too (`origin: "oauth"`) — they're
 * listed, revoked and kill-switched through the EXACT same code below as a
 * manually-minted key. This function's only OAuth-specific job is resolving
 * `oauthClientId` -> a display name for the "Connected app" column.
 */

/** List this org's API keys AND OAuth grants (never returns a secret — only
 *  the display prefix). */
export async function listApiKeys() {
  const { organizationId } = await getOrgContext();
  const convex = await getConvexClient();
  const rawKeys = await convex.query(api.apiKeys.list, {
    orgId: organizationId,
  });
  const clientIds = [...new Set(rawKeys.map((k) => k.oauthClientId).filter((id): id is string => !!id))];
  const clients = clientIds.length ? await convex.query(api.oauthClients.listByIds, { ids: clientIds }) : [];
  const clientNameById = Object.fromEntries(clients.map((c) => [c.id, c.clientName ?? c.id]));
  const keys = rawKeys.map((k) => toKeyRow(k, clientNameById)); // strips tokenHash/refreshTokenHash — never leaves the backend
  const { apiKillSwitchAt } = await readOrgSettings(organizationId);
  return serialize({ keys, apiKillSwitchAt });
}

/** `undefined` = no expiry. Throws on an unparseable/non-finite date. */
function parseExpiresAt(expiresAt: Date | string | null | undefined): number | undefined {
  if (!expiresAt) return undefined;
  const ms = new Date(expiresAt).getTime();
  if (!Number.isFinite(ms)) throw new Error("Invalid expiry date.");
  return ms;
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
  /** Decision 6 — force-redact cost/margin regardless of the acting user's role. */
  noFinancials?: boolean;
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
  const expiresAtMs = parseExpiresAt(input.expiresAt);
  const noFinancials = input.noFinancials === true;
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
    noFinancials,
  });
  const created = toKeyRow(
    { id, name, prefix, scopes: JSON.stringify(scopes), isActive: true, actingUserId, expiresAt: expiresAtMs, createdAt: now, noFinancials },
    {},
  );

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "create",
    entityType: "apiKey",
    entityId: created.id,
    entityName: name,
    summary: `Created API key "${name}"`,
    metadata: { scopes, actingUserId, noFinancials },
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

  const apiKillSwitchAt = await setApiKillSwitchConvex(organizationId, enabled);

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

  return serialize({ apiKillSwitchAt });
}

/**
 * Rotate a key's secret with a grace window (design §14): the OLD secret keeps
 * authenticating for `graceMinutes` (default 60, capped at 24h — same bounds as
 * `rotateWebhookSecret`) so an in-flight agent/MCP client can roll over without
 * a hard cutover. Returns the new raw token ONCE — same one-time-reveal
 * contract as `createApiKey`.
 */
export async function rotateApiKey(id: string, graceMinutes?: number) {
  const { organizationId, userId, userName } = await requirePermission(
    "orgSettings",
    "update",
  );

  const { raw, prefix, tokenHash } = generateApiKey();
  const grace = Math.min(Math.max(graceMinutes ?? 60, 0), 24 * 60);

  let rotated: { id: string; name: string; prefix: string };
  try {
    rotated = await (await getConvexClient()).mutation(api.apiKeys.rotate, {
      id,
      orgId: organizationId,
      prefix,
      tokenHash,
      previousTokenHashExpiresAt: Date.now() + grace * 60_000,
    });
  } catch {
    throw new Error("API key not found.");
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "update",
    entityType: "apiKey",
    entityId: id,
    entityName: rotated.name,
    summary: `Rotated API key "${rotated.name}"`,
    metadata: { graceMinutes: grace },
  });

  // `token` is the only time the new raw secret is ever exposed.
  return serialize({ token: raw, prefix: rotated.prefix, graceMinutes: grace });
}

/**
 * The per-key request log a Settings page renders (design §11, "last ~200
 * calls"). `apiRequestLog.recentForKey` is keyed by `apiKeyId` alone with no
 * org check of its own (it's SERVICE-only, trusted-caller infrastructure) —
 * so this wrapper MUST confirm the key belongs to the caller's org before
 * querying it, or a guessed/leaked key id would leak another org's redacted
 * request log (R-8.4.3).
 */
export async function getApiKeyRequestLog(apiKeyId: string, limit?: number) {
  const { organizationId } = await requirePermission("orgSettings", "read");

  const convex = await getConvexClient();
  const orgKeys = await convex.query(api.apiKeys.list, { orgId: organizationId });
  const owned = orgKeys.some((k: { id: string }) => k.id === apiKeyId);
  if (!owned) throw new Error("API key not found.");

  const entries = await convex.query(api.apiRequestLog.recentForKey, {
    apiKeyId,
    limit,
  });
  return serialize({ entries });
}
