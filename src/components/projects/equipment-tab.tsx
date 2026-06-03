"use client";

import React, { Fragment, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Plus, FolderPlus, Package, Pencil, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { getProjectCategories } from "@/server/project-categories";
import { getProjectServices } from "@/server/project-services";
import {
  createProjectGroup,
  updateProjectGroup,
  updateGroupPrice,
  deleteProjectGroup,
  reorderProjectGroups,
  moveLineItemToGroup,
  recalculateGroupPrices,
} from "@/server/project-groups";
import {
  createProjectCategory,
  updateProjectCategory,
  deleteProjectCategory,
  reorderProjectCategories,
  getUncategorizedLineItems,
  getProjectOverbookedStatus,
} from "@/server/project-categories";
import { getGroupTemplates, applyGroupTemplate, saveGroupAsTemplate } from "@/server/group-templates";
import { removeLineItem, updateLineItem, addKitLineItem, checkKitAvailability, reorderLineItems, checkAvailability, addCustomLineItem } from "@/server/line-items";
import { getKits } from "@/server/kits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { formatCurrency } from "@/lib/formatters";
import { useActiveOrganization } from "@/lib/auth-client";
import { CanDo } from "@/components/auth/permission-gate";
import { AddEquipmentDialog } from "./add-equipment-dialog";
import { SubHireOrderDialog } from "./sub-hire-order-dialog";
import { getSubHires } from "@/server/sub-hires";
import { subHireStatusLabels, formatLabel } from "@/lib/status-labels";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { ArrowLeftRight, ChevronDown } from "lucide-react";
import {
  COL_COUNT,
  isRealKitChild,
  isHiddenFromList,
  SortableGroupRow,
  SortableCategoryRow,
  SortableLineItemRow,
  type LineItemData,
  type GroupData,
  type CategoryData,
  type OverbookedInfo,
} from "./equipment-rows";

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

  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showAddEquipment, setShowAddEquipment] = useState(false);
  const [addEquipmentTarget, setAddEquipmentTarget] = useState<{
    categoryId?: string;
    groupId?: string;
    label?: string;
  }>({});

  // Kit dialog state
  const [showKitDialog, setShowKitDialog] = useState(false);
  const [selectedKitId, setSelectedKitId] = useState("");
  const [kitPricingMode, setKitPricingMode] = useState<"KIT_PRICE" | "ITEMIZED">("KIT_PRICE");
  const [kitUnitPrice, setKitUnitPrice] = useState("");

  // Custom item dialog state
  const [showCustomItemDialog, setShowCustomItemDialog] = useState(false);
  const [customItemName, setCustomItemName] = useState("");
  const [customItemQty, setCustomItemQty] = useState("1");
  const [customItemPrice, setCustomItemPrice] = useState("");
  const [customItemPricingType, setCustomItemPricingType] = useState<"PER_DAY" | "PER_WEEK" | "FLAT" | "PER_HOUR">("FLAT");
  const [customItemDuration, setCustomItemDuration] = useState("1");
  const [customItemDiscount, setCustomItemDiscount] = useState("");
  const [customItemIsOptional, setCustomItemIsOptional] = useState(false);
  const [customItemNotes, setCustomItemNotes] = useState("");
  const [customItemCategoryId, setCustomItemCategoryId] = useState("");
  const [customItemGroupId, setCustomItemGroupId] = useState("");

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


  // Kit target state (for adding kits to specific groups)
  const [kitTarget, setKitTarget] = useState<{
    categoryId?: string;
    groupId?: string;
    label?: string;
  }>({});

  // Price edit dialog state
  const [priceEditGroupId, setPriceEditGroupId] = useState<string | null>(null);
  const [priceEditValue, setPriceEditValue] = useState("");

  // Delete confirmation state
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);
  const [deleteGroupInfo, setDeleteGroupInfo] = useState<{
    title: string;
    price: number;
    itemCount: number;
  } | null>(null);

  // Add group from toolbar state
  const [showAddGroupFromToolbar, setShowAddGroupFromToolbar] = useState(false);
  const [toolbarGroupTitle, setToolbarGroupTitle] = useState("");
  const [toolbarGroupCategoryId, setToolbarGroupCategoryId] = useState("");
  const [toolbarGroupTemplateId, setToolbarGroupTemplateId] = useState("");

  // Save group as template dialog state
  const [saveAsTemplateGroup, setSaveAsTemplateGroup] = useState<{ id: string; title: string } | null>(null);
  const [saveAsTemplateName, setSaveAsTemplateName] = useState("");
  const [saveAsTemplateDescription, setSaveAsTemplateDescription] = useState("");

  // Move line item dialog state
  const [moveLineItemId, setMoveLineItemId] = useState<string | null>(null);
  const [moveTargetGroupId, setMoveTargetGroupId] = useState<string>("__uncategorized__");

  // Line item edit dialog state
  const [editLineItem, setEditLineItem] = useState<LineItemData | null>(null);
  const [editQuantity, setEditQuantity] = useState("1");
  const [editUnitPrice, setEditUnitPrice] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDiscount, setEditDiscount] = useState("");
  const [editDiscountMode, setEditDiscountMode] = useState<"$" | "%">("$");
  const [editPriceMode, setEditPriceMode] = useState<"auto" | "manual">("auto");
  const [editNotes, setEditNotes] = useState("");
  const [editOverbookConfirmed, setEditOverbookConfirmed] = useState(false);

  // Group edit dialog state
  const [editGroupData, setEditGroupData] = useState<GroupData | null>(null);
  const [editGroupTitle, setEditGroupTitle] = useState("");
  const [editGroupDescription, setEditGroupDescription] = useState("");
  const [editGroupQuantity, setEditGroupQuantity] = useState("1");
  const [editGroupBillingMonths, setEditGroupBillingMonths] = useState("");
  const [editGroupBillingWeeks, setEditGroupBillingWeeks] = useState("");
  const [editGroupBillingDays, setEditGroupBillingDays] = useState("");
  const [editGroupPrice, setEditGroupPrice] = useState("");

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
  const { data: editAvailability } = useQuery({
    queryKey: [
      "availability",
      orgId,
      editLineItem?.modelId ?? null,
      rentalStartDate?.toISOString() ?? null,
      rentalEndDate?.toISOString() ?? null,
      projectId,
    ],
    queryFn: () =>
      checkAvailability(
        editLineItem!.modelId!,
        rentalStartDate ?? null,
        rentalEndDate ?? null,
        projectId,
      ),
    enabled: !!editLineItem && !!editLineItem.modelId,
  });

  // "Available for this edit" = the server-computed usable pool (effectiveStock
  // minus all overlapping bookings, including this item) plus the current
  // item's own quantity added back. This matches the add dialog's semantics
  // and agrees with the overbook badge.
  const editAvailableForEdit =
    editAvailability && editLineItem
      ? editAvailability.available + editLineItem.quantity
      : null;
  const editRequestedQty = Number(editQuantity) || 1;
  const editIsOverbooked =
    editAvailableForEdit != null && editRequestedQty > editAvailableForEdit;

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
    queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    queryClient.invalidateQueries({ queryKey: ["project-overbooked", projectId] });
    // Any mutation that changes line item quantity/presence must refresh
    // availability so the next add/edit dialog sees fresh booked counts.
    queryClient.invalidateQueries({ queryKey: ["availability"] });
    queryClient.invalidateQueries({ queryKey: ["asset-lookup"] });
  }, [queryClient, queryKey, projectId]);

  // ─── Mutations ───────────────────────────────────────────────────────────

  const addCustomItemMut = useMutation({
    mutationFn: (data: Parameters<typeof addCustomLineItem>[1]) => addCustomLineItem(projectId, data),
    onSuccess: () => {
      invalidate();
      setShowCustomItemDialog(false);
      setCustomItemName("");
      setCustomItemQty("1");
      setCustomItemPrice("");
      setCustomItemPricingType("FLAT");
      setCustomItemDuration("1");
      setCustomItemNotes("");
      setCustomItemCategoryId("");
      setCustomItemGroupId("");
      toast.success("Custom item added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createCategoryMut = useMutation({
    mutationFn: (name: string) => createProjectCategory(projectId, { name }),
    onSuccess: () => {
      invalidate();
      setShowAddCategory(false);
      setNewCategoryName("");
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
      setMoveLineItemId(null);
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

  function openEditLineItem(item: LineItemData) {
    setEditLineItem(item);
    setEditQuantity(String(item.quantity));
    setEditUnitPrice(item.unitPrice != null ? String(Number(item.unitPrice)) : "");
    setEditDescription(item.description ?? item.model?.name ?? "");
    setEditDiscount(item.discount != null && Number(item.discount) > 0 ? String(Number(item.discount)) : "");
    setEditDiscountMode("$");
    setEditPriceMode(item.pricingType === "OPTIMIZED" && !item.priceOverridden ? "auto" : "manual");
    setEditNotes(item.notes ?? "");
    setEditOverbookConfirmed(false);
  }

  function handleSaveEditLineItem() {
    if (!editLineItem) return;
    const qty = Number(editQuantity) || 1;
    const isAuto = editPriceMode === "auto";
    const price = isAuto
      ? (editLineItem.unitPrice != null ? Number(editLineItem.unitPrice) : undefined)
      : (editUnitPrice ? Number(editUnitPrice) : undefined);
    const dur = editLineItem.duration ?? 1;
    let disc: number | undefined;
    if (editDiscount && Number(editDiscount) > 0) {
      if (editDiscountMode === "%" && price != null) {
        disc = Math.round((price * qty * dur * Number(editDiscount)) / 100 * 100) / 100;
      } else {
        disc = Number(editDiscount);
      }
    }
    updateLineItemMut.mutate({
      id: editLineItem.id,
      data: {
        type: editLineItem.type ?? "EQUIPMENT",
        quantity: qty,
        unitPrice: price,
        description: editDescription,
        pricingType: editLineItem.pricingType ?? "PER_DAY",
        duration: dur,
        discount: disc,
        notes: editNotes || undefined,
      },
      allowOverbook: editOverbookConfirmed,
    });
  }

  const saveAsTemplateMut = useMutation({
    mutationFn: ({ groupId, name, description }: { groupId: string; name: string; description?: string }) =>
      saveGroupAsTemplate(groupId, name, description),
    onSuccess: (t: unknown) => {
      const name = (t as { name?: string })?.name ?? "Template";
      toast.success(`Saved as template "${name}"`);
      queryClient.invalidateQueries({ queryKey: ["group-templates"] });
      setSaveAsTemplateGroup(null);
      setSaveAsTemplateName("");
      setSaveAsTemplateDescription("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createGroupMut = useMutation({
    mutationFn: ({ categoryId, title, templateId }: { categoryId: string; title: string; templateId?: string }) => {
      if (templateId) {
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

  const updatePriceMut = useMutation({
    mutationFn: ({ groupId, price }: { groupId: string; price: number }) =>
      updateGroupPrice(groupId, price),
    onSuccess: () => {
      invalidate();
      setPriceEditGroupId(null);
      toast.success("Price updated");
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

  // Kit queries and mutations
  const { data: kitsData } = useQuery({
    queryKey: ["kits", orgId],
    queryFn: () => getKits({ pageSize: 200 }),
    enabled: showKitDialog,
  });

  const { data: kitAvailability } = useQuery({
    queryKey: ["kit-availability", orgId, selectedKitId, projectId],
    queryFn: () => checkKitAvailability(selectedKitId, new Date(), new Date(), projectId),
    enabled: showKitDialog && !!selectedKitId,
  });

  const addKitMut = useMutation({
    mutationFn: () =>
      addKitLineItem(
        projectId,
        selectedKitId,
        kitPricingMode,
        kitPricingMode === "KIT_PRICE" && kitUnitPrice ? parseFloat(kitUnitPrice) : undefined,
        undefined, // groupName
        kitTarget.categoryId,
        kitTarget.groupId,
      ),
    onSuccess: () => {
      invalidate();
      setShowKitDialog(false);
      setSelectedKitId("");
      setKitPricingMode("KIT_PRICE");
      setKitUnitPrice("");
      setKitTarget({});
      toast.success("Kit added to project");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ─── DnD handlers ─────────────────────────────────────────────────────────

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);

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

    // Group reorder
    if (activeId.startsWith("grp-") && overId.startsWith("grp-")) {
      const activeRealId = activeId.slice(4);
      const overRealId = overId.slice(4);
      // Find which category contains these groups
      const cats = categories as CategoryData[];
      const cat = cats.find((c) => c.groups.some((g) => g.id === activeRealId));
      if (!cat) return;

      const oldIndex = cat.groups.findIndex((g) => g.id === activeRealId);
      const newIndex = cat.groups.findIndex((g) => g.id === overRealId);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = [...cat.groups];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);

      reorderProjectGroups(cat.id, reordered.map((g) => g.id)).catch(() => {
        toast.error("Failed to reorder groups");
      });
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
  const hasUncategorized = (uncategorizedItems as LineItemData[]).length > 0;

  // Build a set of draft sub-hire IDs so we can badge unconfirmed items
  const draftSubHireIds = new Set<string>();
  for (const sh of projectSubHires) {
    if (sh.status === "DRAFT") draftSubHireIds.add(sh.id as string);
  }

  // Build flat list of all sortable IDs for the single DndContext
  const allSortableIds: string[] = [];
  for (const cat of typedCategories) {
    allSortableIds.push(`cat-${cat.id}`);
    for (const group of cat.groups) {
      allSortableIds.push(`grp-${group.id}`);
      if (expandedGroups.has(group.id)) {
        for (const item of group.lineItems ?? []) {
          if (!isRealKitChild(item as LineItemData)) allSortableIds.push(`li-${item.id}`);
        }
      }
    }
    for (const item of cat.lineItems ?? []) {
      if (!(item as LineItemData).isKitChild) allSortableIds.push(`li-${item.id}`);
    }
  }
  for (const item of uncategorizedItems as LineItemData[]) {
    if (!isRealKitChild(item)) allSortableIds.push(`li-${item.id}`);
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => {
            setAddEquipmentTarget({});
            setShowAddEquipment(true);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Equipment
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            setKitTarget({});
            setShowKitDialog(true);
          }}
        >
          <Package className="h-3.5 w-3.5" />
          Add Kit
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setShowCustomItemDialog(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          Custom Item
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            setManagingSubHireId(null);
            setShowSubHireOrderDialog(true);
          }}
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
          Sub-Hire Orders
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
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setShowAddCategory(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Category
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
              <col className="w-28 hidden sm:table-column" />
              <col className="w-20" />
            </colgroup>
            <TableHeader>
            <TableRow>
              <TableHead className="px-1" />
              <TableHead>Item</TableHead>
              <TableHead className="text-center">Qty</TableHead>
              <TableHead className="text-right hidden md:table-cell">Unit Price</TableHead>
              <TableHead className="text-right hidden sm:table-cell">Total</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
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
                      <SortableCategoryRow
                        cat={cat}
                        onRename={() => {
                          setRenameCategoryId(cat.id);
                          setRenameCategoryValue(cat.name);
                        }}
                        onDelete={() => deleteCategoryMut.mutate(cat.id)}
                      />

                      {/* Groups within category */}
                      {cat.groups.map((group) => {
                        const isExpanded = expandedGroups.has(group.id);
                        const priceVal = group.price != null ? Number(group.price) : null;
                        const groupItems = (group.lineItems ?? []).filter((i: LineItemData) => !isHiddenFromList(i));
                        return (
                          <React.Fragment key={group.id}>
                            <SortableGroupRow
                              group={group}
                              isExpanded={isExpanded}
                              indented
                              onToggle={() => toggleGroup(group.id)}
                              onDelete={() => {
                                setDeleteGroupId(group.id);
                                setDeleteGroupInfo({
                                  title: group.title,
                                  price: priceVal ?? 0,
                                  itemCount: groupItems.length,
                                });
                              }}
                              onEdit={() => {
                                setEditGroupData(group);
                                setEditGroupTitle(group.title);
                                setEditGroupDescription(group.description ?? "");
                                setEditGroupQuantity(String(group.quantity));
                                setEditGroupBillingMonths(group.billingMonths != null ? String(group.billingMonths) : "");
                                setEditGroupBillingWeeks(group.billingWeeks != null ? String(group.billingWeeks) : "");
                                setEditGroupBillingDays(group.billingDays != null ? String(group.billingDays) : "");
                                setEditGroupPrice(priceVal != null ? String(priceVal) : "");
                              }}
                              onAddEquipment={() => {
                                setAddEquipmentTarget({ categoryId: cat.id, groupId: group.id, label: `${cat.name} > ${group.title}` });
                                setShowAddEquipment(true);
                              }}
                              onAddKit={() => {
                                setKitTarget({ categoryId: cat.id, groupId: group.id, label: `${cat.name} > ${group.title}` });
                                setShowKitDialog(true);
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
                              onSaveAsTemplate={() => {
                                setSaveAsTemplateGroup({ id: group.id, title: group.title });
                                setSaveAsTemplateName(group.title);
                                setSaveAsTemplateDescription(group.description ?? "");
                              }}
                            />
                            {/* Expanded line items */}
                            {isExpanded && groupItems.length === 0 && (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={COL_COUNT} className="py-3 text-center text-xs text-fg-4">
                                  No items in this group yet. Add equipment to get started.
                                </TableCell>
                              </TableRow>
                            )}
                            {isExpanded && groupItems.map((item) => (
                              <SortableLineItemRow
                                key={item.id}
                                item={item}
                                indent="ml-12"
                                overbookedInfo={item.subHireId != null ? undefined : (overbookedMap as Record<string, OverbookedInfo>)[item.id]}
                                isUnconfirmed={!!item.subHireId && draftSubHireIds.has(item.subHireId)}
                                isExpanded={expandedParents.has(item.id)}
                                onToggle={() => toggleParent(item.id)}
                                onEdit={() => openEditLineItem(item)}
                                onMove={() => { setMoveLineItemId(item.id); setMoveTargetGroupId(group.id); }}
                                onRemove={() => removeMut.mutate(item.id)}
                              />
                            ))}
                          </React.Fragment>
                        );
                      })}

                      {/* Standalone line items in category */}
                      {standaloneItems.map((item) => (
                        <SortableLineItemRow
                          key={item.id}
                          item={item}
                          indent="ml-3"
                          overbookedInfo={item.subHireId != null ? undefined : (overbookedMap as Record<string, OverbookedInfo>)[item.id]}
                          isUnconfirmed={!!item.subHireId && draftSubHireIds.has(item.subHireId)}
                          isExpanded={expandedParents.has(item.id)}
                          onToggle={() => toggleParent(item.id)}
                          onEdit={() => openEditLineItem(item)}
                          onMove={() => { setMoveLineItemId(item.id); setMoveTargetGroupId("__uncategorized__"); }}
                          onRemove={() => removeMut.mutate(item.id)}
                        />
                      ))}
                    </React.Fragment>
                  );
                })}

                {/* Uncategorized items */}
                {hasCategories && hasUncategorized && (
                  <TableRow className="bg-bg-inset/30">
                    <TableCell colSpan={COL_COUNT} className="py-2 px-1">
                      <div className="flex items-center gap-1.5">
                        <div className="w-6" />
                        <h3 className="text-sm font-semibold text-fg-4">Uncategorized</h3>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {(uncategorizedItems as LineItemData[]).filter((i) => !isHiddenFromList(i)).map((item) => (
                  <SortableLineItemRow
                    key={item.id}
                    item={item}
                    indent=""
                    overbookedInfo={item.subHireId != null ? undefined : (overbookedMap as Record<string, OverbookedInfo>)[item.id]}
                    isUnconfirmed={!!item.subHireId && draftSubHireIds.has(item.subHireId)}
                    isExpanded={expandedParents.has(item.id)}
                    onToggle={() => toggleParent(item.id)}
                    onEdit={() => openEditLineItem(item)}
                    onMove={() => { setMoveLineItemId(item.id); setMoveTargetGroupId("__uncategorized__"); }}
                    onRemove={() => removeMut.mutate(item.id)}
                  />
                ))}
              </TableBody>
            </SortableContext>
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
            <CanDo resource="subHire" action="create">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setManagingSubHireId(null);
                  setShowSubHireOrderDialog(true);
                }}
              >
                <Plus className="mr-1 h-3 w-3" />
                New
              </Button>
            </CanDo>
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
      <Dialog open={showAddCategory} onOpenChange={setShowAddCategory}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New category</DialogTitle>
            <DialogDescription>
              Categories organize equipment into sections (e.g. RF, IEM, PA).
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Category name"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newCategoryName.trim()) {
                createCategoryMut.mutate(newCategoryName.trim());
              }
            }}
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowAddCategory(false);
                setNewCategoryName("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createCategoryMut.mutate(newCategoryName.trim())}
              disabled={!newCategoryName.trim() || createCategoryMut.isPending}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename category dialog */}
      <Dialog open={renameCategoryId != null} onOpenChange={(open) => { if (!open) setRenameCategoryId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename category</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Category name"
            value={renameCategoryValue}
            onChange={(e) => setRenameCategoryValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameCategoryValue.trim() && renameCategoryId) {
                renameCategoryMut.mutate({ id: renameCategoryId, name: renameCategoryValue.trim() });
              }
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameCategoryId(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (renameCategoryId && renameCategoryValue.trim()) {
                  renameCategoryMut.mutate({ id: renameCategoryId, name: renameCategoryValue.trim() });
                }
              }}
              disabled={!renameCategoryValue.trim() || renameCategoryMut.isPending}
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save group as template dialog */}
      <Dialog
        open={saveAsTemplateGroup != null}
        onOpenChange={(open) => {
          if (!open) {
            setSaveAsTemplateGroup(null);
            setSaveAsTemplateName("");
            setSaveAsTemplateDescription("");
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Save as Template</DialogTitle>
            <DialogDescription>
              Save &quot;{saveAsTemplateGroup?.title}&quot; as a reusable template. Only model- and kit-backed items are captured; free-text lines are skipped.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>Template name</Label>
              <Input
                value={saveAsTemplateName}
                onChange={(e) => setSaveAsTemplateName(e.target.value)}
                placeholder="e.g. Drum Mic Pack"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Input
                value={saveAsTemplateDescription}
                onChange={(e) => setSaveAsTemplateDescription(e.target.value)}
                placeholder="When to use this template..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSaveAsTemplateGroup(null);
                setSaveAsTemplateName("");
                setSaveAsTemplateDescription("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (saveAsTemplateGroup && saveAsTemplateName.trim()) {
                  saveAsTemplateMut.mutate({
                    groupId: saveAsTemplateGroup.id,
                    name: saveAsTemplateName.trim(),
                    description: saveAsTemplateDescription.trim() || undefined,
                  });
                }
              }}
              disabled={!saveAsTemplateName.trim() || saveAsTemplateMut.isPending}
            >
              {saveAsTemplateMut.isPending ? "Saving..." : "Save Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add group from toolbar dialog */}
      <Dialog open={showAddGroupFromToolbar} onOpenChange={(open) => {
        setShowAddGroupFromToolbar(open);
        if (!open) { setToolbarGroupTitle(""); setToolbarGroupCategoryId(""); setToolbarGroupTemplateId(""); }
      }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Group</DialogTitle>
            <DialogDescription>
              Choose a category and name for the new group. Optionally start from a template.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>Category</Label>
              <select
                value={toolbarGroupCategoryId}
                onChange={(e) => setToolbarGroupCategoryId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">Select category...</option>
                {typedCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>
            {templateOptions.length > 0 && (
              <div className="space-y-2">
                <Label>Template (optional)</Label>
                <select
                  value={toolbarGroupTemplateId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setToolbarGroupTemplateId(id);
                    if (id && !toolbarGroupTitle.trim()) {
                      const t = templateOptions.find((o) => o.id === id);
                      if (t) setToolbarGroupTitle(t.name);
                    }
                  }}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">None (empty group)</option>
                  {templateOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.itemCount} {t.itemCount === 1 ? "item" : "items"})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Group Title</Label>
              <Input
                value={toolbarGroupTitle}
                onChange={(e) => setToolbarGroupTitle(e.target.value)}
                placeholder="e.g. PA System, Lighting Rig"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && toolbarGroupTitle.trim() && toolbarGroupCategoryId) {
                    createGroupMut.mutate({
                      categoryId: toolbarGroupCategoryId,
                      title: toolbarGroupTitle.trim(),
                      templateId: toolbarGroupTemplateId || undefined,
                    });
                    setShowAddGroupFromToolbar(false);
                    setToolbarGroupTitle("");
                    setToolbarGroupCategoryId("");
                    setToolbarGroupTemplateId("");
                  }
                }}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowAddGroupFromToolbar(false);
              setToolbarGroupTitle("");
              setToolbarGroupCategoryId("");
              setToolbarGroupTemplateId("");
            }}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (toolbarGroupTitle.trim() && toolbarGroupCategoryId) {
                  createGroupMut.mutate({
                    categoryId: toolbarGroupCategoryId,
                    title: toolbarGroupTitle.trim(),
                    templateId: toolbarGroupTemplateId || undefined,
                  });
                  setShowAddGroupFromToolbar(false);
                  setToolbarGroupTitle("");
                  setToolbarGroupCategoryId("");
                  setToolbarGroupTemplateId("");
                }
              }}
              disabled={!toolbarGroupTitle.trim() || !toolbarGroupCategoryId || createGroupMut.isPending}
            >
              {toolbarGroupTemplateId ? "Create from Template" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Price edit dialog */}
      <Dialog
        open={priceEditGroupId != null}
        onOpenChange={(open) => {
          if (!open) setPriceEditGroupId(null);
        }}
      >
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Set group price</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <span className="text-fg-3">$</span>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={priceEditValue}
              onChange={(e) => setPriceEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && priceEditGroupId) {
                  updatePriceMut.mutate({
                    groupId: priceEditGroupId,
                    price: parseFloat(priceEditValue) || 0,
                  });
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPriceEditGroupId(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (priceEditGroupId) {
                  updatePriceMut.mutate({
                    groupId: priceEditGroupId,
                    price: parseFloat(priceEditValue) || 0,
                  });
                }
              }}
              disabled={updatePriceMut.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteGroupId != null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteGroupId(null);
            setDeleteGroupInfo(null);
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete group</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{deleteGroupInfo?.title}&rdquo;?
            </DialogDescription>
          </DialogHeader>
          {deleteGroupInfo && (
            <div className="rounded-lg bg-bg-inset p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-fg-3">Items</span>
                <span className="text-fg-2">{deleteGroupInfo.itemCount} will become standalone</span>
              </div>
              {deleteGroupInfo.price > 0 && (
                <div className="flex justify-between">
                  <span className="text-fg-3">Revenue impact</span>
                  <span className="font-medium text-[oklch(0.58_0.22_27)]">
                    -{formatCurrency(deleteGroupInfo.price)}
                  </span>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteGroupId(null);
                setDeleteGroupInfo(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteGroupId && deleteGroupMut.mutate(deleteGroupId)}
              disabled={deleteGroupMut.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit line item dialog */}
      <Dialog open={editLineItem != null} onOpenChange={(open) => { if (!open) setEditLineItem(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Input
                id="edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-quantity">Quantity</Label>
              <Input
                id="edit-quantity"
                type="number"
                min={1}
                value={editQuantity}
                onChange={(e) => setEditQuantity(e.target.value)}
              />
              {editAvailability && editLineItem?.modelId && (
                <div className="space-y-1 pt-1">
                  <p className={editIsOverbooked ? "text-sm text-red-600 dark:text-red-400" : "text-sm text-fg-3"}>
                    <span className="font-semibold">{editAvailableForEdit ?? 0}</span>{" "}
                    available out of{" "}
                    <span className="font-semibold">{editAvailability.effectiveStock ?? editAvailability.totalStock}</span>{" "}
                    {editAvailability.dateless ? "in stock" : "usable"}
                    {editAvailability.dateless && (
                      <span className="text-fg-3 font-normal">
                        {" "}(no dates set — showing stock only)
                      </span>
                    )}
                  </p>
                  {(editAvailability.unavailable ?? 0) > 0 && (
                    <p className="text-purple-600 dark:text-purple-400 text-xs">
                      {editAvailability.unavailable} of {editAvailability.totalStock} total not usable
                      {" "}({[
                        editAvailability.inMaintenance ? `${editAvailability.inMaintenance} in maintenance` : "",
                        editAvailability.lost ? `${editAvailability.lost} lost` : "",
                      ].filter(Boolean).join(", ")})
                    </p>
                  )}
                  {editAvailability.conflicts && editAvailability.conflicts.length > 0 && (
                    <div className="flex items-start gap-2 text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <div>
                        <p className="text-xs font-medium">Conflicts:</p>
                        <ul className="list-disc pl-4 text-xs">
                          {editAvailability.conflicts.map((c: string) => (
                            <li key={c}>{c}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Pricing section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Pricing</Label>
                {editLineItem?.pricingType === "OPTIMIZED" && (
                  <button
                    type="button"
                    onClick={() => {
                      if (editPriceMode === "auto") {
                        setEditPriceMode("manual");
                        setEditUnitPrice(editLineItem.unitPrice != null ? String(Number(editLineItem.unitPrice)) : "");
                      } else {
                        setEditPriceMode("auto");
                        setEditUnitPrice("");
                      }
                    }}
                    className="text-xs text-primary hover:underline"
                  >
                    {editPriceMode === "auto" ? "Set manual price" : "Revert to auto"}
                  </button>
                )}
              </div>

              {editPriceMode === "auto" && editLineItem?.pricingType === "OPTIMIZED" ? (
                <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-primary">Auto-priced</span>
                    <span className="text-sm font-semibold">
                      {formatCurrency(editLineItem.unitPrice != null ? Number(editLineItem.unitPrice) : null)}
                    </span>
                  </div>
                  {editLineItem.priceBreakdown && (
                    <p className="text-xs text-fg-3 mt-0.5">{editLineItem.priceBreakdown}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Input
                    id="edit-unitPrice"
                    type="number"
                    step="0.01"
                    min={0}
                    value={editUnitPrice}
                    onChange={(e) => setEditUnitPrice(e.target.value)}
                    placeholder="Enter price"
                  />
                  {editLineItem?.pricingType === "OPTIMIZED" && (
                    <p className="text-xs text-amber-500">This will override the auto-calculated price</p>
                  )}
                </div>
              )}

              {/* Discount row */}
              <div className="flex items-center gap-2">
                <Label htmlFor="edit-discount" className="shrink-0 text-sm">Discount</Label>
                <div className="flex gap-1 flex-1">
                  <Input
                    id="edit-discount"
                    type="number"
                    step="0.01"
                    min={0}
                    placeholder="0"
                    value={editDiscount}
                    onChange={(e) => setEditDiscount(e.target.value)}
                    className="flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => setEditDiscountMode(editDiscountMode === "$" ? "%" : "$")}
                    className="shrink-0 w-9 h-9 rounded-md border border-input text-sm font-medium hover:bg-accent transition-colors"
                  >
                    {editDiscountMode}
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-notes">Notes</Label>
              <Textarea
                id="edit-notes"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={2}
              />
            </div>

            {editIsOverbooked && (
              <div className="rounded-md border border-red-500/50 bg-red-500/10 p-3 space-y-2">
                <p className="text-sm font-medium text-red-600 dark:text-red-400">
                  <AlertTriangle className="inline-block mr-1.5 h-3.5 w-3.5" />
                  {rentalStartDate && rentalEndDate
                    ? `This will overbook ${editRequestedQty} units with only ${editAvailableForEdit ?? 0} available across overlapping projects`
                    : `Only ${editAvailableForEdit ?? 0} in stock — requesting ${editRequestedQty}`}
                </p>
                {editAvailability?.dateless && (
                  <p className="text-xs text-red-600/80 dark:text-red-400/80">
                    No dates set — checking stock only (not cross-project conflicts)
                  </p>
                )}
                {editAvailability?.conflicts && editAvailability.conflicts.length > 0 && (
                  <p className="text-xs text-red-600/80 dark:text-red-400/80">
                    Conflicts with: {editAvailability.conflicts.join(", ")}
                  </p>
                )}
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editOverbookConfirmed}
                    onChange={(e) => setEditOverbookConfirmed(e.target.checked)}
                    className="accent-red-500"
                  />
                  <span className="text-red-600 dark:text-red-400">I understand, overbook anyway</span>
                </label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditLineItem(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveEditLineItem}
              disabled={updateLineItemMut.isPending || (editIsOverbooked && !editOverbookConfirmed)}
            >
              {updateLineItemMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move line item dialog */}
      <Dialog open={moveLineItemId != null} onOpenChange={(open) => { if (!open) setMoveLineItemId(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Move Item</DialogTitle>
            <DialogDescription>
              Choose a destination group for this item.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <select
              value={moveTargetGroupId}
              onChange={(e) => setMoveTargetGroupId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="__uncategorized__">Uncategorized (no group)</option>
              {typedCategories.map((cat) =>
                cat.groups.map((g) => (
                  <option key={g.id} value={`${cat.id}|${g.id}`}>
                    {cat.name} &gt; {g.title}
                  </option>
                ))
              )}
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveLineItemId(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!moveLineItemId) return;
                if (moveTargetGroupId === "__uncategorized__") {
                  moveLineItemMut.mutate({ lineItemId: moveLineItemId, targetGroupId: null, targetCategoryId: null });
                } else {
                  const [catId, grpId] = moveTargetGroupId.split("|");
                  moveLineItemMut.mutate({ lineItemId: moveLineItemId, targetGroupId: grpId, targetCategoryId: catId });
                }
              }}
              disabled={moveLineItemMut.isPending}
            >
              {moveLineItemMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add custom item dialog */}
      <Dialog
        open={showCustomItemDialog}
        onOpenChange={(open) => {
          setShowCustomItemDialog(open);
          if (!open) {
            setCustomItemName("");
            setCustomItemQty("1");
            setCustomItemPrice("");
            setCustomItemPricingType("FLAT");
            setCustomItemDuration("1");
            setCustomItemDiscount("");
            setCustomItemIsOptional(false);
            setCustomItemNotes("");
            setCustomItemCategoryId("");
            setCustomItemGroupId("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Custom Item</DialogTitle>
            <DialogDescription>
              Add a free-text item not in your inventory. It will appear on documents and in the warehouse.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="custom-item-name">Name <span className="text-error">*</span></Label>
              <Input
                id="custom-item-name"
                placeholder="e.g. 2x SM58 (borrowed), Client cable drum"
                value={customItemName}
                onChange={(e) => setCustomItemName(e.target.value)}
                maxLength={200}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={customItemCategoryId}
                  onChange={(e) => {
                    setCustomItemCategoryId(e.target.value);
                    setCustomItemGroupId("");
                  }}
                >
                  <option value="">Uncategorized</option>
                  {(categories as CategoryData[]).map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Group</Label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={customItemGroupId}
                  onChange={(e) => setCustomItemGroupId(e.target.value)}
                  disabled={!customItemCategoryId}
                >
                  <option value="">No group</option>
                  {customItemCategoryId && (categories as CategoryData[])
                    .find((c) => c.id === customItemCategoryId)
                    ?.groups.map((g) => (
                      <option key={g.id} value={g.id}>{g.title}</option>
                    ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="custom-item-qty">Quantity</Label>
                <Input
                  id="custom-item-qty"
                  type="number"
                  min="1"
                  value={customItemQty}
                  onChange={(e) => setCustomItemQty(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="custom-item-price">Unit Price</Label>
                <Input
                  id="custom-item-price"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={customItemPrice}
                  onChange={(e) => setCustomItemPrice(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Pricing Type</Label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={customItemPricingType}
                  onChange={(e) => setCustomItemPricingType(e.target.value as typeof customItemPricingType)}
                >
                  <option value="FLAT">Flat</option>
                  <option value="PER_DAY">Per Day</option>
                  <option value="PER_WEEK">Per Week</option>
                  <option value="PER_HOUR">Per Hour</option>
                </select>
              </div>
              {customItemPricingType !== "FLAT" && (
                <div className="space-y-1.5">
                  <Label htmlFor="custom-item-duration">Duration</Label>
                  <Input
                    id="custom-item-duration"
                    type="number"
                    min="1"
                    value={customItemDuration}
                    onChange={(e) => setCustomItemDuration(e.target.value)}
                  />
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="custom-item-discount">Discount</Label>
                <Input
                  id="custom-item-discount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={customItemDiscount}
                  onChange={(e) => setCustomItemDiscount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-2 pt-7">
                  <input
                    type="checkbox"
                    className="rounded border-border"
                    checked={customItemIsOptional}
                    onChange={(e) => setCustomItemIsOptional(e.target.checked)}
                  />
                  Optional (excluded from project total)
                </Label>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="custom-item-notes">Notes</Label>
              <Textarea
                id="custom-item-notes"
                placeholder="Optional notes..."
                value={customItemNotes}
                onChange={(e) => setCustomItemNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCustomItemDialog(false)}>
              Cancel
            </Button>
            <Button
              disabled={!customItemName.trim() || addCustomItemMut.isPending}
              onClick={() => {
                addCustomItemMut.mutate({
                  description: customItemName.trim(),
                  quantity: parseInt(customItemQty) || 1,
                  unitPrice: customItemPrice !== "" ? parseFloat(customItemPrice) : undefined,
                  pricingType: customItemPricingType,
                  duration: customItemPricingType !== "FLAT" ? (parseInt(customItemDuration) || 1) : 1,
                  discount: customItemDiscount !== "" ? parseFloat(customItemDiscount) : undefined,
                  isOptional: customItemIsOptional,
                  notes: customItemNotes.trim() || undefined,
                  categoryId: customItemCategoryId || undefined,
                  groupId: customItemGroupId || undefined,
                });
              }}
            >
              {addCustomItemMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add equipment dialog */}
      {showAddEquipment && (
        <AddEquipmentDialog
          projectId={projectId}
          rentalStartDate={rentalStartDate ?? undefined}
          rentalEndDate={rentalEndDate ?? undefined}
          open={showAddEquipment}
          onOpenChange={setShowAddEquipment}
          categoryId={addEquipmentTarget.categoryId}
          groupId={addEquipmentTarget.groupId}
          targetLabel={addEquipmentTarget.label}
          onOpenSubHire={() => {
            setManagingSubHireId(null);
            setShowSubHireOrderDialog(true);
          }}
        />
      )}


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

      {/* Add kit dialog */}
      <Dialog
        open={showKitDialog}
        onOpenChange={(open) => {
          setShowKitDialog(open);
          if (!open) {
            setSelectedKitId("");
            setKitPricingMode("KIT_PRICE");
            setKitUnitPrice("");
            setKitTarget({});
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Kit to Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {kitTarget.label && (
              <div className="rounded-md bg-accent/50 px-3 py-2 text-xs text-fg-3">
                Adding to <span className="font-medium text-fg">{kitTarget.label}</span>
              </div>
            )}
            <div className="space-y-2">
              <Label>Kit</Label>
              <ComboboxPicker
                value={selectedKitId}
                onChange={setSelectedKitId}
                options={(kitsData?.kits || []).map((kit: { id: string; assetTag: string; name: string; category?: { name: string } | null }) => ({
                  value: kit.id,
                  label: `${kit.assetTag} - ${kit.name}`,
                  description: kit.category?.name,
                }))}
                placeholder="Select a kit..."
                searchPlaceholder="Search kits..."
                emptyMessage="No kits found."
              />
            </div>

            {selectedKitId && kitAvailability && !kitAvailability.available && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                Kit is unavailable: {kitAvailability.conflictsWith}
              </div>
            )}

            <div className="space-y-2">
              <Label>Pricing Mode</Label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="kitPricingMode"
                    value="KIT_PRICE"
                    checked={kitPricingMode === "KIT_PRICE"}
                    onChange={() => setKitPricingMode("KIT_PRICE")}
                    className="accent-primary"
                  />
                  Kit Price
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="kitPricingMode"
                    value="ITEMIZED"
                    checked={kitPricingMode === "ITEMIZED"}
                    onChange={() => setKitPricingMode("ITEMIZED")}
                    className="accent-primary"
                  />
                  Itemized
                </label>
              </div>
              <p className="text-xs text-fg-3">
                {kitPricingMode === "KIT_PRICE"
                  ? "One price for the whole kit."
                  : "Each item in the kit priced individually."}
              </p>
            </div>

            {kitPricingMode === "KIT_PRICE" && (
              <div className="space-y-2">
                <Label>Unit Price</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={kitUnitPrice}
                  onChange={(e) => setKitUnitPrice(e.target.value)}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={() => addKitMut.mutate()}
              disabled={
                !selectedKitId ||
                addKitMut.isPending ||
                (kitAvailability && !kitAvailability.available)
              }
            >
              {addKitMut.isPending ? "Adding..." : "Add Kit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit group dialog */}
      <Dialog
        open={editGroupData != null}
        onOpenChange={(open) => {
          if (!open) setEditGroupData(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Group</DialogTitle>
            <DialogDescription>
              Update the group&apos;s title, description, and quantity.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={editGroupTitle}
                onChange={(e) => setEditGroupTitle(e.target.value)}
                placeholder="Group title"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={editGroupDescription}
                onChange={(e) => setEditGroupDescription(e.target.value)}
                placeholder="Optional description..."
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input
                type="number"
                min="1"
                value={editGroupQuantity}
                onChange={(e) => setEditGroupQuantity(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Price</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={editGroupPrice}
                onChange={(e) => setEditGroupPrice(e.target.value)}
                placeholder="Leave blank for no price"
              />
              {editGroupData?.suggestedPrice != null && (
                <button
                  type="button"
                  className="text-xs text-fg-3 hover:text-fg transition-colors"
                  onClick={() => setEditGroupPrice(String(Number(editGroupData.suggestedPrice)))}
                >
                  Suggested: {formatCurrency(Number(editGroupData.suggestedPrice))}
                </button>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground text-xs">Billing Override (leave blank to use project defaults)</Label>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label>Months</Label>
                  <Input
                    type="number"
                    min="0"
                    value={editGroupBillingMonths}
                    onChange={(e) => setEditGroupBillingMonths(e.target.value)}
                    placeholder="—"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Weeks</Label>
                  <Input
                    type="number"
                    min="0"
                    value={editGroupBillingWeeks}
                    onChange={(e) => setEditGroupBillingWeeks(e.target.value)}
                    placeholder="—"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Days</Label>
                  <Input
                    type="number"
                    min="0"
                    value={editGroupBillingDays}
                    onChange={(e) => setEditGroupBillingDays(e.target.value)}
                    placeholder="—"
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditGroupData(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (editGroupData && editGroupTitle.trim()) {
                  updateGroupMut.mutate({
                    groupId: editGroupData.id,
                    data: {
                      title: editGroupTitle.trim(),
                      description: editGroupDescription.trim() || undefined,
                      quantity: parseInt(editGroupQuantity) || 1,
                      billingMonths: editGroupBillingMonths !== "" ? parseInt(editGroupBillingMonths) : undefined,
                      billingWeeks: editGroupBillingWeeks !== "" ? parseInt(editGroupBillingWeeks) : undefined,
                      billingDays: editGroupBillingDays !== "" ? parseInt(editGroupBillingDays) : undefined,
                    },
                  });
                  if (editGroupPrice !== "") {
                    updatePriceMut.mutate({
                      groupId: editGroupData.id,
                      price: parseFloat(editGroupPrice) || 0,
                    });
                  }
                }
              }}
              disabled={!editGroupTitle.trim() || updateGroupMut.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Sub-Hire Expanded Items ──────────────────────────────────────────────────

function SubHireExpandedItems({ subHireId, orgId }: { subHireId: string; orgId?: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subHire } = useQuery<any>({
    queryKey: ["sub-hire", orgId, subHireId],
    queryFn: async () => {
      const { getSubHire } = await import("@/server/sub-hires");
      return getSubHire(subHireId);
    },
    enabled: !!orgId,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = (subHire?.items || []) as Array<Record<string, any>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groups = (subHire?.groups || []) as Array<Record<string, any>>;
  const ungroupedItems = items.filter((item) => !item.groupId);

  if (items.length === 0 && groups.length === 0) {
    return (
      <div className="pb-3 ml-4 border-l-2 border-primary/20 pl-8 text-xs text-fg-4 py-2">
        No items in this order yet.
      </div>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function renderItemRow(item: Record<string, any>, indent: string) {
    const itemMargin = Number(item.unitCharge) - Number(item.unitCost);
    return (
      <tr key={item.id as string} className="text-sm">
        <td className={`${indent} py-1.5 text-fg-2`}>
          {item.description as string}
          {(item.model as Record<string, string>)?.name && (
            <span className="ml-1.5 text-xs text-fg-4">({(item.model as Record<string, string>).name})</span>
          )}
        </td>
        <td className="px-3 py-1.5 text-right tabular-nums text-fg-3 w-12">&times;{item.quantity as number}</td>
        <td className="px-3 py-1.5 text-right tabular-nums text-fg-3 w-24">{formatCurrency(Number(item.unitCost))} cost</td>
        <td className="px-3 py-1.5 text-right tabular-nums w-24">{formatCurrency(Number(item.unitCharge))}</td>
        <td className={`px-3 py-1.5 text-right tabular-nums w-20 ${itemMargin > 0 ? "text-success" : itemMargin < 0 ? "text-error" : "text-fg-4"}`}>
          {formatCurrency(itemMargin)}
        </td>
      </tr>
    );
  }

  return (
    <div className="pb-2 ml-4 border-l-2 border-primary/20">
      <table className="w-full">
        <tbody>
          {groups.map((group) => {
            const groupItems = (group.items || []) as Array<Record<string, unknown>>;
            return (
              <Fragment key={group.id}>
                <tr className="text-xs">
                  <td colSpan={5} className="pl-8 py-1.5 font-medium text-fg-3">
                    <span className="text-primary/70">▸</span> {group.title}
                    <span className="ml-1.5 text-fg-4 font-normal">({groupItems.length} item{groupItems.length !== 1 ? "s" : ""})</span>
                  </td>
                </tr>
                {groupItems.map((item) => renderItemRow(item, "pl-12"))}
              </Fragment>
            );
          })}
          {ungroupedItems.map((item) => renderItemRow(item, "pl-8"))}
        </tbody>
      </table>
    </div>
  );
}
