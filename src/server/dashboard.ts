"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext } from "@/lib/org-context";
import { attachClient } from "@/lib/clients-read";
import { serialize } from "@/lib/serialize";
import {
  getLineItemsByOrg,
  getLineItemsByProjectIds,
  countCheckedOutInProjects,
  countEquipmentLineItemsByProject,
} from "@/lib/line-item-count-read";
import { listOpenBlockingThreads } from "@/lib/blocking-comments-read";
import { getModelMap } from "@/lib/models-read";
import { getAssetsByOrg, getBulkAssetsByOrg } from "@/lib/assets-read";
import { getProjectsByOrg, getProjectIdsForManager } from "@/lib/projects-read";
import { getMaintenanceRecordsByOrg, countDueMaintenance } from "@/lib/maintenance-read";
import { getMaintenanceAssetLinksByRecordIds } from "@/lib/maintenance-record-asset-read";
import { getCrewMembersByOrg, countActiveCrew } from "@/lib/crew-read";
import { getCrewAssignmentsByOrg, countAssignmentsByStatus } from "@/lib/crew-scheduling-read";

export async function getDashboardStats() {
  const { organizationId } = await getOrgContext();

  const now = new Date();

  const [allAssets, allBulkAssets, allProjects, maintenanceRecords, allLineItems, crewMembers, crewAssignments] =
    await Promise.all([
      getAssetsByOrg(organizationId),
      getBulkAssetsByOrg(organizationId),
      getProjectsByOrg(organizationId),
      // Maintenance is dual-written — count due records (status + scheduledDate) from Convex.
      getMaintenanceRecordsByOrg(organizationId),
      // overdueReturns aggregates projectLineItem joined to a project filter. The
      // project rows are in Convex (allProjects), so resolve the overdue project
      // set in JS and count CHECKED_OUT line items within it (Convex read).
      getLineItemsByOrg(organizationId),
      // Crew roster + assignments are dual-written — count from Convex.
      getCrewMembersByOrg(organizationId),
      getCrewAssignmentsByOrg(organizationId),
    ]);

  // overdueReturns: CHECKED_OUT line items whose project is non-template, past its
  // rentalEndDate, and not in a terminal status (matches the old Prisma `project`
  // relation filter). `rentalEndDate` is epoch-ms on the Convex project doc.
  const RETURN_TERMINAL = new Set(["RETURNED", "COMPLETED", "INVOICED", "CANCELLED"]);
  const overdueProjectIds = new Set(
    allProjects
      .filter(
        (p) =>
          !p.isTemplate &&
          p.rentalEndDate != null &&
          (p.rentalEndDate as number) < now.getTime() &&
          !RETURN_TERMINAL.has(p.status ?? ""),
      )
      .map((p) => p.id),
  );
  const overdueReturns = countCheckedOutInProjects(allLineItems, overdueProjectIds);

  const maintenanceDue = countDueMaintenance(maintenanceRecords, now.getTime());
  const activeCrew = countActiveCrew(crewMembers);
  const pendingCrewOffers = countAssignmentsByStatus(crewAssignments, ["OFFERED", "PENDING"]);

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
  const homeLineItems = await getLineItemsByProjectIds(organizationId, projectIds);
  const liCountMap = countEquipmentLineItemsByProject(homeLineItems, projectIds);
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
  const upcomingLineItems = await getLineItemsByProjectIds(organizationId, upcomingIds);
  const upcomingLiMap = countEquipmentLineItemsByProject(upcomingLineItems, upcomingIds);
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
        reportedBy: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
    getModelMap(organizationId),
  ]);

  // The maintenanceRecordAsset join is Convex-only (Phase B): fetch the links for
  // the top-10 records, attach asset scalars from Convex (assets are dual-written),
  // and keep the old `take: 3` cap per record.
  const maintenanceRecordIds = maintenanceRecords.map((m) => m.id);
  const [maintenanceLinks, orgAssetsForMaint] = await Promise.all([
    getMaintenanceAssetLinksByRecordIds(maintenanceRecordIds),
    getAssetsByOrg(organizationId),
  ]);
  const maintAssetMap = new Map(orgAssetsForMaint.map((a) => [a.id, a]));
  const linksByRecord = new Map<string, typeof maintenanceLinks>();
  for (const l of maintenanceLinks) {
    const arr = linksByRecord.get(l.maintenanceRecordId) ?? [];
    arr.push(l);
    linksByRecord.set(l.maintenanceRecordId, arr);
  }

  const withModels = {
    logs: logs.map((l) => ({
      ...l,
      asset: l.asset ? { ...l.asset, model: l.asset.modelId ? modelMap.get(l.asset.modelId) ?? null : null } : null,
      bulkAsset: l.bulkAsset ? { ...l.bulkAsset, model: l.bulkAsset.modelId ? modelMap.get(l.bulkAsset.modelId) ?? null : null } : null,
    })),
    testRecords,
    maintenanceRecords: maintenanceRecords.map((m) => ({
      ...m,
      assets: (linksByRecord.get(m.id) ?? [])
        .slice(0, 3) // preserve the old include `take: 3`
        .map((l) => {
          const asset = maintAssetMap.get(l.assetId) ?? null;
          return {
            id: l.id,
            maintenanceRecordId: l.maintenanceRecordId,
            assetId: l.assetId,
            asset: asset
              ? { ...asset, model: asset.modelId ? modelMap.get(asset.modelId) ?? null : null }
              : null,
          };
        }),
    })),
  };

  return serialize(withModels);
}
