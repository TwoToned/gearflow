"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext } from "@/lib/org-context";
import { attachClient } from "@/lib/clients-read";
import { serialize } from "@/lib/serialize";
import { listOpenBlockingThreads } from "@/lib/blocking-comments-read";
import { getModelMap } from "@/lib/models-read";

export async function getDashboardStats() {
  const { organizationId } = await getOrgContext();

  const now = new Date();

  const [
    totalAssets,
    totalBulkAssets,
    checkedOutAssets,
    activeProjects,
    maintenanceDue,
    overdueReturns,
    activeCrew,
    pendingCrewOffers,
  ] = await Promise.all([
    prisma.asset.count({
      where: { organizationId, isActive: true },
    }),
    prisma.bulkAsset.aggregate({
      where: { organizationId, isActive: true },
      _sum: { totalQuantity: true },
    }),
    prisma.asset.count({
      where: { organizationId, isActive: true, status: "CHECKED_OUT" },
    }),
    prisma.project.count({
      where: {
        organizationId,
        isTemplate: false,
        status: { in: ["CONFIRMED", "PREPPING", "CHECKED_OUT", "ON_SITE"] },
      },
    }),
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

  return {
    totalAssets: totalAssets + (totalBulkAssets._sum.totalQuantity || 0),
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

  const myProjects = await prisma.project.findMany({
    where: {
      organizationId,
      isTemplate: false,
      status: { notIn: ["COMPLETED", "INVOICED", "CANCELLED"] },
      OR: [{ projectManagerId: userId }, { projectManagers: { some: { userId } } }],
    },
    include: {
      _count: { select: { lineItems: { where: { type: "EQUIPMENT" } } } },
    },
    // Soonest first; undated projects (enquiries/drafts) sort last so they can't
    // hide real upcoming work or push it past the take limit.
    orderBy: [{ rentalStartDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 24,
  });

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
  const projects = await prisma.project.findMany({
    where: { organizationId, id: { in: projectIds } },
    select: {
      id: true,
      name: true,
      projectNumber: true,
      projectManagerId: true,
      projectManagers: { select: { userId: true } },
    },
  });
  const projectMap = new Map(projects.map((p) => [p.id, p]));

  const surfaced = threads
    .map((t) => {
      const project = projectMap.get(t.projectId);
      if (!project) return null;
      const isPM =
        project.projectManagerId === userId ||
        project.projectManagers.some((pm) => pm.userId === userId);
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

  const projects = await prisma.project.findMany({
    where: {
      organizationId,
      isTemplate: false,
      status: { in: ["CONFIRMED", "PREPPING", "QUOTED"] },
      rentalStartDate: { gte: now },
    },
    include: {
      _count: { select: { lineItems: { where: { type: "EQUIPMENT" } } } },
    },
    orderBy: { rentalStartDate: "asc" },
    take: 8,
  });

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
