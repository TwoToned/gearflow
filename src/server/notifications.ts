"use server";

import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { getModelMap } from "@/lib/models-read";
import { getProjectsByOrg } from "@/lib/projects-read";
import { getAssetsByOrg } from "@/lib/assets-read";
import { getMaintenanceRecordsByOrg } from "@/lib/maintenance-read";
import { getMaintenanceAssetLinksByRecordIds } from "@/lib/maintenance-record-asset-read";
import {
  getDismissedKeysForUser,
  getDismissalsForUser,
} from "@/lib/notification-dismissals-read";
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
  const { organizationId, userId } = ctx;

  // notificationDismissal is CONVEX-ONLY (bucket-2 Phase B write inversion):
  // read the dismissed keys from Convex (no Prisma fallback on a miss).
  return await getDismissedKeysForUser(organizationId, userId);
}

/**
 * Persist a notification dismissal for the current user. Idempotent — calling
 * twice for the same key is a no-op.
 */
export async function dismissNotification(notificationKey: string): Promise<void> {
  if (!notificationKey) return;
  // Delegate to the bulk path with a single item. The @@unique([userId,
  // notificationKey]) guard (Convex has no unique index) is enforced ATOMICALLY
  // inside createManyIfMissing via the by_userId_notificationKey index — no
  // read-then-create TOCTOU (which could otherwise double-insert on a retry).
  await dismissNotifications([notificationKey]);
}

/**
 * Bulk-persist N notification dismissals for the current user in ONE call
 * (Appendix A bulk single-call invariant — powers the /notifications "Dismiss
 * All"). Idempotent: already-dismissed keys are skipped Convex-side by
 * (userId, notificationKey). Replaces the page's former localStorage-only
 * "Dismiss All".
 */
export async function dismissNotifications(notificationKeys: string[]): Promise<void> {
  if (!notificationKeys || notificationKeys.length === 0) return;
  const { organizationId, userId } = await getOrgContext();

  const unique = [...new Set(notificationKeys.filter(Boolean))];
  if (unique.length === 0) return;

  await (await getConvexClient()).mutation(api.notificationDismissals.createManyIfMissing, {
    organizationId,
    userId,
    items: unique.map((notificationKey) => ({
      id: createId(),
      notificationKey,
      dismissedAt: Date.now(),
    })),
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
  const { organizationId, userId } = ctx;

  // Convex-only: replicate the Prisma deleteMany(where userId, notificationKey
  // notIn activeKeys) by reading the user's dismissals and removing those whose
  // key is no longer active. Empty activeKeys → prune everything (matches the old
  // `notIn: [""]` sentinel, since no real key is the empty string).
  const activeSet = new Set(activeKeys);
  const rows = await getDismissalsForUser(organizationId, userId);
  const stale = rows.filter((r) => !activeSet.has(r.notificationKey));
  if (stale.length === 0) return 0;

  const convex = await getConvexClient();
  await Promise.all(stale.map((row) => convex.mutation(api.notificationDismissals.remove, { id: row.id })));
  return stale.length;
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
  // maintenanceRecord is Convex-only (Phase C). Read the org's records, replicate
  // the old `where` (status in [SCHEDULED, IN_PROGRESS], scheduledDate < now) +
  // `take: 10` in JS. The maintenanceRecordAsset join + assets live in Convex.
  const overdueMaintenance = (await getMaintenanceRecordsByOrg(organizationId))
    .filter(
      (m) =>
        (m.status === "SCHEDULED" || m.status === "IN_PROGRESS") &&
        m.scheduledDate != null &&
        m.scheduledDate.getTime() < now.getTime(),
    )
    .slice(0, 10);

  const overdueRecordIds = overdueMaintenance.map((m) => m.id);
  const overdueLinks = await getMaintenanceAssetLinksByRecordIds(overdueRecordIds);
  const overdueAssets = await getAssetsByOrg(organizationId);
  const overdueAssetMap = new Map(overdueAssets.map((a) => [a.id, a]));
  const overdueLinksByRecord = new Map<string, typeof overdueLinks>();
  for (const l of overdueLinks) {
    const arr = overdueLinksByRecord.get(l.maintenanceRecordId) ?? [];
    arr.push(l);
    overdueLinksByRecord.set(l.maintenanceRecordId, arr);
  }

  for (const m of overdueMaintenance) {
    const recordLinks = overdueLinksByRecord.get(m.id) ?? [];
    const firstAsset = recordLinks[0] ? overdueAssetMap.get(recordLinks[0].assetId) : undefined;
    const assetCount = recordLinks.length;
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
    // projectLineItem is Convex-only — fetch the candidate projects' lines and
    // group CHECKED_OUT counts by projectId in JS (replicates the groupBy).
    const checkedOutLines = await (await getConvexClient()).query(
      api.projectLineItems.listByProjectIds,
      { orgId: organizationId, projectIds: overdueIds },
    );
    const countMap = new Map<string, number>();
    for (const li of checkedOutLines) {
      if (li.status !== "CHECKED_OUT") continue;
      countMap.set(li.projectId, (countMap.get(li.projectId) ?? 0) + 1);
    }
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

  // 9. Flagged assets from warehouse checks.
  // projectLineItem is Convex-only — read the org's lines, filter by prepStatus
  // in JS, take 10. Asset tags + project headers are resolved from Convex.
  const allLines = await (await getConvexClient()).query(
    api.projectLineItems.list,
    { orgId: organizationId },
  );
  const flaggedItems = allLines
    .filter(
      (li) =>
        li.prepStatus === "FLAGGED_FAULTY" || li.prepStatus === "FLAGGED_TT_OVERDUE",
    )
    .slice(0, 10);

  if (flaggedItems.length > 0) {
    const assets = await getAssetsByOrg(organizationId);
    const assetTagMap = new Map(assets.map((a) => [a.id, a.assetTag]));
    const projectMap = new Map(allProjects.map((p) => [p.id, p]));

    for (const li of flaggedItems) {
      const liModelName = li.modelId ? modelMap.get(li.modelId)?.name : undefined;
      const tag = (li.assetId ? assetTagMap.get(li.assetId) : undefined) || liModelName || "Unknown";
      const reason = li.prepStatus === "FLAGGED_TT_OVERDUE" ? "T&T overdue" : "faulty";
      const proj = projectMap.get(li.projectId);
      notifications.push({
        id: `flagged-${li.id}`,
        type: "flagged_asset",
        title: `Flagged: ${tag}`,
        description: `${liModelName || "Item"} flagged as ${reason} on ${proj?.projectNumber ?? ""} — ${proj?.name ?? ""}`,
        href: `/warehouse/${li.projectId}`,
        severity: "warning",
        timestamp: li.updatedAt ? new Date(li.updatedAt as number).toISOString() : now.toISOString(),
      });
    }
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
