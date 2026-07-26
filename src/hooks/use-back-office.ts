"use client";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Reactive hooks for the back-office tail (Phase 4 of the Convex migration):
 * supplier orders, warehouse closes, saved reports, saved table views. All are
 * dual-written; these wrap Convex useQuery so the relevant pages subscribe and
 * re-fetch their server-action composites when another tab changes the data.
 * See FEATUREDOCS/54.
 */
export type WarehouseCloseDoc = Doc<"warehouseCloses">;
export type SavedTableViewDoc = Doc<"savedTableViews">;

/** Reactive per-project close-out record (cross-tab sync) — not the whole org's table. */
export function useWarehouseCloseForProject(
  orgId: string | undefined,
  projectId: string | undefined,
): WarehouseCloseDoc | null | undefined {
  return useAuthedQuery(api.warehouseCloses.getByProject, orgId && projectId ? { orgId, projectId } : "skip");
}
export function useSavedTableViews(orgId: string | undefined): SavedTableViewDoc[] | undefined {
  return useAuthedQuery(api.savedTableViews.list, orgId ? { orgId } : "skip");
}

export function fingerprintWarehouseClose(doc: WarehouseCloseDoc | null | undefined): string | undefined {
  if (doc === undefined) return undefined;
  if (doc === null) return "none";
  return `${doc.id}:${doc.closedAt ?? 0}:${doc.projectId ?? ""}:${doc.storedCount ?? ""}:${doc.damagedCount ?? ""}:${doc.lostCount ?? ""}`;
}
export function fingerprintSavedTableViews(rows: SavedTableViewDoc[] | undefined, tableId?: string): string | undefined {
  if (!rows) return undefined;
  return rows
    .filter((v) => (tableId ? v.tableId === tableId : true))
    .map((v) => `${v.id}:${v.updatedAt ?? 0}:${(v.name ?? "").length}:${v.isDefault ?? ""}:${v.tableId ?? ""}`)
    .sort()
    .join("|");
}
