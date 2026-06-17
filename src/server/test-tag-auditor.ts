"use server";

import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import {
  getTestTagAssetsByOrg,
  assetMatchesAuditorScope,
  cmpStrAsc,
} from "@/lib/test-tag-read";

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

  const record = await prisma.testTagAuditorToken.create({
    data: {
      organizationId,
      name: data.name,
      token: rawToken,
      tokenHash,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      scope: scopeJson,
      createdById: userId,
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "testTagAuditorToken",
    entityId: record.id,
    entityName: data.name,
    summary: `Created auditor portal link "${data.name}"`,
  });

  return serialize({ ...record, token: rawToken });
}

export async function getAuditorTokens() {
  const { organizationId } = await getOrgContext();

  const tokens = await prisma.testTagAuditorToken.findMany({
    where: { organizationId },
    include: {
      createdBy: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return serialize(tokens);
}

export async function updateAuditorToken(id: string, data: {
  name?: string;
  expiresAt?: Date | string | null;
  scope?: AuditorTokenScope | null;
}) {
  const { organizationId, userId, userName } = await requirePermission("testTag", "update");

  const existing = await prisma.testTagAuditorToken.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new Error("Auditor token not found");

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

  const updated = await prisma.testTagAuditorToken.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.expiresAt !== undefined && { expiresAt: data.expiresAt ? new Date(data.expiresAt) : null }),
      ...(scopeJson !== undefined && { scope: scopeJson }),
    },
  });

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

  return serialize(updated);
}

export async function revokeAuditorToken(id: string) {
  const { organizationId, userId, userName } = await requirePermission("testTag", "delete");

  const token = await prisma.testTagAuditorToken.findFirst({
    where: { id, organizationId },
  });
  if (!token) throw new Error("Auditor token not found");

  await prisma.testTagAuditorToken.update({
    where: { id },
    data: { isActive: false },
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

  const token = await prisma.testTagAuditorToken.findFirst({
    where: { id, organizationId },
  });
  if (!token) throw new Error("Auditor token not found");

  await prisma.testTagAuditorToken.delete({ where: { id } });

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

  const record = await prisma.testTagAuditorToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      organizationId: true,
      name: true,
      isActive: true,
      expiresAt: true,
      scope: true,
    },
  });

  if (!record || !record.isActive) return null;

  // Check expiry
  if (record.expiresAt && record.expiresAt < new Date()) return null;

  // Update last accessed (fire-and-forget)
  prisma.testTagAuditorToken
    .update({
      where: { id: record.id },
      data: { lastAccessedAt: new Date() },
    })
    .catch(() => {});

  return { ...record, parsedScope: parseScope(record.scope) };
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
