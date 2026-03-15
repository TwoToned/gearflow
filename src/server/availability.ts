"use server";

import { prisma } from "@/lib/prisma";
import { serialize } from "@/lib/serialize";
import { getOrgContext } from "@/lib/org-context";

export interface CalendarProject {
  id: string;
  projectNumber: string;
  name: string;
  clientName: string | null;
  status: string;
  rentalStartDate: string;
  rentalEndDate: string;
  lineItemCount: number;
}

/**
 * Get all projects that overlap with the given month range.
 * Returns projects with their rental dates so the UI can place them on calendar days.
 */
export interface BookingEntry {
  id: string;
  projectId: string;
  projectNumber: string;
  projectName: string;
  clientName: string | null;
  projectStatus: string;
  rentalStartDate: string;
  rentalEndDate: string;
  quantity: number;
}

/**
 * Get bookings for a specific model within a date range.
 * Returns line items with project details for calendar display.
 */
export async function getModelBookings(
  modelId: string,
  params: { startDate: string; endDate: string }
): Promise<{ bookings: BookingEntry[]; totalStock: number; effectiveStock: number }> {
  const { organizationId } = await getOrgContext();
  const start = new Date(params.startDate);
  const end = new Date(params.endDate);

  const [lineItems, model] = await Promise.all([
    prisma.projectLineItem.findMany({
      where: {
        organizationId,
        modelId,
        status: { not: "CANCELLED" },
        project: {
          isTemplate: false,
          status: { notIn: ["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"] },
          rentalStartDate: { lte: end },
          rentalEndDate: { gte: start },
        },
      },
      include: {
        project: {
          select: {
            id: true,
            projectNumber: true,
            name: true,
            status: true,
            rentalStartDate: true,
            rentalEndDate: true,
            client: { select: { name: true } },
          },
        },
      },
      orderBy: { project: { rentalStartDate: "asc" } },
    }),
    prisma.model.findUnique({
      where: { id: modelId, organizationId },
      include: {
        assets: { where: { isActive: true }, select: { status: true } },
        bulkAssets: { where: { isActive: true }, select: { totalQuantity: true } },
      },
    }),
  ]);

  // Deduplicate by project (sum quantities per project)
  const byProject = new Map<string, BookingEntry>();
  for (const li of lineItems) {
    const key = li.project.id;
    const existing = byProject.get(key);
    if (existing) {
      existing.quantity += li.quantity;
    } else {
      byProject.set(key, {
        id: li.id,
        projectId: li.project.id,
        projectNumber: li.project.projectNumber,
        projectName: li.project.name,
        clientName: li.project.client?.name || null,
        projectStatus: li.project.status,
        rentalStartDate: li.project.rentalStartDate?.toISOString() || "",
        rentalEndDate: li.project.rentalEndDate?.toISOString() || "",
        quantity: li.quantity,
      });
    }
  }

  let totalStock = 0;
  let effectiveStock = 0;
  if (model) {
    if (model.assetType === "SERIALIZED") {
      totalStock = model.assets.length;
      const unavailable = model.assets.filter(
        (a) => a.status === "IN_MAINTENANCE" || a.status === "LOST" || a.status === "RETIRED"
      ).length;
      effectiveStock = totalStock - unavailable;
    } else {
      totalStock = model.bulkAssets.reduce((sum, ba) => sum + ba.totalQuantity, 0);
      effectiveStock = totalStock;
    }
  }

  return serialize({ bookings: [...byProject.values()], totalStock, effectiveStock }) as {
    bookings: BookingEntry[];
    totalStock: number;
    effectiveStock: number;
  };
}

/**
 * Get bookings for a specific serialized asset within a date range.
 */
export async function getAssetBookings(
  assetId: string,
  params: { startDate: string; endDate: string }
): Promise<BookingEntry[]> {
  const { organizationId } = await getOrgContext();
  const start = new Date(params.startDate);
  const end = new Date(params.endDate);

  const lineItems = await prisma.projectLineItem.findMany({
    where: {
      organizationId,
      assetId,
      status: { not: "CANCELLED" },
      project: {
        isTemplate: false,
        status: { notIn: ["CANCELLED"] },
        rentalStartDate: { lte: end },
        rentalEndDate: { gte: start },
      },
    },
    include: {
      project: {
        select: {
          id: true,
          projectNumber: true,
          name: true,
          status: true,
          rentalStartDate: true,
          rentalEndDate: true,
          client: { select: { name: true } },
        },
      },
    },
    orderBy: { project: { rentalStartDate: "asc" } },
  });

  const bookings: BookingEntry[] = lineItems.map((li) => ({
    id: li.id,
    projectId: li.project.id,
    projectNumber: li.project.projectNumber,
    projectName: li.project.name,
    clientName: li.project.client?.name || null,
    projectStatus: li.project.status,
    rentalStartDate: li.project.rentalStartDate?.toISOString() || "",
    rentalEndDate: li.project.rentalEndDate?.toISOString() || "",
    quantity: li.quantity,
  }));

  return serialize(bookings) as BookingEntry[];
}

/**
 * Get bookings for a specific kit within a date range.
 */
export async function getKitBookings(
  kitId: string,
  params: { startDate: string; endDate: string }
): Promise<BookingEntry[]> {
  const { organizationId } = await getOrgContext();
  const start = new Date(params.startDate);
  const end = new Date(params.endDate);

  const lineItems = await prisma.projectLineItem.findMany({
    where: {
      organizationId,
      kitId,
      isKitChild: false,
      status: { not: "CANCELLED" },
      project: {
        isTemplate: false,
        status: { notIn: ["CANCELLED"] },
        rentalStartDate: { lte: end },
        rentalEndDate: { gte: start },
      },
    },
    include: {
      project: {
        select: {
          id: true,
          projectNumber: true,
          name: true,
          status: true,
          rentalStartDate: true,
          rentalEndDate: true,
          client: { select: { name: true } },
        },
      },
    },
    orderBy: { project: { rentalStartDate: "asc" } },
  });

  const bookings: BookingEntry[] = lineItems.map((li) => ({
    id: li.id,
    projectId: li.project.id,
    projectNumber: li.project.projectNumber,
    projectName: li.project.name,
    clientName: li.project.client?.name || null,
    projectStatus: li.project.status,
    rentalStartDate: li.project.rentalStartDate?.toISOString() || "",
    rentalEndDate: li.project.rentalEndDate?.toISOString() || "",
    quantity: li.quantity,
  }));

  return serialize(bookings) as BookingEntry[];
}

export async function getCalendarData(params: {
  startDate: string;
  endDate: string;
}) {
  const { organizationId } = await getOrgContext();
  const start = new Date(params.startDate);
  const end = new Date(params.endDate);

  const projects = await prisma.project.findMany({
    where: {
      organizationId,
      isTemplate: false,
      status: { notIn: ["CANCELLED"] },
      rentalStartDate: { lte: end },
      rentalEndDate: { gte: start },
    },
    include: {
      client: { select: { name: true } },
      _count: {
        select: {
          lineItems: { where: { status: { not: "CANCELLED" } } },
        },
      },
    },
    orderBy: { rentalStartDate: "asc" },
  });

  const result: CalendarProject[] = projects.map((p) => ({
    id: p.id,
    projectNumber: p.projectNumber,
    name: p.name,
    clientName: p.client?.name || null,
    status: p.status,
    rentalStartDate: p.rentalStartDate?.toISOString() || "",
    rentalEndDate: p.rentalEndDate?.toISOString() || "",
    lineItemCount: p._count.lineItems,
  }));

  return serialize(result) as CalendarProject[];
}
