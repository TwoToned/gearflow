"use server";

import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ─── Token CRUD (admin) ─────────────────────────────────────────────────────

export async function createAuditorToken(data: {
  name: string;
  expiresAt?: Date | string | null;
}) {
  const { organizationId, userId, userName } = await requirePermission("testTag", "create");

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);

  const record = await prisma.testTagAuditorToken.create({
    data: {
      organizationId,
      name: data.name,
      token: rawToken,
      tokenHash,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
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

  return record;
}

// ─── Auditor portal data (no auth — uses token) ────────────────────────────

export async function getAuditorPortalData(organizationId: string) {
  const [org, assets, stats] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, metadata: true },
    }),
    prisma.testTagAsset.findMany({
      where: { organizationId, isActive: true },
      select: {
        id: true,
        testTagId: true,
        description: true,
        equipmentClass: true,
        applianceType: true,
        make: true,
        modelName: true,
        serialNumber: true,
        location: true,
        status: true,
        lastTestDate: true,
        nextDueDate: true,
        testIntervalMonths: true,
      },
      orderBy: { testTagId: "asc" },
    }),
    prisma.testTagAsset.groupBy({
      by: ["status"],
      where: { organizationId, isActive: true },
      _count: true,
    }),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const s of stats) {
    statusCounts[s.status] = s._count;
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
    generatedAt: new Date().toISOString(),
  });
}
