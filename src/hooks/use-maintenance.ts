"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Reactive maintenance hooks (Phase 4 of the Convex migration).
 *
 * Thin wrappers over Convex's useQuery — the browser subscribes to the
 * dual-written `maintenanceRecords` table over a websocket, so any new repair,
 * workshop-kanban status move, field edit, or completion (via the maintenance
 * server actions) pushes a live update to every subscriber.
 *
 * The list / kanban / detail pages keep their server-action composite reads
 * (Prisma owns the assets/model/reportedBy/assignedTo joins); these
 * subscriptions are the cross-tab change signal that triggers a re-fetch.
 * The maintenanceRecordAssets join isn't mirrored, but the record's updatedAt
 * bumps whenever its asset links change, so it's a sufficient signal.
 * See FEATUREDOCS/54.
 */
export type MaintenanceRecordDoc = Doc<"maintenanceRecords">;

export function useMaintenanceRecords(orgId: string | undefined): MaintenanceRecordDoc[] | undefined {
  return useQuery(api.maintenanceRecords.list, orgId ? { orgId } : "skip");
}

export function useMaintenanceRecord(id: string | undefined): MaintenanceRecordDoc | null | undefined {
  return useQuery(api.maintenanceRecords.getById, id ? { id } : "skip");
}

/**
 * Stable fingerprint of the org's maintenance records — changes whenever any row
 * is created, deleted, or has a list/kanban/detail-relevant scalar field
 * mutated. Feed into a useEffect that calls the page's server-action refetch.
 */
export function fingerprintMaintenanceRecords(
  records: MaintenanceRecordDoc[] | undefined,
): string | undefined {
  if (!records) return undefined;
  return records
    .map((r) =>
      `${r.id}:${r.updatedAt ?? 0}:${r.status ?? ""}:${r.type ?? ""}:${r.result ?? ""}:${r.assignedToId ?? ""}:${r.scheduledDate ?? ""}:${r.completedDate ?? ""}:${r.cost ?? ""}:${(r.title ?? "").length}`,
    )
    .sort()
    .join("|");
}
