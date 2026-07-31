"use client";

/**
 * Real drag-and-drop for LINE ITEMS ONLY (groups/categories still use their
 * ▲/▼ MoveButtons — those convert to drag in a later commit).
 *
 * Encapsulates the @dnd-kit wiring equipment-tab.tsx needs: sensors, hover/
 * invalid-drop tracking, the optimistic sortOrder/groupId/categoryId overlay
 * (mirrors use-native-line-item-writes.ts's `applyOptimisticEdits` pattern —
 * see `applyOrderOverlay`), and the two justified-mutation wrappers (reorder
 * within a container / move across containers) with their shared
 * <JustificationDialog> instances.
 *
 * Container membership resolution (`buildContainerMap`) and the actual
 * "what should this drop do" decision (`resolveLineItemDragAction`) are pure,
 * framework-free functions exported for unit testing without mounting
 * anything — `handleDragEnd` itself is a thin dispatcher on top of them.
 *
 * Circular-dependency note: `useNativeEquipmentTab`'s `categories` /
 * `uncategorizedItems` / `uncategorizedProjectGroups` are computed FROM this
 * hook's `orderOverlay` (the overlay must apply before reconstruction), while
 * this hook's drag handlers need those same reconstructed trees to resolve a
 * drop (container membership, current order). Passing plain values would be
 * circular within one render. The caller instead hands us stable `RefObject`s
 * it writes AFTER computing `native` each render ("latest ref" pattern) —
 * `orderOverlay` itself is independent local state (unaffected by the ref
 * contents), so there's no ordering hazard: call this hook first to get
 * `orderOverlay`, feed that into `useNativeEquipmentTab`, then stash the
 * result back into the refs this hook already holds.
 */

import * as React from "react";
import { useCallback, useState } from "react";
import {
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates, arrayMove } from "@dnd-kit/sortable";
import { ConvexError } from "convex/values";
import { toast } from "sonner";
import {
  getDisallowedDropReason,
  isHiddenFromList,
  type CategoryData,
  type GroupData,
  type LineItemData,
} from "@/components/projects/equipment-rows";
import { JustificationDialog } from "@/components/projects/justification-dialog";
import { useJustifiedMutation, type LockStatusLike } from "@/hooks/use-justified-mutation";
import { isUserFacingError } from "@/lib/errors/user-facing-error";
import type { useLineItemWrites } from "@/hooks/use-line-item-writes";
import type { useProjectGroupWrites } from "@/hooks/use-project-groups-writes";
import type { OptimisticOrderEdit } from "@/hooks/use-native-line-item-writes";

// ─── Container id scheme ─────────────────────────────────────────────────────
//
// A category's own top-level line items, an expanded project group's line-item
// children, or the flat uncategorized-standalone list. Sortable item ids reuse
// the existing `li-{lineItemId}` prefix (equipment-tab.tsx's `allSortableIds`)
// so this is forward-compatible once groups/categories join the same
// DndContext in a later commit.
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

// ─── The pure "what should this drop do" decision ────────────────────────────

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
 * Decide what a line-item drag-end should do. Framework-free (plain strings +
 * the `ContainerContext` produced by `buildContainerMap`) so it's unit
 * testable without mounting dnd-kit or React. `handleDragEnd` below is a thin
 * wrapper that calls this then dispatches to the right mutation(s).
 */
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

  let toContainerId: ContainerId | undefined;
  let overBareId: string | undefined;
  if (overSortableId.startsWith("li-")) {
    overBareId = overSortableId.slice(3);
    toContainerId = ctx.containerOf.get(overBareId);
  } else if (ctx.itemsByContainer.has(overSortableId as ContainerId)) {
    // Hovering an (empty) container's own landing zone directly.
    toContainerId = overSortableId as ContainerId;
  }
  if (!toContainerId) return { kind: "noop" };

  const destItems = ctx.itemsByContainer.get(toContainerId) ?? [];

  if (fromContainerId === toContainerId) {
    const fromIndex = destItems.indexOf(activeId);
    const toIndex = overBareId ? destItems.indexOf(overBareId) : destItems.length - 1;
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return { kind: "noop" };
    return {
      kind: "reorder",
      containerId: fromContainerId,
      orderedIds: arrayMove([...destItems], fromIndex, toIndex),
    };
  }

  const meta = ctx.containerMeta.get(toContainerId)!;
  let resultingOrder: string[] | undefined;
  if (overBareId) {
    const withoutActive = destItems.filter((id) => id !== activeId);
    const insertAt = withoutActive.indexOf(overBareId);
    const idx = insertAt === -1 ? withoutActive.length : insertAt;
    resultingOrder = [...withoutActive.slice(0, idx), activeId, ...withoutActive.slice(idx)];
  }

  return {
    kind: "move",
    lineItemId: activeId,
    fromContainerId,
    toContainerId,
    targetCategoryId: meta.categoryId,
    targetGroupId: meta.groupId,
    resultingOrder,
  };
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
   *  on this hook's OWN `orderOverlay` output. */
  categoriesRef: React.RefObject<CategoryData[]>;
  uncategorizedItemsRef: React.RefObject<LineItemData[]>;
  uncategorizedProjectGroupsRef: React.RefObject<GroupData[]>;
  lineItemWrites: ReturnType<typeof useLineItemWrites>;
  groupWrites: ReturnType<typeof useProjectGroupWrites>;
  lockStatus: LockStatusLike;
  /** Called once a drag-driven mutation settles (success OR failure) — mirrors
   *  every other mutation call site in equipment-tab.tsx, which invalidates
   *  from its own onSuccess/onError. */
  onSettled?: () => void;
}

export interface UseEquipmentDndResult {
  sensors: ReturnType<typeof useSensors>;
  activeDragId: string | null;
  /** The `over.id` currently being hovered when the Drop Matrix disallows it
   *  — null otherwise. Lets the caller render invalid-drop styling. */
  invalidOverId: string | null;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragOver: (event: DragOverEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;
  orderOverlay: ReadonlyMap<string, OptimisticOrderEdit>;
  /** <JustificationDialog> instance(s) for the reorder/move wrappers — render
   *  once near this equipment tab's other dialogs. */
  dialogs: React.ReactNode;
}

export function useEquipmentDnd(args: UseEquipmentDndArgs): UseEquipmentDndResult {
  const {
    projectId,
    categoriesRef,
    uncategorizedItemsRef,
    uncategorizedProjectGroupsRef,
    lineItemWrites,
    groupWrites,
    lockStatus,
    onSettled,
  } = args;

  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 4 } });
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } });
  const keyboardSensor = useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates });
  const sensors = useSensors(pointerSensor, touchSensor, keyboardSensor);

  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [invalidOverId, setInvalidOverId] = useState<string | null>(null);
  const [orderOverlay, setOrderOverlay] = useState<ReadonlyMap<string, OptimisticOrderEdit>>(
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

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const overId = event.over ? String(event.over.id) : null;
    if (!overId) {
      setInvalidOverId(null);
      return;
    }
    const reason = getDisallowedDropReason(String(event.active.id), overId);
    setInvalidOverId(reason ? overId : null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragId(null);
      setInvalidOverId(null);

      const activeSortableId = String(event.active.id);
      const overSortableId = event.over ? String(event.over.id) : null;
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

  const dialogs = React.createElement(
    React.Fragment,
    null,
    React.createElement(JustificationDialog, { key: "reorder", ...justifiedReorder.dialogProps }),
    React.createElement(JustificationDialog, { key: "move", ...justifiedMove.dialogProps }),
  );

  return {
    sensors,
    activeDragId,
    invalidOverId,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    orderOverlay,
    dialogs,
  };
}
