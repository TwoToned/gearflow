"use server";

import { serialize } from "@/lib/serialize";
import { getOrgContext } from "@/lib/org-context";
import { getClientMap } from "@/lib/clients-read";
import { getModelById } from "@/lib/models-read";
import { getActiveAssetsByModel, getActiveBulkAssetsByModel, type ConvexAsset, type ConvexBulkAsset } from "@/lib/assets-read";
import { getProjectsByOrg } from "@/lib/projects-read";
import {
  getOrgLineItems,
  getOrgLineItemUnits,
  indexProjectsById,
  projectMatchesCalendarWindow,
  buildModelBookings,
  buildKitBookings,
  buildAssetBookings,
  countLineItemsByProject,
  type BookingRow,
  type DateWindow,
} from "@/lib/availability-read";

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

/** epoch-ms (Convex) → ISO string (matching the old `.toISOString()`); null → "". */
function msToIso(ms: number | null): string {
  return ms == null ? "" : new Date(ms).toISOString();
}

/** Resolve `clientName` onto a {@link BookingRow}, producing the public BookingEntry shape. */
function toBookingEntry(row: BookingRow, clientMap: Map<string, { name: string }>): BookingEntry {
  return {
    id: row.id,
    projectId: row.projectId,
    projectNumber: row.projectNumber,
    projectName: row.projectName,
    clientName: clientMap.get(row.clientId ?? "")?.name ?? null,
    projectStatus: row.projectStatus,
    rentalStartDate: msToIso(row.rentalStartMs),
    rentalEndDate: msToIso(row.rentalEndMs),
    quantity: row.quantity,
  };
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
  const window: DateWindow = { start: new Date(params.startDate), end: new Date(params.endDate) };

  // Line items + projects + model + active assets all live in Convex — fetch in parallel.
  const [lineItems, projects, model, activeAssets, activeBulkAssets, clientMap] = await Promise.all([
    getOrgLineItems(organizationId),
    getProjectsByOrg(organizationId),
    getModelById(modelId),
    getActiveAssetsByModel(modelId, organizationId),
    getActiveBulkAssetsByModel(modelId, organizationId),
    getClientMap(organizationId),
  ]);

  const projectsById = indexProjectsById(projects);
  const rows = buildModelBookings(modelId, lineItems, projectsById, window);
  const bookings = rows.map((r) => toBookingEntry(r, clientMap));

  let totalStock = 0;
  let effectiveStock = 0;
  if (model) {
    if ((model.assetType ?? "SERIALIZED") === "SERIALIZED") {
      totalStock = activeAssets.length;
      const unavailable = activeAssets.filter(
        (a: ConvexAsset) => a.status === "IN_MAINTENANCE" || a.status === "LOST" || a.status === "RETIRED"
      ).length;
      effectiveStock = totalStock - unavailable;
    } else {
      totalStock = activeBulkAssets.reduce((sum: number, ba: ConvexBulkAsset) => sum + (ba.totalQuantity ?? 0), 0);
      effectiveStock = totalStock;
    }
  }

  return serialize({ bookings, totalStock, effectiveStock }) as {
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
  const window: DateWindow = { start: new Date(params.startDate), end: new Date(params.endDate) };

  // An asset is booked via a legacy line.assetId row OR via a
  // ProjectLineItemUnit row (the fulfillment model) — both come from Convex now.
  const [lineItems, units, projects, clientMap] = await Promise.all([
    getOrgLineItems(organizationId),
    getOrgLineItemUnits(organizationId),
    getProjectsByOrg(organizationId),
    getClientMap(organizationId),
  ]);

  const projectsById = indexProjectsById(projects);
  const rows = buildAssetBookings(assetId, lineItems, units, projectsById, window);
  const bookings = rows.map((r) => toBookingEntry(r, clientMap));

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
  const window: DateWindow = { start: new Date(params.startDate), end: new Date(params.endDate) };

  const [lineItems, projects, clientMap] = await Promise.all([
    getOrgLineItems(organizationId),
    getProjectsByOrg(organizationId),
    getClientMap(organizationId),
  ]);

  const projectsById = indexProjectsById(projects);
  const rows = buildKitBookings(kitId, lineItems, projectsById, window);
  const bookings = rows.map((r) => toBookingEntry(r, clientMap));

  return serialize(bookings) as BookingEntry[];
}

export async function getCalendarData(params: {
  startDate: string;
  endDate: string;
}) {
  const { organizationId } = await getOrgContext();
  const window: DateWindow = { start: new Date(params.startDate), end: new Date(params.endDate) };

  const [allOrgProjects, clientMap, lineItems] = await Promise.all([
    getProjectsByOrg(organizationId),
    getClientMap(organizationId),
    getOrgLineItems(organizationId),
  ]);

  const calendarProjects = allOrgProjects
    .filter((p) => projectMatchesCalendarWindow(p, window))
    .sort((a, b) => (a.rentalStartDate as number) - (b.rentalStartDate as number));

  const calendarIds = calendarProjects.map((p) => p.id);
  const liCountMap = countLineItemsByProject(calendarIds, lineItems);

  const result: CalendarProject[] = calendarProjects.map((p) => ({
    id: p.id,
    projectNumber: p.projectNumber,
    name: p.name,
    clientName: clientMap.get(p.clientId ?? "")?.name ?? null,
    status: p.status ?? "ENQUIRY",
    rentalStartDate: p.rentalStartDate ? new Date(p.rentalStartDate as number).toISOString() : "",
    rentalEndDate: p.rentalEndDate ? new Date(p.rentalEndDate as number).toISOString() : "",
    lineItemCount: liCountMap.get(p.id) ?? 0,
  }));

  return serialize(result) as CalendarProject[];
}
