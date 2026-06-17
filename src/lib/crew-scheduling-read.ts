import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for crew scheduling counts (Phase A read-rewiring).
 *
 * `crewAssignment` and `crewTimeEntry` are dual-written (Prisma FK anchor + Convex
 * reactive doc — see src/lib/crew-scheduling-mirror.ts). Pure counts over their
 * `status` scalar go through these helpers. Reads that join assignment/time-entry
 * back onto crew members, projects, or Better Auth users stay heavier composites
 * for later. See FEATUREDOCS/54.
 */
export type ConvexCrewAssignment = Doc<"crewAssignments">;
export type ConvexCrewTimeEntry = Doc<"crewTimeEntries">;

export async function getCrewAssignmentsByOrg(
  orgId: string,
): Promise<ConvexCrewAssignment[]> {
  return await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.crewAssignments.list, { orgId }),
  );
}

export async function getCrewTimeEntriesByOrg(
  orgId: string,
): Promise<ConvexCrewTimeEntry[]> {
  return await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.crewTimeEntries.list, { orgId }),
  );
}

/**
 * Count of crew assignments whose status is in `statuses`. Replicates Prisma
 * `count({ status: { in: statuses } })`. A row with no status never matches.
 */
export function countAssignmentsByStatus(
  assignments: ConvexCrewAssignment[],
  statuses: readonly string[],
): number {
  const set = new Set(statuses);
  return assignments.filter((a) => a.status != null && set.has(a.status)).length;
}

/**
 * Count of crew time entries whose status is in `statuses`. Replicates Prisma
 * `count({ status: { in: statuses } })`. A row with no status never matches.
 */
export function countTimeEntriesByStatus(
  entries: ConvexCrewTimeEntry[],
  statuses: readonly string[],
): number {
  const set = new Set(statuses);
  return entries.filter((e) => e.status != null && set.has(e.status)).length;
}
