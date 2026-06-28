"use client";

import React, { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../../convex/_generated/api";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { refreshProjectDetail } from "@/hooks/use-project-detail";
import {
  useProjectCategories,
  refreshProjectCategories,
  useUncategorizedItems,
  refreshUncategorizedItems,
  useUncategorizedSubHireGroups,
  refreshUncategorizedSubHireGroups,
  useUncategorizedProjectGroups,
  refreshUncategorizedProjectGroups,
  useProjectOverbooked,
  refreshProjectOverbooked,
  useProjectSubHires,
  useProjectEquipmentLiveSync,
} from "@/hooks/use-project-equipment";
import {
  NATIVE_EQUIPMENT_ENABLED,
  useNativeEquipmentTab,
} from "@/hooks/use-native-equipment-tab";
import { Plus, FolderPlus, FolderTree, Pencil, ChevronDown as ChevronDownIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

import { useProjectServices } from "@/hooks/use-project-services";
import { useGroupTemplates, refreshGroupTemplates } from "@/hooks/use-group-templates";
import {
  createProjectGroup,
  updateProjectGroup,
  deleteProjectGroup,
  reorderProjectGroups,
  moveLineItemToGroup,
  updateGroupPrice,
} from "@/server/project-groups";
import {
  createProjectCategory,
  updateProjectCategory,
  deleteProjectCategory,
  reorderProjectCategories,
  getUncategorizedLineItems,
  getProjectOverbookedStatus,
} from "@/server/project-categories";
import {
  getUncategorizedSubHireGroups,
  getUncategorizedProjectGroups,
  moveSubHireGroupToCategory,
  reorderMixedGroupsInCategory,
} from "@/server/category-slots";
import { applyGroupTemplate, saveGroupAsTemplate } from "@/server/group-templates";
import { removeLineItem, updateLineItem, reorderLineItems } from "@/server/line-items";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
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
import { getSubHires } from "@/server/sub-hires";
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
} from "./equipment-rows";
import { useSelection } from "./use-selection";
import { targetKey } from "@/lib/collaboration-targets";

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

// ─── Main component ──────────────────────────────────────────────────────────

export function EquipmentTab({ projectId, rentalStartDate, rentalEndDate, addMenuSlot }: EquipmentTabProps) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Native read-layer path (Phase 2, default OFF). When the flag is on, ALL six
  // equipment views come from ONE reactive equipmentTab.bundle subscription
  // (reconstructed client-side) — no server actions, no doorbell→refetch. Both the
  // native hook and the server-action hooks below run (rules-of-hooks); the flag
  // only selects which result we use. When off, the native hook is a no-op (skips).
  const native = useNativeEquipmentTab(projectId, orgId);

  // Cross-tab live sync: subscribe to the dual-written line-item / group /
  // category Convex tables and re-fetch the equipment composites whenever
  // another tab (or collaborator) edits pricing, moves items, or changes groups.
  // The native path is already reactive over its own subscription — skip the
  // doorbell there (pass undefined so the live-sync subscriptions don't fire).
  useProjectEquipmentLiveSync(
    NATIVE_EQUIPMENT_ENABLED ? undefined : projectId,
    NATIVE_EQUIPMENT_ENABLED ? undefined : orgId,
  );

  // Passive section/group collaboration state: one lock subscription and one
  // comment-count subscription for the project, then row lookups by target key.
  // This avoids mounting active edit-lock hooks for every group row.
  const sectionLocks = useAuthedQuery(
    api.collaboration.listLocksForEntity,
    orgId ? { orgId, entityType: "project", entityId: projectId } : "skip"
  );
  const commentCounts = useAuthedQuery(
    api.collaboration.listThreadCommentCounts,
    orgId ? { orgId, entityType: "project", entityId: projectId } : "skip"
  ) as Record<string, { open: number; total: number; blockingOpen: number }> | undefined;
  const lockByTarget = React.useMemo(
    () =>
      new Map(
        (sectionLocks ?? []).map((lock) => [
          targetKey({ targetType: lock.targetType, targetId: lock.targetId }),
          { name: lock.ownerName, color: lock.ownerColor },
        ])
      ),
    [sectionLocks]
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
  const SHOW_COST_KEY = "gearflow-projects-show-cost";
  const [showCostColumn, setShowCostColumn] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(SHOW_COST_KEY) === "true";
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

  // Server-action shared resources (the legacy path). When native is on, each is
  // passed `undefined` so its fetch skips (no double-fetch alongside the native
  // subscription); the value comes from `native` instead.
  const scKey = NATIVE_EQUIPMENT_ENABLED ? undefined : projectId;
  const { data: scCategories = [], isLoading: scLoading } = useProjectCategories(scKey);
  const { data: scUncategorizedItems = [] } = useUncategorizedItems(scKey);
  const { data: scUncategorizedSubHireGroups = [] } = useUncategorizedSubHireGroups(scKey);
  const { data: scUncategorizedProjectGroups = [] } = useUncategorizedProjectGroups(scKey);
  const { data: scOverbookedMap = {} } = useProjectOverbooked(scKey);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: scProjectSubHires = [] } = useProjectSubHires(scKey) as { data: any[] };

  const categories = NATIVE_EQUIPMENT_ENABLED ? native.categories : scCategories;
  const isLoading = NATIVE_EQUIPMENT_ENABLED ? native.isLoading : scLoading;
  const uncategorizedItems = NATIVE_EQUIPMENT_ENABLED ? native.uncategorizedItems : scUncategorizedItems;
  const uncategorizedSubHireGroups = NATIVE_EQUIPMENT_ENABLED ? native.uncategorizedSubHireGroups : scUncategorizedSubHireGroups;
  const uncategorizedProjectGroups = NATIVE_EQUIPMENT_ENABLED ? native.uncategorizedProjectGroups : scUncategorizedProjectGroups;
  const overbookedMap = NATIVE_EQUIPMENT_ENABLED ? native.overbookedMap : scOverbookedMap;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const projectSubHires = (NATIVE_EQUIPMENT_ENABLED ? native.projectSubHires : scProjectSubHires) as any[];

  const { data: templates = [] } = useGroupTemplates(orgId);

  const { data: servicesData } = useProjectServices(projectId);

  const templateOptions = (templates as { id: string; name: string; description: string | null; items: unknown[] }[]).map(
    (t) => ({ id: t.id, name: t.name, description: t.description, itemCount: t.items.length })
  );

  const invalidate = useCallback(() => {
    refreshProjectCategories(projectId);
    refreshUncategorizedItems(projectId);
    refreshUncategorizedSubHireGroups(projectId);
    refreshUncategorizedProjectGroups(projectId);
    refreshProjectDetail(projectId);
    refreshProjectOverbooked(projectId);
  }, [projectId]);

  // Optimistic delete: a removed row vanishes from the list INSTANTLY (instead of
  // lingering until the server round-trip + the reactive refetch land). The id is
  // rolled back on error (row reappears) and pruned once the refetch confirms the
  // deletion. Bridges the gap between the mutation and the live refresh.
  const [pendingRemovalIds, setPendingRemovalIds] = useState<ReadonlySet<string>>(() => new Set());

  // ─── Mutations ───────────────────────────────────────────────────────────

  const createCategoryMut = useServerMutation({
    mutationFn: (name: string) => createProjectCategory(projectId, { name }),
    onSuccess: () => {
      invalidate();
      setShowAddCategory(false);
      toast.success("Category created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const renameCategoryMut = useServerMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateProjectCategory(id, { name }),
    onSuccess: () => {
      invalidate();
      setRenameCategoryId(null);
      toast.success("Category renamed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteCategoryMut = useServerMutation({
    mutationFn: (id: string) => deleteProjectCategory(id),
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
    }) => moveLineItemToGroup({ lineItemId, targetGroupId, targetCategoryId }),
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

  const updateLineItemMut = useServerMutation({
    mutationFn: ({ id, data, allowOverbook, baseUpdatedAt }: { id: string; data: Record<string, unknown>; allowOverbook?: boolean; baseUpdatedAt?: string | number | null }) =>
      updateLineItem(id, data as Parameters<typeof updateLineItem>[1], allowOverbook ?? false, baseUpdatedAt),
    onSuccess: () => {
      invalidate();
      setEditLineItem(null);
      toast.success("Item updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMut = useServerMutation({
    mutationFn: (id: string) => removeLineItem(id),
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

  // No prune needed: a successfully-removed id simply stops matching any rendered
  // row (the refetch drops it). ids are cuids (never reused), so a retained dead id
  // is a harmless no-op in the filters — and skipping a prune effect avoids a
  // setState-in-effect cascading render. The set only grows within a mounted
  // session and resets on navigation.


  const saveAsTemplateMut = useServerMutation({
    mutationFn: ({ groupId, name, description }: { groupId: string; name: string; description?: string }) =>
      saveGroupAsTemplate(groupId, name, description),
    onSuccess: (t: unknown) => {
      const name = (t as { name?: string })?.name ?? "Template";
      toast.success(`Saved as template "${name}"`);
      refreshGroupTemplates(orgId);
      setSaveAsTemplateGroup(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createGroupMut = useServerMutation({
    mutationFn: ({ categoryId, title, templateId }: { categoryId: string | null; title: string; templateId?: string }) => {
      if (templateId) {
        // Templates are category-scoped concepts — fall back to no-template
        // when the user picks Uncategorised so they can still create the
        // group structurally. The template can be applied via a follow-up
        // move + recalculate if they later want to materialise its items.
        if (!categoryId) {
          return createProjectGroup(projectId, { categoryId: null, title, quantity: 1 });
        }
        return applyGroupTemplate(projectId, { templateId, categoryId, title });
      }
      return createProjectGroup(projectId, { categoryId, title, quantity: 1 });
    },
    onSuccess: () => {
      invalidate();
      toast.success("Group created");
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const deleteGroupMut = useServerMutation({
    mutationFn: (groupId: string) => deleteProjectGroup(groupId),
    onSuccess: () => {
      invalidate();
      setDeleteGroupId(null);
      setDeleteGroupInfo(null);
      toast.success("Group deleted — items moved to standalone");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateGroupMut = useServerMutation({
    mutationFn: ({ groupId, data }: { groupId: string; data: Partial<{ title: string; description: string; quantity: number }> }) =>
      updateProjectGroup(groupId, data),
    onSuccess: () => {
      invalidate();
      setEditGroupData(null);
      toast.success("Group updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ─── Reorder handlers (▲/▼ move buttons) ───────────────────────
  //
  // Each handler swaps a row with its neighbour in the same scope, builds the
  // new ordered id array, and calls the same server reorder action the old
  // drag-and-drop onDragEnd used. The buttons are disabled at the ends, so a
  // handler is only ever invoked with a valid in-range swap.

  /** Move a top-level category up (dir -1) or down (dir +1). */
  function moveCategory(index: number, dir: -1 | 1) {
    const cats = categories as CategoryData[];
    const target = index + dir;
    if (target < 0 || target >= cats.length) return;
    const reordered = [...cats];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved);
    reorderProjectCategories(projectId, reordered.map((c) => c.id)).catch(() => {
      toast.error("Failed to reorder categories");
    });
    invalidate();
  }

  /** Move a group slot (project OR sub-hire) within its category. Routes through
   *  the lighter reorderProjectGroups when no sub-hire group is involved, else
   *  the unified reorderMixedGroupsInCategory (which owns cross-type slot order). */
  function moveGroupSlot(cat: CategoryData, slotIndex: number, dir: -1 | 1) {
    const mixed: MixedGroupSlot[] = cat.mixedGroups ?? cat.groups.map((g) => ({
      kind: "project" as const,
      sortOrder: g.sortOrder,
      projectGroupId: g.id,
    }));
    const target = slotIndex + dir;
    if (target < 0 || target >= mixed.length) return;
    const reordered = [...mixed];
    const [moved] = reordered.splice(slotIndex, 1);
    reordered.splice(target, 0, moved);

    const hasAnySubHire = reordered.some((s) => s.kind === "subHire");
    if (!hasAnySubHire) {
      reorderProjectGroups(
        cat.id,
        reordered.map((s) => (s.kind === "project" ? s.projectGroupId : "")).filter(Boolean),
      ).catch(() => toast.error("Failed to reorder groups"));
    } else {
      const orderedIds = reordered.map((s) =>
        s.kind === "project" ? `pg-${s.projectGroupId}` : `shg-${s.subHireGroupId}`,
      );
      reorderMixedGroupsInCategory({ categoryId: cat.id, orderedIds }).catch(() => {
        toast.error("Failed to reorder groups");
      });
    }
    invalidate();
  }

  /** Move a line item up/down within its sibling list. */
  function moveLineItemInList(items: LineItemData[], index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const reordered = [...items];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved);
    reorderLineItems(projectId, reordered.map((i) => i.id)).catch(() => {
      toast.error("Failed to reorder items");
    });
    invalidate();
  }

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
      } else {
        allSortableIds.push(`shg-${slot.subHireGroupId}`);
      }
    }
    for (const item of cat.lineItems ?? []) {
      if (!(item as LineItemData).isKitChild) allSortableIds.push(`li-${item.id}`);
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

  // Primary "Add ▾" menu (item / group / category). The three add actions reuse
  // the exact handlers the old three buttons triggered (UnifiedAddDialog,
  // AddGroupToolbarDialog, AddCategoryDialog) — no behaviour change. Rendered
  // either inline in the in-panel toolbar (fallback) or portalled onto the tab
  // row when the page supplies `addMenuSlot`.
  const addMenu = (
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

      {/* Main table */}
      {(hasCategories || hasUncategorized) && (
        <div className="rounded-[var(--r)] border border-line overflow-x-auto">
          <Table className="table-fixed">
            <colgroup>
              <col className="w-10" />
              <col />
              <col className="w-16" />
              <col className="w-28 hidden md:table-column" />
              {showCostColumn && <col className="w-24 hidden md:table-column" />}
              <col className="w-28 hidden sm:table-column" />
              <col className="w-32" />
            </colgroup>
            <TableHeader>
            <TableRow>
              <TableHead className="px-1" />
              <TableHead>Item</TableHead>
              <TableHead className="text-center">Qty</TableHead>
              <TableHead className="text-right hidden md:table-cell">Unit price</TableHead>
              {showCostColumn && (
                <TableHead className="text-right hidden md:table-cell">Cost</TableHead>
              )}
              <TableHead className="text-right hidden sm:table-cell">Total</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
              <TableBody>
                {typedCategories.map((cat, catIndex) => {
                  const standaloneItems = (cat.lineItems ?? []).filter((i: LineItemData) => !isHiddenFromList(i) && !pendingRemovalIds.has(i.id));
                  const mixedSlots: MixedGroupSlot[] = cat.mixedGroups ?? cat.groups.map<MixedGroupSlot>((g) => ({
                    kind: "project" as const,
                    sortOrder: g.sortOrder,
                    projectGroupId: g.id,
                  }));

                  return (
                    <React.Fragment key={cat.id}>
                      {/* Category label row */}
                      <CategoryRow
                        cat={cat}
                        onMoveUp={() => moveCategory(catIndex, -1)}
                        onMoveDown={() => moveCategory(catIndex, 1)}
                        canMoveUp={catIndex > 0}
                        canMoveDown={catIndex < typedCategories.length - 1}
                        lockedBy={lockByTarget.get(targetKey({ targetType: "category", targetId: cat.id })) ?? null}
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

                      {/* Mixed groups within category (CategorySlot order; falls back
                          to cat.groups when mixedGroups hasn't been computed). */}
                      {mixedSlots.map((slot, slotIndex) => {
                        const canSlotUp = slotIndex > 0;
                        const canSlotDown = slotIndex < mixedSlots.length - 1;
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
                              <SubHireGroupRow
                                group={shGroup}
                                isExpanded={isExpanded}
                                showCostColumn={showCostColumn}
                                indented
                                onMoveUp={() => moveGroupSlot(cat, slotIndex, -1)}
                                onMoveDown={() => moveGroupSlot(cat, slotIndex, 1)}
                                canMoveUp={canSlotUp}
                                canMoveDown={canSlotDown}
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
                              />
                              {isExpanded && childItems.length === 0 && (
                                <TableRow className="hover:bg-transparent">
                                  <TableCell colSpan={colCount} className="py-3 text-center text-caption text-muted">
                                    No items in this sub-hire group yet.
                                  </TableCell>
                                </TableRow>
                              )}
                              {isExpanded && childItems.map((item) => (
                                <LineItemRow
                                  key={item.id}
                                  item={item}
                                  indent="ml-12"
                                  overbookedInfo={undefined}
                                  isUnconfirmed={!!shGroup.subHire && draftSubHireIds.has(shGroup.subHire.id)}
                                  showCostColumn={showCostColumn}
                                  isExpanded={expandedParents.has(item.id)}
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
                            <GroupRow
                              group={group}
                              isExpanded={isExpanded}
                              indented
                              orgId={orgId}
                              projectId={projectId}
                              onMoveUp={() => moveGroupSlot(cat, slotIndex, -1)}
                              onMoveDown={() => moveGroupSlot(cat, slotIndex, 1)}
                              canMoveUp={canSlotUp}
                              canMoveDown={canSlotDown}
                              lockedBy={lockByTarget.get(targetKey({ targetType: "group", targetId: group.id })) ?? null}
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
                                price: priceVal,
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
                            />
                            {/* Expanded line items */}
                            {isExpanded && groupItems.length === 0 && (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={colCount} className="py-3 text-center text-caption text-muted">
                                  No items in this group yet. Add equipment to get started.
                                </TableCell>
                              </TableRow>
                            )}
                            {isExpanded && groupItems.map((item, itemIndex) => (
                              <LineItemRow
                                key={item.id}
                                item={item}
                                indent="ml-12"
                                orgId={orgId}
                                projectId={projectId}
                                onMoveUp={() => moveLineItemInList(groupItems, itemIndex, -1)}
                                onMoveDown={() => moveLineItemInList(groupItems, itemIndex, 1)}
                                canMoveUp={itemIndex > 0}
                                canMoveDown={itemIndex < groupItems.length - 1}
                                overbookedInfo={item.subHireId != null ? undefined : (overbookedMap as Record<string, OverbookedInfo>)[item.id]}
                                isUnconfirmed={!!item.subHireId && draftSubHireIds.has(item.subHireId)}
                                showCostColumn={showCostColumn}
                                isExpanded={expandedParents.has(item.id)}
                                isSelected={selection.isSelected(`li-${item.id}`)}
                                onClick={(e) => handleRowClick(item.id, e)}
                                onToggle={() => toggleParent(item.id)}
                                onEdit={() => setEditLineItem(item)}
                                onMoveToCategory={() => setMoveItemToCategory({
                                  lineItemId: item.id,
                                  initialCategoryId: cat.id,
                                })}
                                onMoveToGroup={() => setMoveItemToGroup({
                                  lineItemId: item.id,
                                  initialGroupId: group.id,
                                })}
                                onRemove={() => handleRemoveItem(item.id)}
                              />
                            ))}
                          </React.Fragment>
                        );
                      })}

                      {/* Standalone line items in category */}
                      {standaloneItems.map((item, itemIndex) => (
                        <LineItemRow
                          key={item.id}
                          item={item}
                          indent="ml-3"
                          orgId={orgId}
                          projectId={projectId}
                          onMoveUp={() => moveLineItemInList(standaloneItems, itemIndex, -1)}
                          onMoveDown={() => moveLineItemInList(standaloneItems, itemIndex, 1)}
                          canMoveUp={itemIndex > 0}
                          canMoveDown={itemIndex < standaloneItems.length - 1}
                          overbookedInfo={item.subHireId != null ? undefined : (overbookedMap as Record<string, OverbookedInfo>)[item.id]}
                          isUnconfirmed={!!item.subHireId && draftSubHireIds.has(item.subHireId)}
                          showCostColumn={showCostColumn}
                          isExpanded={expandedParents.has(item.id)}
                          isSelected={selection.isSelected(`li-${item.id}`)}
                          onClick={(e) => handleRowClick(item.id, e)}
                          onToggle={() => toggleParent(item.id)}
                          onEdit={() => setEditLineItem(item)}
                          onMoveToCategory={() => setMoveItemToCategory({
                            lineItemId: item.id,
                            initialCategoryId: cat.id,
                          })}
                          onMoveToGroup={() => setMoveItemToGroup({
                            lineItemId: item.id,
                          })}
                          onRemove={() => handleRemoveItem(item.id)}
                        />
                      ))}
                    </React.Fragment>
                  );
                })}

                {/* Uncategorized items */}
                {hasCategories && hasUncategorized && (
                  <TableRow className="bg-paper-2/40 hover:bg-paper-2/40">
                    <TableCell colSpan={colCount} className="py-2 px-1">
                      <div className="flex items-center gap-1.5">
                        <div className="w-6" />
                        <h3 className="t-overline text-muted">Uncategorised</h3>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {(() => {
                  const uncatVisible = (uncategorizedItems as LineItemData[]).filter((i) => !isHiddenFromList(i) && !pendingRemovalIds.has(i.id));
                  return uncatVisible.map((item, itemIndex) => (
                  <LineItemRow
                    key={item.id}
                    item={item}
                    indent=""
                    orgId={orgId}
                    projectId={projectId}
                    onMoveUp={() => moveLineItemInList(uncatVisible, itemIndex, -1)}
                    onMoveDown={() => moveLineItemInList(uncatVisible, itemIndex, 1)}
                    canMoveUp={itemIndex > 0}
                    canMoveDown={itemIndex < uncatVisible.length - 1}
                    overbookedInfo={item.subHireId != null ? undefined : (overbookedMap as Record<string, OverbookedInfo>)[item.id]}
                    isUnconfirmed={!!item.subHireId && draftSubHireIds.has(item.subHireId)}
                    showCostColumn={showCostColumn}
                    isExpanded={expandedParents.has(item.id)}
                    isSelected={selection.isSelected(`li-${item.id}`)}
                    onClick={(e) => handleRowClick(item.id, e)}
                    onToggle={() => toggleParent(item.id)}
                    onEdit={() => setEditLineItem(item)}
                    onMoveToCategory={() => setMoveItemToCategory({
                      lineItemId: item.id,
                    })}
                    onMoveToGroup={() => setMoveItemToGroup({
                      lineItemId: item.id,
                    })}
                    onRemove={() => handleRemoveItem(item.id)}
                  />
                  ));
                })()}
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
                      <GroupRow
                        group={group}
                        isExpanded={isExpanded}
                        orgId={orgId}
                        projectId={projectId}
                        lockedBy={lockByTarget.get(targetKey({ targetType: "group", targetId: group.id })) ?? null}
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
                          price: priceVal,
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
                      />
                      {isExpanded && groupItems.length === 0 && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={colCount} className="py-3 text-center text-caption text-muted">
                            No items in this group yet. Add equipment to get started.
                          </TableCell>
                        </TableRow>
                      )}
                      {isExpanded && groupItems.map((item: LineItemData, itemIndex) => (
                        <LineItemRow
                          key={item.id}
                          item={item}
                          indent="ml-12"
                          orgId={orgId}
                          projectId={projectId}
                          onMoveUp={() => moveLineItemInList(groupItems, itemIndex, -1)}
                          onMoveDown={() => moveLineItemInList(groupItems, itemIndex, 1)}
                          canMoveUp={itemIndex > 0}
                          canMoveDown={itemIndex < groupItems.length - 1}
                          overbookedInfo={item.subHireId != null ? undefined : (overbookedMap as Record<string, OverbookedInfo>)[item.id]}
                          isUnconfirmed={!!item.subHireId && draftSubHireIds.has(item.subHireId)}
                          showCostColumn={showCostColumn}
                          isExpanded={expandedParents.has(item.id)}
                          isSelected={selection.isSelected(`li-${item.id}`)}
                          onClick={(e) => handleRowClick(item.id, e)}
                          onToggle={() => toggleParent(item.id)}
                          onEdit={() => setEditLineItem(item)}
                          onMoveToCategory={() => setMoveItemToCategory({
                            lineItemId: item.id,
                          })}
                          onMoveToGroup={() => setMoveItemToGroup({
                            lineItemId: item.id,
                            initialGroupId: group.id,
                          })}
                          onRemove={() => handleRemoveItem(item.id)}
                        />
                      ))}
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
                      <SubHireGroupRow
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
                      />
                      {isExpanded && childItems.length === 0 && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={colCount} className="py-3 text-center text-caption text-muted">
                            No items in this sub-hire group yet.
                          </TableCell>
                        </TableRow>
                      )}
                      {isExpanded && childItems.map((item) => (
                        <LineItemRow
                          key={item.id}
                          item={item}
                          indent="ml-8"
                          overbookedInfo={undefined}
                          isUnconfirmed={!!shGroup.subHire && draftSubHireIds.has(shGroup.subHire.id)}
                          showCostColumn={showCostColumn}
                          isExpanded={expandedParents.has(item.id)}
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
                        />
                      ))}
                    </React.Fragment>
                  );
                })}
              </TableBody>
          </Table>
        </div>
      )}

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
                        className="size-8"
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
        const billable = (servicesData ?? []).filter(
          (s: { showOnDocuments: boolean; status: string }) => s.showOnDocuments && s.status !== "CANCELLED"
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
        projectId={projectId}
        orgId={orgId}
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
        isPending={updateLineItemMut.isPending}
        onClose={() => setEditLineItem(null)}
        onSubmit={(id, data, allowOverbook, baseUpdatedAt) =>
          updateLineItemMut.mutate({
            id,
            data: data as unknown as Record<string, unknown>,
            allowOverbook,
            baseUpdatedAt,
          })
        }
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

      {/* Unified price-edit dialog (Phase 6c — works for both kinds of group). */}
      <PriceEditDialog
        target={priceEditTarget}
        onClose={() => setPriceEditTarget(null)}
        onInvalidate={invalidate}
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
        projectId={projectId}
        orgId={orgId}
        onClose={() => setEditGroupData(null)}
        onSubmit={(groupId, values, price) => {
          updateGroupMut.mutate({ groupId, data: values });
          if (price !== undefined) {
            updateGroupPrice(groupId, price)
              .then(() => invalidate())
              .catch((e: Error) => toast.error(e.message));
          }
        }}
      />
    </div>
  );
}
