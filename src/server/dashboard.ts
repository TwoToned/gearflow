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
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

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

  const convex = await getConvexClient();
  const [rawScanLogs, rawTestTagRecords, rawTestTagAssets, maintenanceRecords, modelMap, allAssets, allBulkAssets, allProjects] = await Promise.all([
    convex.query(api.assetScanLogs.list, { orgId: organizationId }),
    convex.query(api.testTagRecords.list, { orgId: organizationId }),
    convex.query(api.testTagAssets.list, { orgId: organizationId }),
    prisma.maintenanceRecord.findMany({
      where: { organizationId },
      include: {
        reportedBy: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
    getModelMap(organizationId),
    getAssetsByOrg(organizationId),
    getBulkAssetsByOrg(organizationId),
    getProjectsByOrg(organizationId),
  ]);

  // Sort scan logs newest-first and take top 10
  const scanLogsSorted = [...rawScanLogs]
    .sort((a, b) => (b.scannedAt ?? 0) - (a.scannedAt ?? 0))
    .slice(0, 10);

  // Attach scannedBy (Better Auth user — stays Prisma)
  const scannedByIds = [...new Set(scanLogsSorted.map((l) => l.scannedById))];
  const scanUsers = scannedByIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: scannedByIds } } })
    : [];
  const scanUserMap = new Map(scanUsers.map((u) => [u.id, u]));

  const scanAssetMap = new Map(allAssets.map((a) => [a.id, a]));
  const scanBulkAssetMap = new Map(allBulkAssets.map((b) => [b.id, b]));
  const scanProjectMap = new Map(allProjects.map((p) => [p.id, p]));

  // Sort testTagRecords newest-first and take top 10, attaching testTagAsset + testedBy.
  const testTagRecordsSorted = [...rawTestTagRecords]
    .sort((a, b) => (b.testDate ?? 0) - (a.testDate ?? 0))
    .slice(0, 10);
  const testTagAssetMap = new Map(rawTestTagAssets.map((a) => [a.id, a]));
  const testedByIds = [...new Set(testTagRecordsSorted.map((r) => r.testedById))];
  const testedByUsers = testedByIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: testedByIds } }, select: { id: true, name: true } })
    : [];
  const testedByMap = new Map(testedByUsers.map((u) => [u.id, u]));
  const testRecords = testTagRecordsSorted.map((r) => {
    const tta = r.testTagAssetId ? testTagAssetMap.get(r.testTagAssetId) ?? null : null;
    return {
      ...r,
      testDate: r.testDate != null ? new Date(r.testDate) : null,
      testTagAsset: tta ? { testTagId: tta.testTagId, description: tta.description ?? null } : null,
      testedBy: testedByMap.get(r.testedById) ?? null,
    };
  });

  // The maintenanceRecordAsset join is Convex-only (Phase B): fetch the links for
  // the top-10 records, attach asset scalars from Convex (assets are dual-written),
  // and keep the old `take: 3` cap per record.
  const maintenanceRecordIds = maintenanceRecords.map((m) => m.id);
  const maintenanceLinks = await getMaintenanceAssetLinksByRecordIds(maintenanceRecordIds);
  const maintAssetMap = new Map(allAssets.map((a) => [a.id, a]));
  const linksByRecord = new Map<string, typeof maintenanceLinks>();
  for (const l of maintenanceLinks) {
    const arr = linksByRecord.get(l.maintenanceRecordId) ?? [];
    arr.push(l);
    linksByRecord.set(l.maintenanceRecordId, arr);
  }

  const withModels = {
    logs: scanLogsSorted.map((l) => {
      const convexAsset = l.assetId ? scanAssetMap.get(l.assetId) ?? null : null;
      return {
        ...l,
        asset: convexAsset
          ? { ...convexAsset, model: convexAsset.modelId ? modelMap.get(convexAsset.modelId) ?? null : null }
          : null,
        bulkAsset: l.bulkAssetId ? scanBulkAssetMap.get(l.bulkAssetId) ?? null : null,
        project: l.projectId ? scanProjectMap.get(l.projectId) ?? null : null,
        scannedBy: scanUserMap.get(l.scannedById) ?? null,
      };
    }),
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
