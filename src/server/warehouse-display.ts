"use server";

import { randomBytes, createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { getLocationById } from "@/lib/locations-read";
import { getProjectsByOrg } from "@/lib/projects-read";
import {
  getDisplayServices,
  getDisplayLineItems,
  filterDeliveryServices,
  filterPickupServices,
  buildLineItemCountMaps,
} from "@/lib/warehouse-display-read";

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
    locationName = (await getLocationById(locationId))?.name ?? null;
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const todayMs = todayStart.getTime();
  const tomorrowMs = todayEnd.getTime();

  const activeStatusSet = new Set<string>(["CONFIRMED", "PREPPING", "CHECKED_OUT", "ON_SITE"]);
  const returnStatusSet = new Set<string>(["CHECKED_OUT", "ON_SITE", "RETURNED"]);
  const returnOrActiveStatusSet = new Set<string>([...returnStatusSet, ...activeStatusSet]);

  // Fetch all Convex projects once — source of truth for all project filtering below
  const allProjects = await getProjectsByOrg(organizationId);
  const projectMap = new Map(allProjects.map((p) => [p.id, p]));

  const matchesLocation = (p: (typeof allProjects)[0]): boolean =>
    !locationId || p.locationId === locationId;

  // Date-based dispatch projects: loadInDate or rentalStartDate falls today
  const dispatchByDate = allProjects.filter((p) => {
    if (p.isTemplate || !activeStatusSet.has(p.status ?? "") || !matchesLocation(p)) return false;
    const inDate = p.loadInDate as number | undefined;
    const startDate = p.rentalStartDate as number | undefined;
    return (
      (inDate != null && inDate >= todayMs && inDate < tomorrowMs) ||
      (startDate != null && startDate >= todayMs && startDate < tomorrowMs)
    );
  });

  // Date-based return projects: loadOutDate or rentalEndDate falls today
  const returnsByDate = allProjects.filter((p) => {
    if (p.isTemplate || !returnStatusSet.has(p.status ?? "") || !matchesLocation(p)) return false;
    const outDate = p.loadOutDate as number | undefined;
    const endDate = p.rentalEndDate as number | undefined;
    return (
      (outDate != null && outDate >= todayMs && outDate < tomorrowMs) ||
      (endDate != null && endDate >= todayMs && endDate < tomorrowMs)
    );
  });

  // Prepping projects (CONFIRMED/PREPPING), sorted by loadInDate asc, limit 12
  const preppingRaw = allProjects
    .filter((p) => {
      if (p.isTemplate || !matchesLocation(p)) return false;
      return p.status === "CONFIRMED" || p.status === "PREPPING";
    })
    .sort((a, b) => {
      const aMs = (a.loadInDate as number | undefined) ?? Infinity;
      const bMs = (b.loadInDate as number | undefined) ?? Infinity;
      return aMs - bMs;
    })
    .slice(0, 12);

  // Overdue returns: CHECKED_OUT or ON_SITE with past-due loadOutDate/rentalEndDate
  const overdueRaw = allProjects
    .filter((p) => {
      if (p.isTemplate || !matchesLocation(p)) return false;
      if (p.status !== "CHECKED_OUT" && p.status !== "ON_SITE") return false;
      const outDate = p.loadOutDate as number | undefined;
      const endDate = p.rentalEndDate as number | undefined;
      return (outDate != null && outDate < todayMs) || (endDate != null && endDate < todayMs);
    })
    .slice(0, 5);

  // Fetch today's and upcoming services without project filter — cross-ref via Convex projectMap.
  // projectService is dual-written; read all org services once from Convex and replicate the four
  // Prisma where-clauses with pure JS filters (see src/lib/warehouse-display-read.ts).
  const sevenDaysEnd = new Date(todayStart);
  sevenDaysEnd.setDate(sevenDaysEnd.getDate() + 8);
  const todayStartMs = todayStart.getTime();
  const todayEndMs = todayEnd.getTime();
  const sevenDaysEndMs = sevenDaysEnd.getTime();

  const allServices = await getDisplayServices(organizationId);
  const deliveryServices = filterDeliveryServices(allServices, todayStartMs, todayEndMs);
  const pickupServices = filterPickupServices(allServices, todayStartMs, todayEndMs);
  const upcomingDeliverySvcs = filterDeliveryServices(allServices, todayEndMs, sevenDaysEndMs);
  const upcomingPickupSvcs = filterPickupServices(allServices, todayEndMs, sevenDaysEndMs);

  // Filter today's services to only projects that are active in Convex
  const activeDeliveries = deliveryServices.filter((s) => {
    const p = projectMap.get(s.projectId);
    return p && !p.isTemplate && activeStatusSet.has(p.status ?? "") && matchesLocation(p);
  });
  const activePickups = pickupServices.filter((s) => {
    const p = projectMap.get(s.projectId);
    return p && !p.isTemplate && returnStatusSet.has(p.status ?? "") && matchesLocation(p);
  });

  const serviceDispatchIds = new Set(activeDeliveries.map((s) => s.projectId));
  const serviceReturnIds = new Set(activePickups.map((s) => s.projectId));

  // Build dayStart-ms → Set<projectId> maps for upcoming services
  const deliverySvcByDayMs = new Map<number, Set<string>>();
  for (const s of upcomingDeliverySvcs) {
    if (!s.date) continue;
    const ms = new Date(s.date.getFullYear(), s.date.getMonth(), s.date.getDate()).getTime();
    if (!deliverySvcByDayMs.has(ms)) deliverySvcByDayMs.set(ms, new Set());
    deliverySvcByDayMs.get(ms)!.add(s.projectId);
  }
  const pickupSvcByDayMs = new Map<number, Set<string>>();
  for (const s of upcomingPickupSvcs) {
    if (!s.date) continue;
    const ms = new Date(s.date.getFullYear(), s.date.getMonth(), s.date.getDate()).getTime();
    if (!pickupSvcByDayMs.has(ms)) pickupSvcByDayMs.set(ms, new Set());
    pickupSvcByDayMs.get(ms)!.add(s.projectId);
  }

  // Batch-fetch line item counts for all projects that need them
  const allNeededIds = [
    ...new Set([
      ...activeDeliveries.map((s) => s.projectId),
      ...dispatchByDate.filter((p) => !serviceDispatchIds.has(p.id)).map((p) => p.id),
      ...activePickups.map((s) => s.projectId),
      ...returnsByDate.filter((p) => !serviceReturnIds.has(p.id)).map((p) => p.id),
      ...preppingRaw.map((p) => p.id),
    ]),
  ];

  // projectLineItem is dual-written; read only the needed projects' line items from Convex
  // (narrow listByProjectIds — no full-org scan on a public endpoint) and group-count in JS.
  const lineItems = await getDisplayLineItems(organizationId, allNeededIds);
  const { totalCountMap, checkedOutCountMap } = buildLineItemCountMaps(lineItems);

  // ─── Today's Dispatch ──────────────────────────────────────────────────────
  const todaysDispatch: DispatchProject[] = [];

  for (const svc of activeDeliveries) {
    const p = projectMap.get(svc.projectId)!;
    todaysDispatch.push({
      id: p.id,
      projectNumber: p.projectNumber,
      name: p.name,
      deliveryTime: svc.scheduledTime || svc.startTime || null,
      destination: svc.address || null,
      vehicle: svc.vehicleDescription || null,
      status: p.status ?? "",
      totalItems: totalCountMap.get(p.id) ?? 0,
      checkedOutItems: checkedOutCountMap.get(p.id) ?? 0,
    });
  }

  for (const p of dispatchByDate) {
    if (!serviceDispatchIds.has(p.id)) {
      todaysDispatch.push({
        id: p.id,
        projectNumber: p.projectNumber,
        name: p.name,
        deliveryTime: (p.loadInTime as string | undefined) || null,
        destination: null,
        vehicle: null,
        status: p.status ?? "",
        totalItems: totalCountMap.get(p.id) ?? 0,
        checkedOutItems: checkedOutCountMap.get(p.id) ?? 0,
      });
    }
  }

  // ─── Today's Returns ───────────────────────────────────────────────────────
  const todaysReturns: ReturnProject[] = [];

  for (const svc of activePickups) {
    const p = projectMap.get(svc.projectId)!;
    todaysReturns.push({
      id: p.id,
      projectNumber: p.projectNumber,
      name: p.name,
      dueTime: svc.scheduledTime || svc.startTime || null,
      expectedItems: checkedOutCountMap.get(p.id) ?? 0,
    });
  }

  for (const p of returnsByDate) {
    if (!serviceReturnIds.has(p.id)) {
      todaysReturns.push({
        id: p.id,
        projectNumber: p.projectNumber,
        name: p.name,
        dueTime: (p.loadOutTime as string | undefined) || null,
        expectedItems: checkedOutCountMap.get(p.id) ?? 0,
      });
    }
  }

  // ─── Prep Status ───────────────────────────────────────────────────────────
  const prepStatus: PrepCard[] = preppingRaw.map((p) => ({
    projectId: p.id,
    projectNumber: p.projectNumber,
    projectName: p.name,
    packedItems: checkedOutCountMap.get(p.id) ?? 0,
    totalItems: totalCountMap.get(p.id) ?? 0,
  }));

  // ─── Upcoming 7 Days ──────────────────────────────────────────────────────
  const upcoming: UpcomingDay[] = [];

  for (let i = 1; i <= 7; i++) {
    const dayStart = new Date(todayStart);
    dayStart.setDate(dayStart.getDate() + i);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const dayStartMs = dayStart.getTime();
    const dayEndMs = dayEnd.getTime();

    const daySvcDispatch = deliverySvcByDayMs.get(dayStartMs) ?? new Set<string>();
    const daySvcPickup = pickupSvcByDayMs.get(dayStartMs) ?? new Set<string>();

    const dispatchCount = allProjects.filter((p) => {
      if (p.isTemplate || !activeStatusSet.has(p.status ?? "") || !matchesLocation(p)) return false;
      const inDate = p.loadInDate as number | undefined;
      const startDate = p.rentalStartDate as number | undefined;
      return (
        (inDate != null && inDate >= dayStartMs && inDate < dayEndMs) ||
        (startDate != null && startDate >= dayStartMs && startDate < dayEndMs) ||
        daySvcDispatch.has(p.id)
      );
    }).length;

    const returnCount = allProjects.filter((p) => {
      if (p.isTemplate || !returnOrActiveStatusSet.has(p.status ?? "") || !matchesLocation(p))
        return false;
      const outDate = p.loadOutDate as number | undefined;
      const endDate = p.rentalEndDate as number | undefined;
      return (
        (outDate != null && outDate >= dayStartMs && outDate < dayEndMs) ||
        (endDate != null && endDate >= dayStartMs && endDate < dayEndMs) ||
        daySvcPickup.has(p.id)
      );
    }).length;

    upcoming.push({
      date: dayStart.toISOString(),
      dispatching: dispatchCount,
      returning: returnCount,
    });
  }

  // ─── Alerts ────────────────────────────────────────────────────────────────
  const alerts: Alert[] = [];

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

  for (const p of overdueRaw) {
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
