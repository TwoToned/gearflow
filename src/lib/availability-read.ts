import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import type { ConvexProject } from "@/lib/projects-read";
import { mapLineItemDoc, mapUnitDoc, type MappedLineItem, type MappedUnit } from "@/lib/project-line-item-read";

/**
 * Convex read layer for **equipment availability / bookings** — the Prisma→Convex
 * replacement for the cross-project line-item reads in `src/server/availability.ts`
 * and the overbooking computation in `src/lib/availability.ts`.
 *
 * The old code joined `projectLineItem` (+ `projectLineItemUnit`) against the
 * `project` row via a nested Prisma `where: { project: { ... } }`. Projects and
 * line items are now both Convex domains, so we fetch the org's flat line items
 * (and the org's projects) from Convex and reproduce the join + filters in JS.
 *
 * **Fidelity (matches the Prisma semantics exactly):**
 * - The project window filter `projectMatchesWindow` reproduces the Prisma
 *   `project` `where`: `isTemplate === false`, `status NOT IN (CANCELLED,
 *   RETURNED, COMPLETED, INVOICED)`, `rentalStartDate <= end`, `rentalEndDate >=
 *   start`. A project with a null `rentalStartDate`/`rentalEndDate` can never
 *   satisfy `lte`/`gte` against a real date (Prisma drops null on a comparison),
 *   so it's excluded — same as the SQL.
 * - Line items are filtered to `status !== "CANCELLED"` (Prisma `status: { not:
 *   "CANCELLED" }`); ordering by `project.rentalStartDate asc` is reproduced where
 *   the original used it.
 * - **No Prisma fallback on a Convex miss** — a line item whose project isn't in
 *   the Convex project set is simply dropped (the project row isn't mirrored / was
 *   deleted), exactly like an inner join against a missing row.
 *
 * Auth-User and client-name joins stay in the server-action layer (batched).
 */

type LineItemDoc = Doc<"projectLineItems">;
type UnitDoc = Doc<"projectLineItemUnits">;

/** Project statuses excluded from availability/booking windows (Prisma `notIn`). */
export const EXCLUDED_PROJECT_STATUSES: ReadonlySet<string> = new Set([
  "CANCELLED",
  "RETURNED",
  "COMPLETED",
  "INVOICED",
]);

/** The booking date window (inclusive overlap). */
export interface DateWindow {
  start: Date;
  end: Date;
}

/**
 * Reproduces the Prisma `project` `where` used by every availability read:
 * non-template, active status, and rental window overlaps `[start, end]`.
 * A project with no rental dates is excluded (null fails the date comparison,
 * matching Prisma's behaviour on `lte`/`gte` against null).
 */
export function projectMatchesWindow(p: ConvexProject, window: DateWindow): boolean {
  if (p.isTemplate === true) return false;
  if (p.status != null && EXCLUDED_PROJECT_STATUSES.has(p.status)) return false;
  if (p.rentalStartDate == null || p.rentalEndDate == null) return false;
  // rentalStartDate <= end AND rentalEndDate >= start
  return p.rentalStartDate <= window.end.getTime() && p.rentalEndDate >= window.start.getTime();
}

/** Build a `projectId → ConvexProject` map from the org's projects. */
export function indexProjectsById(projects: ConvexProject[]): Map<string, ConvexProject> {
  return new Map(projects.map((p) => [p.id, p]));
}

/** A booking row as the calendar UI consumes it — `clientName` resolved by the caller. */
export interface BookingRow {
  /** Line item id (or, for a unit-only booking, the unit's line item id). */
  id: string;
  projectId: string;
  projectNumber: string;
  projectName: string;
  clientId: string | null;
  projectStatus: string;
  /** epoch-ms (caller converts to ISO). */
  rentalStartMs: number | null;
  rentalEndMs: number | null;
  quantity: number;
}

/** Sort key for ordering bookings by `project.rentalStartDate asc` (nulls last). */
function rentalStartSort(a: BookingRow, b: BookingRow): number {
  const av = a.rentalStartMs ?? Number.POSITIVE_INFINITY;
  const bv = b.rentalStartMs ?? Number.POSITIVE_INFINITY;
  return av - bv;
}

function toBookingRow(li: MappedLineItem, p: ConvexProject, quantity: number): BookingRow {
  return {
    id: li.id,
    projectId: p.id,
    projectNumber: p.projectNumber,
    projectName: p.name,
    clientId: p.clientId ?? null,
    projectStatus: p.status ?? "ENQUIRY",
    rentalStartMs: p.rentalStartDate ?? null,
    rentalEndMs: p.rentalEndDate ?? null,
    quantity,
  };
}

/**
 * Model bookings: every non-cancelled line item for `modelId` whose project is in
 * the window, **deduplicated by project** (quantities summed). Mirrors
 * `getModelBookings`'s per-project rollup. Ordered by project rental start asc.
 */
export function buildModelBookings(
  modelId: string,
  lineItems: MappedLineItem[],
  projectsById: Map<string, ConvexProject>,
  window: DateWindow,
): BookingRow[] {
  const byProject = new Map<string, BookingRow>();
  for (const li of lineItems) {
    if (li.modelId !== modelId) continue;
    if (li.status === "CANCELLED") continue;
    const p = projectsById.get(li.projectId);
    if (!p || !projectMatchesWindow(p, window)) continue;
    const existing = byProject.get(p.id);
    if (existing) {
      existing.quantity += li.quantity;
    } else {
      byProject.set(p.id, toBookingRow(li, p, li.quantity));
    }
  }
  return [...byProject.values()].sort(rentalStartSort);
}

/**
 * Kit bookings: every non-cancelled, non-kit-child line item for `kitId` whose
 * project is in the window. Mirrors `getKitBookings` (no per-project dedup — one
 * row per kit line). Ordered by project rental start asc.
 */
export function buildKitBookings(
  kitId: string,
  lineItems: MappedLineItem[],
  projectsById: Map<string, ConvexProject>,
  window: DateWindow,
): BookingRow[] {
  const out: BookingRow[] = [];
  for (const li of lineItems) {
    if (li.kitId !== kitId) continue;
    if (li.isKitChild) continue;
    if (li.status === "CANCELLED") continue;
    const p = projectsById.get(li.projectId);
    if (!p || !projectMatchesWindow(p, window)) continue;
    out.push(toBookingRow(li, p, li.quantity));
  }
  return out.sort(rentalStartSort);
}

/**
 * Asset bookings: an asset is booked via a legacy `lineItem.assetId` row OR via a
 * `projectLineItemUnit.assetId` row (the fulfillment model). Mirrors
 * `getAssetBookings`: collect the legacy-line bookings first, then add one
 * quantity-1 booking per unit whose line item wasn't already counted. Both paths
 * require the (line item's) project to be in the window and non-cancelled.
 * Ordered by project rental start asc (legacy lines then units, matching the old
 * two-query concat + per-query ordering).
 */
export function buildAssetBookings(
  assetId: string,
  lineItems: MappedLineItem[],
  units: MappedUnit[],
  projectsById: Map<string, ConvexProject>,
  window: DateWindow,
): BookingRow[] {
  const liById = new Map(lineItems.map((li) => [li.id, li]));
  const seenLineIds = new Set<string>();

  // Legacy line.assetId bookings.
  const legacy: BookingRow[] = [];
  for (const li of lineItems) {
    if (li.assetId !== assetId) continue;
    if (li.status === "CANCELLED") continue;
    const p = projectsById.get(li.projectId);
    if (!p || !projectMatchesWindow(p, window)) continue;
    seenLineIds.add(li.id);
    legacy.push(toBookingRow(li, p, li.quantity));
  }
  legacy.sort(rentalStartSort);

  // Unit-level bookings (fulfillment): one physical asset == quantity 1.
  const unitRows: BookingRow[] = [];
  for (const u of units) {
    if (u.assetId !== assetId) continue;
    if (u.status === "CANCELLED") continue;
    if (seenLineIds.has(u.lineItemId)) continue;
    const li = liById.get(u.lineItemId);
    // Prisma joined `lineItem: { status not CANCELLED, project: window }`.
    if (!li || li.status === "CANCELLED") continue;
    const p = projectsById.get(li.projectId);
    if (!p || !projectMatchesWindow(p, window)) continue;
    unitRows.push({ ...toBookingRow(li, p, 1), id: u.lineItemId });
  }
  unitRows.sort(rentalStartSort);

  return [...legacy, ...unitRows];
}

/**
 * For overbooking: sum non-cancelled, non-sub-hire bookings per model across all
 * projects whose window overlaps (or, when `window` is null, only `thisProjectId`).
 * Returns total-by-model and this-project-by-model maps, mirroring
 * `computeOverbookedStatus`'s aggregation.
 */
export function sumBookingsByModel(
  modelIds: string[],
  lineItems: MappedLineItem[],
  projectsById: Map<string, ConvexProject>,
  window: DateWindow | null,
  thisProjectId: string,
): { totalByModel: Map<string, number>; thisProjectByModel: Map<string, number> } {
  const modelSet = new Set(modelIds);
  const totalByModel = new Map<string, number>();
  const thisProjectByModel = new Map<string, number>();

  for (const li of lineItems) {
    if (li.modelId == null || !modelSet.has(li.modelId)) continue;
    if (li.status === "CANCELLED") continue;
    if (li.subHireId != null) continue;

    if (window) {
      const p = projectsById.get(li.projectId);
      if (!p || !projectMatchesWindow(p, window)) continue;
    } else {
      // Dateless: only this project's bookings (no overlap possible).
      if (li.projectId !== thisProjectId) continue;
    }

    totalByModel.set(li.modelId, (totalByModel.get(li.modelId) ?? 0) + li.quantity);
    if (li.projectId === thisProjectId) {
      thisProjectByModel.set(li.modelId, (thisProjectByModel.get(li.modelId) ?? 0) + li.quantity);
    }
  }

  return { totalByModel, thisProjectByModel };
}

/**
 * The calendar's project filter (`getCalendarData`) — looser than
 * {@link projectMatchesWindow}: it only excludes `CANCELLED` (NOT the full
 * RETURNED/COMPLETED/INVOICED set the booking reads exclude), requires both
 * rental dates, and overlaps `[start, end]`. Kept distinct so the calendar keeps
 * showing returned/completed/invoiced projects exactly as the old Prisma filter did.
 */
export function projectMatchesCalendarWindow(p: ConvexProject, window: DateWindow): boolean {
  if (p.isTemplate === true) return false;
  if (p.status === "CANCELLED") return false;
  if (p.rentalStartDate == null || p.rentalEndDate == null) return false;
  return p.rentalStartDate <= window.end.getTime() && p.rentalEndDate >= window.start.getTime();
}

/** Count non-cancelled line items per project (mirrors the calendar `groupBy`). */
export function countLineItemsByProject(
  projectIds: Iterable<string>,
  lineItems: MappedLineItem[],
): Map<string, number> {
  const wanted = new Set(projectIds);
  const counts = new Map<string, number>();
  for (const li of lineItems) {
    if (!wanted.has(li.projectId)) continue;
    if (li.status === "CANCELLED") continue;
    counts.set(li.projectId, (counts.get(li.projectId) ?? 0) + 1);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Convex fetchers (IO). The org's flat line items / units, mapped to the Prisma
// row shape via the shared keystone mappers.
// ---------------------------------------------------------------------------

/** All non-template line items for the org, mapped to the Prisma row shape. */
export async function getOrgLineItems(orgId: string): Promise<MappedLineItem[]> {
  const convex = await getConvexClient();
  const docs: LineItemDoc[] = await convex.query(api.projectLineItems.list, { orgId });
  return docs.map(mapLineItemDoc);
}

/** All line item units for the org, mapped to the Prisma unit row shape. */
export async function getOrgLineItemUnits(orgId: string): Promise<MappedUnit[]> {
  const convex = await getConvexClient();
  const docs: UnitDoc[] = await convex.query(api.projectLineItemUnits.list, { orgId });
  return docs.map(mapUnitDoc);
}
