"use server";

import crypto from "crypto";
import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import {
  getTestTagAssetsByOrg,
  assetMatchesAuditorScope,
  cmpStrAsc,
} from "@/lib/test-tag-read";
import {
  getAuditorTokensByOrg,
  getAuditorTokenById,
  getAuditorTokenByHash,
} from "@/lib/test-tag-auditor-token-read";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ─── Scope Types ─────────────────────────────────────────────────────────────

export interface AuditorTokenScope {
  categories?: string[];       // applianceType values
  equipmentClasses?: string[]; // equipmentClass values
  locations?: string[];        // location strings
  assetIds?: string[];         // specific testTagAsset IDs
}

function parseScope(raw: string | null): AuditorTokenScope | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// ─── Token CRUD (admin) ─────────────────────────────────────────────────────

export async function createAuditorToken(data: {
  name: string;
  expiresAt?: Date | string | null;
  scope?: AuditorTokenScope | null;
}) {
  const { organizationId, userId, userName } = await requirePermission("testTag", "create");

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);

  // Clean up empty scope arrays
  let scopeJson: string | null = null;
  if (data.scope) {
    const cleaned: AuditorTokenScope = {};
    if (data.scope.categories?.length) cleaned.categories = data.scope.categories;
    if (data.scope.equipmentClasses?.length) cleaned.equipmentClasses = data.scope.equipmentClasses;
    if (data.scope.locations?.length) cleaned.locations = data.scope.locations;
    if (data.scope.assetIds?.length) cleaned.assetIds = data.scope.assetIds;
    if (Object.keys(cleaned).length > 0) scopeJson = JSON.stringify(cleaned);
  }

  // Convex-only write (Phase B): create the testTagAuditorTokens doc.
  const id = createId();
  const now = Date.now();
  const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
  await (await getConvexClient()).mutation(api.testTagAuditorTokens.create, {
    id,
    organizationId,
    name: data.name,
    token: rawToken,
    tokenHash,
    isActive: true,
    expiresAt: expiresAt ? expiresAt.getTime() : undefined,
    scope: scopeJson || undefined,
    createdById: userId,
    createdAt: now,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "testTagAuditorToken",
    entityId: id,
    entityName: data.name,
    summary: `Created auditor portal link "${data.name}"`,
  });

  return serialize({
    id,
    organizationId,
    name: data.name,
    token: rawToken,
    tokenHash,
    isActive: true,
    expiresAt,
    scope: scopeJson,
    createdById: userId,
    lastAccessedAt: null,
    createdAt: new Date(now),
  });
}

export async function getAuditorTokens() {
  const { organizationId } = await getOrgContext();

  // Convex-only (Phase B): tokens from Convex, newest first; the createdBy Auth
  // User join (User stays Prisma) is attached in one batched findMany.
  const tokens = await getAuditorTokensByOrg(organizationId);
  const ids = Array.from(new Set(tokens.map((t) => t.createdById)));
  const users = ids.length
    ? await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));
  const withCreatedBy = tokens.map((t) => ({
    ...t,
    createdBy: userMap.has(t.createdById)
      ? { name: userMap.get(t.createdById)!.name, email: userMap.get(t.createdById)!.email }
      : null,
  }));

  return serialize(withCreatedBy);
}

export async function updateAuditorToken(id: string, data: {
  name?: string;
  expiresAt?: Date | string | null;
  scope?: AuditorTokenScope | null;
}) {
  const { organizationId, userId, userName } = await requirePermission("testTag", "update");

  const existing = await getAuditorTokenById(id);
  if (!existing || existing.organizationId !== organizationId) {
    throw new Error("Auditor token not found");
  }

  // Clean up empty scope arrays
  let scopeJson: string | null | undefined = undefined;
  if (data.scope !== undefined) {
    if (data.scope === null) {
      scopeJson = null;
    } else {
      const cleaned: AuditorTokenScope = {};
      if (data.scope.categories?.length) cleaned.categories = data.scope.categories;
      if (data.scope.equipmentClasses?.length) cleaned.equipmentClasses = data.scope.equipmentClasses;
      if (data.scope.locations?.length) cleaned.locations = data.scope.locations;
      if (data.scope.assetIds?.length) cleaned.assetIds = data.scope.assetIds;
      scopeJson = Object.keys(cleaned).length > 0 ? JSON.stringify(cleaned) : null;
    }
  }

  // Convex-only update (Phase B). Only send the provided fields. For an optional
  // Convex field, sending `undefined` clears it — matching the old Prisma write
  // of `null` (expiresAt cleared, scope cleared).
  const patch: {
    name?: string;
    expiresAt?: number;
    scope?: string;
  } = {};
  if (data.name !== undefined) patch.name = data.name;
  const sendExpires = data.expiresAt !== undefined;
  const newExpiresAt = sendExpires
    ? data.expiresAt
      ? new Date(data.expiresAt)
      : null
    : existing.expiresAt;
  if (sendExpires) patch.expiresAt = newExpiresAt ? newExpiresAt.getTime() : undefined;
  const sendScope = scopeJson !== undefined;
  if (sendScope) patch.scope = scopeJson || undefined;
  await (await getConvexClient()).mutation(api.testTagAuditorTokens.update, { id, patch });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "testTagAuditorToken",
    entityId: id,
    entityName: data.name || existing.name,
    summary: `Updated auditor portal link "${data.name || existing.name}"`,
  });

  return serialize({
    id,
    organizationId: existing.organizationId,
    name: data.name ?? existing.name,
    token: existing.token,
    tokenHash: existing.tokenHash,
    isActive: existing.isActive,
    expiresAt: newExpiresAt,
    scope: sendScope ? scopeJson ?? null : existing.scope,
    createdById: existing.createdById,
    lastAccessedAt: existing.lastAccessedAt,
    createdAt: existing.createdAt,
  });
}

export async function revokeAuditorToken(id: string) {
  const { organizationId, userId, userName } = await requirePermission("testTag", "delete");

  const token = await getAuditorTokenById(id);
  if (!token || token.organizationId !== organizationId) {
    throw new Error("Auditor token not found");
  }

  // Convex-only soft-revoke (Phase B): flip isActive false.
  await (await getConvexClient()).mutation(api.testTagAuditorTokens.update, {
    id,
    patch: { isActive: false },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "testTagAuditorToken",
    entityId: id,
    entityName: token.name,
    summary: `Revoked auditor portal link "${token.name}"`,
  });

  return { success: true };
}

export async function deleteAuditorToken(id: string) {
  const { organizationId, userId, userName } = await requirePermission("testTag", "delete");

  const token = await getAuditorTokenById(id);
  if (!token || token.organizationId !== organizationId) {
    throw new Error("Auditor token not found");
  }

  // Convex-only hard delete (Phase B).
  await (await getConvexClient()).mutation(api.testTagAuditorTokens.remove, { id });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "testTagAuditorToken",
    entityId: id,
    entityName: token.name,
    summary: `Deleted auditor portal link "${token.name}"`,
  });

  return { success: true };
}

// ─── Helpers for scope picker data ──────────────────────────────────────────

export async function getAuditorScopeOptions() {
  const { organizationId } = await getOrgContext();

  // Convex read (testTagAsset is dual-written). Distinct facets + the sorted
  // asset list are computed in JS — replicating the old Prisma `distinct` /
  // `orderBy` queries over `isActive: true` assets.
  const active = (await getTestTagAssetsByOrg(organizationId)).filter((a) => a.isActive === true);

  const applianceTypes = [...new Set(active.map((a) => a.applianceType))];
  const equipmentClasses = [...new Set(active.map((a) => a.equipmentClass))];
  const locations = [...new Set(active.map((a) => a.location).filter((l): l is string => Boolean(l)))];

  const assets = active
    .map((a) => ({ id: a.id, testTagId: a.testTagId, description: a.description }))
    .sort((x, y) => cmpStrAsc(x.testTagId, y.testTagId));

  return serialize({
    applianceTypes,
    equipmentClasses,
    locations,
    assets,
  });
}

// ─── Public token validation (no auth required) ─────────────────────────────

export async function validateAuditorToken(rawToken: string) {
  const tokenHash = hashToken(rawToken);

  // Convex-only (Phase B): secure lookup by tokenHash. Preserves the exact
  // validation semantics: a hash miss OR an inactive token → null.
  const record = await getAuditorTokenByHash(tokenHash);

  if (!record || !record.isActive) return null;

  // Check expiry — identical to the old `record.expiresAt < new Date()`.
  if (record.expiresAt && record.expiresAt < new Date()) return null;

  // Update last accessed (fire-and-forget) — Convex-only patch.
  void (async () => {
    try {
      await (await getConvexClient()).mutation(api.testTagAuditorTokens.update, {
        id: record.id,
        patch: { lastAccessedAt: Date.now() },
      });
    } catch {
      /* fire-and-forget: a failed touch must not block the public portal */
    }
  })();

  return {
    id: record.id,
    organizationId: record.organizationId,
    name: record.name,
    isActive: record.isActive,
    expiresAt: record.expiresAt,
    scope: record.scope,
    parsedScope: parseScope(record.scope),
  };
}

// ─── Auditor portal data (no auth — uses token) ────────────────────────────

export async function getAuditorPortalData(
  organizationId: string,
  scope?: AuditorTokenScope | null,
) {
  // org/name stays Prisma — Better Auth `Organization` is not a domain table.
  // testTagAsset is dual-written → read from Convex, then apply the scope `where`
  // (org + `isActive: true` + the optional scope facets) as a pure JS predicate.
  const [org, allAssets] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, metadata: true },
    }),
    getTestTagAssetsByOrg(organizationId),
  ]);

  const scoped = allAssets.filter((a) => assetMatchesAuditorScope(a, scope));

  const assets = scoped
    .map((a) => ({
      id: a.id,
      testTagId: a.testTagId,
      description: a.description,
      equipmentClass: a.equipmentClass,
      applianceType: a.applianceType,
      make: a.make,
      modelName: a.modelName,
      serialNumber: a.serialNumber,
      location: a.location,
      status: a.status,
      lastTestDate: a.lastTestDate,
      nextDueDate: a.nextDueDate,
      testIntervalMonths: a.testIntervalMonths,
    }))
    .sort((x, y) => cmpStrAsc(x.testTagId, y.testTagId));

  // groupBy status → counts, computed over the same scoped set.
  const statusCounts: Record<string, number> = {};
  for (const a of scoped) {
    statusCounts[a.status] = (statusCounts[a.status] ?? 0) + 1;
  }

  const total = assets.length;
  const current = statusCounts["CURRENT"] || 0;
  const dueSoon = statusCounts["DUE_SOON"] || 0;
  const overdue = statusCounts["OVERDUE"] || 0;
  const failed = statusCounts["FAILED"] || 0;
  const notTested = statusCounts["NOT_YET_TESTED"] || 0;

  const complianceRate = total > 0
    ? Math.round(((current + dueSoon) / total) * 100)
    : 0;

  // Build scope description for the portal header
  const scopeLabels: string[] = [];
  if (scope?.categories?.length) scopeLabels.push(`${scope.categories.length} category filter${scope.categories.length > 1 ? "s" : ""}`);
  if (scope?.equipmentClasses?.length) scopeLabels.push(`${scope.equipmentClasses.length} class filter${scope.equipmentClasses.length > 1 ? "s" : ""}`);
  if (scope?.locations?.length) scopeLabels.push(`${scope.locations.length} location${scope.locations.length > 1 ? "s" : ""}`);
  if (scope?.assetIds?.length) scopeLabels.push(`${scope.assetIds.length} specific asset${scope.assetIds.length > 1 ? "s" : ""}`);

  return serialize({
    orgName: org?.name || "Unknown",
    assets,
    summary: {
      total,
      current,
      dueSoon,
      overdue,
      failed,
      notTested,
      complianceRate,
    },
    scopeDescription: scopeLabels.length > 0 ? scopeLabels.join(", ") : null,
    generatedAt: new Date().toISOString(),
  });
}
