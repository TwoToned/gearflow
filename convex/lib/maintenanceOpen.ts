/**
 * What "open" and "overdue" maintenance are — the ONE definition (UX Phase 11
 * review). Read by the maintenance writes (a holding status keeps an asset in
 * MAINTENANCE), Home's maintenance-due count (`dashboardStats.bundle`), the More
 * sheet's Maintenance row (`navCounts.get`), the predictive-maintenance dedupe and
 * the Maintenance page's own Open / Overdue tiles and row badge, so the number on
 * a row is the number on the page it opens. Pure: no Convex imports, so the
 * browser reads it too.
 */

/** Work under way on the gear: the asset is held in MAINTENANCE while one of these. */
export const HOLDING_MAINTENANCE_STATUSES = ["AWAITING_PARTS", "IN_PROGRESS", "QA"] as const;

/** Not finished and not cancelled: scheduled, or any holding status. */
export const OPEN_MAINTENANCE_STATUSES = ["SCHEDULED", ...HOLDING_MAINTENANCE_STATUSES] as const;

export type OpenMaintenanceStatus = (typeof OPEN_MAINTENANCE_STATUSES)[number];

/** An absent status reads as SCHEDULED (the Prisma default), as the writes treat it. */
export function isOpenMaintenance(status: string | null | undefined): boolean {
  return (OPEN_MAINTENANCE_STATUSES as readonly string[]).includes(status ?? "SCHEDULED");
}

/**
 * Overdue: work that should have STARTED by now and hasn't finished — scheduled
 * or in progress with its date passed (the Maintenance page's Overdue tile and its
 * row badge; Home's maintenance-due line). Work awaiting parts or in QA is held
 * for a reason, not late.
 */
export const OVERDUE_MAINTENANCE_STATUSES = ["SCHEDULED", "IN_PROGRESS"] as const satisfies readonly OpenMaintenanceStatus[];

/** Overdue (above), with a scheduled date strictly before `now`. Undated work, or work with no status, is never overdue. */
export function isOverdueMaintenance(r: { status?: string | null; scheduledDate?: number | null }, now: number): boolean {
  return (
    (OVERDUE_MAINTENANCE_STATUSES as readonly string[]).includes(r.status ?? "SCHEDULED") &&
    typeof r.scheduledDate === "number" &&
    r.scheduledDate < now
  );
}

/** The fields the Maintenance page's tiles count by. */
export interface MaintenanceTileRow {
  status?: string | null;
  scheduledDate?: number | null;
  completedDate?: number | null;
}

export interface MaintenanceTileCounts {
  open: number;
  overdue: number;
  inProgress: number;
  completedSince: number;
}

/**
 * The Maintenance page's four tiles, from the org's records (every record,
 * schedule-generated cycles included). The page renders exactly these numbers, and
 * the More sheet / Home tests compare against this function, so a change to what
 * the page counts changes what they are held to.
 */
export function maintenanceTileCounts(rows: readonly MaintenanceTileRow[], now: number, completedSinceMs: number): MaintenanceTileCounts {
  const counts: MaintenanceTileCounts = { open: 0, overdue: 0, inProgress: 0, completedSince: 0 };
  for (const r of rows) {
    if (isOpenMaintenance(r.status)) counts.open++;
    if (isOverdueMaintenance(r, now)) counts.overdue++;
    if (r.status === "IN_PROGRESS") counts.inProgress++;
    if (r.status === "COMPLETED" && typeof r.completedDate === "number" && r.completedDate >= completedSinceMs) counts.completedSince++;
  }
  return counts;
}
