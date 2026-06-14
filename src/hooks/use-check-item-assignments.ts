"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Reactive hooks for the check-item ASSIGNMENT join tables (Phase 4/6 of the
 * Convex migration). The browser subscribes directly to `modelCheckItems` /
 * `kitCheckItems` over a WebSocket, so any add / remove / reorder (via the
 * dual-write server actions) pushes a live update. The check-item label/type the
 * UI renders comes from the separately-subscribed `checkItems` list, joined here
 * client-side (Convex stores the join as a flat `checkItemId`).
 *
 * Returns `undefined` while either subscription is loading. Rows are filtered to
 * the given model/kit and sorted by `sortOrder` to match the old
 * `orderBy: { sortOrder: "asc" }` server query. Lives in src/hooks (NOT convex/)
 * so the Convex function bundler never tries to bundle this React module. See
 * FEATUREDOCS/54.
 */
export type ModelCheckItemDoc = Doc<"modelCheckItems">;
export type KitCheckItemDoc = Doc<"kitCheckItems">;
type CheckItemDoc = Doc<"checkItems">;

export type ModelCheckItemWithCheck = ModelCheckItemDoc & { checkItem: CheckItemDoc | null };
export type KitCheckItemWithCheck = KitCheckItemDoc & { checkItem: CheckItemDoc | null };

export function useModelCheckItems(
  orgId: string | undefined,
  modelId: string | undefined,
): ModelCheckItemWithCheck[] | undefined {
  const assignments = useQuery(api.modelCheckItems.list, orgId ? { orgId } : "skip");
  const checkItems = useQuery(api.checkItems.list, orgId ? { orgId } : "skip");
  return useMemo(() => {
    if (assignments === undefined || checkItems === undefined || !modelId) return undefined;
    const byId = new Map(checkItems.map((c) => [c.id, c]));
    return assignments
      .filter((a) => a.modelId === modelId)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((a) => ({ ...a, checkItem: byId.get(a.checkItemId) ?? null }));
  }, [assignments, checkItems, modelId]);
}

/**
 * Reactive per-check-item model-usage counts: `checkItemId -> number of models`
 * it's assigned to, derived from the Convex `modelCheckItems` list. Replaces the
 * `modelCheckItems` half of the old `getCheckItemCounts()` server action on the
 * check-item library page (the `checkRecords` half wasn't rendered there).
 * Returns `undefined` while loading.
 */
export function useModelCheckItemUsageCounts(
  orgId: string | undefined,
): Map<string, number> | undefined {
  const assignments = useQuery(api.modelCheckItems.list, orgId ? { orgId } : "skip");
  return useMemo(() => {
    if (assignments === undefined) return undefined;
    const counts = new Map<string, number>();
    for (const a of assignments) counts.set(a.checkItemId, (counts.get(a.checkItemId) ?? 0) + 1);
    return counts;
  }, [assignments]);
}

export function useKitCheckItems(
  orgId: string | undefined,
  kitId: string | undefined,
): KitCheckItemWithCheck[] | undefined {
  const assignments = useQuery(api.kitCheckItems.list, orgId ? { orgId } : "skip");
  const checkItems = useQuery(api.checkItems.list, orgId ? { orgId } : "skip");
  return useMemo(() => {
    if (assignments === undefined || checkItems === undefined || !kitId) return undefined;
    const byId = new Map(checkItems.map((c) => [c.id, c]));
    return assignments
      .filter((a) => a.kitId === kitId)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((a) => ({ ...a, checkItem: byId.get(a.checkItemId) ?? null }));
  }, [assignments, checkItems, kitId]);
}
