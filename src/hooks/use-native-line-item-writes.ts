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

/**
 * Sibling to `OptimisticOrderEdit`, for GROUP drag-and-drop
 * (`use-equipment-dnd.ts`'s `resolveGroupDragAction`): overlays a pending
 * `sortOrder` (+ optionally a new category placement) onto the raw bundle's
 * project-group / sub-hire-group / category-slot arrays BEFORE
 * reconstruction — same "cleared on settle" lifecycle as `OptimisticOrderEdit`,
 * just for groups, which live in entirely different bundle collections
 * (`groups` / `subHireGroups` / `categorySlots`) than the `lineItems` array
 * `applyOrderOverlay` patches.
 *
 * Keyed by the group's own bare cuid — works for BOTH project groups and
 * sub-hire groups since the two id spaces never collide (separate Convex
 * tables' cuids).
 */
export interface GroupOrderEdit {
  sortOrder: number;
  /** Present (possibly null) only when the drag reparented the group into a
   *  different category — a same-category reorder omits this so the group's
   *  existing placement is left untouched. */
  categoryId?: string | null;
}

/** Overlay onto the raw `groups` (project-group) bundle array. */
export function applyGroupOrderOverlay<
  T extends { id: string; sortOrder?: number; categoryId?: string | null },
>(groups: readonly T[], overlay: ReadonlyMap<string, GroupOrderEdit>): T[] {
  if (overlay.size === 0) return groups as T[];
  return groups.map((g) => {
    const e = overlay.get(g.id);
    if (!e) return g;
    return {
      ...g,
      sortOrder: e.sortOrder,
      ...(e.categoryId !== undefined ? { categoryId: e.categoryId } : {}),
    };
  });
}

/** Overlay onto the raw `subHireGroups` bundle array — same shape, but the
 *  category-placement field is `targetCategoryId`, not `categoryId`. */
export function applySubHireGroupOrderOverlay<
  T extends { id: string; sortOrder?: number; targetCategoryId?: string | null },
>(groups: readonly T[], overlay: ReadonlyMap<string, GroupOrderEdit>): T[] {
  if (overlay.size === 0) return groups as T[];
  return groups.map((g) => {
    const e = overlay.get(g.id);
    if (!e) return g;
    return {
      ...g,
      sortOrder: e.sortOrder,
      ...(e.categoryId !== undefined ? { targetCategoryId: e.categoryId } : {}),
    };
  });
}

/**
 * Overlay onto the raw `categorySlots` bundle array. `reconstructProjectCategories`'s
 * `mixedGroups` ordering prioritises a category slot's `sortOrder` over the
 * group's own (`slotByGroupId.get(g.id)?.sortOrder ?? g.sortOrder`), so a
 * mixed (project + sub-hire) reorder needs this patched too, not just the
 * group's own `sortOrder` (which `applyGroupOrderOverlay`/
 * `applySubHireGroupOrderOverlay` already handle for the plain, no-slot-yet
 * case). Only touches a slot's `sortOrder`, never its `projectCategoryId` —
 * `mixedGroups`' per-category membership is decided by the group's own
 * `categoryId`/`targetCategoryId` (patched above), not by which category the
 * slot claims, so a momentarily-stale slot category is harmless here.
 */
export function applyCategorySlotOrderOverlay<
  T extends { projectGroupId?: string | null; subHireGroupId?: string | null; sortOrder: number },
>(slots: readonly T[], overlay: ReadonlyMap<string, GroupOrderEdit>): T[] {
  if (overlay.size === 0) return slots as T[];
  return slots.map((s) => {
    const key = s.projectGroupId ?? s.subHireGroupId ?? undefined;
    const e = key ? overlay.get(key) : undefined;
    if (!e) return s;
    return { ...s, sortOrder: e.sortOrder };
  });
}
