"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { getClientsByOrg } from "@/lib/clients-read";
import { getAssetsByOrg, getBulkAssetsByOrg } from "@/lib/assets-read";
import { getProjectsByOrg } from "@/lib/projects-read";
import { serialize } from "@/lib/serialize";
import { executeReport, generateCSV } from "@/lib/report-engine";
import { logActivity } from "@/lib/activity-log";
import {
  mirrorSavedReportCreate,
  patchSavedReportInConvex,
  removeSavedReportFromConvex,
} from "@/lib/saved-reports-mirror";
import type { ReportConfig } from "@/lib/report-types";
import type { Prisma } from "@/generated/prisma/client";

// ─── Dashboard summary (preserved from original) ────────────────────────────

export async function getReportsSummary() {
  const { organizationId } = await getOrgContext();

  const [allAssets, allBulkAssets, allProjects, totalClients, maintenanceSummary] = await Promise.all([
    getAssetsByOrg(organizationId),
    getBulkAssetsByOrg(organizationId),
    getProjectsByOrg(organizationId),
    // Clients live in Convex now — count active ones there.
    getClientsByOrg(organizationId).then((cs) => cs.filter((c) => c.isActive ?? true).length),
    prisma.maintenanceRecord.groupBy({
      by: ["status"],
      where: { organizationId },
      _count: { status: true },
    }),
  ]);

  const activeAssets = allAssets.filter((a) => a.isActive !== false);
  const activeBulkAssets = allBulkAssets.filter((ba) => ba.isActive !== false);
  const orgProjects = allProjects.filter((p) => !p.isTemplate);

  const totalSerializedAssets = activeAssets.length;
  const totalBulkAssets = activeBulkAssets.length;

  const assetStatusCounts = new Map<string, number>();
  for (const a of activeAssets) {
    const s = a.status ?? "AVAILABLE";
    assetStatusCounts.set(s, (assetStatusCounts.get(s) ?? 0) + 1);
  }

  const projectStatusCounts = new Map<string, number>();
  for (const p of orgProjects) {
    const s = p.status ?? "ENQUIRY";
    projectStatusCounts.set(s, (projectStatusCounts.get(s) ?? 0) + 1);
  }

  const totalRevenue = orgProjects
    .filter((p) => p.status === "INVOICED" || p.status === "COMPLETED")
    .reduce((sum, p) => {
      const amount = p.invoicedTotal != null ? Number(p.invoicedTotal) : (p.total ? Number(p.total) : 0);
      return sum + amount;
    }, 0);

  return serialize({
    totalSerializedAssets,
    totalBulkAssets,
    assetsByStatus: Array.from(assetStatusCounts.entries()).map(([status, count]) => ({ status, count })),
    projectsByStatus: Array.from(projectStatusCounts.entries()).map(([status, count]) => ({ status, count })),
    totalClients,
    totalRevenue,
    maintenanceSummary: maintenanceSummary.map((g) => ({
      status: g.status,
      count: g._count.status,
    })),
  });
}

// ─── Report execution ────────────────────────────────────────────────────────

export async function runReport(config: ReportConfig, page = 1, pageSize = 100) {
  const { organizationId } = await requirePermission("reports", "view");
  const result = await executeReport(config, organizationId, page, pageSize);
  return serialize(result);
}

export async function runReportCSV(config: ReportConfig) {
  const { organizationId } = await requirePermission("reports", "export");
  // Fetch all rows for export (up to 10,000)
  const result = await executeReport(config, organizationId, 1, 10000);
  return generateCSV(result);
}

// ─── Saved Report CRUD ───────────────────────────────────────────────────────

export async function getSavedReports() {
  const { organizationId, userId } = await requirePermission("reports", "view");

  const reports = await prisma.savedReport.findMany({
    where: {
      organizationId,
      OR: [
        { createdById: userId },
        { isShared: true },
      ],
    },
    include: {
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: [
      { isPinned: "desc" },
      { updatedAt: "desc" },
    ],
  });

  return serialize(reports);
}

export async function getSavedReportById(id: string) {
  const { organizationId, userId } = await requirePermission("reports", "view");

  const report = await prisma.savedReport.findFirst({
    where: {
      id,
      organizationId,
      OR: [
        { createdById: userId },
        { isShared: true },
      ],
    },
    include: {
      createdBy: { select: { id: true, name: true } },
    },
  });

  if (!report) throw new Error("Report not found");

  return serialize(report);
}

export async function saveReport(data: {
  name: string;
  description?: string;
  dataSource: string;
  config: ReportConfig;
  isShared?: boolean;
  isPinned?: boolean;
}) {
  const { organizationId, userId, userName } = await requirePermission("reports", "view");

  const report = await prisma.savedReport.create({
    data: {
      organizationId,
      name: data.name,
      description: data.description,
      dataSource: data.dataSource,
      config: data.config as unknown as Prisma.InputJsonValue,
      createdById: userId,
      isShared: data.isShared ?? false,
      isPinned: data.isPinned ?? false,
    },
  });

  await mirrorSavedReportCreate(report as unknown as Record<string, unknown>);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "created",
    entityType: "SavedReport",
    entityId: report.id,
    entityName: report.name,
    summary: `Created saved report "${report.name}"`,
  });

  return serialize(report);
}

export async function updateSavedReport(
  id: string,
  data: {
    name?: string;
    description?: string;
    config?: ReportConfig;
    isShared?: boolean;
    isPinned?: boolean;
  },
) {
  const { organizationId, userId, userName } = await requirePermission("reports", "view");

  const existing = await prisma.savedReport.findFirst({
    where: { id, organizationId, createdById: userId },
  });

  if (!existing) throw new Error("Report not found or you don't have permission to edit it");

  const report = await prisma.savedReport.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.config !== undefined ? { config: data.config as unknown as Prisma.InputJsonValue } : {}),
      ...(data.isShared !== undefined ? { isShared: data.isShared } : {}),
      ...(data.isPinned !== undefined ? { isPinned: data.isPinned } : {}),
    },
  });

  await patchSavedReportInConvex(report.id, report as unknown as Record<string, unknown>);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "updated",
    entityType: "SavedReport",
    entityId: report.id,
    entityName: report.name,
    summary: `Updated saved report "${report.name}"`,
  });

  return serialize(report);
}

export async function deleteSavedReport(id: string) {
  const { organizationId, userId, userName } = await requirePermission("reports", "view");

  const existing = await prisma.savedReport.findFirst({
    where: { id, organizationId, createdById: userId },
  });

  if (!existing) throw new Error("Report not found or you don't have permission to delete it");

  await prisma.savedReport.delete({ where: { id } });

  await removeSavedReportFromConvex(id);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "deleted",
    entityType: "SavedReport",
    entityId: existing.id,
    entityName: existing.name,
    summary: `Deleted saved report "${existing.name}"`,
  });
}

export async function togglePinReport(id: string) {
  const { organizationId, userId } = await requirePermission("reports", "view");

  const existing = await prisma.savedReport.findFirst({
    where: {
      id,
      organizationId,
      OR: [{ createdById: userId }, { isShared: true }],
    },
  });

  if (!existing) throw new Error("Report not found");

  const report = await prisma.savedReport.update({
    where: { id },
    data: { isPinned: !existing.isPinned },
  });

  await patchSavedReportInConvex(report.id, report as unknown as Record<string, unknown>);

  return serialize(report);
}

export async function updateReportLastRun(id: string) {
  const { organizationId } = await getOrgContext();

  await prisma.savedReport.updateMany({
    where: { id, organizationId },
    data: { lastRunAt: new Date() },
  });
}
