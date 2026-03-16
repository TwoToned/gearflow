"use server";

import { randomBytes, createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";

// ─── Token Management ────────────────────────────────────────────────────────

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function getDisplayTokens() {
  const { organizationId } = await getOrgContext();

  const tokens = await prisma.warehouseDashboardToken.findMany({
    where: { organizationId },
    include: {
      location: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return serialize(tokens);
}

export async function createDisplayToken(data: {
  name: string;
  locationId?: string | null;
  layout?: string;
}) {
  const { organizationId, userId, userName } = await requirePermission(
    "orgSettings",
    "update"
  );

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);

  const token = await prisma.warehouseDashboardToken.create({
    data: {
      organizationId,
      name: data.name,
      token: rawToken,
      tokenHash,
      locationId: data.locationId || null,
      layout: data.layout || "standard",
      createdById: userId,
    },
    include: {
      location: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "create",
    entityType: "warehouseDashboardToken",
    entityId: token.id,
    entityName: token.name,
    summary: `Created warehouse display token "${token.name}"`,
  });

  return serialize({ token: rawToken, display: token });
}

export async function revokeDisplayToken(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "orgSettings",
    "update"
  );

  const token = await prisma.warehouseDashboardToken.findFirst({
    where: { id, organizationId },
  });

  if (!token) throw new Error("Display token not found");

  await prisma.warehouseDashboardToken.delete({
    where: { id },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "delete",
    entityType: "warehouseDashboardToken",
    entityId: id,
    entityName: token.name,
    summary: `Revoked warehouse display token "${token.name}"`,
  });

  return { success: true };
}

export async function updateDisplayToken(
  id: string,
  data: { name?: string; locationId?: string | null; layout?: string }
) {
  const { organizationId, userId, userName } = await requirePermission(
    "orgSettings",
    "update"
  );

  const existing = await prisma.warehouseDashboardToken.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new Error("Display token not found");

  const token = await prisma.warehouseDashboardToken.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.layout !== undefined && { layout: data.layout }),
      ...(data.locationId !== undefined && {
        locationId: data.locationId || null,
      }),
    },
    include: {
      location: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "update",
    entityType: "warehouseDashboardToken",
    entityId: token.id,
    entityName: token.name,
    summary: `Updated warehouse display "${token.name}"`,
  });

  return serialize(token);
}

export async function regenerateDisplayToken(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "orgSettings",
    "update"
  );

  const existing = await prisma.warehouseDashboardToken.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new Error("Display token not found");

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);

  const updated = await prisma.warehouseDashboardToken.update({
    where: { id },
    data: { token: rawToken, tokenHash },
    include: {
      location: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "update",
    entityType: "warehouseDashboardToken",
    entityId: id,
    entityName: existing.name,
    summary: `Regenerated URL for warehouse display "${existing.name}"`,
  });

  return serialize({ token: rawToken, display: updated });
}

// ─── Display Data ────────────────────────────────────────────────────────────

export interface WarehouseDisplayData {
  orgName: string;
  locationName: string | null;
  todaysDispatch: DispatchProject[];
  todaysReturns: ReturnProject[];
  prepStatus: PrepCard[];
  upcoming: UpcomingDay[];
  alerts: Alert[];
}

interface DispatchProject {
  id: string;
  projectNumber: string;
  name: string;
  deliveryTime: string | null;
  destination: string | null;
  vehicle: string | null;
  status: string;
  totalItems: number;
  checkedOutItems: number;
}

interface ReturnProject {
  id: string;
  projectNumber: string;
  name: string;
  dueTime: string | null;
  expectedItems: number;
}

interface PrepCard {
  projectId: string;
  projectNumber: string;
  projectName: string;
  packedItems: number;
  totalItems: number;
}

interface UpcomingDay {
  date: string;
  dispatching: number;
  returning: number;
}

interface Alert {
  type: "warning" | "error";
  message: string;
}

export async function getWarehouseDisplayData(
  organizationId: string,
  locationId?: string | null
): Promise<WarehouseDisplayData> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });

  let locationName: string | null = null;
  if (locationId) {
    const loc = await prisma.location.findUnique({
      where: { id: locationId },
      select: { name: true },
    });
    locationName = loc?.name ?? null;
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  // Active project statuses for warehouse
  const activeStatuses = [
    "CONFIRMED",
    "PREPPING",
    "CHECKED_OUT",
    "ON_SITE",
  ] as const;

  // ─── Today's Dispatch ──────────────────────────────────────────────────────
  // Projects with delivery services today, or loadInDate/rentalStartDate today
  const deliveryServices = await prisma.projectService.findMany({
    where: {
      organizationId,
      type: "DELIVERY",
      status: { not: "CANCELLED" },
      date: { gte: todayStart, lt: todayEnd },
      project: {
        isTemplate: false,
        status: { in: [...activeStatuses] },
        ...(locationId ? { locationId } : {}),
      },
    },
    include: {
      project: {
        select: {
          id: true,
          projectNumber: true,
          name: true,
          status: true,
          _count: {
            select: { lineItems: { where: { isKitChild: false, status: { not: "CANCELLED" } } } },
          },
          lineItems: {
            where: { isKitChild: false, status: "CHECKED_OUT" },
            select: { id: true },
          },
        },
      },
    },
  });

  // Also check projects by loadInDate if no delivery service
  const projectsByDate = await prisma.project.findMany({
    where: {
      organizationId,
      isTemplate: false,
      status: { in: [...activeStatuses] },
      ...(locationId ? { locationId } : {}),
      OR: [
        { loadInDate: { gte: todayStart, lt: todayEnd } },
        { rentalStartDate: { gte: todayStart, lt: todayEnd } },
      ],
    },
    select: {
      id: true,
      projectNumber: true,
      name: true,
      status: true,
      loadInTime: true,
      _count: {
        select: { lineItems: { where: { isKitChild: false, status: { not: "CANCELLED" } } } },
      },
      lineItems: {
        where: { isKitChild: false, status: "CHECKED_OUT" },
        select: { id: true },
      },
    },
  });

  // Merge: prefer service-based dispatch
  const serviceProjectIds = new Set(deliveryServices.map((s) => s.projectId));
  const todaysDispatch: DispatchProject[] = [];

  for (const svc of deliveryServices) {
    todaysDispatch.push({
      id: svc.project.id,
      projectNumber: svc.project.projectNumber,
      name: svc.project.name,
      deliveryTime: svc.scheduledTime || svc.startTime || null,
      destination: svc.address || null,
      vehicle: svc.vehicleDescription || null,
      status: svc.project.status,
      totalItems: svc.project._count.lineItems,
      checkedOutItems: svc.project.lineItems.length,
    });
  }

  for (const p of projectsByDate) {
    if (!serviceProjectIds.has(p.id)) {
      todaysDispatch.push({
        id: p.id,
        projectNumber: p.projectNumber,
        name: p.name,
        deliveryTime: p.loadInTime || null,
        destination: null,
        vehicle: null,
        status: p.status,
        totalItems: p._count.lineItems,
        checkedOutItems: p.lineItems.length,
      });
    }
  }

  // ─── Today's Returns ───────────────────────────────────────────────────────
  const pickupServices = await prisma.projectService.findMany({
    where: {
      organizationId,
      type: "PICKUP",
      status: { not: "CANCELLED" },
      date: { gte: todayStart, lt: todayEnd },
      project: {
        isTemplate: false,
        status: { in: ["CHECKED_OUT", "ON_SITE", "RETURNED"] },
        ...(locationId ? { locationId } : {}),
      },
    },
    include: {
      project: {
        select: {
          id: true,
          projectNumber: true,
          name: true,
          lineItems: {
            where: { isKitChild: false, status: "CHECKED_OUT" },
            select: { id: true },
          },
        },
      },
    },
  });

  const returnProjectsByDate = await prisma.project.findMany({
    where: {
      organizationId,
      isTemplate: false,
      status: { in: ["CHECKED_OUT", "ON_SITE", "RETURNED"] },
      ...(locationId ? { locationId } : {}),
      OR: [
        { loadOutDate: { gte: todayStart, lt: todayEnd } },
        { rentalEndDate: { gte: todayStart, lt: todayEnd } },
      ],
    },
    select: {
      id: true,
      projectNumber: true,
      name: true,
      loadOutTime: true,
      lineItems: {
        where: { isKitChild: false, status: "CHECKED_OUT" },
        select: { id: true },
      },
    },
  });

  const pickupProjectIds = new Set(pickupServices.map((s) => s.projectId));
  const todaysReturns: ReturnProject[] = [];

  for (const svc of pickupServices) {
    todaysReturns.push({
      id: svc.project.id,
      projectNumber: svc.project.projectNumber,
      name: svc.project.name,
      dueTime: svc.scheduledTime || svc.startTime || null,
      expectedItems: svc.project.lineItems.length,
    });
  }

  for (const p of returnProjectsByDate) {
    if (!pickupProjectIds.has(p.id)) {
      todaysReturns.push({
        id: p.id,
        projectNumber: p.projectNumber,
        name: p.name,
        dueTime: p.loadOutTime || null,
        expectedItems: p.lineItems.length,
      });
    }
  }

  // ─── Prep Status ───────────────────────────────────────────────────────────
  // Projects actively being prepped — show line item checkout progress
  const preppingProjects = await prisma.project.findMany({
    where: {
      organizationId,
      isTemplate: false,
      status: { in: ["CONFIRMED", "PREPPING"] },
      ...(locationId ? { locationId } : {}),
    },
    select: {
      id: true,
      projectNumber: true,
      name: true,
      _count: {
        select: { lineItems: { where: { isKitChild: false, status: { not: "CANCELLED" } } } },
      },
      lineItems: {
        where: { isKitChild: false, status: "CHECKED_OUT" },
        select: { id: true },
      },
    },
    orderBy: { loadInDate: "asc" },
    take: 12,
  });

  const prepStatus: PrepCard[] = preppingProjects.map((p) => ({
    projectId: p.id,
    projectNumber: p.projectNumber,
    projectName: p.name,
    packedItems: p.lineItems.length,
    totalItems: p._count.lineItems,
  }));

  // ─── Upcoming 7 Days ──────────────────────────────────────────────────────
  const upcoming: UpcomingDay[] = [];
  for (let i = 1; i <= 7; i++) {
    const dayStart = new Date(todayStart);
    dayStart.setDate(dayStart.getDate() + i);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const locationFilter = locationId ? { locationId } : {};

    const [dispatchCount, returnCount] = await Promise.all([
      prisma.project.count({
        where: {
          organizationId,
          isTemplate: false,
          status: { in: [...activeStatuses] },
          ...locationFilter,
          OR: [
            { loadInDate: { gte: dayStart, lt: dayEnd } },
            { rentalStartDate: { gte: dayStart, lt: dayEnd } },
            {
              services: {
                some: {
                  type: "DELIVERY",
                  status: { not: "CANCELLED" },
                  date: { gte: dayStart, lt: dayEnd },
                },
              },
            },
          ],
        },
      }),
      prisma.project.count({
        where: {
          organizationId,
          isTemplate: false,
          status: { in: ["CHECKED_OUT", "ON_SITE", "RETURNED", ...activeStatuses] },
          ...locationFilter,
          OR: [
            { loadOutDate: { gte: dayStart, lt: dayEnd } },
            { rentalEndDate: { gte: dayStart, lt: dayEnd } },
            {
              services: {
                some: {
                  type: "PICKUP",
                  status: { not: "CANCELLED" },
                  date: { gte: dayStart, lt: dayEnd },
                },
              },
            },
          ],
        },
      }),
    ]);

    upcoming.push({
      date: dayStart.toISOString(),
      dispatching: dispatchCount,
      returning: returnCount,
    });
  }

  // ─── Alerts ────────────────────────────────────────────────────────────────
  const alerts: Alert[] = [];

  // Unprepped dispatches for today
  for (const d of todaysDispatch) {
    if (d.totalItems > 0 && d.checkedOutItems === 0) {
      alerts.push({
        type: "error",
        message: `#${d.projectNumber} ${d.name} — not started packing`,
      });
    } else if (d.totalItems > 0 && d.checkedOutItems < d.totalItems) {
      alerts.push({
        type: "warning",
        message: `#${d.projectNumber} ${d.name} — ${d.checkedOutItems}/${d.totalItems} packed`,
      });
    }
  }

  // Overdue returns (projects that should have returned before today)
  const overdueReturns = await prisma.project.findMany({
    where: {
      organizationId,
      isTemplate: false,
      status: { in: ["CHECKED_OUT", "ON_SITE"] },
      ...(locationId ? { locationId } : {}),
      OR: [
        { loadOutDate: { lt: todayStart } },
        { rentalEndDate: { lt: todayStart } },
      ],
    },
    select: { projectNumber: true, name: true },
    take: 5,
  });

  for (const p of overdueReturns) {
    alerts.push({
      type: "error",
      message: `#${p.projectNumber} ${p.name} — overdue return`,
    });
  }

  return {
    orgName: org?.name ?? "Warehouse",
    locationName,
    todaysDispatch,
    todaysReturns,
    prepStatus,
    upcoming,
    alerts,
  };
}

// ─── Token Validation (for API route) ────────────────────────────────────────

export async function validateDisplayToken(rawToken: string) {
  const tokenHash = hashToken(rawToken);

  const record = await prisma.warehouseDashboardToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      organizationId: true,
      locationId: true,
      isActive: true,
      layout: true,
      name: true,
    },
  });

  if (!record || !record.isActive) return null;

  // Update last accessed (fire and forget)
  prisma.warehouseDashboardToken
    .update({
      where: { id: record.id },
      data: { lastAccessedAt: new Date() },
    })
    .catch(() => {});

  return record;
}
