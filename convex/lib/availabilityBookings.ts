/**
 * PURE booking/availability builders — the Convex-side port of the pure logic
 * that used to live in `src/lib/availability-read.ts` (deleted when
 * `src/server/availability.ts` was re-homed browser-direct).
 *
 * These reproduce the exact Prisma→JS join semantics the server action ran, so
 * the native `convex/availability.ts` queries return byte-identical bookings. Like
 * `convex/lib/recalc.ts`, the math is DUPLICATED into `convex/` (Convex functions
 * cannot import `@/lib/*` — the app's path alias doesn't resolve in the Convex
 * bundler); `convex/availabilityBookings.test.ts` pins parity.
 *
 * All dates are epoch-ms (Convex-native). The caller (the query) maps raw Convex
 * docs into these minimal shapes, runs the builders, then resolves client names +
 * ISO strings for the public shape.
 *
 * WS2 (#941): `projectMatchesWindow` reads the PROJECT window (getProjectWindow —
 * defaults to the rental window when unset), not the rental window directly.
 * `projectMatchesCalendarWindow` is UNCHANGED — the calendar keeps drawing rental
 * bars (pricing's window), by design (see #943).
 */
import { getProjectWindow } from "./projectWindow";

/** Project statuses excluded from availability/booking windows (Prisma `notIn`). */
export const EXCLUDED_PROJECT_STATUSES: ReadonlySet<string> = new Set([
  "CANCELLED",
  "RETURNED",
  "COMPLETED",
  "INVOICED",
]);

/** Inclusive-overlap booking window, in epoch-ms. */
export interface DateWindowMs {
  startMs: number;
  endMs: number;
}

/** The minimal line-item shape the booking builders read. */
export interface BookingLineItem {
  id: string;
  projectId: string;
  modelId: string | null;
  kitId: string | null;
  assetId: string | null;
  isKitChild: boolean;
  status: string;
  quantity: number;
}

/** The minimal line-item-unit shape (the fulfillment model). */
export interface BookingUnit {
  lineItemId: string;
  assetId: string | null;
  status: string;
}

/** The minimal project shape the builders read. */
export interface BookingProject {
  id: string;
  projectNumber: string;
  name: string;
  clientId: string | null;
  status: string;
  isTemplate: boolean;
  rentalStartMs: number | null;
  rentalEndMs: number | null;
  /** WS2 (#941) — set only when the project's gear-committed window diverges
   *  from the rental window; `getProjectWindow` falls back to rental* when null. */
  projectStartMs: number | null;
  projectEndMs: number | null;
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
  rentalStartMs: number | null;
  rentalEndMs: number | null;
  quantity: number;
}

/**
 * Reproduces the Prisma `project` `where` used by every availability *booking* read:
 * non-template, active status, and PROJECT window (WS2 #941 — falls back to the
 * rental window when unset) overlaps `[start, end]`. A project with no resolvable
 * window is excluded (null fails the date comparison, matching Prisma's behaviour
 * on `lte`/`gte` against null).
 */
export function projectMatchesWindow(p: BookingProject, window: DateWindowMs): boolean {
  if (p.isTemplate === true) return false;
  if (p.status != null && EXCLUDED_PROJECT_STATUSES.has(p.status)) return false;
  const { start, end } = getProjectWindow({
    projectStartDate: p.projectStartMs,
    projectEndDate: p.projectEndMs,
    rentalStartDate: p.rentalStartMs,
    rentalEndDate: p.rentalEndMs,
  });
  if (start == null || end == null) return false;
  return start <= window.endMs && end >= window.startMs;
}

/**
 * The calendar's project filter — looser than {@link projectMatchesWindow}: it only
 * excludes `CANCELLED` (NOT the full RETURNED/COMPLETED/INVOICED set the booking reads
 * exclude), requires both rental dates, and overlaps `[start, end]`. Kept distinct so
 * the calendar keeps showing returned/completed/invoiced projects.
 */
export function projectMatchesCalendarWindow(p: BookingProject, window: DateWindowMs): boolean {
  if (p.isTemplate === true) return false;
  if (p.status === "CANCELLED") return false;
  if (p.rentalStartMs == null || p.rentalEndMs == null) return false;
  return p.rentalStartMs <= window.endMs && p.rentalEndMs >= window.startMs;
}

/** Sort key for ordering bookings by `project.rentalStartDate asc` (nulls last). */
function rentalStartSort(a: BookingRow, b: BookingRow): number {
  const av = a.rentalStartMs ?? Number.POSITIVE_INFINITY;
  const bv = b.rentalStartMs ?? Number.POSITIVE_INFINITY;
  return av - bv;
}

function toBookingRow(id: string, p: BookingProject, quantity: number): BookingRow {
  return {
    id,
    projectId: p.id,
    projectNumber: p.projectNumber,
    projectName: p.name,
    clientId: p.clientId ?? null,
    projectStatus: p.status ?? "ENQUIRY",
    rentalStartMs: p.rentalStartMs ?? null,
    rentalEndMs: p.rentalEndMs ?? null,
    quantity,
  };
}

/**
 * Model bookings: every non-cancelled line item for `modelId` whose project is in
 * the window, **deduplicated by project** (quantities summed). Ordered by project
 * rental start asc.
 */
export function buildModelBookings(
  modelId: string,
  lineItems: BookingLineItem[],
  projectsById: Map<string, BookingProject>,
  window: DateWindowMs,
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
      byProject.set(p.id, toBookingRow(li.id, p, li.quantity));
    }
  }
  return [...byProject.values()].sort(rentalStartSort);
}

/**
 * Kit bookings: every non-cancelled, non-kit-child line item for `kitId` whose
 * project is in the window (no per-project dedup — one row per kit line). Ordered by
 * project rental start asc.
 */
export function buildKitBookings(
  kitId: string,
  lineItems: BookingLineItem[],
  projectsById: Map<string, BookingProject>,
  window: DateWindowMs,
): BookingRow[] {
  const out: BookingRow[] = [];
  for (const li of lineItems) {
    if (li.kitId !== kitId) continue;
    if (li.isKitChild) continue;
    if (li.status === "CANCELLED") continue;
    const p = projectsById.get(li.projectId);
    if (!p || !projectMatchesWindow(p, window)) continue;
    out.push(toBookingRow(li.id, p, li.quantity));
  }
  return out.sort(rentalStartSort);
}

/**
 * Asset bookings: an asset is booked via a legacy `lineItem.assetId` row OR via a
 * `projectLineItemUnit.assetId` row (the fulfillment model). Collect the legacy-line
 * bookings first, then add one quantity-1 booking per unit whose line item wasn't
 * already counted. Both paths require the (line item's) project to be in the window
 * and non-cancelled. Ordered by project rental start asc within each group (legacy
 * lines then units, matching the old two-query concat + per-query ordering).
 */
export function buildAssetBookings(
  assetId: string,
  lineItems: BookingLineItem[],
  units: BookingUnit[],
  projectsById: Map<string, BookingProject>,
  window: DateWindowMs,
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
    legacy.push(toBookingRow(li.id, p, li.quantity));
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
    unitRows.push({ ...toBookingRow(li.id, p, 1), id: u.lineItemId });
  }
  unitRows.sort(rentalStartSort);

  return [...legacy, ...unitRows];
}

/** Count non-cancelled line items per project (mirrors the calendar `groupBy`). */
export function countLineItemsByProject(
  projectIds: Iterable<string>,
  lineItems: BookingLineItem[],
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
