"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Reactive hooks for the back-office tail (Phase 4 of the Convex migration):
 * supplier orders, warehouse closes, saved reports, saved table views. All are
 * dual-written; these wrap Convex useQuery so the relevant pages subscribe and
 * re-fetch their server-action composites when another tab changes the data.
 * See FEATUREDOCS/54.
 */
export type SupplierOrderDoc = Doc<"supplierOrders">;
export type WarehouseCloseDoc = Doc<"warehouseCloses">;
export type SavedReportDoc = Doc<"savedReports">;
export type SavedTableViewDoc = Doc<"savedTableViews">;

export function useSupplierOrders(orgId: string | undefined): SupplierOrderDoc[] | undefined {
  return useQuery(api.supplierOrders.list, orgId ? { orgId } : "skip");
}
export function useWarehouseCloses(orgId: string | undefined): WarehouseCloseDoc[] | undefined {
  return useQuery(api.warehouseCloses.list, orgId ? { orgId } : "skip");
}
export function useSavedReports(orgId: string | undefined): SavedReportDoc[] | undefined {
  return useQuery(api.savedReports.list, orgId ? { orgId } : "skip");
}
export function useSavedTableViews(orgId: string | undefined): SavedTableViewDoc[] | undefined {
  return useQuery(api.savedTableViews.list, orgId ? { orgId } : "skip");
}

export function fingerprintSupplierOrders(rows: SupplierOrderDoc[] | undefined): string | undefined {
  if (!rows) return undefined;
  return rows
    .map((o) => `${o.id}:${o.updatedAt ?? 0}:${o.status ?? ""}:${o.orderNumber ?? ""}:${o.supplierId ?? ""}:${o.total ?? ""}`)
    .sort()
    .join("|");
}
export function fingerprintWarehouseCloses(rows: WarehouseCloseDoc[] | undefined): string | undefined {
  if (!rows) return undefined;
  return rows
    .map((c) => `${c.id}:${c.closedAt ?? 0}:${c.projectId ?? ""}:${c.storedCount ?? ""}:${c.damagedCount ?? ""}:${c.lostCount ?? ""}`)
    .sort()
    .join("|");
}
export function fingerprintSavedReports(rows: SavedReportDoc[] | undefined): string | undefined {
  if (!rows) return undefined;
  return rows
    .map((r) => `${r.id}:${r.updatedAt ?? 0}:${(r.name ?? "").length}:${r.isPinned ?? ""}:${r.isShared ?? ""}`)
    .sort()
    .join("|");
}
export function fingerprintSavedTableViews(rows: SavedTableViewDoc[] | undefined, tableId?: string): string | undefined {
  if (!rows) return undefined;
  return rows
    .filter((v) => (tableId ? v.tableId === tableId : true))
    .map((v) => `${v.id}:${v.updatedAt ?? 0}:${(v.name ?? "").length}:${v.isDefault ?? ""}:${v.tableId ?? ""}`)
    .sort()
    .join("|");
}
