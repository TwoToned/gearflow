import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the Maintenance domain (Phase A read-rewiring).
 *
 * `maintenanceRecord` is dual-written: every create/update/delete in the server
 * actions writes BOTH the Prisma row (the durable FK anchor — `project`, `kit`,
 * `maintenance_record_asset` carry FKs to it) AND the Convex `maintenanceRecords`
 * doc (see src/lib/maintenance-mirror.ts). Pure counts/aggregates over the record
 * scalars (status, scheduledDate, cost) go through this helper. The
 * `maintenanceRecordAssets` join table is NOT mirrored — any read that needs the
 * record→asset join (e.g. the dashboard "recent maintenance" list, the overdue
 * notification card) stays on Prisma for now. See FEATUREDOCS/54.
 *
 * Convex stores epoch-ms numbers; the pure predicates below operate on those
 * numbers directly so callers never need to round-trip through Date.
 */
export type ConvexMaintenanceRecord = Doc<"maintenanceRecords">;

export async function getMaintenanceRecordsByOrg(
  orgId: string,
): Promise<ConvexMaintenanceRecord[]> {
  return await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.maintenanceRecords.list, { orgId }),
  );
}

/** Statuses that count as "open" maintenance work. */
const OPEN_MAINTENANCE_STATUSES = new Set(["SCHEDULED", "IN_PROGRESS"]);

/**
 * Count of open maintenance whose scheduled date has arrived (<= cutoffMs).
 * Replicates Prisma `count({ status: { in: [SCHEDULED, IN_PROGRESS] },
 * scheduledDate: { lte: now } })`. A record with no scheduledDate is excluded
 * (Prisma `lte` never matches NULL).
 */
export function countDueMaintenance(
  records: ConvexMaintenanceRecord[],
  cutoffMs: number,
): number {
  return records.filter(
    (m) =>
      m.status != null &&
      OPEN_MAINTENANCE_STATUSES.has(m.status) &&
      m.scheduledDate != null &&
      m.scheduledDate <= cutoffMs,
  ).length;
}

export interface MaintenanceProjectAggregate {
  /** Sum of `cost` over non-CANCELLED records for the project (null cost = 0). */
  costTotal: number;
  /** Count of non-CANCELLED records for the project. */
  count: number;
}

/**
 * Per-project maintenance aggregate. Replicates Prisma
 * `aggregate({ where: { projectId, organizationId, status: { notIn: [CANCELLED] } },
 * _sum: { cost }, _count: true })`. Records carrying the org's rows are filtered to
 * the project here (Convex `list` is org-scoped).
 */
export function aggregateMaintenanceForProject(
  records: ConvexMaintenanceRecord[],
  projectId: string,
): MaintenanceProjectAggregate {
  let costTotal = 0;
  let count = 0;
  for (const m of records) {
    if (m.projectId !== projectId) continue;
    if (m.status === "CANCELLED") continue;
    count += 1;
    costTotal += m.cost ?? 0;
  }
  return { costTotal, count };
}
