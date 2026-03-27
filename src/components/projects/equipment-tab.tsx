"use client";

import React, { useState, useCallback } from "react";
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
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, FolderPlus, Package, ArrowUpRight, MoreHorizontal, Trash2, Pencil, Loader2, ArrowRightLeft, ChevronRight, GripVertical } from "lucide-react";
import { toast } from "sonner";

import { getProjectCategories } from "@/server/project-categories";
import {
  createProjectGroup,
  updateProjectGroup,
  updateGroupPrice,
  deleteProjectGroup,
  reorderProjectGroups,
  moveLineItemToGroup,
} from "@/server/project-groups";
import {
  createProjectCategory,
  updateProjectCategory,
  deleteProjectCategory,
  reorderProjectCategories,
  getUncategorizedLineItems,
} from "@/server/project-categories";
import { getGroupTemplates, applyGroupTemplate } from "@/server/group-templates";
import { removeLineItem, updateLineItem, addKitLineItem, checkKitAvailability, reorderLineItems } from "@/server/line-items";
import { getKits } from "@/server/kits";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { AddEquipmentDialog } from "./add-equipment-dialog";
import { AddSubhireDialog } from "./add-subhire-dialog";

interface EquipmentTabProps {
  projectId: string;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface LineItemData {
  id: string;
  description: string | null;
  quantity: number;
  unitPrice: unknown;
  lineTotal: unknown;
  pricingType?: string;
  duration?: number;
  notes?: string | null;
  isOptional?: boolean;
  type?: string;
  model?: { name: string; dailyRate?: unknown; weeklyRate?: unknown } | null;
  asset?: { assetTag?: string | null } | null;
}

interface GroupData {
  id: string;
  title: string;
  description: string | null;
  quantity: number;
  price: unknown;
  suggestedPrice: unknown;
  rentalPeriod: string | null;
  rentalQuantity: number | null;
  billingWeeks: number | null;
  billingDays: number | null;
  sortOrder: number;
  lineItems?: LineItemData[];
}

interface CategoryData {
  id: string;
  name: string;
  sortOrder: number;
  groups: GroupData[];
  lineItems?: LineItemData[];
}

const pricingLabels: Record<string, string> = {
  PER_DAY: "/day",
  PER_WEEK: "/week",
  FLAT: "flat",
  PER_HOUR: "/hr",
};

// ─── Sortable group row ─────────────────────────────────────────────────────

function SortableGroupRow({
  group,
  isExpanded,
  onToggle,
  onEditPrice,
  onDelete,
  onEdit,
  onAddEquipment,
  onAddKit,
  onAddSubhire,
}: {
  group: GroupData;
  isExpanded: boolean;
  onToggle: () => void;
  onEditPrice: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onAddEquipment: () => void;
  onAddKit: () => void;
  onAddSubhire: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: group.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const priceVal = group.price != null ? Number(group.price) : null;
  const itemCount = group.lineItems?.length ?? 0;

  return (
    <TableRow ref={setNodeRef} style={style} className="group/row bg-bg-inset/30">
      <TableCell className="w-8 px-1">
        <button
          type="button"
          className="flex h-full cursor-grab items-center px-1 text-fg-3 hover:text-fg active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </TableCell>
      <TableCell className="pl-6">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-1.5 text-left"
          >
            <ChevronRight
              className={`h-4 w-4 shrink-0 text-fg-3 transition-transform ${
                isExpanded ? "rotate-90" : ""
              }`}
            />
            <span className="font-medium">{group.title}</span>
          </button>
          <Badge variant="outline" className="text-xs">
            {itemCount} item{itemCount !== 1 ? "s" : ""}
          </Badge>
          {group.quantity > 1 && (
            <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-600 border-blue-500/20">
              x{group.quantity}
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="text-center">{group.quantity}</TableCell>
      <TableCell className="text-right hidden md:table-cell">
        {priceVal != null ? formatCurrency(priceVal) : "--"}
      </TableCell>
      <TableCell className="text-center hidden lg:table-cell">
        {group.rentalQuantity ?? "--"}
      </TableCell>
      <TableCell className="text-right font-medium hidden sm:table-cell">
        {priceVal != null ? formatCurrency(priceVal * group.quantity) : "--"}
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="opacity-0 group-hover/row:opacity-100 transition-opacity" />}>
            <MoreHorizontal className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Group</DropdownMenuLabel>
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="mr-2 h-3.5 w-3.5" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onEditPrice}>
                <Pencil className="mr-2 h-3.5 w-3.5" />
                Set Price
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onAddEquipment}>
                <Plus className="mr-2 h-3.5 w-3.5" />
                Add Equipment
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onAddKit}>
                <Package className="mr-2 h-3.5 w-3.5" />
                Add Kit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onAddSubhire}>
                <ArrowUpRight className="mr-2 h-3.5 w-3.5" />
                Add Subhire
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onDelete}
                className="text-[oklch(0.58_0.22_27)]"
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

// ─── Sortable category row ──────────────────────────────────────────────────

function SortableCategoryRow({
  cat,
  categoryTotal,
  onRename,
  onDelete,
}: {
  cat: CategoryData;
  categoryTotal: number;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: cat.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <TableRow ref={setNodeRef} style={style} className="group/cat bg-transparent hover:bg-transparent border-b-0">
      <TableCell className="w-8 px-1">
        <button
          type="button"
          className="flex h-full cursor-grab items-center px-1 text-fg-4 opacity-0 group-hover/cat:opacity-100 transition-opacity hover:text-fg-3 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      </TableCell>
      <TableCell colSpan={4} className="py-1.5">
        <span className="text-xs font-semibold text-fg-3">{cat.name}</span>
      </TableCell>
      <TableCell className="text-right font-medium text-xs text-fg-3">
        {formatCurrency(categoryTotal)}
      </TableCell>
      <TableCell>
        <div className="opacity-0 group-hover/cat:opacity-100 transition-opacity">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
              <MoreHorizontal className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Category</DropdownMenuLabel>
                <DropdownMenuItem onClick={onRename}>
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={onDelete}
                  className="text-[oklch(0.58_0.22_27)]"
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── Sortable line item row ──────────────────────────────────────────────────

function SortableLineItemRow({
  item,
  indent,
  onEdit,
  onMove,
  onRemove,
}: {
  item: LineItemData;
  indent: string;
  onEdit: () => void;
  onMove: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <TableRow ref={setNodeRef} style={style} className="group/row">
      <TableCell className="w-8 px-1">
        <button
          type="button"
          className="flex h-full cursor-grab items-center px-1 text-fg-4 opacity-0 group-hover/row:opacity-100 transition-opacity hover:text-fg-3 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      </TableCell>
      <TableCell className={indent}>
        <div className="flex items-center gap-2">
          <span className="truncate text-fg-2">
            {item.model?.name ?? item.description ?? "—"}
          </span>
          {item.asset?.assetTag && (
            <span className="text-xs text-fg-4">({item.asset.assetTag})</span>
          )}
          {item.isOptional && (
            <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/20">
              Optional
            </Badge>
          )}
          {item.type === "SUBHIRE" && (
            <Badge variant="outline" className="text-xs bg-cyan-500/10 text-cyan-600 border-cyan-500/20">
              Subhire
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="text-center">{item.quantity}</TableCell>
      <TableCell className="text-right hidden md:table-cell">
        {formatCurrency(item.unitPrice != null ? Number(item.unitPrice) : null)}
        {item.unitPrice != null && item.pricingType && (
          <span className="text-xs text-fg-3 ml-0.5">
            {pricingLabels[item.pricingType] ?? ""}
          </span>
        )}
      </TableCell>
      <TableCell className="text-center hidden lg:table-cell">
        {item.duration ?? "--"}
      </TableCell>
      <TableCell className="text-right font-medium hidden sm:table-cell">
        {formatCurrency(item.lineTotal != null ? Number(item.lineTotal) : null)}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
          <Button variant="ghost" size="icon-sm" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onMove}>
            <ArrowRightLeft className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onRemove}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function EquipmentTab({ projectId }: EquipmentTabProps) {
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

  // Subhire dialog state
  const [showSubhireDialog, setShowSubhireDialog] = useState(false);
  const [subhireTarget, setSubhireTarget] = useState<{
    categoryId?: string;
    groupId?: string;
    label?: string;
  }>({});

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

  // Move line item dialog state
  const [moveLineItemId, setMoveLineItemId] = useState<string | null>(null);
  const [moveTargetGroupId, setMoveTargetGroupId] = useState<string>("__uncategorized__");

  // Line item edit dialog state
  const [editLineItem, setEditLineItem] = useState<LineItemData | null>(null);
  const [editQuantity, setEditQuantity] = useState("1");
  const [editUnitPrice, setEditUnitPrice] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPricingType, setEditPricingType] = useState("PER_DAY");
  const [editDuration, setEditDuration] = useState("1");
  const [editNotes, setEditNotes] = useState("");

  // Group edit dialog state
  const [editGroupData, setEditGroupData] = useState<GroupData | null>(null);
  const [editGroupTitle, setEditGroupTitle] = useState("");
  const [editGroupDescription, setEditGroupDescription] = useState("");
  const [editGroupQuantity, setEditGroupQuantity] = useState("1");
  const [editGroupBillingWeeks, setEditGroupBillingWeeks] = useState("");
  const [editGroupBillingDays, setEditGroupBillingDays] = useState("");

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

  const templateOptions = (templates as { id: string; name: string; description: string | null; items: unknown[] }[]).map(
    (t) => ({ id: t.id, name: t.name, description: t.description, itemCount: t.items.length })
  );

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ["uncategorized-items", projectId] });
    queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  }, [queryClient, queryKey, projectId]);

  // ─── Mutations ───────────────────────────────────────────────────────────

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
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      updateLineItem(id, data as Parameters<typeof updateLineItem>[1]),
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
    setEditPricingType(item.pricingType ?? "PER_DAY");
    setEditDuration(String(item.duration ?? 1));
    setEditNotes(item.notes ?? "");
  }

  function handleSaveEditLineItem() {
    if (!editLineItem) return;
    updateLineItemMut.mutate({
      id: editLineItem.id,
      data: {
        type: editLineItem.type ?? "EQUIPMENT",
        quantity: Number(editQuantity) || 1,
        unitPrice: editUnitPrice ? Number(editUnitPrice) : undefined,
        description: editDescription,
        pricingType: editPricingType,
        duration: Number(editDuration) || 1,
        notes: editNotes || undefined,
      },
    });
  }

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
    mutationFn: ({ groupId, data }: { groupId: string; data: Partial<{ title: string; description: string; quantity: number; billingWeeks: number; billingDays: number }> }) =>
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

  function handleGroupDragEnd(categoryId: string, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const cat = (categories as CategoryData[]).find((c) => c.id === categoryId);
    if (!cat) return;

    const oldIndex = cat.groups.findIndex((g) => g.id === active.id);
    const newIndex = cat.groups.findIndex((g) => g.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = [...cat.groups];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);

    reorderProjectGroups(categoryId, reordered.map((g) => g.id)).catch(() => {
      toast.error("Failed to reorder groups");
    });
    invalidate();
  }

  function handleCategoryDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const cats = categories as CategoryData[];
    const oldIndex = cats.findIndex((c) => c.id === active.id);
    const newIndex = cats.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = [...cats];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);

    reorderProjectCategories(projectId, reordered.map((c) => c.id)).catch(() => {
      toast.error("Failed to reorder categories");
    });
    invalidate();
  }

  function handleLineItemDragEnd(groupId: string | null, items: LineItemData[], event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = [...items];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);

    reorderLineItems(projectId, reordered.map((i) => i.id)).catch(() => {
      toast.error("Failed to reorder items");
    });
    invalidate();
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
  const COL_COUNT = 7;

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
          onClick={() => {
            setSubhireTarget({});
            setShowSubhireDialog(true);
          }}
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
          Add Subhire
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8 px-1" />
              <TableHead>ITEM</TableHead>
              <TableHead className="text-center">QTY</TableHead>
              <TableHead className="text-right hidden md:table-cell">UNIT PRICE</TableHead>
              <TableHead className="text-center hidden lg:table-cell">DURATION</TableHead>
              <TableHead className="text-right hidden sm:table-cell">TOTAL</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Categories — sortable */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleCategoryDragEnd}
            >
              <SortableContext
                items={typedCategories.map((c) => c.id)}
                strategy={verticalListSortingStrategy}
              >
                {typedCategories.map((cat) => {
                  const categoryTotal = cat.groups.reduce((sum, g) => {
                    const price = g.price != null ? Number(g.price) : 0;
                    return sum + price * g.quantity;
                  }, 0) + (cat.lineItems ?? []).reduce((sum, li) => {
                    return sum + (li.lineTotal != null ? Number(li.lineTotal) : 0);
                  }, 0);

                  const standaloneItems = cat.lineItems ?? [];

                  return (
                    <React.Fragment key={cat.id}>
                      {/* Category label row — sortable */}
                      <SortableCategoryRow
                        cat={cat}
                        categoryTotal={categoryTotal}
                        onRename={() => {
                          setRenameCategoryId(cat.id);
                          setRenameCategoryValue(cat.name);
                        }}
                        onDelete={() => deleteCategoryMut.mutate(cat.id)}
                      />

                      {/* Groups within category — sortable */}
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={(e) => handleGroupDragEnd(cat.id, e)}
                      >
                        <SortableContext
                          items={cat.groups.map((g) => g.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          {cat.groups.map((group) => {
                            const isExpanded = expandedGroups.has(group.id);
                            const priceVal = group.price != null ? Number(group.price) : null;
                            const groupItems = group.lineItems ?? [];
                            return (
                              <React.Fragment key={group.id}>
                                <SortableGroupRow
                                  group={group}
                                  isExpanded={isExpanded}
                                  onToggle={() => toggleGroup(group.id)}
                                  onEditPrice={() => {
                                    setPriceEditGroupId(group.id);
                                    setPriceEditValue(priceVal != null ? String(priceVal) : "");
                                  }}
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
                                    setEditGroupBillingWeeks(group.billingWeeks != null ? String(group.billingWeeks) : "");
                                    setEditGroupBillingDays(group.billingDays != null ? String(group.billingDays) : "");
                                  }}
                                  onAddEquipment={() => {
                                    setAddEquipmentTarget({ categoryId: cat.id, groupId: group.id, label: `${cat.name} > ${group.title}` });
                                    setShowAddEquipment(true);
                                  }}
                                  onAddKit={() => {
                                    setKitTarget({ categoryId: cat.id, groupId: group.id, label: `${cat.name} > ${group.title}` });
                                    setShowKitDialog(true);
                                  }}
                                  onAddSubhire={() => {
                                    setSubhireTarget({ categoryId: cat.id, groupId: group.id, label: `${cat.name} > ${group.title}` });
                                    setShowSubhireDialog(true);
                                  }}
                                />
                                {/* Expanded line items — sortable */}
                                {isExpanded && groupItems.length === 0 && (
                                  <TableRow className="hover:bg-transparent">
                                    <TableCell colSpan={COL_COUNT} className="pl-10 py-3 text-center text-xs text-fg-4">
                                      No items in this group yet. Add equipment to get started.
                                    </TableCell>
                                  </TableRow>
                                )}
                                {isExpanded && groupItems.length > 0 && (
                                  <DndContext
                                    sensors={sensors}
                                    collisionDetection={closestCenter}
                                    onDragEnd={(e) => handleLineItemDragEnd(group.id, groupItems, e)}
                                  >
                                    <SortableContext
                                      items={groupItems.map((i) => i.id)}
                                      strategy={verticalListSortingStrategy}
                                    >
                                      {groupItems.map((item) => (
                                        <SortableLineItemRow
                                          key={item.id}
                                          item={item}
                                          indent="pl-10"
                                          onEdit={() => openEditLineItem(item)}
                                          onMove={() => { setMoveLineItemId(item.id); setMoveTargetGroupId("__uncategorized__"); }}
                                          onRemove={() => removeMut.mutate(item.id)}
                                        />
                                      ))}
                                    </SortableContext>
                                  </DndContext>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </SortableContext>
                      </DndContext>

                      {/* Standalone line items in category — sortable */}
                      {standaloneItems.length > 0 && (
                        <DndContext
                          sensors={sensors}
                          collisionDetection={closestCenter}
                          onDragEnd={(e) => handleLineItemDragEnd(null, standaloneItems, e)}
                        >
                          <SortableContext
                            items={standaloneItems.map((i) => i.id)}
                            strategy={verticalListSortingStrategy}
                          >
                            {standaloneItems.map((item) => (
                              <SortableLineItemRow
                                key={item.id}
                                item={item}
                                indent="pl-6"
                                onEdit={() => openEditLineItem(item)}
                                onMove={() => { setMoveLineItemId(item.id); setMoveTargetGroupId("__uncategorized__"); }}
                                onRemove={() => removeMut.mutate(item.id)}
                              />
                            ))}
                          </SortableContext>
                        </DndContext>
                      )}
                    </React.Fragment>
                  );
                })}
              </SortableContext>
            </DndContext>

            {/* Uncategorized items — sortable, plain rows */}
            {hasUncategorized && (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(e) => handleLineItemDragEnd(null, uncategorizedItems as LineItemData[], e)}
              >
                <SortableContext
                  items={(uncategorizedItems as LineItemData[]).map((i) => i.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {(uncategorizedItems as LineItemData[]).map((item) => (
                    <SortableLineItemRow
                      key={item.id}
                      item={item}
                      indent="pl-3"
                      onEdit={() => openEditLineItem(item)}
                      onMove={() => { setMoveLineItemId(item.id); setMoveTargetGroupId("__uncategorized__"); }}
                      onRemove={() => removeMut.mutate(item.id)}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            )}
          </TableBody>
        </Table>
      )}

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

      {/* Add group from toolbar dialog */}
      <Dialog open={showAddGroupFromToolbar} onOpenChange={(open) => {
        setShowAddGroupFromToolbar(open);
        if (!open) { setToolbarGroupTitle(""); setToolbarGroupCategoryId(""); }
      }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Group</DialogTitle>
            <DialogDescription>
              Choose a category and name for the new group.
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
            <div className="space-y-2">
              <Label>Group Title</Label>
              <Input
                value={toolbarGroupTitle}
                onChange={(e) => setToolbarGroupTitle(e.target.value)}
                placeholder="e.g. PA System, Lighting Rig"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && toolbarGroupTitle.trim() && toolbarGroupCategoryId) {
                    createGroupMut.mutate({ categoryId: toolbarGroupCategoryId, title: toolbarGroupTitle.trim() });
                    setShowAddGroupFromToolbar(false);
                    setToolbarGroupTitle("");
                    setToolbarGroupCategoryId("");
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
            }}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (toolbarGroupTitle.trim() && toolbarGroupCategoryId) {
                  createGroupMut.mutate({ categoryId: toolbarGroupCategoryId, title: toolbarGroupTitle.trim() });
                  setShowAddGroupFromToolbar(false);
                  setToolbarGroupTitle("");
                  setToolbarGroupCategoryId("");
                }
              }}
              disabled={!toolbarGroupTitle.trim() || !toolbarGroupCategoryId || createGroupMut.isPending}
            >
              Create
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

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-quantity">Quantity</Label>
                <Input
                  id="edit-quantity"
                  type="number"
                  min={1}
                  value={editQuantity}
                  onChange={(e) => setEditQuantity(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-unitPrice">Unit Price ($)</Label>
                <Input
                  id="edit-unitPrice"
                  type="number"
                  step="0.01"
                  min={0}
                  value={editUnitPrice}
                  onChange={(e) => setEditUnitPrice(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-pricingType">Pricing Type</Label>
                <select
                  id="edit-pricingType"
                  value={editPricingType}
                  onChange={(e) => setEditPricingType(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="PER_DAY">Per Day</option>
                  <option value="PER_WEEK">Per Week</option>
                  <option value="FLAT">Flat</option>
                  <option value="PER_HOUR">Per Hour</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-duration">Duration</Label>
                <Input
                  id="edit-duration"
                  type="number"
                  min={1}
                  value={editDuration}
                  onChange={(e) => setEditDuration(e.target.value)}
                />
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditLineItem(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEditLineItem} disabled={updateLineItemMut.isPending}>
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

      {/* Add equipment dialog */}
      {showAddEquipment && (
        <AddEquipmentDialog
          projectId={projectId}
          open={showAddEquipment}
          onOpenChange={setShowAddEquipment}
          categoryId={addEquipmentTarget.categoryId}
          groupId={addEquipmentTarget.groupId}
          targetLabel={addEquipmentTarget.label}
        />
      )}

      {/* Add subhire dialog */}
      <AddSubhireDialog
        projectId={projectId}
        open={showSubhireDialog}
        onOpenChange={(open) => {
          setShowSubhireDialog(open);
          if (!open) setSubhireTarget({});
        }}
        categoryId={subhireTarget.categoryId}
        groupId={subhireTarget.groupId}
        targetLabel={subhireTarget.label}
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
              <Label className="text-muted-foreground text-xs">Billing Override (leave blank to use project defaults)</Label>
              <div className="grid grid-cols-2 gap-3">
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
                      billingWeeks: editGroupBillingWeeks !== "" ? parseInt(editGroupBillingWeeks) : undefined,
                      billingDays: editGroupBillingDays !== "" ? parseInt(editGroupBillingDays) : undefined,
                    },
                  });
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
