"use client";

import React, { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  DragOverlay,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Plus, FolderPlus, Pencil } from "lucide-react";
import { toast } from "sonner";

import { getProjectCategories } from "@/server/project-categories";
import { getProjectServices } from "@/server/project-services";
import {
  createProjectGroup,
  updateProjectGroup,
  deleteProjectGroup,
  reorderProjectGroups,
  moveLineItemToGroup,
  recalculateGroupPrices,
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
import { getGroupTemplates, applyGroupTemplate, saveGroupAsTemplate } from "@/server/group-templates";
import { removeLineItem, updateLineItem, reorderLineItems } from "@/server/line-items";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/formatters";
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
  getDisallowedDropReason,
  type LineItemData,
  type GroupData,
  type CategoryData,
  type SubHireGroupData,
  type MixedGroupSlot,
  type OverbookedInfo,
} from "./equipment-rows";
import { useSelection } from "./use-selection";

interface EquipmentTabProps {
  projectId: string;
  rentalStartDate?: Date | null;
  rentalEndDate?: Date | null;
}

// ─── Main component ──────────────────────────────────────────────────────────

export function EquipmentTab({ projectId, rentalStartDate, rentalEndDate }: EquipmentTabProps) {
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // The sortable ID currently being hovered with a disallowed drop (Drop
  // Matrix 8C). Cleared on drag end / leave. Row components read this to
  // render the red left-edge rejection bar + not-allowed cursor.
  const [rejectedDropTargetId, setRejectedDropTargetId] = useState<string | null>(null);

  // Multi-select DnD state
  const selection = useSelection();
  const [activeMultiDrag, setActiveMultiDrag] = useState<string[] | null>(null);

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const queryKey = ["project-categories", projectId];

  const { data: categories = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => getProjectCategories(projectId),
    staleTime: 60_000,
  });

  const { data: uncategorizedItems = [] } = useQuery({
    queryKey: ["uncategorized-items", projectId],
    queryFn: () => getUncategorizedLineItems(projectId),
    staleTime: 60_000,
  });

  const { data: uncategorizedSubHireGroups = [] } = useQuery({
    queryKey: ["uncategorized-subhire-groups", projectId],
    queryFn: () => getUncategorizedSubHireGroups(projectId),
    staleTime: 60_000,
  });

  const { data: uncategorizedProjectGroups = [] } = useQuery({
    queryKey: ["uncategorized-project-groups", projectId],
    queryFn: () => getUncategorizedProjectGroups(projectId),
    staleTime: 60_000,
  });

  const { data: templates = [] } = useQuery({
    queryKey: ["group-templates"],
    queryFn: () => getGroupTemplates(),
    staleTime: 60_000,
  });

  const { data: servicesData } = useQuery({
    queryKey: ["project-services", projectId],
    queryFn: () => getProjectServices(projectId),
    staleTime: 60_000,
  });

  const { data: overbookedMap = {} } = useQuery({
    queryKey: ["project-overbooked", projectId],
    queryFn: () => getProjectOverbookedStatus(projectId),
    staleTime: 30_000,
  });

  // Availability check for the currently-edited line item (equipment w/ modelId only)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: projectSubHires = [] } = useQuery<any[]>({
    queryKey: ["project-sub-hires", orgId, projectId],
    queryFn: () => getSubHires({ projectId }),
  });

  const templateOptions = (templates as { id: string; name: string; description: string | null; items: unknown[] }[]).map(
    (t) => ({ id: t.id, name: t.name, description: t.description, itemCount: t.items.length })
  );

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ["uncategorized-items", projectId] });
    queryClient.invalidateQueries({ queryKey: ["uncategorized-subhire-groups", projectId] });
    queryClient.invalidateQueries({ queryKey: ["uncategorized-project-groups", projectId] });
    queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    queryClient.invalidateQueries({ queryKey: ["project-overbooked", projectId] });
    // Any mutation that changes line item quantity/presence must refresh
    // availability so the next add/edit dialog sees fresh booked counts.
    queryClient.invalidateQueries({ queryKey: ["availability"] });
    queryClient.invalidateQueries({ queryKey: ["asset-lookup"] });
  }, [queryClient, queryKey, projectId]);

  // ─── Mutations ───────────────────────────────────────────────────────────

  const createCategoryMut = useMutation({
    mutationFn: (name: string) => createProjectCategory(projectId, { name }),
    onSuccess: () => {
      invalidate();
      setShowAddCategory(false);
      toast.success("Category created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const renameCategoryMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateProjectCategory(id, { name }),
    onSuccess: () => {
      invalidate();
      setRenameCategoryId(null);
      toast.success("Category renamed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteCategoryMut = useMutation({
    mutationFn: (id: string) => deleteProjectCategory(id),
    onSuccess: () => {
      invalidate();
      toast.success("Category deleted — items moved to uncategorized");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const moveLineItemMut = useMutation({
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

  const updateLineItemMut = useMutation({
    mutationFn: ({ id, data, allowOverbook }: { id: string; data: Record<string, unknown>; allowOverbook?: boolean }) =>
      updateLineItem(id, data as Parameters<typeof updateLineItem>[1], allowOverbook ?? false),
    onSuccess: () => {
      invalidate();
      setEditLineItem(null);
      toast.success("Item updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => removeLineItem(id),
    onSuccess: () => {
      invalidate();
      toast.success("Item removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const saveAsTemplateMut = useMutation({
    mutationFn: ({ groupId, name, description }: { groupId: string; name: string; description?: string }) =>
      saveGroupAsTemplate(groupId, name, description),
    onSuccess: (t: unknown) => {
      const name = (t as { name?: string })?.name ?? "Template";
      toast.success(`Saved as template "${name}"`);
      queryClient.invalidateQueries({ queryKey: ["group-templates"] });
      setSaveAsTemplateGroup(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createGroupMut = useMutation({
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


  const deleteGroupMut = useMutation({
    mutationFn: (groupId: string) => deleteProjectGroup(groupId),
    onSuccess: () => {
      invalidate();
      setDeleteGroupId(null);
      setDeleteGroupInfo(null);
      toast.success("Group deleted — items moved to standalone");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateGroupMut = useMutation({
    mutationFn: ({ groupId, data }: { groupId: string; data: Partial<{ title: string; description: string; quantity: number; billingMonths: number; billingWeeks: number; billingDays: number }> }) =>
      updateProjectGroup(groupId, data),
    onSuccess: () => {
      invalidate();
      setEditGroupData(null);
      toast.success("Group updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ─── DnD handlers ─────────────────────────────────────────────────────────

  /** Resolve the category id of whatever sortable row the drag landed on.
   *  Returns the cat id, `null` for the uncategorised zone, or "unknown"
   *  if the over id doesn't map to a known row (defensive). */
  function findCategoryOfOverId(overId: string): string | null | "unknown" {
    const cats = categories as CategoryData[];
    if (overId.startsWith("cat-")) return overId.slice(4);
    if (overId.startsWith("grp-")) {
      const id = overId.slice(4);
      const cat = cats.find((c) => c.groups.some((g) => g.id === id));
      return cat ? cat.id : "unknown";
    }
    if (overId.startsWith("shg-")) {
      const id = overId.slice(4);
      const cat = cats.find((c) => (c.subHireGroupTargets ?? []).some((g) => g.id === id));
      if (cat) return cat.id;
      const orphans = uncategorizedSubHireGroups as SubHireGroupData[];
      if (orphans.some((g) => g.id === id)) return null;
      return "unknown";
    }
    if (overId.startsWith("li-")) {
      const id = overId.slice(3);
      for (const cat of cats) {
        if ((cat.lineItems ?? []).some((i) => i.id === id)) return cat.id;
        for (const group of cat.groups) {
          if ((group.lineItems ?? []).some((i) => i.id === id)) return cat.id;
        }
      }
      const uncat = uncategorizedItems as LineItemData[];
      if (uncat.some((i) => i.id === id)) return null;
      return "unknown";
    }
    return "unknown";
  }

  function handleDragStart(event: DragStartEvent) {
    const activeId = String(event.active.id);
    if (
      activeId.startsWith("li-") &&
      selection.isSelected(activeId) &&
      selection.selectionSize > 1
    ) {
      setActiveMultiDrag(Array.from(selection.selectedIds));
    } else {
      setActiveMultiDrag(null);
    }
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) {
      if (rejectedDropTargetId !== null) setRejectedDropTargetId(null);
      return;
    }
    const overId = String(over.id);

    if (activeMultiDrag && activeMultiDrag.length > 1) {
      const anyRejected = activeMultiDrag.some((id) => getDisallowedDropReason(id, overId));
      const next = anyRejected ? overId : null;
      if (next !== rejectedDropTargetId) setRejectedDropTargetId(next);
      return;
    }

    const reason = getDisallowedDropReason(String(active.id), overId);
    const next = reason ? overId : null;
    if (next !== rejectedDropTargetId) setRejectedDropTargetId(next);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setRejectedDropTargetId(null);
    const prevMultiDrag = activeMultiDrag;
    setActiveMultiDrag(null);
    if (!over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    // Drop Matrix 8C — reject disallowed combinations with an explanatory
    // toast before any mutation runs.
    const disallowedReason = getDisallowedDropReason(activeId, overId);
    if (disallowedReason) {
      toast.error(disallowedReason);
      return;
    }

    // Multi-item drag — batch-move all selected line items
    if (prevMultiDrag && prevMultiDrag.length > 1) {
      const idsToMove = prevMultiDrag.filter((id) => id.startsWith("li-"));
      if (idsToMove.length > 0) {
        let targetGroupId: string | null = null;
        let targetCategoryId: string | null = null;

        if (overId.startsWith("grp-")) {
          targetGroupId = overId.slice(4);
        } else if (overId.startsWith("cat-")) {
          targetCategoryId = overId.slice(4);
        } else if (overId.startsWith("li-")) {
          const overRealId = overId.slice(3);
          const cats = categories as CategoryData[];
          for (const cat of cats) {
            for (const group of cat.groups) {
              if ((group.lineItems ?? []).some((i) => i.id === overRealId)) {
                targetGroupId = group.id;
                break;
              }
            }
            if (targetGroupId) break;
            if ((cat.lineItems ?? []).some((i) => i.id === overRealId)) {
              targetCategoryId = cat.id;
              break;
            }
          }
          if (!targetGroupId && !targetCategoryId) {
            const uncatItems = uncategorizedItems as LineItemData[];
            if (uncatItems.some((i) => i.id === overRealId)) {
              targetCategoryId = null;
            }
          }
        } else {
          return;
        }

        let successCount = 0;
        let failCount = 0;
        let lastError = "";
        const promises = idsToMove.map((id) =>
          moveLineItemToGroup({
            lineItemId: id.slice(3),
            targetGroupId,
            targetCategoryId,
          })
            .then(() => { successCount++; })
            .catch((e: Error) => {
              failCount++;
              lastError = e.message;
            }),
        );
        Promise.all(promises).then(() => {
          if (failCount === 0) {
            toast.success(`Moved ${successCount} items`);
          } else {
            toast.error(`Moved ${successCount} items. ${failCount} could not be moved: ${lastError}`);
          }
          invalidate();
        });
      }
      return;
    }

    // Cross-category sub-hire group move (Phase 5d.b — Drop Matrix 8C row
    // "SubHireGroup → ProjectCategory" allowed). Fires before the
    // within-category reorder branch below so dragging a sub-hire group
    // from cat A to cat B issues a placement write, not a reorder.
    if (activeId.startsWith("shg-")) {
      const activeRealId = activeId.slice(4);
      const cats = categories as CategoryData[];
      const sourceCat = cats.find((c) =>
        (c.subHireGroupTargets ?? []).some((g) => g.id === activeRealId),
      );
      const sourceCatId: string | null = sourceCat?.id ?? null;
      const targetCatId = findCategoryOfOverId(overId);
      if (targetCatId !== "unknown" && sourceCatId !== targetCatId) {
        moveSubHireGroupToCategory({ groupId: activeRealId, categoryId: targetCatId })
          .then(() => {
            toast.success(
              targetCatId === null
                ? "Moved sub-hire group to uncategorised"
                : "Moved sub-hire group",
            );
          })
          .catch((e: Error) => toast.error(e.message));
        invalidate();
        return;
      }
    }

    // Category reorder
    if (activeId.startsWith("cat-") && overId.startsWith("cat-")) {
      const cats = categories as CategoryData[];
      const activeRealId = activeId.slice(4);
      const overRealId = overId.slice(4);
      const oldIndex = cats.findIndex((c) => c.id === activeRealId);
      const newIndex = cats.findIndex((c) => c.id === overRealId);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = [...cats];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);

      reorderProjectCategories(projectId, reordered.map((c) => c.id)).catch(() => {
        toast.error("Failed to reorder categories");
      });
      invalidate();
      return;
    }

    // Group-level reorder (project group OR sub-hire group, in any
    // combination). Within the same category, both move types route
    // through reorderMixedGroupsInCategory which owns the cross-type
    // CategorySlot sortOrder. If the destination category has no
    // sub-hire groups (and neither active nor over is a sub-hire group),
    // we keep the lighter reorderProjectGroups path so categories that
    // never touch the unified shape don't pay for CategorySlot writes.
    const activeIsGroupSlot = activeId.startsWith("grp-") || activeId.startsWith("shg-");
    const overIsGroupSlot = overId.startsWith("grp-") || overId.startsWith("shg-");
    if (activeIsGroupSlot && overIsGroupSlot) {
      const activeKind: "project" | "subHire" = activeId.startsWith("grp-") ? "project" : "subHire";
      const overKind: "project" | "subHire" = overId.startsWith("grp-") ? "project" : "subHire";
      const activeRealId = activeId.startsWith("grp-") ? activeId.slice(4) : activeId.slice(4);
      const overRealId = overId.startsWith("grp-") ? overId.slice(4) : overId.slice(4);

      const cats = categories as CategoryData[];
      const findCatForGroup = (kind: "project" | "subHire", id: string) => {
        if (kind === "project") {
          return cats.find((c) => c.groups.some((g) => g.id === id));
        }
        return cats.find((c) => (c.subHireGroupTargets ?? []).some((g) => g.id === id));
      };
      const activeCat = findCatForGroup(activeKind, activeRealId);
      const overCat = findCatForGroup(overKind, overRealId);
      if (!activeCat || !overCat) return;
      // Cross-category moves are handled in Phase 5d.b — for 5d.a we only
      // wire within-category reorders. Bail out cleanly if cats differ.
      if (activeCat.id !== overCat.id) return;

      const cat = activeCat;
      // Build current mixed-ordered slot list for this category.
      const mixed: MixedGroupSlot[] = cat.mixedGroups ?? cat.groups.map((g) => ({
        kind: "project" as const,
        sortOrder: g.sortOrder,
        projectGroupId: g.id,
      }));
      const oldIndex = mixed.findIndex((s) =>
        s.kind === "project"
          ? activeKind === "project" && s.projectGroupId === activeRealId
          : activeKind === "subHire" && s.subHireGroupId === activeRealId,
      );
      const newIndex = mixed.findIndex((s) =>
        s.kind === "project"
          ? overKind === "project" && s.projectGroupId === overRealId
          : overKind === "subHire" && s.subHireGroupId === overRealId,
      );
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = [...mixed];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);

      const hasAnySubHire = reordered.some((s) => s.kind === "subHire");
      if (!hasAnySubHire) {
        // Pure project-group reorder — keep the lighter path.
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
      return;
    }

    // Line item reorder
    if (activeId.startsWith("li-") && overId.startsWith("li-")) {
      const activeRealId = activeId.slice(3);
      const overRealId = overId.slice(3);

      // Find the item list containing both items
      const cats = categories as CategoryData[];
      let items: LineItemData[] | undefined;

      // Check groups
      for (const cat of cats) {
        for (const group of cat.groups) {
          const groupItems = group.lineItems ?? [];
          if (groupItems.some((i) => i.id === activeRealId)) {
            items = groupItems;
            break;
          }
        }
        if (items) break;
        // Check standalone items
        const standalone = cat.lineItems ?? [];
        if (standalone.some((i) => i.id === activeRealId)) {
          items = standalone;
          break;
        }
      }
      // Check uncategorized
      if (!items) {
        const uncatItems = uncategorizedItems as LineItemData[];
        if (uncatItems.some((i) => i.id === activeRealId)) {
          items = uncatItems;
        }
      }

      if (!items) return;

      const oldIndex = items.findIndex((i) => i.id === activeRealId);
      const newIndex = items.findIndex((i) => i.id === overRealId);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = [...items];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);

      reorderLineItems(projectId, reordered.map((i) => i.id)).catch(() => {
        toast.error("Failed to reorder items");
      });
      invalidate();
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-fg-4">
        Loading equipment...
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

  // Build flat list of all sortable IDs for the single DndContext.
  // Walks each category's mixed group list in canonical (CategorySlot)
  // order so the DnD context sees sub-hire group rows interleaved with
  // project group rows. Falls back to cat.groups when mixedGroups isn't
  // present (e.g. an HMR-stale cached response).
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

  return (
    <div className="space-y-3" data-shortcut-scope="equipment">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        {/* Single Add entry — opens UnifiedAddDialog. Tabs inside the
            dialog (own-stock / kit / sub-hire / custom) replace the four
            old toolbar buttons. Defaults to whichever kind was used last,
            falling back to "own-stock". */}
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => {
            setUnifiedAddTarget({});
            setShowUnifiedAdd(true);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setShowAddGroupFromToolbar(true)}
        >
          <FolderPlus className="h-3.5 w-3.5" />
          Add Group
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setShowAddCategory(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Category
        </Button>
        <div className="flex-1" />
        <Button
          variant={showCostColumn ? "default" : "outline"}
          size="sm"
          className="gap-1.5"
          onClick={toggleShowCostColumn}
          title="Toggle the supplier-cost column so margin is visible at a glance"
        >
          {showCostColumn ? "Hide margin" : "Show margin"}
        </Button>
      </div>

      {/* Empty state */}
      {!hasCategories && !hasUncategorized && (
        <div className="rounded-lg border border-dashed border-foreground/10 py-12 text-center">
          <p className="text-sm text-fg-3">No categories yet.</p>
          <p className="mt-1 text-xs text-fg-4">
            Create a category (e.g. &quot;RF&quot;, &quot;IEM&quot;, &quot;PA&quot;) to organize your equipment.
          </p>
        </div>
      )}

      {/* Main table */}
      {(hasCategories || hasUncategorized) && (
        <div className="rounded-md border overflow-x-auto">
          <Table className="table-fixed">
            <colgroup>
              <col className="w-10" />
              <col />
              <col className="w-16" />
              <col className="w-28 hidden md:table-column" />
              <col className="w-20 hidden lg:table-column" />
              {showCostColumn && <col className="w-24 hidden md:table-column" />}
              <col className="w-28 hidden sm:table-column" />
              <col className="w-20" />
            </colgroup>
            <TableHeader>
            <TableRow>
              <TableHead className="px-1" />
              <TableHead>Item</TableHead>
              <TableHead className="text-center">Qty</TableHead>
              <TableHead className="text-right hidden md:table-cell">Unit Price</TableHead>
              {showCostColumn && (
                <TableHead className="text-right hidden md:table-cell">Cost</TableHead>
              )}
              <TableHead className="text-right hidden sm:table-cell">Total</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={() => {
              setRejectedDropTargetId(null);
              setActiveMultiDrag(null);
            }}
          >
            <SortableContext
              items={allSortableIds}
              strategy={verticalListSortingStrategy}
            >
              <TableBody>
                {typedCategories.map((cat) => {
                  const standaloneItems = (cat.lineItems ?? []).filter((i: LineItemData) => !isHiddenFromList(i));

                  return (
                    <React.Fragment key={cat.id}>
                      {/* Category label row — sortable */}
                      <CategoryRow
                        cat={cat}
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
                      {(cat.mixedGroups ?? cat.groups.map<MixedGroupSlot>((g) => ({
                        kind: "project" as const,
                        sortOrder: g.sortOrder,
                        projectGroupId: g.id,
                      }))).map((slot) => {
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
                                isRejectedDropTarget={rejectedDropTargetId === `shg-${shGroup.id}`}
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
                              />
                              {isExpanded && childItems.length === 0 && (
                                <TableRow className="hover:bg-transparent">
                                  <TableCell colSpan={colCount} className="py-3 text-center text-xs text-fg-4">
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
                                  onRemove={() => removeMut.mutate(item.id)}
                                />
                              ))}
                            </React.Fragment>
                          );
                        }
                        const group = cat.groups.find((g) => g.id === slot.projectGroupId);
                        if (!group) return null;
                        const isExpanded = expandedGroups.has(group.id);
                        const priceVal = group.price != null ? Number(group.price) : null;
                        const groupItems = (group.lineItems ?? []).filter((i: LineItemData) => !isHiddenFromList(i));
                        return (
                          <React.Fragment key={group.id}>
                            <GroupRow
                              group={group}
                              isExpanded={isExpanded}
                              indented
                              isRejectedDropTarget={rejectedDropTargetId === `grp-${group.id}`}
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
                              onRecalculate={async () => {
                                try {
                                  const count = await recalculateGroupPrices(group.id);
                                  if (count === 0) {
                                    toast.info("No items to recalculate");
                                  } else {
                                    toast.success(`Prices updated for ${count} item${count !== 1 ? "s" : ""}`);
                                  }
                                  queryClient.invalidateQueries({ queryKey: ["project-categories"] });
                                  queryClient.invalidateQueries({ queryKey: ["project-line-items"] });
                                } catch (e) {
                                  toast.error(e instanceof Error ? e.message : "Failed to recalculate");
                                }
                              }}
                              onSaveAsTemplate={() => setSaveAsTemplateGroup({ id: group.id, title: group.title })}
                              onMove={() => setMoveProjectGroup({ id: group.id, title: group.title })}
                            />
                            {/* Expanded line items */}
                            {isExpanded && groupItems.length === 0 && (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={colCount} className="py-3 text-center text-xs text-fg-4">
                                  No items in this group yet. Add equipment to get started.
                                </TableCell>
                              </TableRow>
                            )}
                            {isExpanded && groupItems.map((item) => (
                              <LineItemRow
                                key={item.id}
                                item={item}
                                indent="ml-12"
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
                                onRemove={() => removeMut.mutate(item.id)}
                              />
                            ))}
                          </React.Fragment>
                        );
                      })}

                      {/* Standalone line items in category */}
                      {standaloneItems.map((item) => (
                        <LineItemRow
                          key={item.id}
                          item={item}
                          indent="ml-3"
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
                          onRemove={() => removeMut.mutate(item.id)}
                        />
                      ))}
                    </React.Fragment>
                  );
                })}

                {/* Uncategorized items */}
                {hasCategories && hasUncategorized && (
                  <TableRow className="bg-bg-inset/30">
                    <TableCell colSpan={colCount} className="py-2 px-1">
                      <div className="flex items-center gap-1.5">
                        <div className="w-6" />
                        <h3 className="text-sm font-semibold text-fg-4">Uncategorized</h3>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {(uncategorizedItems as LineItemData[]).filter((i) => !isHiddenFromList(i)).map((item) => (
                  <LineItemRow
                    key={item.id}
                    item={item}
                    indent=""
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
                    onRemove={() => removeMut.mutate(item.id)}
                  />
                ))}
                {/* Orphan PROJECT groups — categoryId IS NULL (v0.9.4.0
                    allows groups to live uncategorised). Render with the
                    full GroupRow affordances (kebab, Move, Delete) so
                    they're first-class citizens of the Uncategorized
                    zone alongside orphan sub-hire groups. */}
                {orphanProjectGroups.map((group) => {
                  const isExpanded = expandedGroups.has(group.id);
                  const priceVal = group.price != null ? Number(group.price) : null;
                  const groupItems = (group.lineItems ?? []).filter((i: LineItemData) => !isHiddenFromList(i));
                  return (
                    <React.Fragment key={`pg-${group.id}`}>
                      <GroupRow
                        group={group}
                        isExpanded={isExpanded}
                        isRejectedDropTarget={rejectedDropTargetId === `grp-${group.id}`}
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
                          <TableCell colSpan={colCount} className="py-3 text-center text-xs text-fg-4">
                            No items in this group yet. Add equipment to get started.
                          </TableCell>
                        </TableRow>
                      )}
                      {isExpanded && groupItems.map((item: LineItemData) => (
                        <LineItemRow
                          key={item.id}
                          item={item}
                          indent="ml-12"
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
                          onRemove={() => removeMut.mutate(item.id)}
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
                        isRejectedDropTarget={rejectedDropTargetId === `shg-${shGroup.id}`}
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
                          <TableCell colSpan={colCount} className="py-3 text-center text-xs text-fg-4">
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
                          onRemove={() => removeMut.mutate(item.id)}
                        />
                      ))}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </SortableContext>
            <DragOverlay>
              {activeMultiDrag && activeMultiDrag.length > 1 && (
                <div className="bg-primary text-primary-foreground rounded-full px-3 py-1 text-sm font-medium shadow-lg">
                  {activeMultiDrag.length} items
                </div>
              )}
            </DragOverlay>
          </DndContext>
          </Table>
        </div>
      )}

      {/* ─── Sub-Hire Orders ──────────────────────────────────────────────── */}
      {projectSubHires.length > 0 && (
        <div className="mt-6 rounded-lg border border-border/50 bg-card">
          <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-medium text-fg-2">Sub-Hire Orders</h3>
              <span className="text-xs text-fg-4">({projectSubHires.length})</span>
            </div>
          </div>
          <div className="divide-y divide-border/30">
            {projectSubHires.map((sh: Record<string, unknown>) => {
              const shId = sh.id as string;
              const isExpanded = expandedSubHires.has(shId);
              const margin = Number(sh.totalCharge) - Number(sh.totalCost);
              const isOverdue = sh.status === "ON_HIRE" && sh.hireEnd && new Date(sh.hireEnd as string) < new Date();
              const itemCount = (sh._count as Record<string, number>)?.items || 0;
              return (
                <div key={shId}>
                  <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-elevated/50 transition-colors">
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
                      className="text-fg-3 hover:text-fg transition-colors"
                    >
                      <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium">{sh.orderNumber as string}</span>
                        <span className="text-sm text-fg-3">{(sh.supplier as Record<string, unknown>)?.name as string}</span>
                        {isOverdue ? (
                          <StatusIndicator category="subHire" intent="error" label="Overdue" value="OVERDUE" />
                        ) : (
                          <StatusIndicator
                            category="subHire"
                            value={sh.status as string}
                            label={subHireStatusLabels[sh.status as string] || formatLabel(sh.status as string)}
                          />
                        )}
                        <span className="text-xs text-fg-4">{itemCount} item{itemCount !== 1 ? "s" : ""}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div className="text-sm tabular-nums">{formatCurrency(Number(sh.totalCharge))}</div>
                        <div className={`text-xs tabular-nums ${margin > 0 ? "text-success" : margin < 0 ? "text-error" : "text-fg-4"}`}>
                          {margin > 0 ? "+" : ""}{formatCurrency(margin)}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setManagingSubHireId(shId);
                          setShowSubHireOrderDialog(true);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
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
          <div className="mt-6 rounded-lg border border-border/50 bg-card">
            <div className="flex items-center gap-2 border-b border-border/50 px-4 py-3">
              <h3 className="text-sm font-medium text-muted-foreground">Services on Documents</h3>
              <span className="text-xs text-muted-foreground/60">({billable.length})</span>
            </div>
            <div className="divide-y divide-border/30">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {billable.map((svc: any) => (
                <div key={svc.id} className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{svc.title}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{svc.type.replace("_", " ")}</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    {svc.lineTotal != null && Number(svc.lineTotal) > 0 && (
                      <span className="text-foreground">{formatCurrency(Number(svc.lineTotal))}</span>
                    )}
                    {svc.costTotal != null && Number(svc.costTotal) > 0 && (
                      <span className="text-xs text-muted-foreground">Cost: {formatCurrency(Number(svc.costTotal))}</span>
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
        isPending={updateLineItemMut.isPending}
        onClose={() => setEditLineItem(null)}
        onSubmit={(id, data, allowOverbook) =>
          updateLineItemMut.mutate({
            id,
            data: data as unknown as Record<string, unknown>,
            allowOverbook,
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
