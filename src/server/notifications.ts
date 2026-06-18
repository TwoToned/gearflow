"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { getModelMap } from "@/lib/models-read";
import { getProjectsByOrg } from "@/lib/projects-read";
import {
  getCrewAssignmentsByOrg,
  countAssignmentsByStatus,
  getCrewTimeEntriesByOrg,
  countTimeEntriesByStatus,
} from "@/lib/crew-scheduling-read";

export interface AppNotification {
  id: string;
  type: "overdue_maintenance" | "overdue_return" | "upcoming_project" | "pending_invitation" | "pending_offers" | "pending_timesheets" | "flagged_asset";
  title: string;
  description: string;
  href: string;
  severity: "warning" | "error" | "info";
  timestamp: string;
}

/**
 * Return the set of notification keys (i.e. AppNotification.id values) the
 * current user has dismissed. Used by the client to filter out dismissed
 * items. Source of truth is the database — not localStorage — so dismissals
 * survive browser changes / cache clears.
 */
export async function getDismissedKeys(): Promise<string[]> {
  let ctx;
  try {
    ctx = await getOrgContext();
  } catch {
    return [];
  }
  const { userId } = ctx;

  const rows = await prisma.notificationDismissal.findMany({
    where: { userId },
    select: { notificationKey: true },
  });
  return rows.map((r) => r.notificationKey);
}

/**
 * Persist a notification dismissal for the current user. Idempotent — calling
 * twice for the same key is a no-op.
 */
export async function dismissNotification(notificationKey: string): Promise<void> {
  if (!notificationKey) return;
  const { organizationId, userId } = await getOrgContext();

  await prisma.notificationDismissal.upsert({
    where: {
      userId_notificationKey: { userId, notificationKey },
    },
    create: { organizationId, userId, notificationKey },
    update: {}, // already dismissed — keep original dismissedAt
  });
}

/**
 * Garbage-collect dismissal rows whose underlying notification key is no
 * longer in the active set. Keeps the table small and prevents stale keys
 * from accumulating forever. Safe to call frequently; runs as a single
 * deleteMany.
 */
export async function pruneStaleDismissals(activeKeys: string[]): Promise<number> {
  let ctx;
  try {
    ctx = await getOrgContext();
  } catch {
    return 0;
  }
  const { userId } = ctx;

  const result = await prisma.notificationDismissal.deleteMany({
    where: {
      userId,
      notificationKey: { notIn: activeKeys.length > 0 ? activeKeys : [""] },
    },
  });
  return result.count;
}

export async function getNotifications(): Promise<AppNotification[]> {
  let ctx;
  try {
    ctx = await getOrgContext();
  } catch {
    return []; // No active organization
  }
  const { organizationId, userId } = ctx;
  const now = new Date();
  const soon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000); // 3 days
  const notifications: AppNotification[] = [];

  const modelMap = await getModelMap(organizationId);

  // 1. Overdue maintenance
  const overdueMaintenance = await prisma.maintenanceRecord.findMany({
    where: {
      organizationId,
      status: { in: ["SCHEDULED", "IN_PROGRESS"] },
      scheduledDate: { lt: now },
    },
    include: { assets: { include: { asset: true } } },
    take: 10,
  });

  for (const m of overdueMaintenance) {
    const firstAsset = m.assets[0]?.asset;
    const assetCount = m.assets.length;
    const firstModelName = firstAsset?.modelId ? modelMap.get(firstAsset.modelId)?.name : undefined;
    const desc = firstAsset
      ? assetCount > 1
        ? `${firstAsset.assetTag} — ${firstModelName ?? firstAsset.assetTag} + ${assetCount - 1} more overdue`
        : `${firstAsset.assetTag} — ${firstModelName ?? firstAsset.assetTag} is overdue`
      : `${m.title} is overdue`;
    notifications.push({
      id: `maint-${m.id}`,
      type: "overdue_maintenance",
      title: m.title,
      description: desc,
      href: `/maintenance/${m.id}`,
      severity: "error",
      timestamp: m.scheduledDate?.toISOString() || m.createdAt.toISOString(),
    });
  }

  // 2. Overdue returns (projects past rental end date with checked-out items)
  const allProjects = await getProjectsByOrg(organizationId);
  const overdueProjectCandidates = allProjects
    .filter(
      (p) =>
        !p.isTemplate &&
        (p.status === "CHECKED_OUT" || p.status === "ON_SITE") &&
        p.rentalEndDate != null &&
        (p.rentalEndDate as number) < now.getTime(),
    )
    .slice(0, 10);

  if (overdueProjectCandidates.length > 0) {
    const overdueIds = overdueProjectCandidates.map((p) => p.id);
    const checkedOutCounts = await prisma.projectLineItem.groupBy({
      by: ["projectId"],
      where: { organizationId, projectId: { in: overdueIds }, status: "CHECKED_OUT" },
      _count: { _all: true },
    });
    const countMap = new Map(checkedOutCounts.map((g) => [g.projectId, g._count._all]));
    for (const p of overdueProjectCandidates) {
      const lineItemCount = countMap.get(p.id) ?? 0;
      if (lineItemCount > 0) {
        notifications.push({
          id: `return-${p.id}`,
          type: "overdue_return",
          title: `Overdue return: ${p.projectNumber}`,
          description: `${p.name} — ${lineItemCount} items still deployed`,
          href: `/projects/${p.id}`,
          severity: "error",
          timestamp: p.rentalEndDate ? new Date(p.rentalEndDate as number).toISOString() : new Date(p.updatedAt as number).toISOString(),
        });
      }
    }
  }

  // 3. Upcoming projects starting within 3 days
  const upcomingProjects = allProjects
    .filter(
      (p) =>
        !p.isTemplate &&
        (p.status === "CONFIRMED" || p.status === "PREPPING") &&
        p.rentalStartDate != null &&
        (p.rentalStartDate as number) >= now.getTime() &&
        (p.rentalStartDate as number) <= soon.getTime(),
    )
    .slice(0, 10);

  for (const p of upcomingProjects) {
    notifications.push({
      id: `upcoming-${p.id}`,
      type: "upcoming_project",
      title: `Starting soon: ${p.projectNumber}`,
      description: p.name,
      href: `/projects/${p.id}`,
      severity: "info",
      timestamp: p.rentalStartDate ? new Date(p.rentalStartDate as number).toISOString() : new Date(p.createdAt as number).toISOString(),
    });
  }

  // 4. Pending invitations for the current user
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (user?.email) {
    const pendingInvitations = await prisma.invitation.findMany({
      where: {
        email: user.email.toLowerCase(),
        status: "pending",
        expiresAt: { gte: now },
      },
      include: {
        organization: { select: { name: true } },
      },
      take: 10,
    });

    for (const inv of pendingInvitations) {
      notifications.push({
        id: `invite-${inv.id}`,
        type: "pending_invitation",
        title: `Invitation to ${inv.organization.name}`,
        description: `You've been invited to join ${inv.organization.name}${inv.role ? ` as ${inv.role}` : ""}`,
        href: `/invite/${inv.id}`,
        severity: "info",
        timestamp: inv.createdAt.toISOString(),
      });
    }
  }

  // 6. Pending crew offers (assignments in OFFERED status)
  // crewAssignment is dual-written — count from Convex.
  const pendingOffers = countAssignmentsByStatus(
    await getCrewAssignmentsByOrg(organizationId),
    ["OFFERED"],
  );
  if (pendingOffers > 0) {
    notifications.push({
      id: "crew-pending-offers",
      type: "pending_offers",
      title: `${pendingOffers} pending crew offer${pendingOffers !== 1 ? "s" : ""}`,
      description: `${pendingOffers} crew assignment${pendingOffers !== 1 ? "s" : ""} awaiting response`,
      href: "/crew",
      severity: "info",
      timestamp: now.toISOString(),
    });
  }

  // 8. Submitted timesheets awaiting approval
  // crewTimeEntry is dual-written — count from Convex.
  const submittedTimesheets = countTimeEntriesByStatus(
    await getCrewTimeEntriesByOrg(organizationId),
    ["SUBMITTED"],
  );
  if (submittedTimesheets > 0) {
    notifications.push({
      id: "crew-pending-timesheets",
      type: "pending_timesheets",
      title: `${submittedTimesheets} timesheet${submittedTimesheets !== 1 ? "s" : ""} pending approval`,
      description: `${submittedTimesheets} time entr${submittedTimesheets !== 1 ? "ies" : "y"} submitted for review`,
      href: "/crew/timesheets",
      severity: "info",
      timestamp: now.toISOString(),
    });
  }

  // 9. Flagged assets from warehouse checks
  const flaggedItems = await prisma.projectLineItem.findMany({
    where: {
      organizationId,
      prepStatus: { in: ["FLAGGED_FAULTY", "FLAGGED_TT_OVERDUE"] },
    },
    include: {
      asset: { select: { assetTag: true } },
      project: { select: { id: true, name: true, projectNumber: true } },
    },
    take: 10,
  });

  for (const li of flaggedItems) {
    const liModelName = li.modelId ? modelMap.get(li.modelId)?.name : undefined;
    const tag = li.asset?.assetTag || liModelName || "Unknown";
    const reason = li.prepStatus === "FLAGGED_TT_OVERDUE" ? "T&T overdue" : "faulty";
    notifications.push({
      id: `flagged-${li.id}`,
      type: "flagged_asset",
      title: `Flagged: ${tag}`,
      description: `${liModelName || "Item"} flagged as ${reason} on ${li.project.projectNumber} — ${li.project.name}`,
      href: `/warehouse/${li.project.id}`,
      severity: "warning",
      timestamp: li.updatedAt.toISOString(),
    });
  }

  // Sort by severity (errors first) then timestamp
  const severityOrder = { error: 0, warning: 1, info: 2 };
  notifications.sort((a, b) => {
    const s = severityOrder[a.severity] - severityOrder[b.severity];
    if (s !== 0) return s;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  return serialize(notifications) as AppNotification[];
}
