import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the warehouse-display dashboard (Phase A
 * read-rewiring of the Convex domain-only decommission). The dashboard is a
 * public, token-gated surface; this module reads the two dual-written domain
 * tables it needs — `projectService` and `projectLineItem` — from Convex and
 * shapes the rows back into the form `getWarehouseDisplayData` consumes.
 *
 * Mapper rules (Convex → Prisma-row shape): epoch-ms → Date, absent optionals →
 * null, required fields coerced. CRITICAL: the dashboard calls
 * `service.date.getFullYear()` on upcoming services, so `date` MUST be a real
 * `Date` here, not an epoch number.
 *
 * Pure filter/count helpers (no I/O) replicate the Prisma `where`/`groupBy`
 * semantics and are unit-tested independently. They take a numeric millisecond
 * window so the caller keeps owning the today/upcoming day math.
 *
 * NOTE: the `warehouseDashboardToken` table is NOT dual-written to Convex — token
 * CRUD + validation stay Prisma (a blocked terminus). Only the project-domain
 * reads inside `getWarehouseDisplayData` move here. See FEATUREDOCS/54.
 */

type RawService = Doc<"projectServices">;
type RawLineItem = Doc<"projectLineItems">;

const toDate = (v: number | undefined): Date | null => (typeof v === "number" ? new Date(v) : null);
const orNull = <T>(v: T | undefined): T | null => (v === undefined ? null : v);
const req = <T>(v: T | undefined): T => v as T;

/**
 * Shape of a project service as the dashboard needs it. `date` is a real Date
 * (or null) — the upcoming-service day bucketing calls `.getFullYear()` on it.
 */
export interface DisplayServiceRow {
  projectId: string;
  type: string;
  status: string | null;
  date: Date | null;
  scheduledTime: string | null;
  startTime: string | null;
  address: string | null;
  vehicleDescription: string | null;
}

/** Minimal line-item shape needed for the per-project count maps. */
export interface DisplayLineItemRow {
  projectId: string;
  isKitChild: boolean | null;
  status: string | null;
}

export function mapDisplayService(d: RawService): DisplayServiceRow {
  return {
    projectId: req(d.projectId),
    type: req(d.type),
    status: orNull(d.status),
    date: toDate(d.date),
    scheduledTime: orNull(d.scheduledTime),
    startTime: orNull(d.startTime),
    address: orNull(d.address),
    vehicleDescription: orNull(d.vehicleDescription),
  };
}

export function mapDisplayLineItem(d: RawLineItem): DisplayLineItemRow {
  return {
    projectId: req(d.projectId),
    isKitChild: orNull(d.isKitChild),
    status: orNull(d.status),
  };
}

/** All project services for an org (one round trip); filtered in JS by the caller. */
export async function getDisplayServices(orgId: string): Promise<DisplayServiceRow[]> {
  const rows = (await (await getConvexClient()).query(api.projectServices.list, { orgId })) as RawService[];
  return rows.map(mapDisplayService);
}

/**
 * Line items for a fixed set of project ids (one round trip via the narrow
 * `listByProjectIds` query — avoids scanning the whole org's line-item table on
 * a public endpoint). Returns empty when no ids are requested.
 */
export async function getDisplayLineItems(
  orgId: string,
  projectIds: string[]
): Promise<DisplayLineItemRow[]> {
  if (projectIds.length === 0) return [];
  const rows = (await (await getConvexClient()).query(api.projectLineItems.listByProjectIds, {
    orgId,
    projectIds,
  })) as RawLineItem[];
  return rows.map(mapDisplayLineItem);
}

// ─── Pure service filters (replicate the Prisma where-clauses) ────────────────
// Each replicates `organizationId` (already scoped by the query) + `type` +
// `status: { not: "CANCELLED" }` + `date: { gte, lt }`. The org filter is done
// by the Convex query, so these only enforce type/status/date.

function inWindow(date: Date | null, gteMs: number, ltMs: number): boolean {
  if (!date) return false;
  const ms = date.getTime();
  return ms >= gteMs && ms < ltMs;
}

/** type === "DELIVERY", status !== "CANCELLED", date in [gteMs, ltMs). */
export function filterDeliveryServices(
  services: DisplayServiceRow[],
  gteMs: number,
  ltMs: number
): DisplayServiceRow[] {
  return services.filter(
    (s) => s.type === "DELIVERY" && s.status !== "CANCELLED" && inWindow(s.date, gteMs, ltMs)
  );
}

/** type === "PICKUP", status !== "CANCELLED", date in [gteMs, ltMs). */
export function filterPickupServices(
  services: DisplayServiceRow[],
  gteMs: number,
  ltMs: number
): DisplayServiceRow[] {
  return services.filter(
    (s) => s.type === "PICKUP" && s.status !== "CANCELLED" && inWindow(s.date, gteMs, ltMs)
  );
}

// ─── Pure line-item count predicates (replicate the Prisma groupBy where) ─────
// GOTCHA: Convex `isKitChild` is optional → match Prisma `isKitChild: false`
// with `!== true` (NOT `=== false`, which would drop rows where the flag is
// absent). `status` is also optional; CANCELLED rows are excluded for totals.

/** Counts toward totalItems: top-level (not a kit child) and not cancelled. */
export function countsAsTotal(li: DisplayLineItemRow): boolean {
  return li.isKitChild !== true && li.status !== "CANCELLED";
}

/** Counts toward checkedOutItems: top-level (not a kit child) and CHECKED_OUT. */
export function countsAsCheckedOut(li: DisplayLineItemRow): boolean {
  return li.isKitChild !== true && li.status === "CHECKED_OUT";
}

/**
 * Build the two per-project count maps (total + checked-out) the dashboard
 * consumes, replicating the two Prisma `groupBy` aggregates in one pass.
 */
export function buildLineItemCountMaps(items: DisplayLineItemRow[]): {
  totalCountMap: Map<string, number>;
  checkedOutCountMap: Map<string, number>;
} {
  const totalCountMap = new Map<string, number>();
  const checkedOutCountMap = new Map<string, number>();
  for (const li of items) {
    if (countsAsTotal(li)) {
      totalCountMap.set(li.projectId, (totalCountMap.get(li.projectId) ?? 0) + 1);
    }
    if (countsAsCheckedOut(li)) {
      checkedOutCountMap.set(li.projectId, (checkedOutCountMap.get(li.projectId) ?? 0) + 1);
    }
  }
  return { totalCountMap, checkedOutCountMap };
}
