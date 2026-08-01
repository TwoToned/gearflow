"use client";

/**
 * Real drag-and-drop for LINE ITEMS, GROUPS (project groups + sub-hire
 * groups), and CATEGORIES.
 *
 * Encapsulates the @dnd-kit wiring equipment-tab.tsx needs: sensors, hover/
 * invalid-drop tracking, the optimistic sortOrder/groupId/categoryId overlay
 * for line items (mirrors use-native-line-item-writes.ts's
 * `applyOptimisticEdits` pattern — see `applyOrderOverlay`), the analogous
 * overlay for groups (`applyGroupOrderOverlay` + friends, same file), the
 * analogous (simpler — no reparent field) overlay for categories
 * (`applyCategoryOrderOverlay`), and the justified-mutation wrappers (reorder
 * within a container / move across containers, one pair per row kind — a
 * single reorder wrapper for categories, which never move across containers)
 * with their shared <JustificationDialog> instances.
 *
 * Container membership resolution and the actual "what should this drop do"
 * decision are pure, framework-free functions exported for unit testing
 * without mounting anything — line items get `buildContainerMap` /
 * `resolveLineItemDragAction`, groups get the parallel `buildGroupContainerMap`
 * / `resolveGroupDragAction`. Categories get only `resolveCategoryDragAction`
 * — no container-map builder, because there is exactly ONE category
 * container for the whole project (top-level reorder only; categories don't
 * nest into anything and nothing nests INTO a category via a "category
 * drag" — a line item/group landing under a category is decided by ITS OWN
 * drag). Kept as separate functions rather than one generalized set: line
 * items nest inside groups (an extra `items:{groupId}` container groups never
 * participate in), groups can never nest inside groups, and categories never
 * move across containers at all — so the three "what containers exist, what
 * can move where" shapes genuinely differ — forcing them into one generic
 * risked exactly the contorted abstraction the task brief warned against.
 * `handleDragEnd` dispatches on the active id's prefix (`li-` vs `grp-`/`shg-`
 * vs `cat-`) to the right one.
 *
 * Circular-dependency note: `useNativeEquipmentTab`'s `categories` /
 * `uncategorizedItems` / `uncategorizedProjectGroups` /
 * `uncategorizedSubHireGroups` are computed FROM this hook's `orderOverlay` /
 * `groupOrderOverlay` / `categoryOrderOverlay` (the overlays must apply
 * before reconstruction), while
 * this hook's drag handlers need those same reconstructed trees to resolve a
 * drop (container membership, current order). Passing plain values would be
 * circular within one render. The caller instead hands us stable `RefObject`s
 * it writes AFTER computing `native` each render ("latest ref" pattern) —
 * the overlays themselves are independent local state (unaffected by the ref
 * contents), so there's no ordering hazard: call this hook first to get the
 * overlays, feed those into `useNativeEquipmentTab`, then stash the result
 * back into the refs this hook already holds.
 */

import * as React from "react";
import { useCallback, useState } from "react";
import {
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
  type DragCancelEvent,
  type ClientRect,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates, arrayMove } from "@dnd-kit/sortable";
import { restrictToVerticalAxis, restrictToWindowEdges } from "@dnd-kit/modifiers";
import { ConvexError } from "convex/values";
import { toast } from "sonner";
import {
  getDisallowedDropReason,
  isHiddenFromList,
  type CategoryData,
  type GroupData,
  type LineItemData,
  type SubHireGroupData,
  type MixedGroupSlot,
} from "@/components/projects/equipment-rows";
import { JustificationDialog } from "@/components/projects/justification-dialog";
import { useJustifiedMutation, type LockStatusLike } from "@/hooks/use-justified-mutation";
import { isUserFacingError } from "@/lib/errors/user-facing-error";
import type { useLineItemWrites } from "@/hooks/use-line-item-writes";
import type { useProjectGroupWrites } from "@/hooks/use-project-groups-writes";
import type { useCategorySlotWrites } from "@/hooks/use-category-slots-writes";
import type { useProjectCategoryWrites } from "@/hooks/use-project-categories-writes";
import type { OptimisticOrderEdit, GroupOrderEdit, CategoryOrderEdit } from "@/hooks/use-native-line-item-writes";

// ─── Container id scheme (line items) ───────────────────────────────────────
//
// A category's own top-level line items, an expanded project group's line-item
// children, or the flat uncategorized-standalone list. Sortable item ids reuse
// the existing `li-{lineItemId}` prefix (equipment-tab.tsx's `allSortableIds`).
export type ContainerId = `standalone:${string}` | `items:${string}` | "uncategorized-standalone";

export interface ContainerContext {
  /** bare lineItemId (no `li-` prefix) -> the container currently holding it. */
  containerOf: ReadonlyMap<string, ContainerId>;
  /** containerId -> ordered bare lineItemIds currently visible in that container. */
  itemsByContainer: ReadonlyMap<ContainerId, readonly string[]>;
  /** containerId -> the categoryId/groupId placement it represents. */
  containerMeta: ReadonlyMap<ContainerId, { categoryId: string | null; groupId: string | null }>;
}

/**
 * Build the container index from the reconstructed equipment tree. Pure —
 * only reads plain data, no React/dnd-kit. Filters with the SAME
 * `isHiddenFromList` predicate equipment-tab.tsx's render uses, so the
 * resolved order matches what's on screen (kit children / merge tombstones /
 * sub-hire group parents never participate in line-item DnD).
 */
export function buildContainerMap(
  categories: readonly CategoryData[],
  uncategorizedItems: readonly LineItemData[],
  uncategorizedProjectGroups: readonly GroupData[],
): ContainerContext {
  const containerOf = new Map<string, ContainerId>();
  const itemsByContainer = new Map<ContainerId, readonly string[]>();
  const containerMeta = new Map<ContainerId, { categoryId: string | null; groupId: string | null }>();

  const addContainer = (
    containerId: ContainerId,
    meta: { categoryId: string | null; groupId: string | null },
    items: readonly LineItemData[],
  ) => {
    const visible = items.filter((i) => !isHiddenFromList(i));
    itemsByContainer.set(containerId, visible.map((i) => i.id));
    containerMeta.set(containerId, meta);
    for (const it of visible) containerOf.set(it.id, containerId);
  };

  for (const cat of categories) {
    addContainer(`standalone:${cat.id}`, { categoryId: cat.id, groupId: null }, cat.lineItems ?? []);
    for (const g of cat.groups ?? []) {
      addContainer(`items:${g.id}`, { categoryId: cat.id, groupId: g.id }, g.lineItems ?? []);
    }
  }
  addContainer("uncategorized-standalone", { categoryId: null, groupId: null }, uncategorizedItems);
  for (const g of uncategorizedProjectGroups) {
    addContainer(`items:${g.id}`, { categoryId: null, groupId: g.id }, g.lineItems ?? []);
  }

  return { containerOf, itemsByContainer, containerMeta };
}

// ─── The pure "what should this drop do" decision (line items) ──────────────

export type LineItemDragAction =
  | { kind: "noop" }
  | { kind: "blocked"; reason: string }
  | { kind: "reorder"; containerId: ContainerId; orderedIds: string[] }
  | {
      kind: "move";
      lineItemId: string;
      fromContainerId: ContainerId;
      toContainerId: ContainerId;
      targetCategoryId: string | null;
      targetGroupId: string | null;
      /** Full ordered bare-id list for the destination container AFTER the
       *  move, INCLUDING the moved item — set only when the drop targeted a
       *  specific sibling (not just "append to the end"). When undefined the
       *  move mutation's own append behaviour is correct and no follow-up
       *  reorder call is needed. */
      resultingOrder?: string[];
    };

/**
 * Splice `activeId` into `orderedIds` immediately before `overId` (or at the
 * end when `overId` is undefined — an append-only drop), first removing any
 * existing occurrence of `activeId` so a same-list move doesn't duplicate it.
 * Pure, shared by both the line-item and group move resolvers below — same
 * "insert relative to a sibling" shape either way, just typed as plain
 * strings so there's nothing row-kind-specific to it.
 */
function insertBeforeSibling(orderedIds: readonly string[], activeId: string, overId: string | undefined): string[] {
  const withoutActive = orderedIds.filter((id) => id !== activeId);
  if (!overId) return [...withoutActive, activeId];
  const insertAt = withoutActive.indexOf(overId);
  const idx = insertAt === -1 ? withoutActive.length : insertAt;
  return [...withoutActive.slice(0, idx), activeId, ...withoutActive.slice(idx)];
}

/**
 * Resolve which container a line-item drop is targeting, and (when it landed
 * on a specific sibling rather than an empty container's landing zone) that
 * sibling's bare id. Extracted from `resolveLineItemDragAction` to keep that
 * function's own branching under the complexity ratchet (POLICY.md R-3.6) —
 * a pure, separately-testable-in-principle piece of "where did this land",
 * distinct from "what should happen there".
 */
function resolveLineItemDropTarget(
  overSortableId: string,
  ctx: ContainerContext,
): { toContainerId: ContainerId; overBareId?: string } | null {
  if (overSortableId.startsWith("li-")) {
    const overBareId = overSortableId.slice(3);
    const toContainerId = ctx.containerOf.get(overBareId);
    return toContainerId ? { toContainerId, overBareId } : null;
  }
  // Dropping directly on a category row targets that category's own
  // standalone container, append-only — mirrors `resolveGroupDropTarget`'s
  // `cat-` branch. Without this branch the drop resolved to nothing (`target`
  // stayed null below), silently no-opping a line item dragged onto a
  // category header back to its original position instead of moving it out
  // to that category's top level.
  if (overSortableId.startsWith("cat-")) {
    const candidate: ContainerId = `standalone:${overSortableId.slice(4)}`;
    return ctx.itemsByContainer.has(candidate) ? { toContainerId: candidate } : null;
  }
  // The Uncategorized zone's header/landing-zone row (equipment-tab.tsx's
  // `UncategorizedHeader`, always rendered whenever the project has
  // categories, even with nothing uncategorized yet — see its doc comment).
  // Same id is read by `resolveGroupDropTarget` for the group side of the
  // same gesture.
  if (overSortableId === "uncat-zone") {
    return { toContainerId: "uncategorized-standalone" };
  }
  // Dropping directly ON a group/sub-hire-group row (rather than on one of
  // its child line items) targets THAT group's own `items:{groupId}`
  // container, append-only — there's no specific sibling to land before.
  // Drop Matrix 8C says li- onto grp- is a valid "enter group" move; without
  // this branch the drop resolved to nothing (`target` stayed null below),
  // which silently no-opped the drop back to its original position instead
  // of moving the item into the group. `getDisallowedDropReason` (checked
  // earlier in `resolveLineItemDragAction`) already rejects li- onto shg-
  // before this runs, and `buildContainerMap` never registers an
  // `items:{shgId}` container in the first place (sub-hire groups can't hold
  // plain line items) — so the `has()` check below is a defensive no-op for
  // shg-, not the thing actually blocking it.
  if (overSortableId.startsWith("grp-") || overSortableId.startsWith("shg-")) {
    const candidate: ContainerId = `items:${overSortableId.slice(4)}`;
    return ctx.itemsByContainer.has(candidate) ? { toContainerId: candidate } : null;
  }
  // Hovering an (empty) container's own landing zone directly.
  if (ctx.itemsByContainer.has(overSortableId as ContainerId)) {
    return { toContainerId: overSortableId as ContainerId };
  }
  return null;
}

/**
 * Decide what a line-item drag-end should do. Framework-free (plain strings +
 * the `ContainerContext` produced by `buildContainerMap`) so it's unit
 * testable without mounting dnd-kit or React. `handleDragEnd` below is a thin
 * wrapper that calls this then dispatches to the right mutation(s).
 */
/**
 * The same-container branch of `resolveLineItemDragAction` — reorder the
 * mover within its current container, or `null` when the drop didn't
 * actually change position. Extracted for the same complexity-ratchet
 * reason `planGroupSameContainerReorder` was.
 */
function planLineItemSameContainerReorder(
  containerId: ContainerId,
  activeId: string,
  overBareId: string | undefined,
  destItems: readonly string[],
): LineItemDragAction | null {
  const fromIndex = destItems.indexOf(activeId);
  const toIndex = overBareId ? destItems.indexOf(overBareId) : destItems.length - 1;
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return null;
  return {
    kind: "reorder",
    containerId,
    orderedIds: arrayMove([...destItems], fromIndex, toIndex),
  };
}

export function resolveLineItemDragAction(input: {
  activeSortableId: string;
  overSortableId: string | null;
  ctx: ContainerContext;
}): LineItemDragAction {
  const { activeSortableId, overSortableId, ctx } = input;

  if (!activeSortableId.startsWith("li-")) return { kind: "noop" };
  if (!overSortableId || activeSortableId === overSortableId) return { kind: "noop" };

  const disallowed = getDisallowedDropReason(activeSortableId, overSortableId);
  if (disallowed) return { kind: "blocked", reason: disallowed };

  const activeId = activeSortableId.slice(3);
  const fromContainerId = ctx.containerOf.get(activeId);
  if (!fromContainerId) return { kind: "noop" };

  const target = resolveLineItemDropTarget(overSortableId, ctx);
  if (!target) return { kind: "noop" };
  const { toContainerId, overBareId } = target;

  const destItems = ctx.itemsByContainer.get(toContainerId) ?? [];

  if (fromContainerId === toContainerId) {
    const action = planLineItemSameContainerReorder(fromContainerId, activeId, overBareId, destItems);
    return action ?? { kind: "noop" };
  }

  return planLineItemMove(activeId, fromContainerId, toContainerId, overBareId, destItems, ctx);
}

/**
 * The cross-container branch of `resolveLineItemDragAction` — build the
 * `move` action for a line item leaving its container. Extracted for the
 * same complexity-ratchet reason `planLineItemSameContainerReorder` was.
 */
function planLineItemMove(
  activeId: string,
  fromContainerId: ContainerId,
  toContainerId: ContainerId,
  overBareId: string | undefined,
  destItems: readonly string[],
  ctx: ContainerContext,
): LineItemDragAction {
  const meta = ctx.containerMeta.get(toContainerId)!;
  return {
    kind: "move",
    lineItemId: activeId,
    fromContainerId,
    toContainerId,
    targetCategoryId: meta.categoryId,
    targetGroupId: meta.groupId,
    resultingOrder: overBareId ? insertBeforeSibling(destItems, activeId, overBareId) : undefined,
  };
}

// ─── Container id scheme (groups) ───────────────────────────────────────────
//
// A category's interleaved ProjectGroup + SubHireGroup list is ONE container
// (`mixed:{categoryId}`) — the Drop Matrix (equipment-rows.tsx's
// `getDisallowedDropReason`) forbids nesting a group inside another group, so
// unlike line items there is no per-group child container here. "Uncategorized"
// is a second, single flat container covering every orphan project + sub-hire
// group. Sortable ids reuse the `grp-{projectGroupId}` / `shg-{subHireGroupId}`
// prefixes equipment-tab.tsx's `allSortableIds` and `getDisallowedDropReason`
// already use.
export type GroupContainerId = `mixed:${string}` | "uncategorized-groups";

export interface GroupContainerContext {
  /** PREFIXED sortable id (`grp-{id}` / `shg-{id}`) -> the container currently
   *  holding it. Prefixed (not bare) because, unlike line items, TWO different
   *  row kinds share this one map — keying by the full sortable id keeps a
   *  project-group id and a sub-hire-group id unambiguous without relying on
   *  cross-table cuid uniqueness. */
  containerOf: ReadonlyMap<string, GroupContainerId>;
  /** containerId -> ordered PREFIXED sortable ids currently visible in that container. */
  itemsByContainer: ReadonlyMap<GroupContainerId, readonly string[]>;
  /** containerId -> the categoryId it represents (null = Uncategorized). */
  containerMeta: ReadonlyMap<GroupContainerId, { categoryId: string | null }>;
}

/** `grp-{id}` / `shg-{id}` -> bare cuid. Both prefixes are 4 characters. */
function bareGroupId(sortableId: string): string {
  return sortableId.slice(4);
}

// ─── Reorder-mutation selection (pure, unit-testable) ───────────────────────

export type GroupReorderPlan =
  | { kind: "pure"; orderedIds: string[] }
  | { kind: "mixed"; categoryId: string; orderedIds: string[] };

/**
 * Translate an ordered PREFIXED sortable-id list (`grp-`/`shg-`) into
 * whichever reorder mutation it needs — pure, mirrors the old
 * `moveGroupSlot`'s (equipment-tab.tsx, now removed) exact branching: no
 * sub-hire group anywhere in the list -> the lighter plain-project-group
 * reorder (bare project-group ids); any sub-hire group in the list -> the
 * cross-type slot reorder, which expects `pg-`/`shg-` prefixed ids (NOT this
 * hook's own `grp-`/`shg-` scheme) — translated here.
 */
export function planGroupReorder(categoryId: string, orderedSortableIds: string[]): GroupReorderPlan {
  const hasAnySubHire = orderedSortableIds.some((sid) => sid.startsWith("shg-"));
  if (!hasAnySubHire) {
    return { kind: "pure", orderedIds: orderedSortableIds.map(bareGroupId) };
  }
  return {
    kind: "mixed",
    categoryId,
    orderedIds: orderedSortableIds.map((sid) => (sid.startsWith("grp-") ? `pg-${bareGroupId(sid)}` : sid)),
  };
}

/**
 * Build the GROUP container index from the reconstructed equipment tree — the
 * sibling of `buildContainerMap`, for `grp-`/`shg-` sortable ids instead of
 * `li-`. Falls back to `cat.groups.map(...)` when `cat.mixedGroups` isn't
 * present (HMR-stale cache) — the exact fallback the old `moveGroupSlot`
 * (equipment-tab.tsx, now removed) used, which deliberately omits
 * `subHireGroupTargets` from the fallback the same way that function did.
 *
 * The Uncategorized zone is a valid DROP TARGET (a group can land there) but
 * is not itself reorderable — orphan project/sub-hire groups never had ▲/▼
 * buttons either, so `resolveGroupDragAction` always treats a same-container
 * drop within "uncategorized-groups" as a no-op.
 */
export function buildGroupContainerMap(
  categories: readonly CategoryData[],
  uncategorizedProjectGroups: readonly GroupData[],
  uncategorizedSubHireGroups: readonly SubHireGroupData[],
): GroupContainerContext {
  const containerOf = new Map<string, GroupContainerId>();
  const itemsByContainer = new Map<GroupContainerId, readonly string[]>();
  const containerMeta = new Map<GroupContainerId, { categoryId: string | null }>();

  for (const cat of categories) {
    const containerId: GroupContainerId = `mixed:${cat.id}`;
    // Line-item slots are filtered out here — this container map is grp-/shg-
    // only (the sibling of `buildContainerMap`'s li-only one). A line item
    // reordering against a group in the same category is resolved separately
    // by `resolveCrossKindCategoryReorder`, ahead of both resolvers — see
    // that section's doc comment.
    const mixed = (
      cat.mixedGroups ??
      cat.groups.map((g) => ({ kind: "project" as const, sortOrder: g.sortOrder, projectGroupId: g.id }))
    ).filter(
      (slot): slot is Extract<MixedGroupSlot, { kind: "project" | "subHire" }> => slot.kind !== "lineItem",
    );
    const ids = mixed.map((slot) =>
      slot.kind === "project" ? `grp-${slot.projectGroupId}` : `shg-${slot.subHireGroupId}`,
    );
    itemsByContainer.set(containerId, ids);
    containerMeta.set(containerId, { categoryId: cat.id });
    for (const id of ids) containerOf.set(id, containerId);
  }

  const uncategorizedIds = [
    ...uncategorizedProjectGroups.map((g) => `grp-${g.id}`),
    ...uncategorizedSubHireGroups.map((g) => `shg-${g.id}`),
  ];
  itemsByContainer.set("uncategorized-groups", uncategorizedIds);
  containerMeta.set("uncategorized-groups", { categoryId: null });
  for (const id of uncategorizedIds) containerOf.set(id, "uncategorized-groups");

  return { containerOf, itemsByContainer, containerMeta };
}

/**
 * Bare line-item id -> the categoryId it top-level belongs to (its own
 * category if standalone, or its parent group's category if it's a group
 * child) — used ONLY by `resolveGroupDropTarget`'s `li-` fallback branch
 * below, to resolve a group dropped onto (or near) a line item in a
 * DIFFERENT category. Deliberately NOT part of `GroupContainerContext`
 * itself (see that type's doc comment on why line items and groups stay
 * separate container systems) — this is a minimal, single-purpose lookup,
 * not a merge of the two.
 */
export function buildLineItemCategoryIndex(categories: readonly CategoryData[]): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const cat of categories) {
    for (const item of cat.lineItems ?? []) index.set(item.id, cat.id);
    for (const g of cat.groups ?? []) {
      for (const item of g.lineItems ?? []) index.set(item.id, cat.id);
    }
  }
  return index;
}

// ─── The pure "what should this drop do" decision (groups) ──────────────────

export type GroupDragAction =
  | { kind: "noop" }
  | { kind: "blocked"; reason: string }
  | { kind: "reorder"; categoryId: string; orderedSortableIds: string[] }
  | {
      kind: "move";
      groupKind: "project" | "subHire";
      groupId: string;
      fromContainerId: GroupContainerId;
      toContainerId: GroupContainerId;
      targetCategoryId: string | null;
      /** Full ordered PREFIXED sortable-id list for the destination
       *  category's mixed list AFTER the move, INCLUDING the mover — set
       *  only when the drop targeted a specific sibling group inside a real
       *  category. Never set for a move into "uncategorized-groups" (that
       *  zone has no defined order — see `buildGroupContainerMap`'s doc
       *  comment) or an append-only drop; the move mutation's own append
       *  behaviour is correct then and no follow-up reorder call is needed. */
      resultingOrder?: string[];
    };

/**
 * Resolve which container a GROUP drop is targeting, and (when it landed on
 * a specific sibling group rather than a container's own landing zone) that
 * sibling's sortable id. Extracted from `resolveGroupDragAction` for the same
 * complexity-ratchet reason `resolveLineItemDropTarget` was — three distinct
 * ways a drop can resolve a target here (onto another group, onto a category
 * row, onto an empty container) vs. line items' two.
 */
/**
 * The `li-` branch of `resolveGroupDropTarget` — a group dropped on a LINE
 * ITEM in a DIFFERENT category (the SAME-category case — reordering a group
 * past a line item already sharing its top-level list — is intercepted
 * earlier by `resolveCrossKindCategoryReorder`, so this only ever fires
 * cross-category). Extracted for the same complexity-ratchet reason every
 * other `plan*`/`resolve*` split in this file was.
 *
 * There's no specific-sibling positioning here (that would need the full
 * interleaved order this container map deliberately doesn't track — see
 * `buildLineItemCategoryIndex`'s doc comment) — append-only, same as
 * dropping on that category's header, just a more discoverable gesture
 * ("drop near any row in category B" instead of having to find its header
 * specifically).
 */
function resolveGroupDropOnLineItem(
  overBareLineItemId: string,
  ctx: GroupContainerContext,
  lineItemCategoryIndex: ReadonlyMap<string, string> | undefined,
): { toContainerId: GroupContainerId } | null {
  const categoryId = lineItemCategoryIndex?.get(overBareLineItemId);
  if (!categoryId) return null;
  const candidate: GroupContainerId = `mixed:${categoryId}`;
  return ctx.itemsByContainer.has(candidate) ? { toContainerId: candidate } : null;
}

function resolveGroupDropTarget(
  overSortableId: string,
  ctx: GroupContainerContext,
  lineItemCategoryIndex?: ReadonlyMap<string, string>,
): { toContainerId: GroupContainerId; overSlotId?: string } | null {
  if (overSortableId.startsWith("grp-") || overSortableId.startsWith("shg-")) {
    const toContainerId = ctx.containerOf.get(overSortableId);
    return toContainerId ? { toContainerId, overSlotId: overSortableId } : null;
  }
  if (overSortableId.startsWith("cat-")) {
    // Dropping directly on a category row targets that category's mixed
    // container — the Drop Matrix explicitly allows this target (a group
    // reparenting to a new category, landing at the end of its mixed list).
    const candidate: GroupContainerId = `mixed:${overSortableId.slice(4)}`;
    return ctx.itemsByContainer.has(candidate) ? { toContainerId: candidate } : null;
  }
  if (overSortableId.startsWith("li-")) {
    return resolveGroupDropOnLineItem(overSortableId.slice(3), ctx, lineItemCategoryIndex);
  }
  // The Uncategorized zone's header/landing-zone row — see
  // `resolveLineItemDropTarget`'s matching branch.
  if (overSortableId === "uncat-zone") {
    return { toContainerId: "uncategorized-groups" };
  }
  // Hovering a container's own landing zone directly (e.g. an empty
  // Uncategorized zone) — same defensive branch `resolveLineItemDropTarget` has.
  if (ctx.itemsByContainer.has(overSortableId as GroupContainerId)) {
    return { toContainerId: overSortableId as GroupContainerId };
  }
  return null;
}

/**
 * The same-container branch of `resolveGroupDragAction` — reorder the mover
 * within its current mixed list, or `null` when there's nothing to do
 * (Uncategorized never reorders internally; see `buildGroupContainerMap`'s
 * doc comment) or the drop didn't actually change position.
 */
function planGroupSameContainerReorder(
  toContainerId: GroupContainerId,
  activeSortableId: string,
  overSlotId: string | undefined,
  destItems: readonly string[],
  ctx: GroupContainerContext,
): GroupDragAction | null {
  if (toContainerId === "uncategorized-groups") return null;
  const fromIndex = destItems.indexOf(activeSortableId);
  const toIndex = overSlotId ? destItems.indexOf(overSlotId) : destItems.length - 1;
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return null;
  return {
    kind: "reorder",
    categoryId: ctx.containerMeta.get(toContainerId)!.categoryId!,
    orderedSortableIds: arrayMove([...destItems], fromIndex, toIndex),
  };
}

function isGroupSortableId(id: string): boolean {
  return id.startsWith("grp-") || id.startsWith("shg-");
}

/**
 * The cross-container branch of `resolveGroupDragAction` — build the `move`
 * action for a group leaving its container. Extracted for the same
 * complexity-ratchet reason `planGroupSameContainerReorder` was.
 */
function planGroupMove(
  activeSortableId: string,
  fromContainerId: GroupContainerId,
  toContainerId: GroupContainerId,
  overSlotId: string | undefined,
  destItems: readonly string[],
  ctx: GroupContainerContext,
): GroupDragAction {
  const meta = ctx.containerMeta.get(toContainerId)!;
  return {
    kind: "move",
    groupKind: activeSortableId.startsWith("grp-") ? "project" : "subHire",
    groupId: bareGroupId(activeSortableId),
    fromContainerId,
    toContainerId,
    targetCategoryId: meta.categoryId,
    resultingOrder:
      overSlotId && toContainerId !== "uncategorized-groups"
        ? insertBeforeSibling(destItems, activeSortableId, overSlotId)
        : undefined,
  };
}

/**
 * Decide what a GROUP (project group or sub-hire group) drag-end should do —
 * the sibling of `resolveLineItemDragAction`. Framework-free, unit testable
 * without mounting dnd-kit or React.
 */
export function resolveGroupDragAction(input: {
  activeSortableId: string;
  overSortableId: string | null;
  ctx: GroupContainerContext;
  /** See `buildLineItemCategoryIndex` — only needed to resolve a group
   *  dropped on a line item in a different category. Omit in tests that
   *  don't exercise that branch. */
  lineItemCategoryIndex?: ReadonlyMap<string, string>;
}): GroupDragAction {
  const { activeSortableId, overSortableId, ctx, lineItemCategoryIndex } = input;

  if (!isGroupSortableId(activeSortableId)) return { kind: "noop" };
  if (!overSortableId || activeSortableId === overSortableId) return { kind: "noop" };

  const disallowed = getDisallowedDropReason(activeSortableId, overSortableId);
  if (disallowed) return { kind: "blocked", reason: disallowed };

  const fromContainerId = ctx.containerOf.get(activeSortableId);
  if (!fromContainerId) return { kind: "noop" };

  const target = resolveGroupDropTarget(overSortableId, ctx, lineItemCategoryIndex);
  if (!target) return { kind: "noop" };
  const { toContainerId, overSlotId } = target;

  const destItems = ctx.itemsByContainer.get(toContainerId) ?? [];

  if (fromContainerId === toContainerId) {
    const action = planGroupSameContainerReorder(toContainerId, activeSortableId, overSlotId, destItems, ctx);
    return action ?? { kind: "noop" };
  }

  return planGroupMove(activeSortableId, fromContainerId, toContainerId, overSlotId, destItems, ctx);
}

// ─── Container id scheme (categories) ───────────────────────────────────────
//
// Categories don't nest into anything, and nothing nests INTO a category via
// a "category drag" — a line item/group landing under a category is decided
// by ITS OWN drag (resolveLineItemDragAction / resolveGroupDragAction; see
// the `cat-` branch inside resolveGroupDragAction above — that branch is
// unrelated to this section, it's for a GROUP landing on a category, not a
// category reordering itself). So unlike line items and groups, there is
// exactly ONE container for the whole project: every category, top-level, in
// one list. No buildContainerMap-style indexing is needed — the ordered list
// of `cat-{id}` sortable ids the caller already has (equipment-tab.tsx's
// `allSortableIds`, filtered to the `cat-` prefix) IS the whole picture.
export type CategoryContainerId = "categories";

export type CategoryDragAction =
  | { kind: "noop" }
  | { kind: "reorder"; orderedIds: string[] };

/**
 * Decide what a CATEGORY drag-end should do — the simplest of the three
 * sibling resolvers: top-level reorder only, no cross-container move, and no
 * Drop Matrix rule to consult (`getDisallowedDropReason` has no
 * category-vs-category case — there is nothing to block a category from
 * landing on another category). Framework-free, unit testable without
 * mounting dnd-kit or React.
 */
export function resolveCategoryDragAction(input: {
  activeSortableId: string;
  overSortableId: string | null;
  /** Every category's sortable id (`cat-{id}`), in current display order. */
  allCategorySortableIds: readonly string[];
}): CategoryDragAction {
  const { activeSortableId, overSortableId, allCategorySortableIds } = input;

  if (!activeSortableId.startsWith("cat-")) return { kind: "noop" };
  if (!overSortableId || activeSortableId === overSortableId) return { kind: "noop" };
  if (!overSortableId.startsWith("cat-")) return { kind: "noop" };

  const fromIndex = allCategorySortableIds.indexOf(activeSortableId);
  const toIndex = allCategorySortableIds.indexOf(overSortableId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return { kind: "noop" };

  const reordered = arrayMove([...allCategorySortableIds], fromIndex, toIndex);
  return { kind: "reorder", orderedIds: reordered.map((sid) => sid.slice(4)) };
}

// ─── Cross-kind same-category reorder (groups ↔ standalone line items) ─────
//
// Groups and standalone (non-grouped) top-level line items used to be two
// structurally separate lists per category — a group and a line item could
// never be dragged past each other at all. `cat.mixedGroups` (extended in
// equipment-tab-reconstruct.ts to include a `lineItem` slot kind) is now the
// single combined order for a category's whole top-level membership, so this
// section resolves ONLY the narrow gap that unlocks: reordering a line item
// and a group/sub-hire-group relative to each other WITHIN THE SAME
// category. Everything else (group-vs-group reorder, line-item-vs-line-item
// reorder, moving a line item into/out of a group, moving a group to another
// category) is completely unchanged — still resolved by
// `resolveLineItemDragAction`/`resolveGroupDragAction` exactly as before.
//
// This is deliberately NOT built by merging `ContainerId`/`GroupContainerId`
// into one type. Doing that would make EVERY line-item/group container
// concept (nested group children, Uncategorized, cross-category moves) have
// to understand mixed-kind membership, for a gap that's actually much
// narrower: only a category-level STANDALONE line item (never a grouped
// child — those simply never appear in `cat.mixedGroups`) reordering against
// a group already in the SAME category. Scanning `cat.mixedGroups` directly
// for the category containing both dragged ids is enough on its own, and the
// existing per-kind resolvers keep handling everything they always did.

/** Every category's full combined top-level order (project groups, sub-hire
 *  groups, AND standalone line items) as PREFIXED sortable ids, straight from
 *  `cat.mixedGroups`. */
export function buildCategoryTopLevelOrder(
  categories: readonly CategoryData[],
): ReadonlyMap<string, readonly string[]> {
  const byCategory = new Map<string, readonly string[]>();
  for (const cat of categories) {
    const slots: MixedGroupSlot[] = cat.mixedGroups ?? [];
    byCategory.set(
      cat.id,
      slots.map((slot) =>
        slot.kind === "project" ? `grp-${slot.projectGroupId}`
        : slot.kind === "subHire" ? `shg-${slot.subHireGroupId}`
        : `li-${slot.lineItemId}`,
      ),
    );
  }
  return byCategory;
}

/** Where the ACTIVE item's center currently sits relative to the OVER
 *  target's rect — the top/bottom quarter means "reorder before/after this
 *  row", the middle half means "onto this row" (enter, when that's a valid
 *  transition — e.g. a line item dropped onto a group). Falls back to
 *  "middle" (today's existing behaviour) when either rect is unavailable, so
 *  a measurement miss never surprises the user with a new reorder they
 *  didn't ask for. */
export function computeDropZone(
  activeRect: ClientRect | null | undefined,
  overRect: ClientRect | null | undefined,
): "before" | "middle" | "after" {
  if (!activeRect || !overRect || overRect.height <= 0) return "middle";
  const activeCenterY = activeRect.top + activeRect.height / 2;
  const relative = (activeCenterY - overRect.top) / overRect.height;
  if (relative < 0.25) return "before";
  if (relative > 0.75) return "after";
  return "middle";
}

export type CrossKindReorderAction =
  | { kind: "noop" }
  | { kind: "reorder"; categoryId: string; orderedIds: string[] };

/** True when exactly one side is a standalone line item and the other a
 *  group/sub-hire-group — the only pairing `resolveCrossKindCategoryReorder`
 *  handles (line-vs-line and group-vs-group reorders stay on their existing,
 *  unrelated resolvers). */
function isCrossKindPair(activeSortableId: string, overSortableId: string): boolean {
  const isLine = (id: string) => id.startsWith("li-");
  const isGroupish = (id: string) => id.startsWith("grp-") || id.startsWith("shg-");
  return (
    (isLine(activeSortableId) && isGroupish(overSortableId)) ||
    (isGroupish(activeSortableId) && isLine(overSortableId))
  );
}

/** Splice `activeSortableId` immediately before/after `overSortableId` within
 *  `order`. Returns `null` when the result wouldn't actually change anything
 *  (dropping right back where it already was). */
function spliceCrossKind(
  order: readonly string[],
  activeSortableId: string,
  overSortableId: string,
  dropZone: "before" | "after",
): string[] | null {
  const withoutActive = order.filter((id) => id !== activeSortableId);
  const overIdx = withoutActive.indexOf(overSortableId);
  const insertAt = dropZone === "before" ? overIdx : overIdx + 1;
  const reordered = [...withoutActive.slice(0, insertAt), activeSortableId, ...withoutActive.slice(insertAt)];
  const unchanged = reordered.length === order.length && reordered.every((id, i) => id === order[i]);
  return unchanged ? null : reordered;
}

/**
 * Pure — resolves the "reorder a line item past a group in the same
 * category" gap. Requires one side a line item and the other a
 * group/sub-hire-group, and BOTH ids present in the SAME category's combined
 * order (a grouped line-item child never is, by construction — so this can
 * never fire for "leave my group", only ever for two items already siblings
 * at the top of one category).
 *
 * A "middle" drop zone is ambiguous only in ONE direction: a LINE ITEM
 * dropped in the middle of a GROUP/sub-hire-group row means "enter that
 * group" (handled by `resolveLineItemDragAction` elsewhere, so this function
 * stays a noop for that pairing). The reverse — a GROUP dropped in the
 * middle of a LINE ITEM row — has no such "enter" interpretation (a group
 * can never contain a line item), so there's nothing else to fall through
 * to; treating it as a noop there just silently swallowed the drag. Collapse
 * that one direction's "middle" to "before" instead, so hovering ANYWHERE
 * over the line item's row reorders the group next to it.
 */
export function resolveCrossKindCategoryReorder(
  activeSortableId: string,
  overSortableId: string,
  dropZone: "before" | "middle" | "after",
  categoryTopLevelOrder: ReadonlyMap<string, readonly string[]>,
): CrossKindReorderAction {
  if (!isCrossKindPair(activeSortableId, overSortableId)) return { kind: "noop" };

  const activeIsGroupish = activeSortableId.startsWith("grp-") || activeSortableId.startsWith("shg-");
  const effectiveDropZone = dropZone === "middle" && activeIsGroupish ? "before" : dropZone;
  if (effectiveDropZone === "middle") return { kind: "noop" };

  for (const [categoryId, order] of categoryTopLevelOrder) {
    if (!order.includes(activeSortableId) || !order.includes(overSortableId)) continue;
    const orderedIds = spliceCrossKind(order, activeSortableId, overSortableId, effectiveDropZone);
    return orderedIds ? { kind: "reorder", categoryId, orderedIds } : { kind: "noop" };
  }
  return { kind: "noop" };
}

// ─── Error classification (mirrors use-justified-mutation.ts's own helper) ──

function getConvexErrorCode(e: unknown): string | undefined {
  if (isUserFacingError(e)) return e.code;
  if (e instanceof ConvexError && e.data && typeof e.data === "object") {
    const code = (e.data as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/** HARD_LOCKED has no retry path (no `JUSTIFICATION_REQUIRED` prompt can fix
 *  it — only a full unlock session can) — `useJustifiedMutation` doesn't
 *  intercept `PROJECT_LOCKED`, so it reaches here and needs its own clear
 *  toast instead of a generic error message. A user-cancelled justification
 *  dialog (`useJustifiedMutation`'s `cancel()`) rejects with a plain
 *  "Cancelled" Error — that's an intentional no-op, not a failure to report. */
function reportDragMutationError(e: unknown) {
  if (e instanceof Error && e.message === "Cancelled") return;
  const code = getConvexErrorCode(e);
  if (code === "PROJECT_LOCKED") {
    toast.error("This project is locked. Open a full unlock session to make changes.");
    return;
  }
  toast.error(e instanceof Error ? e.message : "Couldn't move that item.");
}

// ─── The hook ────────────────────────────────────────────────────────────────

export interface UseEquipmentDndArgs {
  projectId: string;
  /** "Latest ref" pattern (see file header) — the caller writes these AFTER
   *  computing `native.categories` etc. each render, so this hook's drag
   *  handlers (invoked later, from a dnd-kit event, never during render) always
   *  read the most recently committed tree without a circular hook dependency
   *  on this hook's OWN overlay output. */
  categoriesRef: React.RefObject<CategoryData[]>;
  uncategorizedItemsRef: React.RefObject<LineItemData[]>;
  uncategorizedProjectGroupsRef: React.RefObject<GroupData[]>;
  /** Groups-only: the flat orphan sub-hire-group list, needed to resolve the
   *  Uncategorized container membership for a dragged sub-hire group (line
   *  items never need this list). */
  uncategorizedSubHireGroupsRef: React.RefObject<SubHireGroupData[]>;
  lineItemWrites: ReturnType<typeof useLineItemWrites>;
  groupWrites: ReturnType<typeof useProjectGroupWrites>;
  /** Groups-only: cross-category move + mixed-order reorder writes. */
  categorySlotWrites: ReturnType<typeof useCategorySlotWrites>;
  /** Categories-only: top-level reorder write. */
  categoryWrites: ReturnType<typeof useProjectCategoryWrites>;
  lockStatus: LockStatusLike;
  /** Called once a drag-driven mutation settles (success OR failure) — mirrors
   *  every other mutation call site in equipment-tab.tsx, which invalidates
   *  from its own onSuccess/onError. */
  onSettled?: () => void;
}

/** Every row kind renders as a single vertically-stacked list (desktop table
 *  rows and mobile cards both scroll top-to-bottom only) — clamp the dragged
 *  node to that axis (no horizontal drift while dragging on a `table-fixed`
 *  layout) and keep the floating `DragOverlay` from escaping the viewport on
 *  a small screen. Same modifiers for both layouts; neither needs different
 *  treatment since the constraint (vertical-only, stay-on-screen) is
 *  layout-agnostic. */
const dragModifiers = [restrictToVerticalAxis, restrictToWindowEdges];

/** A cloned drag-row DOM node plus its measured width — the clone itself is
 *  detached (never mounted), so `getBoundingClientRect()` on it always
 *  returns zeroes; the width has to be captured from the still-mounted
 *  SOURCE at clone time and carried alongside it. */
export interface DraggedRowClone {
  node: HTMLElement;
  width: number;
}

/**
 * Clone the actual row/card DOM node being dragged, so the DragOverlay can
 * render a pixel-accurate copy of the real thing instead of a hand-built
 * summary chip (the "it should look exactly the same" ask). Walks up from
 * the pointerdown target to the nearest `[data-drag-row]` ancestor
 * (equipment-rows.tsx/equipment-cards.tsx tag every draggable row root with
 * this) and deep-clones it BEFORE React re-renders the source row into its
 * dimmed `isDragging` state, so the clone captures the row at full opacity.
 *
 * `<TableRow>` clones need their per-cell widths frozen explicitly: a
 * standalone one-row `<table>` has no sibling rows to inform the browser's
 * table layout algorithm, so it would size each `<td>` to that cell's own
 * content instead of matching the live table's column widths. Locking each
 * cloned cell's width (measured from the source, which is still mounted at
 * clone time) to a `px` value sidesteps that entirely.
 */
function cloneDragRow(target: EventTarget | null): DraggedRowClone | null {
  if (!(target instanceof Element)) return null;
  const source = target.closest<HTMLElement>("[data-drag-row]");
  if (!source) return null;
  const clone = source.cloneNode(true) as HTMLElement;
  const width = source.getBoundingClientRect().width;
  if (source.tagName === "TR") {
    const sourceCells = Array.from(source.children);
    const clonedCells = Array.from(clone.children);
    sourceCells.forEach((cell, i) => {
      const clonedCell = clonedCells[i];
      if (!(clonedCell instanceof HTMLElement)) return;
      clonedCell.style.width = `${cell.getBoundingClientRect().width}px`;
      clonedCell.style.boxSizing = "border-box";
    });
  }
  return { node: clone, width };
}

export interface UseEquipmentDndResult {
  sensors: ReturnType<typeof useSensors>;
  /** Pass to `<DndContext modifiers={modifiers}>` — see `dragModifiers`'s
   *  doc comment for why these two, and why they apply uniformly. */
  modifiers: typeof dragModifiers;
  activeDragId: string | null;
  /** A deep clone of the row/card DOM node being dragged, captured at
   *  drag-start — render this inside `<DragOverlay>` (wrapped in a
   *  matching-width `<table>` for `<tr>` clones) so the floating preview is
   *  a pixel-accurate copy of the real row, not a hand-built summary. Null
   *  when nothing is being dragged. */
  draggedRowClone: DraggedRowClone | null;
  /** The `over.id` currently being hovered when the Drop Matrix disallows it
   *  — null otherwise. Lets the caller render invalid-drop styling. */
  invalidOverId: string | null;
  /** The `over.id` currently being hovered, valid or not — null when nothing
   *  is being dragged or the pointer isn't over any droppable. Lets the
   *  caller render a "you're about to drop here" highlight on whatever
   *  category/group/line-item row the pointer is over, distinct from
   *  `invalidOverId`'s narrower "and it's disallowed" signal. */
  hoveredOverId: string | null;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragOver: (event: DragOverEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;
  handleDragCancel: (event: DragCancelEvent) => void;
  orderOverlay: ReadonlyMap<string, OptimisticOrderEdit>;
  /** Groups' sibling of `orderOverlay` — see `use-native-line-item-writes.ts`'s
   *  `GroupOrderEdit` / `applyGroupOrderOverlay`. */
  groupOrderOverlay: ReadonlyMap<string, GroupOrderEdit>;
  /** Categories' sibling of `orderOverlay`/`groupOrderOverlay` — see
   *  `use-native-line-item-writes.ts`'s `CategoryOrderEdit` /
   *  `applyCategoryOrderOverlay`. No reparent field: categories never move
   *  across containers. */
  categoryOrderOverlay: ReadonlyMap<string, CategoryOrderEdit>;
  /** <JustificationDialog> instance(s) for the reorder/move wrappers (line
   *  items, groups, AND categories) — render once near this equipment tab's
   *  other dialogs. */
  dialogs: React.ReactNode;
}

export function useEquipmentDnd(args: UseEquipmentDndArgs): UseEquipmentDndResult {
  const {
    projectId,
    categoriesRef,
    uncategorizedItemsRef,
    uncategorizedProjectGroupsRef,
    uncategorizedSubHireGroupsRef,
    lineItemWrites,
    groupWrites,
    categorySlotWrites,
    categoryWrites,
    lockStatus,
    onSettled,
  } = args;

  // ONE PointerSensor, not PointerSensor+TouchSensor: Pointer Events fire for
  // mouse, touch, AND pen alike, so a touch interaction used to trigger BOTH
  // sensors at once — PointerSensor's old 4px `distance` constraint won the
  // race almost immediately (any touch jitter clears 4px well before
  // TouchSensor's 250ms delay elapsed), hijacking the long-press gesture and
  // fighting the browser's native scroll, which is what made drag "just not
  // work" on phones. A single delay-based constraint applied to PointerSensor
  // covers mouse/touch/pen uniformly (dnd-kit's own recommended pattern for
  // combined pointer-type support) and IS the "press and hold, then drag"
  // feel — no separate handle needed, and no dedicated touch-only sensor to
  // race against.
  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 8 } });
  const keyboardSensor = useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates });
  const sensors = useSensors(pointerSensor, keyboardSensor);

  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [draggedRowClone, setDraggedRowClone] = useState<DraggedRowClone | null>(null);
  const [invalidOverId, setInvalidOverId] = useState<string | null>(null);
  /** The `over.id` currently being hovered, valid or not — lets the caller
   *  highlight whatever category/group/line-item row the pointer is over,
   *  same idea as `invalidOverId` but unconditional (that one is a strict
   *  subset, only set when the Drop Matrix disallows the hovered target). */
  const [hoveredOverId, setHoveredOverId] = useState<string | null>(null);
  const [orderOverlay, setOrderOverlay] = useState<ReadonlyMap<string, OptimisticOrderEdit>>(
    () => new Map(),
  );
  const [groupOrderOverlay, setGroupOrderOverlay] = useState<ReadonlyMap<string, GroupOrderEdit>>(
    () => new Map(),
  );
  const [categoryOrderOverlay, setCategoryOrderOverlay] = useState<ReadonlyMap<string, CategoryOrderEdit>>(
    () => new Map(),
  );

  const justifiedReorder = useJustifiedMutation(
    (jargs: { itemIds: string[]; justification?: string }) =>
      lineItemWrites.reorder(projectId, jargs.itemIds, undefined, jargs.justification),
    lockStatus,
  );
  const justifiedMove = useJustifiedMutation(
    (jargs: {
      lineItemId: string;
      targetGroupId: string | null;
      targetCategoryId: string | null;
      justification?: string;
    }) => groupWrites.moveLineItem(jargs),
    lockStatus,
  );

  // One combined reorder wrapper for BOTH group-reorder branches (mirrors the
  // old `moveGroupSlot`'s own branching): a mixed list with no sub-hire group
  // in it reorders the lighter plain-project-group way; a mixed list WITH a
  // sub-hire group goes through the cross-type slot reorder. Combined behind
  // one `useJustifiedMutation`/dialog (rather than two) since they're the same
  // logical operation from the user's point of view — "reorder this category's
  // groups" — just two different mutations underneath depending on what's in
  // the list.
  const justifiedGroupReorder = useJustifiedMutation(
    (
      jargs: { justification?: string } & (
        | { kind: "pure"; orderedIds: string[] }
        | { kind: "mixed"; categoryId: string; orderedIds: string[] }
      ),
    ) =>
      jargs.kind === "pure"
        ? groupWrites.reorder({ orderedIds: jargs.orderedIds, justification: jargs.justification })
        : categorySlotWrites.reorderMixed({
            categoryId: jargs.categoryId,
            orderedIds: jargs.orderedIds,
            justification: jargs.justification,
          }),
    lockStatus,
  );
  // Same combining rationale for the two move mutations (project group vs
  // sub-hire group) — one dialog for "move this group to a different
  // category", branching on which underlying mutation the dragged row needs.
  const justifiedGroupMove = useJustifiedMutation(
    (jargs: {
      groupKind: "project" | "subHire";
      groupId: string;
      categoryId: string | null;
      justification?: string;
    }) =>
      jargs.groupKind === "project"
        ? categorySlotWrites.moveProjectGroup({
            groupId: jargs.groupId,
            categoryId: jargs.categoryId,
            justification: jargs.justification,
          })
        : categorySlotWrites.moveSubHireGroup({
            groupId: jargs.groupId,
            categoryId: jargs.categoryId,
            justification: jargs.justification,
          }),
    lockStatus,
  );
  // Categories' single reorder wrapper — no move counterpart (categories
  // never leave the one top-level container), so unlike line items/groups
  // there's only one mutation, one dialog.
  const justifiedCategoryReorder = useJustifiedMutation(
    (jargs: { orderedIds: string[]; justification?: string }) =>
      categoryWrites.reorder({ orderedIds: jargs.orderedIds, justification: jargs.justification }),
    lockStatus,
  );

  /** Dispatch the right reorder mutation for an ordered PREFIXED sortable-id
   *  list — see `planGroupReorder` (pure, unit-tested independently). */
  const runGroupReorder = useCallback(
    (categoryId: string, orderedSortableIds: string[]) =>
      justifiedGroupReorder.run(planGroupReorder(categoryId, orderedSortableIds)),
    [justifiedGroupReorder],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    // Clone BEFORE flipping activeDragId — that state flip is what re-renders
    // the source row into its dimmed `isDragging` state, so the clone must be
    // taken first to capture the row at full opacity.
    setDraggedRowClone(cloneDragRow(event.activatorEvent?.target ?? null));
    setActiveDragId(String(event.active.id));
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const overId = event.over ? String(event.over.id) : null;
    setHoveredOverId(overId);
    if (!overId) {
      setInvalidOverId(null);
      return;
    }
    const reason = getDisallowedDropReason(String(event.active.id), overId);
    setInvalidOverId(reason ? overId : null);
  }, []);

  // Each of the three `handleDragEnd` branches below (group / category / line
  // item) is its own `useCallback`, not inlined, so its internal noop/
  // blocked/reorder/move branching counts toward ITS OWN complexity score
  // instead of piling onto one giant dispatcher — the complexity ratchet
  // (POLICY.md R-3.6) measures per-function, so this split is what keeps
  // `handleDragEnd` itself a thin 3-way dispatch.
  const handleGroupDrop = useCallback(
    (activeSortableId: string, overSortableId: string | null) => {
      const groupCtx = buildGroupContainerMap(
        categoriesRef.current ?? [],
        uncategorizedProjectGroupsRef.current ?? [],
        uncategorizedSubHireGroupsRef.current ?? [],
      );
      const lineItemCategoryIndex = buildLineItemCategoryIndex(categoriesRef.current ?? []);
      const action = resolveGroupDragAction({ activeSortableId, overSortableId, ctx: groupCtx, lineItemCategoryIndex });

      if (action.kind === "noop") return;
      if (action.kind === "blocked") {
        toast.error(action.reason);
        return;
      }

      if (action.kind === "reorder") {
        setGroupOrderOverlay((prev) => {
          const next = new Map(prev);
          action.orderedSortableIds.forEach((sid, idx) => next.set(bareGroupId(sid), { sortOrder: idx }));
          return next;
        });
        runGroupReorder(action.categoryId, action.orderedSortableIds)
          .catch(reportDragMutationError)
          .finally(() => {
            setGroupOrderOverlay(new Map());
            onSettled?.();
          });
        return;
      }

      // Cross-category move — overlay the mover's new placement (+ every
      // destination sibling's shifted position when a specific position was
      // targeted) instantly, then fire the move (and a follow-up reorder for
      // the exact position, if implied).
      setGroupOrderOverlay((prev) => {
        const next = new Map(prev);
        if (action.resultingOrder) {
          action.resultingOrder.forEach((sid, idx) => {
            next.set(bareGroupId(sid), { sortOrder: idx, categoryId: action.targetCategoryId });
          });
        } else {
          // Append-only move (typically into "uncategorized-groups", which
          // has no defined order to insert into — see
          // `buildGroupContainerMap`) — only the mover's own placement
          // needs to change; siblings' positions are left alone, matching
          // what the move mutation itself actually does server-side.
          const destLen = (groupCtx.itemsByContainer.get(action.toContainerId) ?? []).length;
          next.set(action.groupId, { sortOrder: destLen, categoryId: action.targetCategoryId });
        }
        return next;
      });

      justifiedGroupMove
        .run({ groupKind: action.groupKind, groupId: action.groupId, categoryId: action.targetCategoryId })
        .then(() => {
          if (action.resultingOrder && action.targetCategoryId) {
            return runGroupReorder(action.targetCategoryId, action.resultingOrder);
          }
        })
        .catch(reportDragMutationError)
        .finally(() => {
          setGroupOrderOverlay(new Map());
          onSettled?.();
        });
    },
    [categoriesRef, uncategorizedProjectGroupsRef, uncategorizedSubHireGroupsRef, justifiedGroupMove, runGroupReorder, onSettled],
  );

  const handleCategoryDrop = useCallback(
    (activeSortableId: string, overSortableId: string | null) => {
      const allCategorySortableIds = (categoriesRef.current ?? []).map((cat) => `cat-${cat.id}`);
      const action = resolveCategoryDragAction({ activeSortableId, overSortableId, allCategorySortableIds });

      if (action.kind === "noop") return;

      setCategoryOrderOverlay((prev) => {
        const next = new Map(prev);
        action.orderedIds.forEach((id, idx) => next.set(id, { sortOrder: idx }));
        return next;
      });
      justifiedCategoryReorder
        .run({ orderedIds: action.orderedIds })
        .catch(reportDragMutationError)
        .finally(() => {
          setCategoryOrderOverlay(new Map());
          onSettled?.();
        });
    },
    [categoriesRef, justifiedCategoryReorder, onSettled],
  );

  const handleLineItemDrop = useCallback(
    (activeSortableId: string, overSortableId: string | null) => {
      const ctx = buildContainerMap(
        categoriesRef.current ?? [],
        uncategorizedItemsRef.current ?? [],
        uncategorizedProjectGroupsRef.current ?? [],
      );
      const action = resolveLineItemDragAction({ activeSortableId, overSortableId, ctx });

      if (action.kind === "noop") return;
      if (action.kind === "blocked") {
        toast.error(action.reason);
        return;
      }

      if (action.kind === "reorder") {
        setOrderOverlay((prev) => {
          const next = new Map(prev);
          action.orderedIds.forEach((id, idx) => next.set(id, { sortOrder: idx }));
          return next;
        });
        justifiedReorder
          .run({ itemIds: action.orderedIds })
          .catch(reportDragMutationError)
          .finally(() => {
            setOrderOverlay(new Map());
            onSettled?.();
          });
        return;
      }

      // Cross-container move — overlay the mover's new placement (+ every
      // destination sibling's shifted sortOrder when a specific position was
      // targeted) instantly, then fire the move (and a follow-up reorder for
      // the exact position, if implied).
      setOrderOverlay((prev) => {
        const next = new Map(prev);
        const destOrder =
          action.resultingOrder ?? [...(ctx.itemsByContainer.get(action.toContainerId) ?? []), action.lineItemId];
        destOrder.forEach((id, idx) => {
          next.set(id, {
            sortOrder: idx,
            groupId: action.targetGroupId,
            categoryId: action.targetCategoryId,
          });
        });
        return next;
      });

      justifiedMove
        .run({
          lineItemId: action.lineItemId,
          targetGroupId: action.targetGroupId,
          targetCategoryId: action.targetCategoryId,
        })
        .then(() => {
          if (action.resultingOrder) {
            return justifiedReorder.run({ itemIds: action.resultingOrder });
          }
        })
        .catch(reportDragMutationError)
        .finally(() => {
          setOrderOverlay(new Map());
          onSettled?.();
        });
    },
    [categoriesRef, uncategorizedItemsRef, uncategorizedProjectGroupsRef, justifiedReorder, justifiedMove, onSettled],
  );

  // dnd-kit cancels a drag (Escape, window resize, tab visibility change)
  // without ever calling onDragEnd — without this, activeDragId/
  // draggedRowClone would stay stuck set, leaving the DragOverlay open and
  // the source row dimmed indefinitely.
  const handleDragCancel = useCallback(() => {
    setActiveDragId(null);
    setDraggedRowClone(null);
    setInvalidOverId(null);
    setHoveredOverId(null);
  }, []);

  // Dispatch for `resolveCrossKindCategoryReorder`'s "reorder" result — a
  // line item and a group/sub-hire-group swapping positions within one
  // category. Reuses `justifiedGroupReorder`'s "mixed" mode (the SAME
  // `categorySlotWrites.reorderMixed` mutation `planGroupReorder` already
  // routes a sub-hire-inclusive group reorder through), translating `grp-`
  // to categorySlot's `pg-` the same way — `li-` needs no translation, it's
  // already the slot prefix `categorySlotWrites.ts` expects.
  const runCrossKindReorder = useCallback(
    (categoryId: string, orderedIds: string[]) => {
      setOrderOverlay((prev) => {
        const next = new Map(prev);
        orderedIds.forEach((sid, idx) => {
          if (sid.startsWith("li-")) next.set(sid.slice(3), { sortOrder: idx });
        });
        return next;
      });
      setGroupOrderOverlay((prev) => {
        const next = new Map(prev);
        orderedIds.forEach((sid, idx) => {
          if (!sid.startsWith("li-")) next.set(bareGroupId(sid), { sortOrder: idx });
        });
        return next;
      });
      justifiedGroupReorder
        .run({
          kind: "mixed",
          categoryId,
          orderedIds: orderedIds.map((sid) => (sid.startsWith("grp-") ? `pg-${bareGroupId(sid)}` : sid)),
        })
        .catch(reportDragMutationError)
        .finally(() => {
          setOrderOverlay(new Map());
          setGroupOrderOverlay(new Map());
          onSettled?.();
        });
    },
    [justifiedGroupReorder, onSettled],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragId(null);
      setDraggedRowClone(null);
      setInvalidOverId(null);
      setHoveredOverId(null);

      const activeSortableId = String(event.active.id);
      const overSortableId = event.over ? String(event.over.id) : null;

      // Cross-kind check FIRST, ahead of the per-kind dispatch below — see
      // "Cross-kind same-category reorder" section's doc comment for why
      // this narrow gap is resolved separately instead of folded into
      // resolveLineItemDragAction/resolveGroupDragAction.
      if (overSortableId && activeSortableId !== overSortableId) {
        const dropZone = computeDropZone(event.active.rect.current.translated, event.over?.rect ?? null);
        const categoryOrder = buildCategoryTopLevelOrder(categoriesRef.current ?? []);
        const crossKind = resolveCrossKindCategoryReorder(activeSortableId, overSortableId, dropZone, categoryOrder);
        if (crossKind.kind === "reorder") {
          runCrossKindReorder(crossKind.categoryId, crossKind.orderedIds);
          return;
        }
      }

      if (isGroupSortableId(activeSortableId)) {
        return handleGroupDrop(activeSortableId, overSortableId);
      }
      if (activeSortableId.startsWith("cat-")) {
        return handleCategoryDrop(activeSortableId, overSortableId);
      }
      return handleLineItemDrop(activeSortableId, overSortableId);
    },
    [handleGroupDrop, handleCategoryDrop, handleLineItemDrop, categoriesRef, runCrossKindReorder],
  );

  const dialogs = React.createElement(
    React.Fragment,
    null,
    React.createElement(JustificationDialog, { key: "reorder", ...justifiedReorder.dialogProps }),
    React.createElement(JustificationDialog, { key: "move", ...justifiedMove.dialogProps }),
    React.createElement(JustificationDialog, { key: "group-reorder", ...justifiedGroupReorder.dialogProps }),
    React.createElement(JustificationDialog, { key: "group-move", ...justifiedGroupMove.dialogProps }),
    React.createElement(JustificationDialog, { key: "category-reorder", ...justifiedCategoryReorder.dialogProps }),
  );

  return {
    sensors,
    modifiers: dragModifiers,
    activeDragId,
    draggedRowClone,
    invalidOverId,
    hoveredOverId,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
    orderOverlay,
    groupOrderOverlay,
    categoryOrderOverlay,
    dialogs,
  };
}
