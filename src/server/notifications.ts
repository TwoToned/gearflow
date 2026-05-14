"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";

export interface AppNotification {
  id: string;
  type: "overdue_maintenance" | "overdue_return" | "upcoming_project" | "low_stock" | "pending_invitation" | "expiring_cert" | "pending_offers" | "pending_timesheets" | "flagged_asset";
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

  // 1. Overdue maintenance
  const overdueMaintenance = await prisma.maintenanceRecord.findMany({
    where: {
      organizationId,
      status: { in: ["SCHEDULED", "IN_PROGRESS"] },
      scheduledDate: { lt: now },
    },
    include: { assets: { include: { asset: { include: { model: true } } } } },
    take: 10,
  });

  for (const m of overdueMaintenance) {
    const firstAsset = m.assets[0]?.asset;
    const assetCount = m.assets.length;
    const desc = firstAsset
      ? assetCount > 1
        ? `${firstAsset.assetTag} — ${firstAsset.model.name} + ${assetCount - 1} more overdue`
        : `${firstAsset.assetTag} — ${firstAsset.model.name} is overdue`
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
  const overdueProjects = await prisma.project.findMany({
    where: {
      organizationId,
      isTemplate: false,
      status: { in: ["CHECKED_OUT", "ON_SITE"] },
      rentalEndDate: { lt: now },
    },
    include: {
      _count: { select: { lineItems: { where: { status: "CHECKED_OUT" } } } },
    },
    take: 10,
  });

  for (const p of overdueProjects) {
    if (p._count.lineItems > 0) {
      notifications.push({
        id: `return-${p.id}`,
        type: "overdue_return",
        title: `Overdue return: ${p.projectNumber}`,
        description: `${p.name} — ${p._count.lineItems} items still deployed`,
        href: `/projects/${p.id}`,
        severity: "error",
        timestamp: p.rentalEndDate?.toISOString() || p.updatedAt.toISOString(),
      });
    }
  }

  // 3. Upcoming projects starting within 3 days
  const upcomingProjects = await prisma.project.findMany({
    where: {
      organizationId,
      isTemplate: false,
      status: { in: ["CONFIRMED", "PREPPING"] },
      rentalStartDate: { gte: now, lte: soon },
    },
    take: 10,
  });

  for (const p of upcomingProjects) {
    notifications.push({
      id: `upcoming-${p.id}`,
      type: "upcoming_project",
      title: `Starting soon: ${p.projectNumber}`,
      description: p.name,
      href: `/projects/${p.id}`,
      severity: "info",
      timestamp: p.rentalStartDate?.toISOString() || p.createdAt.toISOString(),
    });
  }

  // 4. Low stock bulk assets
  const lowStock = await prisma.bulkAsset.findMany({
    where: {
      organizationId,
      isActive: true,
      status: "LOW_STOCK",
    },
    include: { model: true },
    take: 10,
  });

  for (const b of lowStock) {
    notifications.push({
      id: `stock-${b.id}`,
      type: "low_stock",
      title: `Low stock: ${b.model.name}`,
      description: `${b.assetTag} — ${b.availableQuantity} of ${b.totalQuantity} available`,
      href: `/assets/registry/${b.id}`,
      severity: "warning",
      timestamp: b.updatedAt.toISOString(),
    });
  }

  // 5. Pending invitations for the current user
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

  // 6. Expiring crew certifications (within 30 days)
  const certSoon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const expiringCerts = await prisma.crewCertification.findMany({
    where: {
      crewMember: { organizationId },
      expiryDate: { gte: now, lte: certSoon },
      status: { in: ["CURRENT", "EXPIRING_SOON"] },
    },
    include: {
      crewMember: { select: { id: true, firstName: true, lastName: true } },
    },
    take: 10,
  });

  for (const cert of expiringCerts) {
    const daysLeft = Math.ceil(
      (new Date(cert.expiryDate!).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );
    notifications.push({
      id: `cert-${cert.id}`,
      type: "expiring_cert",
      title: `Expiring: ${cert.name}`,
      description: `${cert.crewMember.firstName} ${cert.crewMember.lastName} — expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`,
      href: `/crew/${cert.crewMember.id}`,
      severity: daysLeft <= 7 ? "error" : "warning",
      timestamp: cert.expiryDate!.toISOString(),
    });
  }

  // 7. Pending crew offers (assignments in OFFERED status)
  const pendingOffers = await prisma.crewAssignment.count({
    where: { organizationId, status: "OFFERED" },
  });
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
  const submittedTimesheets = await prisma.crewTimeEntry.count({
    where: { organizationId, status: "SUBMITTED" },
  });
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
      model: { select: { name: true } },
      asset: { select: { assetTag: true } },
      project: { select: { id: true, name: true, projectNumber: true } },
    },
    take: 10,
  });

  for (const li of flaggedItems) {
    const tag = li.asset?.assetTag || li.model?.name || "Unknown";
    const reason = li.prepStatus === "FLAGGED_TT_OVERDUE" ? "T&T overdue" : "faulty";
    notifications.push({
      id: `flagged-${li.id}`,
      type: "flagged_asset",
      title: `Flagged: ${tag}`,
      description: `${li.model?.name || "Item"} flagged as ${reason} on ${li.project.projectNumber} — ${li.project.name}`,
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
