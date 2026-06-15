"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext } from "@/lib/org-context";
import { attachClient } from "@/lib/clients-read";
import { serialize } from "@/lib/serialize";
import { listOpenBlockingThreads } from "@/lib/blocking-comments-read";
import { getModelMap } from "@/lib/models-read";
import { getAssetsByOrg, getBulkAssetsByOrg } from "@/lib/assets-read";
import { getProjectsByOrg, getProjectIdsForManager } from "@/lib/projects-read";

export async function getDashboardStats() {
  const { organizationId } = await getOrgContext();

  const now = new Date();

  const [allAssets, allBulkAssets, allProjects, maintenanceDue, overdueReturns, activeCrew, pendingCrewOffers] =
    await Promise.all([
      getAssetsByOrg(organizationId),
      getBulkAssetsByOrg(organizationId),
      getProjectsByOrg(organizationId),
      prisma.maintenanceRecord.count({
        where: {
          organizationId,
          status: { in: ["SCHEDULED", "IN_PROGRESS"] },
          scheduledDate: { lte: now },
        },
      }),
      prisma.projectLineItem.count({
        where: {
          organizationId,
          status: "CHECKED_OUT",
          project: {
            isTemplate: false,
            rentalEndDate: { lt: now },
            status: { notIn: ["RETURNED", "COMPLETED", "INVOICED", "CANCELLED"] },
          },
        },
      }),
      prisma.crewMember.count({
        where: { organizationId, status: "ACTIVE" },
      }),
      prisma.crewAssignment.count({
        where: { organizationId, status: { in: ["OFFERED", "PENDING"] } },
      }),
    ]);

  const activeAssets = allAssets.filter((a) => a.isActive !== false);
  const activeBulkAssets = allBulkAssets.filter((ba) => ba.isActive !== false);
  const totalAssets = activeAssets.length;
  const totalBulkQuantity = activeBulkAssets.reduce((sum, ba) => sum + (ba.totalQuantity ?? 0), 0);
  const checkedOutAssets = activeAssets.filter((a) => a.status === "CHECKED_OUT").length;
  const ACTIVE_PROJECT_STATUSES = new Set(["CONFIRMED", "PREPPING", "CHECKED_OUT", "ON_SITE"]);
  const activeProjects = allProjects.filter((p) => !p.isTemplate && ACTIVE_PROJECT_STATUSES.has(p.status ?? "")).length;

  return {
    totalAssets: totalAssets + totalBulkQuantity,
    checkedOutAssets,
    activeProjects,
    maintenanceDue,
    overdueReturns,
    activeCrew,
    pendingCrewOffers,
  };
}

/**
 * User-centric home data: the projects the current user manages (as the single
 * projectManager OR via the ProjectManager join), plus their org's display name.
 * Active projects only (not completed/invoiced/cancelled), soonest first.
 */
export async function getMyHomeData() {
  const { organizationId, userId, userName } = await getOrgContext();

  const INACTIVE_STATUSES = new Set(["COMPLETED", "INVOICED", "CANCELLED"]);
  const [allProjects, pmProjectIds] = await Promise.all([
    getProjectsByOrg(organizationId),
    getProjectIdsForManager(organizationId, userId),
  ]);

  const candidateProjects = allProjects
    .filter(
      (p) =>
        !p.isTemplate &&
        !INACTIVE_STATUSES.has(p.status ?? "") &&
        (p.projectManagerId === userId || pmProjectIds.has(p.id)),
    )
    .sort((a, b) => {
      if (a.rentalStartDate && b.rentalStartDate) return (a.rentalStartDate as number) - (b.rentalStartDate as number);
      if (a.rentalStartDate) return -1;
      if (b.rentalStartDate) return 1;
      return (b.createdAt ?? 0) - (a.createdAt ?? 0);
    })
    .slice(0, 24);

  const projectIds = candidateProjects.map((p) => p.id);
  const lineItemCounts =
    projectIds.length > 0
      ? await prisma.projectLineItem.groupBy({
          by: ["projectId"],
          where: { organizationId, projectId: { in: projectIds }, type: "EQUIPMENT" },
          _count: { _all: true },
        })
      : [];
  const liCountMap = new Map(lineItemCounts.map((g) => [g.projectId, g._count._all]));
  const myProjects = candidateProjects.map((p) => ({ ...p, _count: { lineItems: liCountMap.get(p.id) ?? 0 } }));

  // Clients live in Convex — attach instead of a Prisma join.
  const withClients = await attachClient(organizationId, myProjects);
  return serialize({ userName, userId, myProjects: withClients });
}

/**
 * Open blocking comments that need the current user's attention: ones on a
 * project they manage, or where they've been @mentioned. Surfaced on the
 * dashboard so a blocker that's gating prep / send-out can't sit unnoticed.
 */
export async function getMyBlockingComments() {
  const { organizationId, userId } = await getOrgContext();

  const threads = await listOpenBlockingThreads(organizationId);
  if (threads.length === 0) return serialize([]);

  const projectIds = Array.from(new Set(threads.map((t) => t.projectId).filter(Boolean)));
  const [allOrgProjects, pmProjectIds] = await Promise.all([
    getProjectsByOrg(organizationId),
    getProjectIdsForManager(organizationId, userId),
  ]);
  const idSet = new Set(projectIds);
  const projectMap = new Map(allOrgProjects.filter((p) => idSet.has(p.id)).map((p) => [p.id, p]));

  const surfaced = threads
    .map((t) => {
      const project = projectMap.get(t.projectId);
      if (!project) return null;
      const isPM = project.projectManagerId === userId || pmProjectIds.has(project.id);
      const isMentioned = t.mentionUserIds.includes(userId);
      if (!isPM && !isMentioned) return null;
      return {
        threadId: t.threadId,
        projectId: t.projectId,
        projectName: project.name,
        projectNumber: project.projectNumber,
        targetType: t.targetType,
        snippet: t.snippet,
        createdByName: t.createdByName,
        createdAt: t.createdAt,
        // "mention" wins as the more personal reason when both apply.
        reason: isMentioned ? ("mention" as const) : ("pm" as const),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.createdAt - a.createdAt);

  return serialize(surfaced);
}

export async function getUpcomingProjects() {
  const { organizationId } = await getOrgContext();

  const now = new Date();

  const UPCOMING_STATUSES = new Set(["CONFIRMED", "PREPPING", "QUOTED"]);
  const allOrgProjects = await getProjectsByOrg(organizationId);
  const candidateUpcoming = allOrgProjects
    .filter(
      (p) =>
        !p.isTemplate &&
        UPCOMING_STATUSES.has(p.status ?? "") &&
        p.rentalStartDate != null &&
        (p.rentalStartDate as number) >= now.getTime(),
    )
    .sort((a, b) => (a.rentalStartDate as number) - (b.rentalStartDate as number))
    .slice(0, 8);

  const upcomingIds = candidateUpcoming.map((p) => p.id);
  const upcomingLiCounts =
    upcomingIds.length > 0
      ? await prisma.projectLineItem.groupBy({
          by: ["projectId"],
          where: { organizationId, projectId: { in: upcomingIds }, type: "EQUIPMENT" },
          _count: { _all: true },
        })
      : [];
  const upcomingLiMap = new Map(upcomingLiCounts.map((g) => [g.projectId, g._count._all]));
  const projects = candidateUpcoming.map((p) => ({ ...p, _count: { lineItems: upcomingLiMap.get(p.id) ?? 0 } }));

  // Clients live in Convex — attach instead of a Prisma join.
  return serialize(await attachClient(organizationId, projects));
}

export async function getRecentActivity() {
  const { organizationId } = await getOrgContext();

  const [logs, testRecords, maintenanceRecords, modelMap] = await Promise.all([
    prisma.assetScanLog.findMany({
      where: { organizationId },
      include: {
        asset: true,
        bulkAsset: true,
        project: true,
        scannedBy: true,
      },
      orderBy: { scannedAt: "desc" },
      take: 10,
    }),
    prisma.testTagRecord.findMany({
      where: { organizationId },
      include: {
        testTagAsset: { select: { testTagId: true, description: true } },
        testedBy: { select: { id: true, name: true } },
      },
      orderBy: { testDate: "desc" },
      take: 10,
    }),
    prisma.maintenanceRecord.findMany({
      where: { organizationId },
      include: {
        assets: {
          include: { asset: true },
          take: 3,
        },
        reportedBy: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
    getModelMap(organizationId),
  ]);

  const withModels = {
    logs: logs.map((l) => ({
      ...l,
      asset: l.asset ? { ...l.asset, model: l.asset.modelId ? modelMap.get(l.asset.modelId) ?? null : null } : null,
      bulkAsset: l.bulkAsset ? { ...l.bulkAsset, model: l.bulkAsset.modelId ? modelMap.get(l.bulkAsset.modelId) ?? null : null } : null,
    })),
    testRecords,
    maintenanceRecords: maintenanceRecords.map((m) => ({
      ...m,
      assets: m.assets.map((a) => ({
        ...a,
        asset: { ...a.asset, model: a.asset.modelId ? modelMap.get(a.asset.modelId) ?? null : null },
      })),
    })),
  };

  return serialize(withModels);
}
