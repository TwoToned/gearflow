/**
 * What "open" maintenance is — the ONE definition (UX Phase 11 review). Read by
 * the maintenance writes (a holding status keeps an asset in MAINTENANCE), Home's
 * maintenance-due count (`dashboardStats.bundle`), the More sheet's Maintenance
 * row (`navCounts.get`) and the Maintenance page's own Open / Overdue tiles, so
 * the number on a row is the number on the page it opens. Pure: no Convex
 * imports, so the browser reads it too.
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
 * or in progress with its date passed (the Maintenance page's Overdue tile). Work
 * awaiting parts or in QA is held for a reason, not late.
 */
export const OVERDUE_MAINTENANCE_STATUSES = ["SCHEDULED", "IN_PROGRESS"] as const satisfies readonly OpenMaintenanceStatus[];

/** Overdue (above), with a scheduled date already passed. Undated work is never overdue. */
export function isOverdueMaintenance(r: { status?: string | null; scheduledDate?: number | null }, now: number): boolean {
  const status = r.status ?? "SCHEDULED";
  return (OVERDUE_MAINTENANCE_STATUSES as readonly string[]).includes(status) && typeof r.scheduledDate === "number" && r.scheduledDate < now;
}
