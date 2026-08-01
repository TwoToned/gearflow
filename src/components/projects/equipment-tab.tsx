"use client";

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { DndContext, DragOverlay, closestCenter, useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { readMigratedLocalStorage } from "@/lib/local-storage-migrate";
import { api } from "../../../convex/_generated/api";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { refreshProjectDetail } from "@/hooks/use-project-detail";
import { useProjectCategoryWrites } from "@/hooks/use-project-categories-writes";
import { useProjectGroupWrites } from "@/hooks/use-project-groups-writes";
import { useCategorySlotWrites } from "@/hooks/use-category-slots-writes";
import { useNativeEquipmentTab } from "@/hooks/use-native-equipment-tab";
import {
  computeLineTotal,
  type OptimisticLineEdit,
} from "@/hooks/use-native-line-item-writes";
import { useEquipmentDnd, type DraggedRowClone } from "@/hooks/use-equipment-dnd";
import { useCanDo } from "@/lib/use-permissions";
import { Plus, FolderPlus, FolderTree, Pencil, Trash2, ChevronDown as ChevronDownIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { ConvexError } from "convex/values";

import { useProjectServices } from "@/hooks/use-project-services";
import { useGroupTemplates } from "@/hooks/use-group-templates";
import { useGroupTemplateWrites } from "@/hooks/use-group-templates-writes";
import {
  useLineItemWrites,
  buildLineItemSetClear,
  type BulkLineItemPatch,
} from "@/hooks/use-line-item-writes";
import { lineItemSchema } from "@/lib/validations/line-item";
import { computeInlineLineItemPayload, type InlineLineItemPatch } from "@/lib/line-item-edit-payload";
import { computeInlineSubHireItemInput, type SubHireItemRowLike, type InlineSubHireItemPatch } from "@/lib/sub-hire-item-edit-payload";
import { useSubHireWrites } from "@/hooks/use-sub-hire-writes";
import { Button } from "@/components/ui/button";
import { GatedButton } from "@/components/ui/gated-button";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkActionBar } from "@/components/ui/bulk-action-bar";
import { BulkDeleteDialog } from "@/components/ui/bulk-delete-dialog";
import { BulkEditLineItemsDialog } from "./bulk-edit-line-items-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/formatters";
import { SERVICE_TYPE_LABELS } from "@/lib/constants/services";
import { cn, focusRing } from "@/lib/utils";
import { useActiveOrganization } from "@/lib/auth-client";
import { UnifiedAddDialog, type UnifiedAddKind } from "./unified-add-dialog";
import { MoveSubHireGroupDialog } from "./move-sub-hire-group-dialog";
import { MoveProjectGroupDialog } from "./move-project-group-dialog";
import { PriceEditDialog, type PriceEditTarget } from "./price-edit-dialog";
import { MoveItemToCategoryDialog } from "./move-item-to-category-dialog";
import { MoveItemToGroupDialog } from "./move-item-to-group-dialog";
import { EditGroupDialog } from "./edit-group-dialog";
import { DeleteGroupDialog } from "./delete-group-dialog";
import { SaveAsTemplateDialog } from "./save-as-template-dialog";
import { AddCategoryDialog } from "./add-category-dialog";
import { RenameCategoryDialog } from "./rename-category-dialog";
import { AddGroupToolbarDialog } from "./add-group-toolbar-dialog";
import { EditLineItemDialog } from "./edit-line-item-dialog";
import { SubHireExpandedItems } from "./sub-hire-expanded-items";
import { SubHireOrderDialog } from "./sub-hire-order-dialog";
import { subHireStatusLabels, formatLabel } from "@/lib/status-labels";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { ArrowLeftRight, ChevronDown } from "lucide-react";
import {
  COL_COUNT,
  isRealKitChild,
  isHiddenFromList,
  GroupRow,
  CategoryRow,
  LineItemRow,
  SubHireGroupRow,
  type LineItemData,
  type GroupData,
  type CategoryData,
  type SubHireGroupData,
  type MixedGroupSlot,
  type OverbookedInfo,
  type GroupInlinePricePatch,
} from "./equipment-rows";
import { ReassignProvider, type ReassignTarget, type ReassignSerial } from "./reassign-context";
import { useWarehouseWrites } from "@/hooks/use-warehouse-writes";
import { useSelection } from "./use-selection";
import { useIsMobile } from "@/hooks/use-mobile";
import { CategoryCardHeading } from "./equipment-cards";
import { useProjectLockStatus } from "@/hooks/use-project-lock";
import { resolveLockCopy, scrollToLockStrip } from "@/lib/lock-copy";
import { useJustifiedMutation } from "@/hooks/use-justified-mutation";
import { JustificationDialog } from "./justification-dialog";

interface EquipmentTabProps {
  projectId: string;
  rentalStartDate?: Date | null;
  rentalEndDate?: Date | null;
  /** When provided, the primary "Add ▾" menu is portalled into this element
   *  (the tab row) instead of the in-panel toolbar. The page renders an empty
   *  slot inline with the Equipment/Labour/Tasks tabs and hands the node here so
   *  the Add action sits on the tab row. */
  addMenuSlot?: HTMLElement | null;
}

/** `useSortable()`'s `transform`/`transition` turned into an inline style —
 *  applied to the row/card ROOT alongside `dragHandleRef`/`dragAttributes`/
 *  `dragListeners` (see equipment-rows.tsx's `DragHandleControls` doc
 *  comment). This is what makes OTHER rows slide out of the way live as a
 *  drag passes over them (dnd-kit's `verticalListSortingStrategy` computes
 *  the shift automatically from each row's position in its `SortableContext`
 *  — no manual reorder-preview logic needed here). Without it, the list sat
 *  frozen until drop then snapped to the new order all at once. */
function buildDragStyle(
  transform: ReturnType<typeof useSortable>["transform"],
  transition: ReturnType<typeof useSortable>["transition"],
): React.CSSProperties {
  return { transform: CSS.Transform.toString(transform), transition };
}

/**
 * Mounts `use-equipment-dnd.ts`'s `draggedRowClone` — a deep clone of the
 * ACTUAL row/card DOM node being dragged — inside the DragOverlay, so the
 * floating preview is a pixel-accurate copy of the real row instead of a
 * hand-built summary ("it should look exactly the same" — a name-only or
 * qty/total-only chip was the earlier, explicitly rejected attempt at this).
 * `appendChild`s the raw node imperatively (a cloned DOM node, not a React
 * element/JSX, can't be returned from render) into a plain wrapper div; a
 * `<tr>` clone is re-wrapped in its own `<table>` so it renders as a table
 * row would (browsers refuse to render a bare `<tr>` outside a table/tbody).
 * `cloneDragRow` already freezes each `<td>`'s width inline before handing it
 * here, so this one-row table doesn't get re-sized by the browser's table
 * layout algorithm (which would otherwise size columns from this row's own
 * content alone, disagreeing with the live table's multi-row-informed
 * widths).
 */
function DragRowOverlayContent({ clone }: { clone: DraggedRowClone }) {
  const { node, width } = clone;
  const containerRef = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.replaceChildren(node);
    return () => {
      container.replaceChildren();
    };
  }, [node]);

  const isRow = node.tagName === "TR";
  return (
    <div
      className="cursor-grabbing overflow-hidden rounded-[var(--r)] shadow-[var(--sh-card)]"
      style={{ width }}
    >
      {isRow ? (
        <table className="w-full border-collapse bg-card">
          <tbody ref={containerRef as React.Ref<HTMLTableSectionElement>} />
        </table>
      ) : (
        <div ref={containerRef as React.Ref<HTMLDivElement>} className="bg-card" />
      )}
    </div>
  );
}

// ─── Sortable line-item row wrapper ──────────────────────────────────────────
//
// Groups convert to drag below via SortableGroupRow/SortableSubHireGroupRow,
// and categories via SortableCategoryRow (see use-equipment-dnd.ts's file
// header). One `useSortable()` call per row, kept in a small wrapper (rather
// than inline in the .map() callbacks below) so the hook isn't called from a
// plain callback, which would trip react-hooks/rules-of-hooks. `dragHandleRef`
// is `useSortable`'s `setNodeRef`, attached to the row's/card's ROOT element —
// there is no dedicated handle; pressing and holding anywhere on the row
// starts the drag (a delay-based activation constraint distinguishes a quick
// click from a hold — see use-equipment-dnd.ts's sensor setup) — see
// equipment-rows.tsx's `DragHandleControls` doc comment.
function SortableLineItemRow({
  sortableId,
  containerId,
  dragDisabled,
  ...rowProps
}: {
  sortableId: string;
  containerId: string;
  dragDisabled?: boolean;
} & Omit<
  React.ComponentProps<typeof LineItemRow>,
  "dragHandleRef" | "dragAttributes" | "dragListeners" | "isDragDisabled" | "dragStyle" | "isDragging"
>) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: sortableId,
    data: { containerId },
    disabled: dragDisabled,
  });
  return (
    <LineItemRow
      {...rowProps}
      dragHandleRef={setNodeRef}
      dragAttributes={attributes as unknown as Record<string, unknown>}
      dragListeners={listeners as unknown as Record<string, unknown>}
      isDragDisabled={dragDisabled}
      dragStyle={buildDragStyle(transform, transition)}
      isDragging={isDragging}
    />
  );
}

// ─── Sortable group row wrappers ────────────────────────────────────────────
//
// Same "small wrapper to satisfy rules-of-hooks" shape as SortableLineItemRow
// above, one per group kind. `dragDisabled: true` is used for orphan
// (Uncategorized-zone) groups — they're still registered as sortable items
// (so the Uncategorized zone resolves as a valid drop container/target for a
// group leaving a category — see use-equipment-dnd.ts's
// `buildGroupContainerMap`) but can't originate a drag themselves: dnd-kit's
// own `useSortable({disabled: true})` already makes `listeners` a no-op (see
// equipment-rows.tsx's `DragHandleControls` doc comment), so the row simply
// never activates a drag — no separate handle-hiding logic needed.
function SortableGroupRow({
  sortableId,
  containerId,
  dragDisabled,
  ...rowProps
}: {
  sortableId: string;
  containerId: string;
  dragDisabled?: boolean;
} & Omit<
  React.ComponentProps<typeof GroupRow>,
  "dragHandleRef" | "dragAttributes" | "dragListeners" | "isDragDisabled" | "dragStyle" | "isDragging"
>) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: sortableId,
    data: { containerId },
    disabled: dragDisabled,
  });
  return (
    <GroupRow
      {...rowProps}
      dragHandleRef={setNodeRef}
      dragAttributes={attributes as unknown as Record<string, unknown>}
      dragListeners={listeners as unknown as Record<string, unknown>}
      isDragDisabled={dragDisabled}
      dragStyle={buildDragStyle(transform, transition)}
      isDragging={isDragging}
    />
  );
}

function SortableSubHireGroupRow({
  sortableId,
  containerId,
  dragDisabled,
  ...rowProps
}: {
  sortableId: string;
  containerId: string;
  dragDisabled?: boolean;
} & Omit<
  React.ComponentProps<typeof SubHireGroupRow>,
  "dragHandleRef" | "dragAttributes" | "dragListeners" | "isDragDisabled" | "dragStyle" | "isDragging"
>) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: sortableId,
    data: { containerId },
    disabled: dragDisabled,
  });
  return (
    <SubHireGroupRow
      {...rowProps}
      dragHandleRef={setNodeRef}
      dragAttributes={attributes as unknown as Record<string, unknown>}
      dragListeners={listeners as unknown as Record<string, unknown>}
      isDragDisabled={dragDisabled}
      dragStyle={buildDragStyle(transform, transition)}
      isDragging={isDragging}
    />
  );
}

// ─── Sortable category row wrapper ──────────────────────────────────────────
//
// Same "small wrapper to satisfy rules-of-hooks" shape as the wrappers above.
// Categories are always independently reorderable structurally (no "orphan
// zone" equivalent the way groups have), but `dragDisabled` is still threaded
// through so the caller can gate drag on permission/lock state, same as every
// other row kind.
function SortableCategoryRow({
  sortableId,
  containerId,
  dragDisabled,
  ...rowProps
}: {
  sortableId: string;
  containerId: string;
  dragDisabled?: boolean;
} & Omit<
  React.ComponentProps<typeof CategoryRow>,
  "dragHandleRef" | "dragAttributes" | "dragListeners" | "isDragDisabled" | "dragStyle" | "isDragging"
>) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: sortableId,
    data: { containerId },
    disabled: dragDisabled,
  });
  return (
    <CategoryRow
      {...rowProps}
      dragHandleRef={setNodeRef}
      dragAttributes={attributes as unknown as Record<string, unknown>}
      dragListeners={listeners as unknown as Record<string, unknown>}
      isDragDisabled={dragDisabled}
      dragStyle={buildDragStyle(transform, transition)}
      isDragging={isDragging}
    />
  );
}

// ─── Uncategorized zone header / drop target ────────────────────────────────
//
// Previously this header (and any empty-state hint) only rendered once
// something was ALREADY uncategorized (`hasUncategorized`) — but the two
// `SortableContext`s beneath it (orphan items/groups) render no DOM node at
// all when empty, so a project where everything currently lives in a
// category had NO droppable anywhere for "drag this out to Uncategorized".
// Always rendering this header (whenever the project has categories at all)
// gives that drag a landing zone even on the very first use. Not a
// `useSortable` — nothing reorders against this row itself, just a plain
// `useDroppable` landing zone. Its id (`uncat-zone`) is resolved by both
// `resolveLineItemDropTarget` and `resolveGroupDropTarget` in
// use-equipment-dnd.ts, exactly like the `cat-` header-row branches — one
// gesture, read differently depending on what's being dragged.
function UncategorizedHeader({
  isMobile,
  colCount,
  isEmpty,
}: {
  isMobile: boolean;
  colCount: number;
  isEmpty: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: "uncat-zone" });
  const hint = "Drag items or groups here to remove them from a category.";
  if (isMobile) {
    return (
      <div ref={setNodeRef}>
        <CategoryCardHeading name="Uncategorised" />
        {isEmpty && <p className="px-3 py-2 text-caption text-muted">{hint}</p>}
      </div>
    );
  }
  return (
    <>
      <TableRow ref={setNodeRef} className="bg-paper-2/40 hover:bg-paper-2/40">
        <TableCell colSpan={colCount} className="py-2 px-1">
          <div className="flex items-center gap-1.5">
            <div className="w-6" />
            <h3 className="t-overline text-muted">Uncategorised</h3>
          </div>
        </TableCell>
      </TableRow>
      {isEmpty && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={colCount} className="py-3 text-center text-caption text-muted">
            {hint}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function EquipmentTab({ projectId, rentalStartDate, rentalEndDate, addMenuSlot }: EquipmentTabProps) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const isMobile = useIsMobile();
  const warehouseWrites = useWarehouseWrites();

  const invalidate = useCallback(() => {
    refreshProjectDetail(projectId);
  }, [projectId]);

  // Browser-direct project-group writes (create / update / price / delete / reorder /
  // move) — guarded api.projectGroupsWrites.* mutations; each folds the suggested-price
  // recompute + in-mutation recalcProjectTotals + audit into one transaction. Hoisted
  // above the native read-layer path (below) so useEquipmentDnd — which needs both
  // this and lineItemWrites — can be called before `native` without a TDZ violation.
  const groupWrites = useProjectGroupWrites();

  // Browser-direct cross-type category-slot writes (reorder mixed groups + the
  // move/create-and-place flows used by the move dialogs AND group
  // drag-and-drop). Hoisted here (same reason as groupWrites above) so
  // useEquipmentDnd can be called before `native` without a TDZ violation.
  const categorySlotWrites = useCategorySlotWrites();

  // Browser-direct project-category writes (create / rename / delete / reorder) —
  // guarded api.projectCategoriesWrites.* mutations; category reads are reactive.
  // Hoisted here too (same TDZ reason as groupWrites/categorySlotWrites above) so
  // useEquipmentDnd — which now also drives category drag-and-drop reorder — can
  // be called before `native` is computed.
  const categoryWrites = useProjectCategoryWrites();

  // Browser-direct line-item writes (update / remove / reorder). Each guarded
  // api.lineItemWrites.* mutation folds the availability re-check +
  // recalcProjectTotals + audit + collab feed into one transaction.
  const lineItemWrites = useLineItemWrites();

  // Browser-direct sub-hire writes — used here for inline edits on sub-hire
  // GROUP CHILD line items (updateSubHireItemNative, keyed by subHireItemId
  // instead of the derived line's own id) and the sub-hire group's own
  // inline cost/charge cells (updateGroup). PriceEditDialog/SubHireOrderDialog
  // own their own separate instances of this same hook for their dialogs.
  const subHireWrites = useSubHireWrites();

  // #990 — one `useProjectLockStatus` subscription backs every money-field
  // lock in this tab (price/discount edit dialogs, bulk edit, gated add/
  // delete buttons at HARD_LOCKED). `moneyLocked` mirrors the server's
  // `defaultToZero`/gate condition: tier isn't OPEN and no session is open.
  const [lockNow] = useState(() => Date.now());
  const lockStatus = useProjectLockStatus(projectId, orgId, lockNow);
  const moneyLocked = !lockStatus.loading && lockStatus.tier !== "OPEN" && !lockStatus.hasOpenSession;
  const lockReason = resolveLockCopy(lockStatus, lockNow).oneLiner;
  const hardLocked = !lockStatus.loading && lockStatus.tier === "HARD_LOCKED" && !lockStatus.hasOpenSession;

  // Drag-and-drop is client-gated on the SAME permission every reorder/move
  // mutation already enforces server-side (`project:manage_line_items`) —
  // unlike the old ▲/▼ buttons (which rendered unconditionally for any
  // viewer), a dragged handle should simply not exist for someone who can't
  // write. Also disabled at HARD_LOCKED with no open FULL session: every
  // drag mutation's `assertLifecycleGuard` throws `PROJECT_LOCKED` there with
  // no retry-with-justification path (see use-equipment-dnd.ts's
  // `reportDragMutationError`), so starting that drag can only ever fail —
  // better to not offer the handle at all than let it fail every time.
  const canDragEquipment = useCanDo("project", "manage_line_items") && !hardLocked;

  // Native read-layer path (Phase 4 — the six server-action shared-resource reads +
  // the useProjectEquipmentLiveSync doorbell are retired here). ALL six equipment
  // views come from ONE reactive equipmentTab.bundle subscription (reconstructed
  // client-side); writes are still server actions whose convex.mutation pushes the
  // delta to this subscription, so no doorbell→refetch is needed.
  // Optimistic line-item edits (Phase 5d, flag-gated): the edited row updates
  // instantly by overlaying the pending fields onto the bundle; the real write still
  // goes through the updateLineItem server action, and the overlay is cleared once it
  // settles. See use-native-line-item-writes.ts.
  const [pendingEdits, setPendingEdits] = useState<ReadonlyMap<string, OptimisticLineEdit>>(
    () => new Map(),
  );
  const clearPendingEdit = useCallback((id: string) => {
    setPendingEdits((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Drag-and-drop for LINE ITEMS, GROUPS, and CATEGORIES. "Latest ref"
  // pattern (see use-equipment-dnd.ts's file header) resolves the circular
  // dependency between this hook's `orderOverlay`/`groupOrderOverlay`/
  // `categoryOrderOverlay` (needed BEFORE useNativeEquipmentTab reconstructs
  // categories/uncategorizedItems below) and its drag handlers (which need
  // those SAME reconstructed trees to resolve a drop) — the refs are written
  // AFTER `native` is computed, every render, and read only later from a
  // dnd-kit event, never during render.
  const categoriesRef = useRef<CategoryData[]>([]);
  const uncategorizedItemsRef = useRef<LineItemData[]>([]);
  const uncategorizedProjectGroupsRef = useRef<GroupData[]>([]);
  const uncategorizedSubHireGroupsRef = useRef<SubHireGroupData[]>([]);
  const dnd = useEquipmentDnd({
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
    onSettled: invalidate,
  });

  const native = useNativeEquipmentTab(
    projectId,
    orgId,
    pendingEdits,
    dnd.orderOverlay,
    dnd.groupOrderOverlay,
    dnd.categoryOrderOverlay,
  );

  // #990 (surface 5, "justify tier") — line item/group remove prompt for a
  // reason at ON_SITE+ with no open session (`useJustifiedMutation` pre-checks
  // `lockStatus.tier` and shows `<JustificationDialog>` before firing).
  const justifiedRemoveLineItem = useJustifiedMutation(
    (args: { id: string; justification?: string }) => lineItemWrites.remove(args.id, args.justification),
    lockStatus,
  );
  const justifiedRemoveLineItems = useJustifiedMutation(
    (args: { ids: string[]; justification?: string }) => lineItemWrites.removeMany(args.ids, args.justification),
    lockStatus,
  );
  const justifiedRemoveGroup = useJustifiedMutation(
    (args: { groupId: string; justification?: string }) => groupWrites.remove(args.groupId, args.justification),
    lockStatus,
  );

  // Passive section/group/line-item collaboration state: one review-marker
  // subscription and one comment-count subscription for the whole project,
  // then row lookups by target key. This avoids mounting a getReviewMarker
  // hook PER ROW — LineItemRow used to do exactly that (an extra live
  // subscription per line item, un-dedupeable since each row's targetId
  // differs), which is why collaboration.getReviewMarker was thousands of
  // calls/month on a small org (Phase 0 baseline,
  // docs/designs/perf-convex-efficiency-2026-06.md Finding #4).
  // listReviewMarkersForEntity already returns every target under this
  // project (no targetType filter), so the same map covers section/group/
  // category rows AND line-item rows.
  const reviewMarkers = useAuthedQuery(
    api.collaboration.listReviewMarkersForEntity,
    orgId ? { orgId, entityType: "project", entityId: projectId } : "skip"
  );
  const commentCounts = useAuthedQuery(
    api.collaboration.listThreadCommentCounts,
    orgId ? { orgId, entityType: "project", entityId: projectId } : "skip"
  ) as Record<string, { open: number; total: number; blockingOpen: number }> | undefined;
  const markerByTarget = React.useMemo(
    () => new Map((reviewMarkers ?? []).map((m) => [m.targetId, m])),
    [reviewMarkers]
  );

  // Multi-select state (row highlight via cmd/shift-click).
  const selection = useSelection();

  // Clear selection on Escape
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && selection.selectionSize > 0) {
        selection.clearSelection();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selection]);

  // Move-sub-hire-group dialog state (Phase 6b kebab action).
  const [moveSubHireGroup, setMoveSubHireGroup] = useState<{ id: string; title: string } | null>(null);

  // Move-project-group dialog state (Fix A — project groups can move
  // between categories now; mirrors the sub-hire flow).
  const [moveProjectGroup, setMoveProjectGroup] = useState<{ id: string; title: string } | null>(null);

  // Unified PriceEditDialog target (Phase 6c kebab action — works for
  // both project groups and sub-hire groups).
  const [priceEditTarget, setPriceEditTarget] = useState<PriceEditTarget | null>(null);

  // 8H — "Show margin" toggle reveals a Cost column. Persisted to
  // localStorage so each user keeps the column they prefer. Default OFF.
  const SHOW_COST_KEY = "rvlt-flow-projects-show-cost";
  const LEGACY_SHOW_COST_KEY = "gearflow-projects-show-cost"; // pre-rebrand
  const [showCostColumn, setShowCostColumn] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return (
        readMigratedLocalStorage(SHOW_COST_KEY, LEGACY_SHOW_COST_KEY) === "true"
      );
    } catch {
      return false;
    }
  });
  const toggleShowCostColumn = useCallback(() => {
    setShowCostColumn((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SHOW_COST_KEY, String(next));
      } catch {
        // ignore — localStorage may be disabled
      }
      return next;
    });
  }, []);
  const colCount = COL_COUNT + (showCostColumn ? 1 : 0);

  const [showAddCategory, setShowAddCategory] = useState(false);

  // Unified add dialog state (own-stock / kit / sub-hire / custom)
  const [showUnifiedAdd, setShowUnifiedAdd] = useState(false);
  const [unifiedAddKind, setUnifiedAddKind] = useState<UnifiedAddKind>("own-stock");
  const [unifiedAddTarget, setUnifiedAddTarget] = useState<{
    categoryId?: string;
    groupId?: string;
    label?: string;
  }>({});

  // Sub-hire order dialog state
  const [showSubHireOrderDialog, setShowSubHireOrderDialog] = useState(false);
  const [managingSubHireId, setManagingSubHireId] = useState<string | null>(null);
  const [expandedSubHires, setExpandedSubHires] = useState<Set<string>>(new Set());

  // Kit/group parent expand state (for items with childLineItems)
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  const toggleParent = useCallback((id: string) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);



  // Delete confirmation state
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);
  const [deleteGroupInfo, setDeleteGroupInfo] = useState<{
    title: string;
    price: number;
    itemCount: number;
  } | null>(null);

  // Add group from toolbar state
  const [showAddGroupFromToolbar, setShowAddGroupFromToolbar] = useState(false);

  // Save group as template dialog state
  const [saveAsTemplateGroup, setSaveAsTemplateGroup] = useState<{ id: string; title: string } | null>(null);

  // Move-item dialog state. Split into two flows (v0.9.3.0):
  //   - moveItemToCategory: pick a category (or Uncategorised); item
  //     lands as standalone under that category.
  //   - moveItemToGroup: pick a group; item adopts the group's category.
  // Each opens independently so the user can pick one path from the
  // kebab without going through a chooser.
  const [moveItemToCategory, setMoveItemToCategory] = useState<{
    lineItemId: string;
    initialCategoryId?: string;
  } | null>(null);
  const [moveItemToGroup, setMoveItemToGroup] = useState<{
    lineItemId: string;
    initialGroupId?: string;
  } | null>(null);

  // EditLineItemDialog target — body owns its own form state + availability query.
  const [editLineItem, setEditLineItem] = useState<LineItemData | null>(null);
  // The clicked item's current placement — line items don't carry categoryId/groupId
  // directly (the tree position IS the placement), so each onEdit call site captures
  // it from the same closure the neighbouring onMoveToCategory/onMoveToGroup use.
  const [editLineItemPlacement, setEditLineItemPlacement] = useState<{
    categoryId?: string;
    groupId?: string;
  }>({});

  // Bulk-operations dialog state (act on the current multi-selection).
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkMoveGroupOpen, setBulkMoveGroupOpen] = useState(false);
  const [bulkMoveCategoryOpen, setBulkMoveCategoryOpen] = useState(false);

  // Group edit dialog state
  // EditGroupDialog target — body owns its own form state, keyed by group.id.
  const [editGroupData, setEditGroupData] = useState<GroupData | null>(null);

  // Category rename state
  const [renameCategoryId, setRenameCategoryId] = useState<string | null>(null);
  const [renameCategoryValue, setRenameCategoryValue] = useState("");

  // Expanded groups state
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  // All six equipment views come from the single native subscription.
  const categories = native.categories;
  const isLoading = native.isLoading;
  const uncategorizedItems = native.uncategorizedItems;
  const uncategorizedSubHireGroups = native.uncategorizedSubHireGroups;
  const uncategorizedProjectGroups = native.uncategorizedProjectGroups;

  // "Latest ref" hand-off to useEquipmentDnd (see that hook's file header and
  // the comment on its call above). Written in an effect (not during render —
  // react-hooks/refs correctly flags a bare `ref.current = x` in the render
  // body) so it still always holds the latest committed tree by the time any
  // subsequent drag-end callback reads it, which can only happen after this
  // render has committed and the rows are interactive.
  useEffect(() => {
    categoriesRef.current = categories;
    uncategorizedItemsRef.current = uncategorizedItems;
    uncategorizedProjectGroupsRef.current = uncategorizedProjectGroups;
    uncategorizedSubHireGroupsRef.current = uncategorizedSubHireGroups;
  }, [categories, uncategorizedItems, uncategorizedProjectGroups, uncategorizedSubHireGroups]);

  // Sub-hire item id -> full source row, built from both categorized and
  // uncategorized sub-hire groups' children. Inline edits on a sub-hire
  // GROUP CHILD row (handleInlineLineItemUpdate below) look up the current
  // full item here — updateSubHireItemNative is a full-replace mutation
  // (unlike patchNative's set/clear), so every other field needs to round-trip
  // unchanged alongside the one the cell actually edited. Declared before the
  // isLoading/isMobile early returns (and before handleInlineLineItemUpdate's
  // useCallback, which closes over it) so it's always initialized by the time
  // anything in this render could reference it.
  const subHireItemsById = useMemo(() => {
    const map = new Map<string, SubHireItemRowLike>();
    for (const g of [
      ...(categories as CategoryData[]).flatMap((c) => c.subHireGroupTargets ?? []),
      ...(uncategorizedSubHireGroups as SubHireGroupData[]),
    ]) {
      for (const it of g.items ?? []) map.set(it.id, it);
    }
    return map;
  }, [categories, uncategorizedSubHireGroups]);

  // ── Reassign: candidate same-model target lines for the per-unit picker, plus
  // the move handler. Built from the reconstructed tree so a unit can be moved to
  // any other line of its model on this project. The label carries the container
  // (category / group) so two same-model lines are distinguishable.
  const [reassignPendingUnitId, setReassignPendingUnitId] = useState<string | null>(null);
  const reassignTargetsByModel = React.useMemo(() => {
    const map = new Map<string, ReassignTarget[]>();
    const add = (line: LineItemData, context: string) => {
      // These scopes are already top-level (reconstruct excludes kit children).
      if (!line.modelId || line.isKitChild) return;
      const assigned = Math.max(line.units?.length ?? 0, line.asset?.assetTag ? 1 : 0);
      const label =
        line.description && line.description !== line.model?.name
          ? `${context} · ${line.description}`
          : context;
      const arr = map.get(line.modelId) ?? [];
      arr.push({ id: line.id, label, full: assigned >= (line.quantity ?? 0) });
      map.set(line.modelId, arr);
    };
    for (const cat of categories as CategoryData[]) {
      for (const li of cat.lineItems ?? []) add(li, cat.name);
      for (const g of cat.groups ?? []) for (const li of g.lineItems ?? []) add(li, `${cat.name} › ${g.title}`);
    }
    for (const li of uncategorizedItems as LineItemData[]) add(li, "Uncategorised");
    for (const g of uncategorizedProjectGroups as GroupData[]) for (const li of g.lineItems ?? []) add(li, g.title);
    return map;
  }, [categories, uncategorizedItems, uncategorizedProjectGroups]);

  const handleReassignUnit = useCallback(
    (unitId: string, targetLineItemId: string) => {
      setReassignPendingUnitId(unitId);
      warehouseWrites.reassignLineItemUnit(projectId, unitId, targetLineItemId)
        .then((res) => {
          if (res.moved) toast.success(`Moved ${res.assetTag ?? "unit"} to a different line`);
        })
        .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Couldn't reassign that unit"))
        .finally(() => setReassignPendingUnitId(null));
    },
    [projectId, warehouseWrites],
  );

  // Kit-member reassign (Phase 4): a member swaps its SERIAL (a same-model
  // AVAILABLE asset), not its line. Gather the models present as kit members, load
  // available inventory for just those models, and expose a serials-by-model map +
  // swap handler alongside the loose-gear line targets.
  const kitMemberModelIds = React.useMemo(() => {
    const ids = new Set<string>();
    const scan = (line: LineItemData) => {
      for (const c of line.childLineItems ?? []) {
        if (c.isKitChild && c.childKind !== "ACCESSORY" && c.modelId) ids.add(c.modelId);
      }
    };
    for (const cat of categories as CategoryData[]) {
      for (const li of cat.lineItems ?? []) scan(li);
      for (const g of cat.groups ?? []) for (const li of g.lineItems ?? []) scan(li);
    }
    for (const li of uncategorizedItems as LineItemData[]) scan(li);
    for (const g of uncategorizedProjectGroups as GroupData[]) for (const li of g.lineItems ?? []) scan(li);
    return [...ids];
  }, [categories, uncategorizedItems, uncategorizedProjectGroups]);

  const availableKitAssets = useAuthedQuery(
    api.assets.listByModelIds,
    orgId && kitMemberModelIds.length > 0 ? { orgId, modelIds: kitMemberModelIds } : "skip",
  );

  const reassignSerialsByModel = React.useMemo(() => {
    const map = new Map<string, ReassignSerial[]>();
    for (const a of availableKitAssets ?? []) {
      if (a.status !== "AVAILABLE" || a.isActive === false || !a.modelId || !a.assetTag) continue;
      const arr = map.get(a.modelId) ?? [];
      arr.push({ assetId: a.id, assetTag: a.assetTag });
      map.set(a.modelId, arr);
    }
    for (const arr of map.values()) arr.sort((x, y) => x.assetTag.localeCompare(y.assetTag));
    return map;
  }, [availableKitAssets]);

  const handleReassignKitMember = useCallback(
    (unitId: string, newAssetId: string) => {
      setReassignPendingUnitId(unitId);
      warehouseWrites.reassignKitMemberSerial(projectId, unitId, newAssetId)
        .then((res) => {
          if (res.moved) toast.success(`Swapped kit serial to ${res.toAssetTag ?? "the new asset"}`);
        })
        .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Couldn't swap that serial"))
        .finally(() => setReassignPendingUnitId(null));
    },
    [projectId, warehouseWrites],
  );

  const reassignValue = React.useMemo(
    () => ({
      targetsByModel: reassignTargetsByModel,
      reassign: handleReassignUnit,
      pendingUnitId: reassignPendingUnitId,
      serialsByModel: reassignSerialsByModel,
      reassignKitMember: handleReassignKitMember,
    }),
    [reassignTargetsByModel, handleReassignUnit, reassignPendingUnitId, reassignSerialsByModel, handleReassignKitMember],
  );
  const overbookedMap = native.overbookedMap;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const projectSubHires = native.projectSubHires as any[];

  const { data: templates = [] } = useGroupTemplates(orgId);
  const templateWrites = useGroupTemplateWrites();

  const { data: servicesData } = useProjectServices(projectId);

  const templateOptions = templates.map(
    (t) => ({ id: t.id, name: t.name, description: t.description, itemCount: t.items.length })
  );

  // (groupWrites / categorySlotWrites / categoryWrites / lineItemWrites /
  // subHireWrites / invalidate are declared earlier in this component, above
  // `native` — useEquipmentDnd needs all but subHireWrites before native's
  // orderOverlay/groupOrderOverlay/categoryOrderOverlay can be computed. See
  // that block's comment.)

  // Optimistic delete: a removed row vanishes from the list INSTANTLY (instead of
  // lingering until the server round-trip + the reactive refetch land). The id is
  // rolled back on error (row reappears) and pruned once the refetch confirms the
  // deletion. Bridges the gap between the mutation and the live refresh.
  const [pendingRemovalIds, setPendingRemovalIds] = useState<ReadonlySet<string>>(() => new Set());

  // ─── Mutations ───────────────────────────────────────────────────────────

  const createCategoryMut = useServerMutation({
    mutationFn: (name: string) => categoryWrites.create(projectId, name),
    onSuccess: () => {
      invalidate();
      setShowAddCategory(false);
      toast.success("Category created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const renameCategoryMut = useServerMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => categoryWrites.update(id, name),
    onSuccess: () => {
      invalidate();
      setRenameCategoryId(null);
      toast.success("Category renamed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteCategoryMut = useServerMutation({
    mutationFn: (id: string) => categoryWrites.remove(id),
    onSuccess: () => {
      invalidate();
      toast.success("Category deleted — items moved to uncategorized");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const moveLineItemMut = useServerMutation({
    mutationFn: ({ lineItemId, targetGroupId, targetCategoryId }: {
      lineItemId: string;
      targetGroupId: string | null;
      targetCategoryId: string | null;
    }) => groupWrites.moveLineItem({ lineItemId, targetGroupId, targetCategoryId }),
    onSuccess: () => {
      invalidate();
      // Close whichever dialog drove this mutation. Cheap to call
      // both setters — only the one with state actually re-renders.
      setMoveItemToCategory(null);
      setMoveItemToGroup(null);
      toast.success("Item moved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Browser-direct native path. patchNative re-checks availability (on qty increase) +
  // recalcs + audits + emits the collab feed atomically. NOTE: it has no baseUpdatedAt
  // stale-revision guard (the server action's optimistic-concurrency check) — edit
  // locks remain the first line of defence. Reactive useQuery renders the updated row.
  // Shared by the full edit dialog AND inline cell edits below — one write path,
  // two entry points (POLICY.md R-3.1).
  const updateLineItemMutationFn = ({ id, data, allowOverbook }: { id: string; data: Record<string, unknown>; allowOverbook?: boolean; baseUpdatedAt?: string | number | null }) => {
    if (!lineItemWrites.enabled) throw new Error("Not ready — try again in a moment.");
    const parsed = lineItemSchema.parse(data);
    const { set, clear } = buildLineItemSetClear(parsed);
    return lineItemWrites.update(id, set, clear, {
      entityName: parsed.description || "Line item",
      allowOverbook: allowOverbook ?? false,
    });
  };

  const updateLineItemMut = useServerMutation({
    mutationFn: updateLineItemMutationFn,
    onSuccess: (_r: unknown, { id }: { id: string }) => {
      invalidate();
      // Drop the optimistic overlay — the reactive bundle now carries the server value.
      clearPendingEdit(id);
      setEditLineItem(null);
      toast.success("Item updated");
    },
    onError: (e: Error, { id }: { id: string }) => {
      // Rollback: remove the overlay so the row reverts to the server state.
      clearPendingEdit(id);
      toast.error(e.message);
    },
  });

  // Same write as updateLineItemMut, minus the dialog-close/success-toast side
  // effects — a table cell already shows its own save state, and the row's
  // `justChanged` flash (equipment-rows.tsx, on `updatedAt` changing) is
  // feedback enough. Errors still toast, EXCEPT `INSUFFICIENT_STOCK` — that
  // one is a quantity overbook, which `InlineEditableQuantity` handles itself
  // via its own confirm-and-retry step; toasting it here too would just be a
  // redundant, less actionable copy of the same message.
  const updateLineItemInlineMut = useServerMutation({
    mutationFn: updateLineItemMutationFn,
    onSuccess: (_r: unknown, { id }: { id: string }) => {
      invalidate();
      clearPendingEdit(id);
    },
    onError: (e: Error, { id }: { id: string }) => {
      clearPendingEdit(id);
      const isOverbook =
        e instanceof ConvexError &&
        typeof e.data === "object" &&
        e.data !== null &&
        (e.data as { code?: unknown }).code === "INSUFFICIENT_STOCK";
      if (!isOverbook) toast.error(e.message);
    },
  });

  // Inline (click-to-edit, save-on-blur) cell edits — equipment-rows.tsx's
  // `onInlineUpdate`. Builds the exact same payload the full edit dialog
  // would (computeInlineLineItemPayload -> computeEditLineItemPayload), just
  // for a single changed field, and runs it through the identical
  // update/optimistic-overlay path. A "quantity" patch carries its own
  // `allowOverbook` (false on the first attempt, true only on a confirmed
  // retry from `InlineEditableQuantity`'s overbook prompt) — every other
  // field never touches availability, so `allowOverbook: false` is always
  // correct for them.
  const handleInlineLineItemUpdate = useCallback(
    (item: LineItemData, patch: InlineLineItemPatch) => {
      if (item.subHireGroupId != null) {
        // Sub-hire GROUP CHILD — routes through updateSubHireItemNative
        // (keyed by the SOURCE subHireItems row, not the derived line's own
        // id), never patchNative. A direct patchNative edit would silently
        // vanish the next time anything in that sub-hire order changes
        // (regenerateSubHireLines deletes + recreates every derived line).
        // equipment-rows.tsx only ever sends description/notes/unitPrice/
        // discountPercent patches for these rows, never the $/% "discount"
        // variant — see InlineSubHireItemPatch.
        const subHireItemId = item.subHireItemId;
        const source = subHireItemId ? subHireItemsById.get(subHireItemId) : undefined;
        if (!subHireItemId || !source) {
          const err = new Error("This item's sub-hire data hasn't loaded yet — try again in a moment.");
          toast.error(err.message);
          return Promise.reject(err);
        }
        const input = computeInlineSubHireItemInput(source, patch as InlineSubHireItemPatch);
        return subHireWrites
          .updateItem(subHireItemId, input)
          .then(() => invalidate())
          .catch((e: Error) => {
            toast.error(e.message);
            throw e;
          });
      }

      const payload = computeInlineLineItemPayload(item, patch as Exclude<InlineLineItemPatch, { field: "discountPercent" }>);
      setPendingEdits((prev) => {
        const next = new Map(prev);
        next.set(item.id, {
          quantity: payload.quantity,
          unitPrice: payload.unitPrice,
          discount: payload.discount,
          description: payload.description,
          notes: payload.notes,
          lineTotal: computeLineTotal(payload.unitPrice, payload.quantity, payload.duration, payload.discount),
        });
        return next;
      });
      const baseUpdatedAt =
        item.updatedAt instanceof Date ? item.updatedAt.toISOString() : (item.updatedAt ?? null);
      return updateLineItemInlineMut.mutateAsync({
        id: item.id,
        data: payload as unknown as Record<string, unknown>,
        allowOverbook: patch.field === "quantity" ? patch.allowOverbook : false,
        baseUpdatedAt,
      });
    },
    [updateLineItemInlineMut, subHireWrites, subHireItemsById, invalidate],
  );

  // Inline cost/charge cells on a sub-hire GROUP's own row (SubHireGroupRow)
  // — the same updateGroup call PriceEditDialog's sub-hire branch uses
  // (price-edit-dialog.tsx), just triggered per-cell instead of via the
  // dialog. title/quantity resend unchanged (updateGroupNative full-replaces
  // those); cost/charge are set-or-clear (omitted = left alone), so only the
  // one changed field needs to be passed. Not lock-gated — the sub-hire
  // group mutation never checks the project financial lock, matching
  // PriceEditDialog's existing (also ungated) sub-hire branch.
  const handleInlineSubHireGroupPriceUpdate = useCallback(
    (group: SubHireGroupData, patch: { cost?: number | null; charge?: number | null }) =>
      subHireWrites
        .updateGroup(group.id, {
          title: group.title,
          quantity: group.quantity,
          ...(patch.cost !== undefined ? { cost: patch.cost } : {}),
          ...(patch.charge !== undefined ? { charge: patch.charge } : {}),
        })
        .then(() => invalidate())
        .catch((e: Error) => {
          toast.error(e.message);
          throw e;
        }),
    [subHireWrites, invalidate],
  );

  // Inline price/discount cells on a regular PROJECT group's own row
  // (GroupRow) — the same updateGroupPriceNative call PriceEditDialog's
  // project branch / EditGroupDialog make. Unlike the sub-hire group's
  // updateGroup, this mutation IS financial-lock-gated server-side (see
  // GroupInlinePricePatch's doc comment), so GroupRow wraps these cells in
  // <LockedField>. `price` is always-required/full-replace (resend the
  // current value when only discount changed); `discount`/`discountMode` are
  // set-or-clear-when-provided (resend the current price, omit discount
  // entirely, when only price changed) — mirrors EditGroupDialog's own
  // handleSave, which has this exact same "clearing the discount input
  // doesn't actually clear a stored discount" characteristic already
  // (resolveDiscountAmount returns undefined for a blank field, and
  // undefined = "leave untouched" server-side, not "clear").
  const handleInlineGroupPriceUpdate = useCallback(
    (group: GroupData, patch: GroupInlinePricePatch) => {
      const currentPrice = group.price != null ? Number(group.price) : 0;
      const call =
        patch.field === "price"
          ? groupWrites.updatePrice(group.id, patch.value ?? 0)
          : groupWrites.updatePrice(group.id, currentPrice, patch.value, patch.discountMode);
      return call.then(() => invalidate()).catch((e: Error) => {
        toast.error(e.message);
        throw e;
      });
    },
    [groupWrites, invalidate],
  );

  const removeMut = useServerMutation({
    mutationFn: async (id: string) => {
      // Browser-direct native path. removeNative applies the child-guard + cascade
      // (children + units) + recalc + audit + collab atomically. Result unused (onSuccess
      // just invalidates), so it resolves void. Routed through `useJustifiedMutation`
      // (#990) — prompts for a reason first when the project is ON_SITE+ with no
      // open unlock session, instead of firing straight into a server rejection.
      if (!lineItemWrites.enabled) throw new Error("Not ready — try again in a moment.");
      await justifiedRemoveLineItem.run({ id });
    },
    onSuccess: () => {
      invalidate();
      toast.success("Item removed");
    },
    onError: (e: Error, id: string) => {
      // Rollback the optimistic hide so the row reappears.
      setPendingRemovalIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast.error(e.message);
    },
  });

  // Optimistically hide the row, then fire the delete. Every row's onRemove uses this.
  const handleRemoveItem = useCallback(
    (id: string) => {
      setPendingRemovalIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      removeMut.mutate(id);
    },
    [removeMut],
  );

  // ─── Bulk mutations (operate on the current multi-selection) ───────────────

  const bulkDeleteMut = useServerMutation({
    mutationFn: (ids: string[]) => {
      if (!lineItemWrites.enabled) throw new Error("Not ready — try again in a moment.");
      return justifiedRemoveLineItems.run({ ids });
    },
    onSuccess: (r: { removed: number; skipped: number }) => {
      invalidate();
      selection.clearSelection();
      setBulkDeleteOpen(false);
      toast.success(
        `Removed ${r.removed} item${r.removed === 1 ? "" : "s"}` +
          (r.skipped ? ` (${r.skipped} skipped — kit/accessory children)` : ""),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkEditMut = useServerMutation({
    mutationFn: ({ ids, patch }: { ids: string[]; patch: BulkLineItemPatch }) => {
      if (!lineItemWrites.enabled) throw new Error("Not ready — try again in a moment.");
      return lineItemWrites.updateMany(ids, patch);
    },
    onSuccess: (r: { updated: number; skipped: number }) => {
      invalidate();
      selection.clearSelection();
      setBulkEditOpen(false);
      toast.success(`Updated ${r.updated} item${r.updated === 1 ? "" : "s"}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkMoveMut = useServerMutation({
    mutationFn: ({
      ids,
      targetGroupId,
      targetCategoryId,
    }: {
      ids: string[];
      targetGroupId: string | null;
      targetCategoryId: string | null;
    }) => groupWrites.moveLineItems({ lineItemIds: ids, targetGroupId, targetCategoryId }),
    onSuccess: (r: { moved: number; skipped: number }) => {
      invalidate();
      selection.clearSelection();
      setBulkMoveGroupOpen(false);
      setBulkMoveCategoryOpen(false);
      toast.success(`Moved ${r.moved} item${r.moved === 1 ? "" : "s"}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // No prune needed: a successfully-removed id simply stops matching any rendered
  // row (the refetch drops it). ids are cuids (never reused), so a retained dead id
  // is a harmless no-op in the filters — and skipping a prune effect avoids a
  // setState-in-effect cascading render. The set only grows within a mounted
  // session and resets on navigation.


  const saveAsTemplateMut = useServerMutation({
    mutationFn: ({ groupId, name, description }: { groupId: string; name: string; description?: string }) =>
      templateWrites.saveGroupAsTemplate(groupId, name, description),
    onSuccess: (t: { name?: string }) => {
      const name = t?.name ?? "Template";
      toast.success(`Saved as template "${name}"`);
      setSaveAsTemplateGroup(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createGroupMut = useServerMutation({
    mutationFn: async ({ categoryId, title, templateId }: { categoryId: string | null; title: string; templateId?: string }) => {
      if (templateId) {
        // Templates are category-scoped concepts — fall back to no-template
        // when the user picks Uncategorised so they can still create the
        // group structurally. The template can be applied via a follow-up
        // move + recalculate if they later want to materialise its items.
        if (!categoryId) {
          await groupWrites.create(projectId, null, title);
          return;
        }
        const tpl = templates.find((t) => t.id === templateId);
        await templateWrites.applyTemplate({
          templateId,
          projectId,
          categoryId,
          title,
          items: (tpl?.items ?? []).map((it) => ({
            modelId: it.modelId,
            kitId: it.kitId,
            quantity: it.quantity,
          })),
        });
        return;
      }
      await groupWrites.create(projectId, categoryId, title);
    },
    onSuccess: () => {
      invalidate();
      toast.success("Group created");
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const deleteGroupMut = useServerMutation({
    mutationFn: (groupId: string) => justifiedRemoveGroup.run({ groupId }),
    onSuccess: () => {
      invalidate();
      setDeleteGroupId(null);
      setDeleteGroupInfo(null);
      toast.success("Group deleted — items moved to standalone");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateGroupMut = useServerMutation({
    mutationFn: ({ groupId, data }: { groupId: string; data: Partial<{ title: string; description: string; quantity: number; xeroAccountCode: string; xeroTaxType: string }> }) =>
      groupWrites.update(groupId, data),
    onSuccess: () => {
      invalidate();
      setEditGroupData(null);
      toast.success("Group updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Category reordering is real drag-and-drop too (useEquipmentDnd, rendered
  // rows wrapped in SortableCategoryRow below) — the old ▲/▼ moveCategory
  // swap-with-neighbour helper is fully superseded.
  //
  // Group (project group + sub-hire group) reordering AND cross-category
  // moves are now real drag-and-drop too (useEquipmentDnd, rendered rows
  // wrapped in SortableGroupRow/SortableSubHireGroupRow below) — the old
  // ▲/▼ moveGroupSlot swap-with-neighbour helper (which branched between
  // groupWrites.reorder and categorySlotWrites.reorderMixed the same way
  // useEquipmentDnd's runGroupReorder now does) is fully superseded.
  //
  // Line-item reordering is real drag-and-drop too (useEquipmentDnd,
  // rendered rows wrapped in SortableLineItemRow below) — the old ▲/▼
  // moveLineItemInList swap-with-neighbour helper is fully superseded.

  // ─── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-16" />
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-28" />
          <div className="flex-1" />
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="overflow-hidden rounded-[var(--r-lg)] border border-line">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-line px-4 py-3 last:border-b-0">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const typedCategories = categories as CategoryData[];
  const hasCategories = typedCategories.length > 0;
  const orphanSubHireGroups = uncategorizedSubHireGroups as SubHireGroupData[];
  const orphanProjectGroups = uncategorizedProjectGroups as GroupData[];
  const hasUncategorized =
    (uncategorizedItems as LineItemData[]).length > 0 ||
    orphanSubHireGroups.length > 0 ||
    orphanProjectGroups.length > 0;

  // Build a set of draft sub-hire IDs so we can badge unconfirmed items
  const draftSubHireIds = new Set<string>();
  for (const sh of projectSubHires) {
    if (sh.status === "DRAFT") draftSubHireIds.add(sh.id as string);
  }

  // Build flat list of all line-item IDs in visual order. Used by
  // shift-click range selection (handleRowClick). Walks each category's
  // mixed group list in canonical (CategorySlot) order. Falls back to
  // cat.groups when mixedGroups isn't present (e.g. an HMR-stale cache).
  const allSortableIds: string[] = [];
  for (const cat of typedCategories) {
    allSortableIds.push(`cat-${cat.id}`);
    const mixed: MixedGroupSlot[] = cat.mixedGroups ?? cat.groups.map((g) => ({
      kind: "project" as const,
      sortOrder: g.sortOrder,
      projectGroupId: g.id,
    }));
    for (const slot of mixed) {
      if (slot.kind === "project") {
        allSortableIds.push(`grp-${slot.projectGroupId}`);
        const group = cat.groups.find((g) => g.id === slot.projectGroupId);
        if (group && expandedGroups.has(group.id)) {
          for (const item of group.lineItems ?? []) {
            if (!isRealKitChild(item as LineItemData)) allSortableIds.push(`li-${item.id}`);
          }
        }
      } else if (slot.kind === "subHire") {
        allSortableIds.push(`shg-${slot.subHireGroupId}`);
      } else {
        allSortableIds.push(`li-${slot.lineItemId}`);
      }
    }
  }
  for (const item of uncategorizedItems as LineItemData[]) {
    if (!isRealKitChild(item)) allSortableIds.push(`li-${item.id}`);
  }
  for (const shGroup of orphanSubHireGroups) {
    allSortableIds.push(`shg-${shGroup.id}`);
  }

  const handleRowClick = (id: string, e: React.MouseEvent) => {
    const sortableId = `li-${id}`;
    if (e.metaKey || e.ctrlKey) {
      selection.toggle(sortableId, true);
    } else if (e.shiftKey) {
      const liIds = allSortableIds.filter((sid) => sid.startsWith("li-"));
      selection.selectTo(sortableId, liIds);
    } else {
      selection.select(sortableId);
    }
  };

  // ─── Bulk-selection derived state ──────────────────────────────────────────
  // Every selectable line item's sortable key, and the plain cuids of the ones
  // currently selected (the payload for the bulk server actions).
  const allLiSortableIds = allSortableIds.filter((sid) => sid.startsWith("li-"));
  const selectedLineItemIds = allLiSortableIds
    .filter((sid) => selection.isSelected(sid))
    .map((sid) => sid.slice(3));
  const allLiSelected =
    allLiSortableIds.length > 0 && selectedLineItemIds.length === allLiSortableIds.length;
  const someLiSelected = selectedLineItemIds.length > 0;

  const toggleSelectAll = () => {
    if (allLiSelected) selection.clearSelection();
    else selection.selectAll(allLiSortableIds);
  };

  // Checkbox on a line-item row: shift extends a range, otherwise toggle one.
  const handleSelectChange = (itemId: string, _checked: boolean, shiftKey: boolean) => {
    const sortableId = `li-${itemId}`;
    if (shiftKey) selection.selectTo(sortableId, allLiSortableIds);
    else selection.toggle(sortableId, true);
  };

  // Primary "Add ▾" menu (item / group / category). The three add actions reuse
  // the exact handlers the old three buttons triggered (UnifiedAddDialog,
  // AddGroupToolbarDialog, AddCategoryDialog) — no behaviour change. Rendered
  // either inline in the in-panel toolbar (fallback) or portalled onto the tab
  // row when the page supplies `addMenuSlot`.
  // #990 (surface 4) — at HARD_LOCKED, every add path is rejected server-side
  // (`assertLifecycleGuard` has no per-edit path at this tier, only a FULL
  // unlock session), so the menu itself is gated rather than opening onto
  // three dead end items. `GatedButton` replaces the `DropdownMenuTrigger`
  // entirely here (a gated trigger can't compose with Radix's `asChild` Slot,
  // which needs a single plain element, not `GatedButton`'s own Tooltip wrap).
  const addMenu = hardLocked ? (
    <GatedButton
      size="sm"
      className="gap-1.5"
      gated
      reason={lockReason}
      exitLabel="Open full unlock session"
      onExit={scrollToLockStrip}
    >
      <Plus className="h-3.5 w-3.5" />
      Add
      <ChevronDownIcon className="h-3 w-3" />
    </GatedButton>
  ) : (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add
          <ChevronDownIcon className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => {
            setUnifiedAddTarget({});
            setShowUnifiedAdd(true);
          }}
        >
          <Plus className="mr-2 h-3.5 w-3.5" />
          Add item
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setShowAddGroupFromToolbar(true)}>
          <FolderPlus className="mr-2 h-3.5 w-3.5" />
          Add group
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setShowAddCategory(true)}>
          <FolderTree className="mr-2 h-3.5 w-3.5" />
          Add category
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <ReassignProvider value={reassignValue}>
    <div className="space-y-3" data-shortcut-scope="equipment">
      {/* Add ▾ goes on the tab row when a slot is supplied; otherwise it stays
          inline in this toolbar. The quiet margin toggle always stays here. */}
      {addMenuSlot ? createPortal(addMenu, addMenuSlot) : null}
      <div className="flex items-center gap-2">
        {!addMenuSlot && addMenu}
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={showCostColumn}
          onClick={toggleShowCostColumn}
          title="Toggle the supplier-cost column so margin is visible at a glance"
        >
          {showCostColumn ? "Hide margin" : "Show margin"}
        </Button>
      </div>

      {/* Empty state */}
      {!hasCategories && !hasUncategorized && (
        <div className="rounded-[var(--r-lg)] border-2 border-dashed border-line-2 py-12 text-center">
          <p className="text-ui-text font-medium text-ink-2">Nothing on the quote yet</p>
          <p className="mx-auto mt-1 max-w-sm text-caption text-muted">
            Add gear, kits, or a sub-hire — or create a category (RF, IEM, PA) to organise the build.
          </p>
        </div>
      )}

      {/* Bulk action bar — appears once one or more line items are selected. */}
      <BulkActionBar
        count={selectedLineItemIds.length}
        onClear={selection.clearSelection}
      >
        <Button size="sm" variant="line" onClick={() => setBulkEditOpen(true)}>
          <Pencil className="mr-2 h-3 w-3" />
          Edit
        </Button>
        <Button size="sm" variant="line" onClick={() => setBulkMoveGroupOpen(true)}>
          <ArrowLeftRight className="mr-2 h-3 w-3" />
          Move to group
        </Button>
        <Button size="sm" variant="line" onClick={() => setBulkMoveCategoryOpen(true)}>
          <FolderTree className="mr-2 h-3 w-3" />
          Move to category
        </Button>
        <Button
          size="sm"
          variant="line"
          className="text-destructive"
          onClick={() => setBulkDeleteOpen(true)}
        >
          <Trash2 className="mr-2 h-3 w-3" />
          Delete
        </Button>
      </BulkActionBar>

      {/* Equipment list. Desktop renders the full data table; below md the rows
          self-branch into stacked cards (§15) — same data, same handlers, no
          StickyTable and no horizontal scroll. The row map is built once and
          rendered in whichever shell matches the breakpoint, so the live per-row
          subscriptions aren't duplicated across two DOM trees. */}
      {(hasCategories || hasUncategorized) && (() => {
        const equipmentRows = (
          <>
                {/* Top-level category reorder — ONE SortableContext for the
                    whole project's category list (useEquipmentDnd's
                    resolveCategoryDragAction; single "categories" container,
                    top-level reorder only — categories don't nest into
                    anything and nothing nests INTO a category via a
                    "category drag", see that function's doc comment). */}
                <SortableContext
                  items={typedCategories.map((cat) => `cat-${cat.id}`)}
                  strategy={verticalListSortingStrategy}
                >
                {typedCategories.map((cat) => {
                  const standaloneItems = (cat.lineItems ?? []).filter((i: LineItemData) => !isHiddenFromList(i) && !pendingRemovalIds.has(i.id));
                  const mixedSlots: MixedGroupSlot[] = cat.mixedGroups ?? cat.groups.map<MixedGroupSlot>((g) => ({
                    kind: "project" as const,
                    sortOrder: g.sortOrder,
                    projectGroupId: g.id,
                  }));

                  return (
                    <React.Fragment key={cat.id}>
                      {/* Category label row */}
                      <SortableCategoryRow
                        sortableId={`cat-${cat.id}`}
                        containerId="categories"
                        dragDisabled={!canDragEquipment}
                        cat={cat}
                        columnCount={colCount}
                        onRename={() => {
                          setRenameCategoryId(cat.id);
                          setRenameCategoryValue(cat.name);
                        }}
                        onDelete={() => deleteCategoryMut.mutate(cat.id)}
                        onAddEquipment={() => {
                          setUnifiedAddTarget({ categoryId: cat.id, label: cat.name });
                          setUnifiedAddKind("own-stock");
                          setShowUnifiedAdd(true);
                        }}
                        onAddKit={() => {
                          setUnifiedAddTarget({ categoryId: cat.id, label: cat.name });
                          setUnifiedAddKind("kit");
                          setShowUnifiedAdd(true);
                        }}
                        onAddCustom={() => {
                          setUnifiedAddTarget({ categoryId: cat.id, label: cat.name });
                          setUnifiedAddKind("custom");
                          setShowUnifiedAdd(true);
                        }}
                      />

                      {/* Combined top-level list within category (CategorySlot order;
                          falls back to cat.groups when mixedGroups hasn't been computed).
                          ONE SortableContext for the whole interleaved
                          project-group + sub-hire-group + standalone-line-item
                          list — a drag can reorder within it (groups and line
                          items freely rearranged against each other) or move a
                          group/item out to another category/Uncategorized
                          (useEquipmentDnd's resolveGroupDragAction /
                          resolveLineItemDragAction; container id `mixed:{cat.id}`
                          for both). */}
                      <SortableContext
                        items={mixedSlots.map((slot) =>
                          slot.kind === "project" ? `grp-${slot.projectGroupId}`
                          : slot.kind === "subHire" ? `shg-${slot.subHireGroupId}`
                          : `li-${slot.lineItemId}`,
                        )}
                        strategy={verticalListSortingStrategy}
                      >
                      {mixedSlots.map((slot) => {
                        if (slot.kind === "lineItem") {
                          const item = standaloneItems.find((i) => i.id === slot.lineItemId);
                          if (!item) return null;
                          return (
                            <SortableLineItemRow
                              key={item.id}
                              sortableId={`li-${item.id}`}
                              containerId={`mixed:${cat.id}`}
                              dragDisabled={!canDragEquipment}
                              item={item}
                              indent="ml-3"
                              orgId={orgId}
                              projectId={projectId}
                              markerByTarget={markerByTarget}
                              overbookedInfo={item.subHireId != null ? undefined : (overbookedMap as Record<string, OverbookedInfo>)[item.id]}
                              isUnconfirmed={!!item.subHireId && draftSubHireIds.has(item.subHireId)}
                              showCostColumn={showCostColumn}
                              isExpanded={expandedParents.has(item.id)}
                              isSelected={selection.isSelected(`li-${item.id}`)}
                              selectable={!item.isKitChild}
                              selectionActive={someLiSelected}
                              onSelectChange={(checked, shiftKey) => handleSelectChange(item.id, checked, shiftKey)}
                              onClick={(e) => handleRowClick(item.id, e)}
                              onToggle={() => toggleParent(item.id)}
                              onEdit={() => {
                                setEditLineItemPlacement({ categoryId: cat.id });
                                setEditLineItem(item);
                              }}
                              onMoveToCategory={() => setMoveItemToCategory({
                                lineItemId: item.id,
                                initialCategoryId: cat.id,
                              })}
                              onMoveToGroup={() => setMoveItemToGroup({
                                lineItemId: item.id,
                              })}
                              onRemove={() => handleRemoveItem(item.id)}
                              onInlineUpdate={handleInlineLineItemUpdate}
                              moneyLocked={moneyLocked}
                              lockReason={lockReason}
                              onUnlockExit={scrollToLockStrip}
                            />
                          );
                        }
                        if (slot.kind === "subHire") {
                          const shGroup = (cat.subHireGroupTargets ?? []).find(
                            (g: SubHireGroupData) => g.id === slot.subHireGroupId,
                          );
                          if (!shGroup) return null;
                          const isExpanded = expandedGroups.has(shGroup.id);
                          // Synthetic parent line item — its childLineItems are
                          // the kit-style children rendered on expand.
                          const parentLi = (shGroup.lineItems ?? [])[0];
                          const childItems = (parentLi?.childLineItems ?? []) as LineItemData[];
                          return (
                            <React.Fragment key={`shg-${shGroup.id}`}>
                              <SortableSubHireGroupRow
                                sortableId={`shg-${shGroup.id}`}
                                containerId={`mixed:${cat.id}`}
                                dragDisabled={!canDragEquipment}
                                group={shGroup}
                                isExpanded={isExpanded}
                                showCostColumn={showCostColumn}
                                indented
                                onToggle={() => toggleGroup(shGroup.id)}
                                onEdit={() => {
                                  setManagingSubHireId(shGroup.subHire.id);
                                  setShowSubHireOrderDialog(true);
                                }}
                                onEditPrice={() => setPriceEditTarget({
                                  kind: "subHire",
                                  groupId: shGroup.id,
                                  title: shGroup.title,
                                  quantity: shGroup.quantity,
                                  cost: shGroup.cost != null ? Number(shGroup.cost) : null,
                                  charge: shGroup.charge != null ? Number(shGroup.charge) : null,
                                })}
                                onMove={() => setMoveSubHireGroup({ id: shGroup.id, title: shGroup.title })}
                                onInlinePriceUpdate={handleInlineSubHireGroupPriceUpdate}
                              />
                              {isExpanded && childItems.length === 0 && (
                                isMobile ? (
                                  <p className="px-3 py-2 text-caption text-muted">No items in this sub-hire group yet.</p>
                                ) : (
                                  <TableRow className="hover:bg-transparent">
                                    <TableCell colSpan={colCount} className="py-3 text-center text-caption text-muted">
                                      No items in this sub-hire group yet.
                                    </TableCell>
                                  </TableRow>
                                )
                              )}
                              {isExpanded && childItems.map((item) => (
                                <LineItemRow
                                  key={item.id}
                                  item={item}
                                  indent="ml-12"
                                  markerByTarget={markerByTarget}
                                  overbookedInfo={undefined}
                                  isUnconfirmed={!!shGroup.subHire && draftSubHireIds.has(shGroup.subHire.id)}
                                  showCostColumn={showCostColumn}
                                  isExpanded={expandedParents.has(item.id)}
                                  isDragDisabled
                                  onToggle={() => toggleParent(item.id)}
                                  onEdit={() => {
                                    setManagingSubHireId(shGroup.subHire.id);
                                    setShowSubHireOrderDialog(true);
                                  }}
                                  onMoveToCategory={() => {
                                    setManagingSubHireId(shGroup.subHire.id);
                                    setShowSubHireOrderDialog(true);
                                  }}
                                  onMoveToGroup={() => {
                                    setManagingSubHireId(shGroup.subHire.id);
                                    setShowSubHireOrderDialog(true);
                                  }}
                                  onRemove={() => handleRemoveItem(item.id)}
                                  onInlineUpdate={handleInlineLineItemUpdate}
                                />
                              ))}
                            </React.Fragment>
                          );
                        }
                        const group = cat.groups.find((g) => g.id === slot.projectGroupId);
                        if (!group) return null;
                        const isExpanded = expandedGroups.has(group.id);
                        const priceVal = group.price != null ? Number(group.price) : null;
                        const groupItems = (group.lineItems ?? []).filter((i: LineItemData) => !isHiddenFromList(i) && !pendingRemovalIds.has(i.id));
                        return (
                          <React.Fragment key={group.id}>
                            <SortableGroupRow
                              sortableId={`grp-${group.id}`}
                              containerId={`mixed:${cat.id}`}
                              dragDisabled={!canDragEquipment}
                              group={group}
                              isExpanded={isExpanded}
                              indented
                              orgId={orgId}
                              projectId={projectId}
                              commentBadge={{
                                open: commentCounts?.[group.id]?.open ?? 0,
                                blocking: commentCounts?.[group.id]?.blockingOpen ?? 0,
                              }}
                              showCostColumn={showCostColumn}
                              onToggle={() => toggleGroup(group.id)}
                              onDelete={() => {
                                setDeleteGroupId(group.id);
                                setDeleteGroupInfo({
                                  title: group.title,
                                  price: priceVal ?? 0,
                                  itemCount: groupItems.length,
                                });
                              }}
                              onEdit={() => setEditGroupData(group)}
                              onEditPrice={() => setPriceEditTarget({
                                kind: "project",
                                groupId: group.id,
                                title: group.title,
                                quantity: group.quantity,
                                price: priceVal,
                                discount: group.discount != null ? Number(group.discount) : null,
                                discountMode: group.discountMode ?? null,
                              })}
                              onAddEquipment={() => {
                                setUnifiedAddTarget({ categoryId: cat.id, groupId: group.id, label: `${cat.name} > ${group.title}` });
                                setUnifiedAddKind("own-stock");
                                setShowUnifiedAdd(true);
                              }}
                              onAddKit={() => {
                                setUnifiedAddTarget({ categoryId: cat.id, groupId: group.id, label: `${cat.name} > ${group.title}` });
                                setUnifiedAddKind("kit");
                                setShowUnifiedAdd(true);
                              }}
                              onSaveAsTemplate={() => setSaveAsTemplateGroup({ id: group.id, title: group.title })}
                              onMove={() => setMoveProjectGroup({ id: group.id, title: group.title })}
                              onInlinePriceUpdate={handleInlineGroupPriceUpdate}
                              moneyLocked={moneyLocked}
                              lockReason={lockReason}
                              onUnlockExit={scrollToLockStrip}
                            />
                            {/* Expanded line items */}
                            {isExpanded && groupItems.length === 0 && (
                              isMobile ? (
                                <p className="px-3 py-2 text-caption text-muted">No items in this group yet. Add equipment to get started.</p>
                              ) : (
                                <TableRow className="hover:bg-transparent">
                                  <TableCell colSpan={colCount} className="py-3 text-center text-caption text-muted">
                                    No items in this group yet. Add equipment to get started.
                                  </TableCell>
                                </TableRow>
                              )
                            )}
                            <SortableContext
                              items={groupItems.map((item) => `li-${item.id}`)}
                              strategy={verticalListSortingStrategy}
                            >
                              {isExpanded && groupItems.map((item) => (
                                <SortableLineItemRow
                                  key={item.id}
                                  sortableId={`li-${item.id}`}
                                  containerId={`items:${group.id}`}
                                  dragDisabled={!canDragEquipment}
                                  item={item}
                                  indent="ml-12"
                                  orgId={orgId}
                                  projectId={projectId}
                                  markerByTarget={markerByTarget}
                                  overbookedInfo={item.subHireId != null ? undefined : (overbookedMap as Record<string, OverbookedInfo>)[item.id]}
                                  isUnconfirmed={!!item.subHireId && draftSubHireIds.has(item.subHireId)}
                                  showCostColumn={showCostColumn}
                                  isExpanded={expandedParents.has(item.id)}
                                  isSelected={selection.isSelected(`li-${item.id}`)}
                                  selectable={!item.isKitChild}
                                  selectionActive={someLiSelected}
                                  onSelectChange={(checked, shiftKey) => handleSelectChange(item.id, checked, shiftKey)}
                                  onClick={(e) => handleRowClick(item.id, e)}
                                  onToggle={() => toggleParent(item.id)}
                                  onEdit={() => {
                                    setEditLineItemPlacement({ categoryId: cat.id, groupId: group.id });
                                    setEditLineItem(item);
                                  }}
                                  onMoveToCategory={() => setMoveItemToCategory({
                                    lineItemId: item.id,
                                    initialCategoryId: cat.id,
                                  })}
                                  onMoveToGroup={() => setMoveItemToGroup({
                                    lineItemId: item.id,
                                    initialGroupId: group.id,
                                  })}
                                  onRemove={() => handleRemoveItem(item.id)}
                                  onInlineUpdate={handleInlineLineItemUpdate}
                                  moneyLocked={moneyLocked}
                                  lockReason={lockReason}
                                  onUnlockExit={scrollToLockStrip}
                                />
                              ))}
                            </SortableContext>
                          </React.Fragment>
                        );
                      })}
                      </SortableContext>
                    </React.Fragment>
                  );
                })}
                </SortableContext>

                {/* Uncategorized items — always rendered whenever the project
                    has categories, even with nothing uncategorized yet, so
                    there's always a droppable landing zone for a line item
                    or group dragged out of a category (see
                    UncategorizedHeader's doc comment). */}
                {hasCategories && (
                  <UncategorizedHeader isMobile={isMobile} colCount={colCount} isEmpty={!hasUncategorized} />
                )}
                {(() => {
                  const uncatVisible = (uncategorizedItems as LineItemData[]).filter((i) => !isHiddenFromList(i) && !pendingRemovalIds.has(i.id));
                  return (
                    <SortableContext
                      items={uncatVisible.map((item) => `li-${item.id}`)}
                      strategy={verticalListSortingStrategy}
                    >
                      {uncatVisible.map((item) => (
                        <SortableLineItemRow
                          key={item.id}
                          sortableId={`li-${item.id}`}
                          containerId="uncategorized-standalone"
                          dragDisabled={!canDragEquipment}
                          item={item}
                          indent=""
                          orgId={orgId}
                          projectId={projectId}
                          markerByTarget={markerByTarget}
                          overbookedInfo={item.subHireId != null ? undefined : (overbookedMap as Record<string, OverbookedInfo>)[item.id]}
                          isUnconfirmed={!!item.subHireId && draftSubHireIds.has(item.subHireId)}
                          showCostColumn={showCostColumn}
                          isExpanded={expandedParents.has(item.id)}
                          isSelected={selection.isSelected(`li-${item.id}`)}
                          selectable={!item.isKitChild}
                          selectionActive={someLiSelected}
                          onSelectChange={(checked, shiftKey) => handleSelectChange(item.id, checked, shiftKey)}
                          onClick={(e) => handleRowClick(item.id, e)}
                          onToggle={() => toggleParent(item.id)}
                          onEdit={() => {
                            setEditLineItemPlacement({});
                            setEditLineItem(item);
                          }}
                          onMoveToCategory={() => setMoveItemToCategory({
                            lineItemId: item.id,
                          })}
                          onMoveToGroup={() => setMoveItemToGroup({
                            lineItemId: item.id,
                          })}
                          onRemove={() => handleRemoveItem(item.id)}
                          onInlineUpdate={handleInlineLineItemUpdate}
                          moneyLocked={moneyLocked}
                          lockReason={lockReason}
                          onUnlockExit={scrollToLockStrip}
                        />
                      ))}
                    </SortableContext>
                  );
                })()}
                {/* Orphan groups (project + sub-hire) — a single flat
                    "Uncategorized" drop container (useEquipmentDnd's
                    "uncategorized-groups"), spanning BOTH maps below so a
                    group dragged out of any category can land among either
                    kind. Every row here is a valid DROP TARGET but not
                    itself draggable (`dragDisabled` — see
                    SortableGroupRow/SortableSubHireGroupRow's doc comment):
                    orphan groups have never had reorder buttons, and this
                    doesn't add reordering among them, only makes the zone
                    reachable by drag. */}
                <SortableContext
                  items={[
                    ...orphanProjectGroups.map((g) => `grp-${g.id}`),
                    ...orphanSubHireGroups.map((g) => `shg-${g.id}`),
                  ]}
                  strategy={verticalListSortingStrategy}
                >
                {/* Orphan PROJECT groups — categoryId IS NULL (v0.9.4.0
                    allows groups to live uncategorised). Render with the
                    full GroupRow affordances (kebab, Move, Delete) so
                    they're first-class citizens of the Uncategorized
                    zone alongside orphan sub-hire groups. */}
                {orphanProjectGroups.map((group) => {
                  const isExpanded = expandedGroups.has(group.id);
                  const priceVal = group.price != null ? Number(group.price) : null;
                  const groupItems = (group.lineItems ?? []).filter((i: LineItemData) => !isHiddenFromList(i) && !pendingRemovalIds.has(i.id));
                  return (
                    <React.Fragment key={`pg-${group.id}`}>
                      <SortableGroupRow
                        sortableId={`grp-${group.id}`}
                        containerId="uncategorized-groups"
                        dragDisabled
                        group={group}
                        isExpanded={isExpanded}
                        orgId={orgId}
                        projectId={projectId}
                        commentBadge={{
                          open: commentCounts?.[group.id]?.open ?? 0,
                          blocking: commentCounts?.[group.id]?.blockingOpen ?? 0,
                        }}
                        showCostColumn={showCostColumn}
                        onToggle={() => toggleGroup(group.id)}
                        onDelete={() => {
                          setDeleteGroupId(group.id);
                          setDeleteGroupInfo({
                            title: group.title,
                            price: priceVal ?? 0,
                            itemCount: groupItems.length,
                          });
                        }}
                        onEdit={() => setEditGroupData(group)}
                        onEditPrice={() => setPriceEditTarget({
                          kind: "project",
                          groupId: group.id,
                          title: group.title,
                          quantity: group.quantity,
                          price: priceVal,
                          discount: group.discount != null ? Number(group.discount) : null,
                          discountMode: group.discountMode ?? null,
                        })}
                        onAddEquipment={() => {
                          setUnifiedAddTarget({ groupId: group.id, label: `Uncategorized > ${group.title}` });
                          setUnifiedAddKind("own-stock");
                          setShowUnifiedAdd(true);
                        }}
                        onAddKit={() => {
                          setUnifiedAddTarget({ groupId: group.id, label: `Uncategorized > ${group.title}` });
                          setUnifiedAddKind("kit");
                          setShowUnifiedAdd(true);
                        }}
                        onMove={() => setMoveProjectGroup({ id: group.id, title: group.title })}
                        onInlinePriceUpdate={handleInlineGroupPriceUpdate}
                        moneyLocked={moneyLocked}
                        lockReason={lockReason}
                        onUnlockExit={scrollToLockStrip}
                      />
                      {isExpanded && groupItems.length === 0 && (
                        isMobile ? (
                          <p className="px-3 py-2 text-caption text-muted">No items in this group yet. Add equipment to get started.</p>
                        ) : (
                          <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={colCount} className="py-3 text-center text-caption text-muted">
                              No items in this group yet. Add equipment to get started.
                            </TableCell>
                          </TableRow>
                        )
                      )}
                      <SortableContext
                        items={groupItems.map((item: LineItemData) => `li-${item.id}`)}
                        strategy={verticalListSortingStrategy}
                      >
                        {isExpanded && groupItems.map((item: LineItemData) => (
                          <SortableLineItemRow
                            key={item.id}
                            sortableId={`li-${item.id}`}
                            containerId={`items:${group.id}`}
                            dragDisabled={!canDragEquipment}
                            item={item}
                            indent="ml-12"
                            orgId={orgId}
                            projectId={projectId}
                            markerByTarget={markerByTarget}
                            overbookedInfo={item.subHireId != null ? undefined : (overbookedMap as Record<string, OverbookedInfo>)[item.id]}
                            isUnconfirmed={!!item.subHireId && draftSubHireIds.has(item.subHireId)}
                            showCostColumn={showCostColumn}
                            isExpanded={expandedParents.has(item.id)}
                            isSelected={selection.isSelected(`li-${item.id}`)}
                            selectable={!item.isKitChild}
                            selectionActive={someLiSelected}
                            onSelectChange={(checked, shiftKey) => handleSelectChange(item.id, checked, shiftKey)}
                            onClick={(e) => handleRowClick(item.id, e)}
                            onToggle={() => toggleParent(item.id)}
                            onEdit={() => {
                              setEditLineItemPlacement({ groupId: group.id });
                              setEditLineItem(item);
                            }}
                            onMoveToCategory={() => setMoveItemToCategory({
                              lineItemId: item.id,
                            })}
                            onMoveToGroup={() => setMoveItemToGroup({
                              lineItemId: item.id,
                              initialGroupId: group.id,
                            })}
                            onRemove={() => handleRemoveItem(item.id)}
                            onInlineUpdate={handleInlineLineItemUpdate}
                            moneyLocked={moneyLocked}
                            lockReason={lockReason}
                            onUnlockExit={scrollToLockStrip}
                          />
                        ))}
                      </SortableContext>
                    </React.Fragment>
                  );
                })}
                {/* Orphan sub-hire groups — targetCategoryId IS NULL.
                    S13 from the test plan: must surface here, not vanish. */}
                {orphanSubHireGroups.map((shGroup) => {
                  const isExpanded = expandedGroups.has(shGroup.id);
                  const parentLi = (shGroup.lineItems ?? [])[0];
                  const childItems = (parentLi?.childLineItems ?? []) as LineItemData[];
                  return (
                    <React.Fragment key={`shg-${shGroup.id}`}>
                      <SortableSubHireGroupRow
                        sortableId={`shg-${shGroup.id}`}
                        containerId="uncategorized-groups"
                        dragDisabled
                        group={shGroup}
                        isExpanded={isExpanded}
                        showCostColumn={showCostColumn}
                        onToggle={() => toggleGroup(shGroup.id)}
                        onEdit={() => {
                          setManagingSubHireId(shGroup.subHire.id);
                          setShowSubHireOrderDialog(true);
                        }}
                        onEditPrice={() => setPriceEditTarget({
                          kind: "subHire",
                          groupId: shGroup.id,
                          title: shGroup.title,
                          quantity: shGroup.quantity,
                          cost: shGroup.cost != null ? Number(shGroup.cost) : null,
                          charge: shGroup.charge != null ? Number(shGroup.charge) : null,
                        })}
                        onMove={() => setMoveSubHireGroup({ id: shGroup.id, title: shGroup.title })}
                        onInlinePriceUpdate={handleInlineSubHireGroupPriceUpdate}
                      />
                      {isExpanded && childItems.length === 0 && (
                        isMobile ? (
                          <p className="px-3 py-2 text-caption text-muted">No items in this sub-hire group yet.</p>
                        ) : (
                          <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={colCount} className="py-3 text-center text-caption text-muted">
                              No items in this sub-hire group yet.
                            </TableCell>
                          </TableRow>
                        )
                      )}
                      {isExpanded && childItems.map((item) => (
                        <LineItemRow
                          key={item.id}
                          item={item}
                          indent="ml-8"
                          markerByTarget={markerByTarget}
                          overbookedInfo={undefined}
                          isUnconfirmed={!!shGroup.subHire && draftSubHireIds.has(shGroup.subHire.id)}
                          showCostColumn={showCostColumn}
                          isExpanded={expandedParents.has(item.id)}
                          isDragDisabled
                          onToggle={() => toggleParent(item.id)}
                          onEdit={() => {
                            setManagingSubHireId(shGroup.subHire.id);
                            setShowSubHireOrderDialog(true);
                          }}
                          onMoveToCategory={() => {
                            setManagingSubHireId(shGroup.subHire.id);
                            setShowSubHireOrderDialog(true);
                          }}
                          onMoveToGroup={() => {
                            setManagingSubHireId(shGroup.subHire.id);
                            setShowSubHireOrderDialog(true);
                          }}
                          onRemove={() => handleRemoveItem(item.id)}
                          onInlineUpdate={handleInlineLineItemUpdate}
                        />
                      ))}
                    </React.Fragment>
                  );
                })}
                </SortableContext>
          </>
        );
        const content = isMobile ? (
          <div className="space-y-1.5">{equipmentRows}</div>
        ) : (
          <div className="overflow-x-auto rounded-[var(--r)] border border-line">
            <table className="w-full caption-bottom text-[13.5px] table-fixed">
              <colgroup>
                <col className="w-10" />
                <col />
                <col className="w-16" />
                <col className="w-28" />
                {showCostColumn && <col className="w-24" />}
                <col className="w-28" />
                <col className="w-32" />
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-1" />
                  <TableHead>
                    <div className="flex items-center gap-2">
                      {allLiSortableIds.length > 0 && (
                        <Checkbox
                          aria-label="Select all items"
                          checked={
                            allLiSelected ? true : someLiSelected ? "indeterminate" : false
                          }
                          onCheckedChange={toggleSelectAll}
                        />
                      )}
                      <span>Item</span>
                    </div>
                  </TableHead>
                  <TableHead className="text-center">Qty</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Unit price</TableHead>
                  {showCostColumn && (
                    <TableHead className="text-right whitespace-nowrap">Cost</TableHead>
                  )}
                  <TableHead className="text-right whitespace-nowrap">Total</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>{equipmentRows}</TableBody>
            </table>
          </div>
        );
        // Drag-and-drop for LINE ITEMS, GROUPS, and CATEGORIES (see
        // use-equipment-dnd.ts). A single DndContext wraps both the desktop
        // table and mobile card shells. `dragHandleRef` now registers the
        // WHOLE row/card as dnd-kit's measured/dragged node (equipment-rows.tsx's
        // `DragHandleControls` doc comment), so dnd-kit's own <DragOverlay>
        // wrapper is sized and positioned to exactly match the row the user
        // grabbed — this floating label fills that wrapper (`h-full w-full`)
        // instead of rendering as a small fixed-size chip inside it, which is
        // what keeps it tracking the exact point the user grabbed rather than
        // snapping to a corner.
        //
        // dnd-kit's <DragOverlay> renders IN PLACE (no portal of its own —
        // confirmed reading @dnd-kit/core's source) and relies entirely on
        // `position: fixed` to visually escape the layout. `<FadeIn>`
        // (src/app/(app)/projects/[id]/page.tsx wraps the whole page in it)
        // is a Framer Motion `motion.div` whose `animate={{ y: 0 }}` leaves a
        // persistent (non-`none`) `transform` style on that ancestor even at
        // rest — any non-`none` transform establishes a NEW containing block
        // for `position: fixed` descendants, so the overlay was positioning
        // itself relative to that page wrapper instead of the viewport. That
        // silent coordinate-system mismatch (not the row-vs-handle sizing
        // fixed above) is what made the dragged preview appear to "jump to
        // the top" disconnected from the cursor. Portaling straight to
        // `document.body` sidesteps this (and any other transformed
        // ancestor) entirely, matching dnd-kit's own documented fix for this
        // exact class of bug.
        return (
          <DndContext
            sensors={dnd.sensors}
            collisionDetection={closestCenter}
            modifiers={dnd.modifiers}
            onDragStart={dnd.handleDragStart}
            onDragOver={dnd.handleDragOver}
            onDragEnd={dnd.handleDragEnd}
            onDragCancel={dnd.handleDragCancel}
          >
            {content}
            {typeof document !== "undefined" &&
              createPortal(
                <DragOverlay>
                  {dnd.draggedRowClone ? <DragRowOverlayContent clone={dnd.draggedRowClone} /> : null}
                </DragOverlay>,
                document.body,
              )}
          </DndContext>
        );
      })()}

      {/* ─── Sub-Hire Orders ──────────────────────────────────────────────── */}
      {projectSubHires.length > 0 && (
        <div className="mt-6 rounded-[var(--r-lg)] border border-line bg-card shadow-[var(--sh-card)]">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4 text-red" />
              <h3 className="text-card-title font-semibold text-ink">Sub-hire orders</h3>
              <span className="t-mono text-muted">({projectSubHires.length})</span>
            </div>
          </div>
          <div className="divide-y divide-line">
            {projectSubHires.map((sh: Record<string, unknown>) => {
              const shId = sh.id as string;
              const isExpanded = expandedSubHires.has(shId);
              const margin = Number(sh.totalCharge) - Number(sh.totalCost);
              const isOverdue = sh.status === "ON_HIRE" && sh.hireEnd && new Date(sh.hireEnd as string) < new Date();
              const itemCount = (sh._count as Record<string, number>)?.items || 0;
              return (
                <div key={shId}>
                  <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-elev/50 transition-colors">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedSubHires((prev) => {
                          const next = new Set(prev);
                          if (next.has(shId)) next.delete(shId);
                          else next.add(shId);
                          return next;
                        })
                      }
                      className={cn("rounded-sm text-muted hover:text-ink transition-colors", focusRing)}
                    >
                      <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="t-mono font-medium text-ink-2">{sh.orderNumber as string}</span>
                        <span className="text-ui-text text-muted">{(sh.supplier as Record<string, unknown>)?.name as string}</span>
                        {isOverdue ? (
                          <StatusIndicator category="subHire" intent="error" label="Overdue" value="OVERDUE" />
                        ) : (
                          <StatusIndicator
                            category="subHire"
                            value={sh.status as string}
                            label={subHireStatusLabels[sh.status as string] || formatLabel(sh.status as string)}
                          />
                        )}
                        <span className="text-caption text-muted">{itemCount} item{itemCount !== 1 ? "s" : ""}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div className="text-ui-text tabular-nums text-ink-2">{formatCurrency(Number(sh.totalCharge))}</div>
                        <div className={`text-caption tabular-nums ${margin > 0 ? "text-ok" : margin < 0 ? "text-t-out" : "text-muted"}`}>
                          {margin > 0 ? "+" : ""}{formatCurrency(margin)}
                        </div>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="touch-target size-8"
                        title="Edit sub-hire order"
                        onClick={() => {
                          setManagingSubHireId(shId);
                          setShowSubHireOrderDialog(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {/* Expanded items */}
                  {isExpanded && (
                    <SubHireExpandedItems
                      subHireId={shId}
                      orgId={orgId}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Billable Services on Documents ─────────────────────────────────── */}
      {(() => {
        // A service is billable once it has an actual charge — mirrors
        // buildFinanceLines/build-document-data.ts/recalcProjectTotals (R-3.1),
        // not a separate "show on documents" flag.
        const billable = (servicesData ?? []).filter(
          (s: { lineTotal: number | null; status: string }) => s.status !== "CANCELLED" && Number(s.lineTotal) > 0
        );
        if (billable.length === 0) return null;
        return (
          <div className="mt-6 rounded-[var(--r-lg)] border border-line bg-card shadow-[var(--sh-card)]">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <h3 className="text-card-title font-semibold text-ink">Services on documents</h3>
              <span className="t-mono text-muted">({billable.length})</span>
            </div>
            <div className="divide-y divide-line">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {billable.map((svc: any) => (
                <div key={svc.id} className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-ui-text text-ink-2">{svc.title}</span>
                    <span className="rounded-full bg-paper-2 px-2 py-0.5 text-badge font-medium text-muted">{SERVICE_TYPE_LABELS[svc.type as keyof typeof SERVICE_TYPE_LABELS] ?? svc.type}</span>
                  </div>
                  <div className="flex items-center gap-4 text-ui-text">
                    {svc.lineTotal != null && Number(svc.lineTotal) > 0 && (
                      <span className="tabular-nums text-ink">{formatCurrency(Number(svc.lineTotal))}</span>
                    )}
                    {svc.costTotal != null && Number(svc.costTotal) > 0 && (
                      <span className="text-caption tabular-nums text-muted">Cost: {formatCurrency(Number(svc.costTotal))}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ─── Dialogs ────────────────────────────────────────────────────────── */}

      {/* Add category dialog */}
      <AddCategoryDialog
        open={showAddCategory}
        isPending={createCategoryMut.isPending}
        onOpenChange={setShowAddCategory}
        onSubmit={(name) => createCategoryMut.mutate(name)}
      />

      <RenameCategoryDialog
        categoryId={renameCategoryId}
        initialValue={renameCategoryValue}
        isPending={renameCategoryMut.isPending}
        onClose={() => setRenameCategoryId(null)}
        onSubmit={(id, name) => renameCategoryMut.mutate({ id, name })}
      />

      {/* Save group as template dialog */}
      <SaveAsTemplateDialog
        group={saveAsTemplateGroup}
        isPending={saveAsTemplateMut.isPending}
        onClose={() => setSaveAsTemplateGroup(null)}
        onSubmit={(groupId, values) =>
          saveAsTemplateMut.mutate({
            groupId,
            name: values.name,
            description: values.description,
          })
        }
      />

      {/* Add group from toolbar dialog */}
      <AddGroupToolbarDialog
        open={showAddGroupFromToolbar}
        isPending={createGroupMut.isPending}
        categories={typedCategories.map((c) => ({ id: c.id, name: c.name }))}
        templates={templateOptions}
        onOpenChange={setShowAddGroupFromToolbar}
        onSubmit={(values) => {
          createGroupMut.mutate(values);
          setShowAddGroupFromToolbar(false);
        }}
      />
      {/* Delete confirmation dialog (Phase 7 — extracted) */}
      <DeleteGroupDialog
        groupId={deleteGroupId}
        info={deleteGroupInfo}
        isPending={deleteGroupMut.isPending}
        onClose={() => {
          setDeleteGroupId(null);
          setDeleteGroupInfo(null);
        }}
        onConfirm={(id) => deleteGroupMut.mutate(id)}
      />


      {/* Edit line item dialog (Phase 7 — extracted) */}
      <EditLineItemDialog
        item={editLineItem}
        projectId={projectId}
        rentalStartDate={rentalStartDate}
        rentalEndDate={rentalEndDate}
        orgId={orgId}
        categories={categories as CategoryData[]}
        initialCategoryId={editLineItemPlacement.categoryId}
        initialGroupId={editLineItemPlacement.groupId}
        isPending={updateLineItemMut.isPending}
        locked={moneyLocked}
        lockReason={lockReason}
        onUnlockExit={scrollToLockStrip}
        onClose={() => setEditLineItem(null)}
        onMove={(id, placement) => {
          groupWrites
            .moveLineItem({ lineItemId: id, targetCategoryId: placement.categoryId, targetGroupId: placement.groupId })
            .then(() => invalidate())
            .catch((e: Error) => toast.error(e.message));
        }}
        onSubmit={(id, data, allowOverbook, baseUpdatedAt) => {
          // Optimistically overlay the edited fields onto the row so it updates
          // instantly; the server action below is still the authoritative write.
          setPendingEdits((prev) => {
            const next = new Map(prev);
            next.set(id, {
              quantity: data.quantity,
              unitPrice: data.unitPrice,
              discount: data.discount,
              description: data.description,
              notes: data.notes,
              lineTotal: computeLineTotal(
                data.unitPrice,
                data.quantity,
                data.duration,
                data.discount,
              ),
            });
            return next;
          });
          updateLineItemMut.mutate({
            id,
            data: data as unknown as Record<string, unknown>,
            allowOverbook,
            baseUpdatedAt,
          });
        }}
      />

      {/* Move-item-to-category dialog (kebab → "Move to category").
          Item lands as standalone under the picked category. */}
      <MoveItemToCategoryDialog
        lineItemId={moveItemToCategory?.lineItemId ?? null}
        initialCategoryId={moveItemToCategory?.initialCategoryId}
        categories={typedCategories}
        isPending={moveLineItemMut.isPending}
        onClose={() => setMoveItemToCategory(null)}
        onSubmit={(lineItemId, target) =>
          moveLineItemMut.mutate({
            lineItemId,
            targetCategoryId: target.categoryId,
            targetGroupId: target.groupId,
          })
        }
      />

      {/* Move-item-to-group dialog (kebab → "Move to group").
          Item lands inside the picked group and adopts its category. */}
      <MoveItemToGroupDialog
        lineItemId={moveItemToGroup?.lineItemId ?? null}
        initialGroupId={moveItemToGroup?.initialGroupId}
        categories={typedCategories}
        uncategorizedGroups={orphanProjectGroups.map((g) => ({ id: g.id, title: g.title }))}
        isPending={moveLineItemMut.isPending}
        onClose={() => setMoveItemToGroup(null)}
        onSubmit={(lineItemId, target) =>
          moveLineItemMut.mutate({
            lineItemId,
            targetCategoryId: target.categoryId,
            targetGroupId: target.groupId,
          })
        }
      />

      {/* ─── Bulk-operation dialogs (act on the current multi-selection) ─── */}

      {/* Bulk edit — set shared fields across every selected line item. */}
      <BulkEditLineItemsDialog
        open={bulkEditOpen}
        onOpenChange={setBulkEditOpen}
        count={selectedLineItemIds.length}
        isPending={bulkEditMut.isPending}
        onSubmit={(patch) => bulkEditMut.mutate({ ids: selectedLineItemIds, patch })}
        locked={moneyLocked}
        lockReason={lockReason}
        onUnlockExit={scrollToLockStrip}
      />

      {/* Bulk delete — typed-confirmation, cascades kit/accessory parents. */}
      <BulkDeleteDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title="Remove selected items"
        description="This removes the selected line items from the project. Kit/accessory members are removed with their parent."
        count={selectedLineItemIds.length}
        itemLabel="line item"
        confirmLabel={`Remove ${selectedLineItemIds.length} item${
          selectedLineItemIds.length === 1 ? "" : "s"
        }`}
        pending={bulkDeleteMut.isPending}
        onConfirm={() => bulkDeleteMut.mutate(selectedLineItemIds)}
      />

      {/* #990 — the shared justification prompts backing removeMut/bulkDeleteMut/
          deleteGroupMut above. One dialog per justified mutation (each has its
          own pending call state) rather than a single shared dialog racing
          three concurrent callers. */}
      <JustificationDialog {...justifiedRemoveLineItem.dialogProps} />
      <JustificationDialog {...justifiedRemoveLineItems.dialogProps} />
      <JustificationDialog {...justifiedRemoveGroup.dialogProps} />
      {/* Drag-and-drop reorder/move justification prompts (useEquipmentDnd). */}
      {dnd.dialogs}

      {/* Bulk move to group — reuses the single-item picker with a sentinel id;
          the echoed id is ignored in favour of the current selection. */}
      <MoveItemToGroupDialog
        lineItemId={bulkMoveGroupOpen ? "__bulk__" : null}
        categories={typedCategories}
        uncategorizedGroups={orphanProjectGroups.map((g) => ({ id: g.id, title: g.title }))}
        isPending={bulkMoveMut.isPending}
        onClose={() => setBulkMoveGroupOpen(false)}
        onSubmit={(_id, target) =>
          bulkMoveMut.mutate({
            ids: selectedLineItemIds,
            targetCategoryId: target.categoryId,
            targetGroupId: target.groupId,
          })
        }
      />

      {/* Bulk move to category — same sentinel reuse. */}
      <MoveItemToCategoryDialog
        lineItemId={bulkMoveCategoryOpen ? "__bulk__" : null}
        categories={typedCategories}
        isPending={bulkMoveMut.isPending}
        onClose={() => setBulkMoveCategoryOpen(false)}
        onSubmit={(_id, target) =>
          bulkMoveMut.mutate({
            ids: selectedLineItemIds,
            targetCategoryId: target.categoryId,
            targetGroupId: target.groupId,
          })
        }
      />

      {/* Unified price-edit dialog (Phase 6c — works for both kinds of group). */}
      <PriceEditDialog
        target={priceEditTarget}
        onClose={() => setPriceEditTarget(null)}
        onInvalidate={invalidate}
        locked={moneyLocked}
        lockReason={lockReason}
        onUnlockExit={scrollToLockStrip}
      />

      {/* Move-sub-hire-group dialog (kebab → "Move to category") */}
      <MoveSubHireGroupDialog
        open={moveSubHireGroup != null}
        onOpenChange={(open) => {
          if (!open) setMoveSubHireGroup(null);
        }}
        groupId={moveSubHireGroup?.id ?? null}
        groupTitle={moveSubHireGroup?.title}
        projectId={projectId}
        categories={(categories as CategoryData[]).map((c) => ({ id: c.id, name: c.name }))}
        onInvalidate={invalidate}
      />

      {/* Move-project-group dialog (kebab → "Move to category") */}
      <MoveProjectGroupDialog
        open={moveProjectGroup != null}
        onOpenChange={(open) => {
          if (!open) setMoveProjectGroup(null);
        }}
        groupId={moveProjectGroup?.id ?? null}
        groupTitle={moveProjectGroup?.title}
        projectId={projectId}
        categories={(categories as CategoryData[]).map((c) => ({ id: c.id, name: c.name }))}
        onInvalidate={invalidate}
      />

      {/* Unified add dialog (own-stock / kit / sub-hire / custom) */}
      <UnifiedAddDialog
        open={showUnifiedAdd}
        onOpenChange={(open) => {
          setShowUnifiedAdd(open);
          if (!open) setUnifiedAddTarget({});
        }}
        kind={unifiedAddKind}
        onKindChange={setUnifiedAddKind}
        projectId={projectId}
        rentalStartDate={rentalStartDate ?? undefined}
        rentalEndDate={rentalEndDate ?? undefined}
        categoryId={unifiedAddTarget.categoryId}
        groupId={unifiedAddTarget.groupId}
        targetLabel={unifiedAddTarget.label}
        categories={categories as CategoryData[]}
        onInvalidate={invalidate}
        onSubHireCreated={(newSubHireId) => {
          // Hand off from the inline create form to the manage view so
          // the user can add items to their new order without a context
          // switch. Close the unified dialog first, then open the order
          // dialog on the next tick to avoid a same-frame open/close
          // race in Radix Dialog.
          setShowUnifiedAdd(false);
          setUnifiedAddTarget({});
          setTimeout(() => {
            setManagingSubHireId(newSubHireId);
            setShowSubHireOrderDialog(true);
          }, 0);
        }}
      />

      {/* Sub-hire order dialog */}
      <SubHireOrderDialog
        projectId={projectId}
        open={showSubHireOrderDialog}
        onOpenChange={(open) => {
          setShowSubHireOrderDialog(open);
          if (!open) setManagingSubHireId(null);
        }}
        subHireId={managingSubHireId}
      />

      {/* Edit group dialog (Phase 7 — extracted) */}
      <EditGroupDialog
        group={editGroupData}
        isPending={updateGroupMut.isPending}
        locked={moneyLocked}
        lockReason={lockReason}
        onUnlockExit={scrollToLockStrip}
        onClose={() => setEditGroupData(null)}
        onSubmit={(groupId, values, price, discount, discountMode) => {
          updateGroupMut.mutate({ groupId, data: values });
          if (price !== undefined) {
            groupWrites.updatePrice(groupId, price, discount, discountMode)
              .then(() => invalidate())
              .catch((e: Error) => toast.error(e.message));
          }
        }}
      />
    </div>
    </ReassignProvider>
  );
}
