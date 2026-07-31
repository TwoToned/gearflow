"use client";

/**
 * Phase 5d — optimistic line-item EDIT for the equipment tab.
 *
 * The recalc-in-mutation fix already made edits sub-second; this makes the edited
 * ROW update with ZERO latency. Unlike the asset-notes optimistic hook (which calls a
 * Convex mutation directly with `withOptimisticUpdate`), line-item edits must keep
 * going through the `updateLineItem` server action: it owns the cross-project
 * availability re-check, the stale-guard, and — critically for money — the org default
 * tax rate, which lives in Postgres and has no Convex mirror. So a pure client→Convex
 * write couldn't recompute project totals correctly.
 *
 * Instead we overlay the pending field changes onto the `equipmentTab.bundle` line
 * items BEFORE reconstruction (see use-native-equipment-tab.ts) — the exact same idea
 * as the tab's existing optimistic DELETE (`pendingRemovalIds`), just a patch instead
 * of a hide. The real write still lands via the server action; the overlay is cleared
 * once it settles, at which point the reactive bundle already carries the server value.
 * Only affects the native equipment-tab read path.
 */

const roundCurrency = (v: number): number => Math.round(v * 100) / 100;

/** Client-side twin of the server's calculateLineTotal (line-items.ts) — same math. */
export function computeLineTotal(
  unitPrice: number | undefined,
  quantity: number,
  duration: number,
  discount: number | undefined,
): number | null {
  if (unitPrice == null) return null;
  const gross = roundCurrency(unitPrice * quantity * duration);
  return Math.max(0, roundCurrency(gross - (discount ?? 0)));
}

/** The line-item fields an optimistic edit overlays onto the bundle doc. */
export interface OptimisticLineEdit {
  quantity: number;
  unitPrice?: number;
  discount?: number;
  description: string;
  notes?: string;
  lineTotal: number | null;
}

/**
 * Overlay pending edits onto the raw bundle line items (by cuid `id`). Pure — returns
 * a new array only when something matched, so an empty overlay is a no-op reference.
 */
export function applyOptimisticEdits<
  T extends { id: string; quantity?: number; unitPrice?: number | null; discount?: number | null; description?: string | null; notes?: string | null; lineTotal?: number | null },
>(lineItems: readonly T[], edits: ReadonlyMap<string, OptimisticLineEdit>): T[] {
  if (edits.size === 0) return lineItems as T[];
  return lineItems.map((li) => {
    const e = edits.get(li.id);
    if (!e) return li;
    return {
      ...li,
      quantity: e.quantity,
      unitPrice: e.unitPrice ?? null,
      discount: e.discount ?? null,
      description: e.description,
      notes: e.notes ?? null,
      lineTotal: e.lineTotal,
    };
  });
}

/**
 * Sibling to `OptimisticLineEdit` for drag-and-drop (`use-equipment-dnd.ts`):
 * overlays a pending `sortOrder` (+ optionally a new `groupId`/`categoryId`,
 * for a cross-container move) onto the raw bundle line items BEFORE
 * reconstruction — same idea, same "cleared on settle" lifecycle, just a
 * position patch instead of a field patch.
 */
export interface OptimisticOrderEdit {
  sortOrder: number;
  /** Present (possibly null) only when the drag reparented the item — a
   *  same-container reorder omits these so the row's existing placement is
   *  left untouched. */
  groupId?: string | null;
  categoryId?: string | null;
}

/**
 * Overlay pending order/placement edits onto the raw bundle line items (by
 * cuid `id`). Pure — an empty overlay is a no-op reference, same as
 * `applyOptimisticEdits`.
 */
export function applyOrderOverlay<
  T extends { id: string; sortOrder?: number; groupId?: string | null; categoryId?: string | null },
>(lineItems: readonly T[], overlay: ReadonlyMap<string, OptimisticOrderEdit>): T[] {
  if (overlay.size === 0) return lineItems as T[];
  return lineItems.map((li) => {
    const o = overlay.get(li.id);
    if (!o) return li;
    return {
      ...li,
      sortOrder: o.sortOrder,
      ...(o.groupId !== undefined ? { groupId: o.groupId } : {}),
      ...(o.categoryId !== undefined ? { categoryId: o.categoryId } : {}),
    };
  });
}
