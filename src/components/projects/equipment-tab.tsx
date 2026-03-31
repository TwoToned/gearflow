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
import { Plus, FolderPlus, Package, ArrowUpRight, MoreHorizontal, Trash2, Pencil, Loader2, ChevronRight, GripVertical, RefreshCw } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
  discount?: unknown;
  notes?: string | null;
  isOptional?: boolean;
  type?: string;
  priceBreakdown?: string | null;
  priceOverridden?: boolean;
  isSubhire?: boolean;
  isKitChild?: boolean;
  kitId?: string | null;
  pricingMode?: string | null;
  status?: string;
  prepStatus?: string | null;
  supplier?: { name: string } | null;
  model?: { name: string; dailyRate?: unknown; weeklyRate?: unknown; monthlyRate?: unknown } | null;
  asset?: { assetTag?: string | null } | null;
  kit?: { name?: string } | null;
  childLineItems?: LineItemData[];
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
  billingMonths: number | null;
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

const COL_COUNT = 6;

// ─── Overbooked info type ───────────────────────────────────────────────────

type OverbookedInfo = {
  overBy: number;
  totalStock: number;
  effectiveStock?: number;
  totalBooked: number;
  inherited?: boolean;
  unavailableAssets?: number;
  reducedOnly?: boolean;
  hasOverbookedChildren?: boolean;
  hasReducedChildren?: boolean;
};

function OverbookedBadge({ info }: { info?: OverbookedInfo | null }) {
  if (!info) return null;

  const effective = info.effectiveStock ?? info.totalStock;
  const unavail = info.unavailableAssets || 0;

  // Kit parents with BOTH overbooked and reduced children show two badges
  if (info.inherited && info.hasOverbookedChildren && info.hasReducedChildren) {
    return (
      <>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <Badge variant="outline" className="ml-1.5 cursor-help text-xs bg-red-500/10 text-red-600 border-red-500/20">
                  Overbooked
                </Badge>
              }
            />
            <TooltipContent>Contains items that are over capacity</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <Badge variant="outline" className="ml-1.5 cursor-help text-xs bg-purple-500/10 text-purple-600 border-purple-500/20">
                  Reduced Stock
                </Badge>
              }
            />
            <TooltipContent>
              Contains items with {unavail} asset{unavail !== 1 ? "s" : ""} in maintenance or lost
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </>
    );
  }

  const isReduced = info.reducedOnly;
  const colorClass = isReduced
    ? "bg-purple-500/10 text-purple-600 border-purple-500/20"
    : info.inherited
      ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
      : "bg-red-500/10 text-red-600 border-red-500/20";
  const label = isReduced ? "Reduced Stock" : "Overbooked";

  function getTooltip() {
    if (info!.inherited) {
      return isReduced
        ? `Contains items with ${unavail} asset${unavail !== 1 ? "s" : ""} in maintenance or lost`
        : `Contains items that are ${info!.overBy} over capacity`;
    }
    if (isReduced) {
      return `${info!.overBy} over usable stock — ${unavail} of ${info!.totalStock} in maintenance or lost (${effective} usable, ${info!.totalBooked} booked)`;
    }
    return `${info!.overBy} over capacity (${info!.totalBooked} booked / ${effective} usable${unavail > 0 ? `, ${unavail} unavailable` : ""})`;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Badge variant="outline" className={`ml-1.5 cursor-help text-xs ${colorClass}`}>
              {label}
            </Badge>
          }
        />
        <TooltipContent>{getTooltip()}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── Sortable group row ─────────────────────────────────────────────────────

function SortableGroupRow({
  group,
  isExpanded,
  indented,
  onToggle,
  onDelete,
  onEdit,
  onAddEquipment,
  onAddKit,
  onAddSubhire,
  onRecalculate,
}: {
  group: GroupData;
  isExpanded: boolean;
  indented?: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onAddEquipment: () => void;
  onAddKit: () => void;
  onAddSubhire: () => void;
  onRecalculate?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `grp-${group.id}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const priceVal = group.price != null ? Number(group.price) : null;

  return (
    <TableRow ref={setNodeRef} style={style} className={`group/row ${isDragging ? "opacity-30" : ""}`}>
      <TableCell className="px-0">
        <div className={`flex justify-end ${indented ? "ml-3" : "px-1"}`}>
          <button
            type="button"
            className="flex cursor-grab items-center px-1 text-fg-3 hover:text-fg active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        </div>
      </TableCell>
      <TableCell>
        <div className={`flex items-center gap-1.5 ${indented ? "ml-2" : ""}`}>
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
            <span className="font-semibold">{group.title}</span>
          </button>
        </div>
      </TableCell>
      <TableCell className="text-center t-data">{group.quantity}</TableCell>
      <TableCell className="text-right hidden md:table-cell t-data">
        {priceVal != null ? formatCurrency(priceVal) : "--"}
      </TableCell>
      <TableCell className="text-center hidden lg:table-cell t-data">
        {group.rentalQuantity ?? "--"}
      </TableCell>
      <TableCell className="text-right font-medium hidden sm:table-cell t-data">
        {priceVal != null ? formatCurrency(priceVal * group.quantity) : "--"}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
              <MoreHorizontal className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Group</DropdownMenuLabel>
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
                {onRecalculate && (
                  <DropdownMenuItem onClick={onRecalculate}>
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                    Recalculate Prices
                  </DropdownMenuItem>
                )}
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

// ─── Sortable category row ──────────────────────────────────────────────────

function SortableCategoryRow({
  cat,
  onRename,
  onDelete,
}: {
  cat: CategoryData;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `cat-${cat.id}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <TableRow ref={setNodeRef} style={style} className={`group/cat border-b-0 bg-bg-inset/50 ${isDragging ? "opacity-30" : ""}`}>
      <TableCell colSpan={COL_COUNT} className="py-2 px-1">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="flex cursor-grab items-center px-1 text-fg-3 hover:text-fg active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <h3 className="text-sm font-semibold text-fg-3">{cat.name}</h3>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="opacity-0 group-hover/cat:opacity-100 transition-opacity" />}>
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
  overbookedInfo,
  onEdit,
  onMove,
  onRemove,
}: {
  item: LineItemData;
  indent: string;
  overbookedInfo?: OverbookedInfo | null;
  onEdit: () => void;
  onMove: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `li-${item.id}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Map content indent to grip indent (margin-based to avoid affecting column width)
  const gripIndent = indent === "ml-12" ? "ml-8" : indent === "ml-3" ? "ml-1" : "";

  return (
    <TableRow ref={setNodeRef} style={style} className={isDragging ? "opacity-30" : ""}>
      <TableCell className="px-0">
        <div className={`flex justify-end ${gripIndent || "px-1"}`}>
          <button
            type="button"
            className="flex cursor-grab items-center px-1 text-fg-3 hover:text-fg active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        </div>
      </TableCell>
      <TableCell>
        <div className={`flex items-center gap-2 ${indent}`}>
          <span className="font-medium">
            {item.model?.name ?? item.description ?? "—"}
          </span>
          {item.asset?.assetTag && (
            <span className="text-xs text-fg-3">({item.asset.assetTag})</span>
          )}
          {item.kitId && !item.isKitChild && (
            <Badge variant="outline" className="ml-1.5 text-xs bg-indigo-500/10 text-indigo-600 border-indigo-500/20">
              Kit
            </Badge>
          )}
          {item.kitId && !item.isKitChild && item.pricingMode === "ITEMIZED" && (
            <Badge variant="outline" className="ml-1 text-xs">
              Itemized
            </Badge>
          )}
          {item.isOptional && (
            <Badge variant="outline" className="ml-1.5 text-xs bg-amber-500/10 text-amber-600 border-amber-500/20">
              Optional
            </Badge>
          )}
          {(item.isSubhire || item.type === "SUBHIRE") && (
            <Badge variant="outline" className="ml-1.5 text-xs bg-cyan-500/10 text-cyan-600 border-cyan-500/20">
              Subhire
            </Badge>
          )}
          {item.status === "CANCELLED" && (
            <Badge variant="outline" className="ml-1.5 text-xs bg-red-500/10 text-red-600 border-red-500/20">
              Cancelled
            </Badge>
          )}
          {item.prepStatus === "PREPPED" && (
            <Badge variant="outline" className="ml-1.5 text-xs bg-green-500/10 text-green-600 border-green-500/20">
              Prepped
            </Badge>
          )}
          <OverbookedBadge info={overbookedInfo} />
        </div>
        {(item.isSubhire || item.type === "SUBHIRE") && item.supplier && (
          <p className={`text-xs text-fg-3 mt-0.5 ${indent}`}>via {item.supplier.name}</p>
        )}
      </TableCell>
      <TableCell className="text-center t-data">{item.quantity}</TableCell>
      <TableCell className="text-right hidden md:table-cell t-data">
        <div className="flex items-center justify-end gap-1">
          {formatCurrency(item.unitPrice != null ? Number(item.unitPrice) : null)}
          {item.pricingType === "OPTIMIZED" && !item.priceOverridden && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary shrink-0" title="Auto-priced from rates" />
          )}
          {item.priceOverridden && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" title="Manually set price" />
          )}
        </div>
        {item.priceBreakdown && !item.priceOverridden && (
          <p className="text-[11px] text-fg-3 truncate max-w-[140px]" title={item.priceBreakdown}>
            {item.priceBreakdown}
          </p>
        )}
        {item.discount != null && Number(item.discount) > 0 && (
          <p className="text-[11px] text-green-500">-{formatCurrency(Number(item.discount))} disc.</p>
        )}
      </TableCell>
      <TableCell className="text-right font-medium hidden sm:table-cell t-data">
        {formatCurrency(item.lineTotal != null ? Number(item.lineTotal) : null)}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
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
  const [editDiscount, setEditDiscount] = useState("");
  const [editDiscountMode, setEditDiscountMode] = useState<"$" | "%">("$");
  const [editPriceMode, setEditPriceMode] = useState<"auto" | "manual">("auto");
  const [editNotes, setEditNotes] = useState("");

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
    setEditDiscount(item.discount != null && Number(item.discount) > 0 ? String(Number(item.discount)) : "");
    setEditDiscountMode("$");
    setEditPriceMode(item.pricingType === "OPTIMIZED" && !item.priceOverridden ? "auto" : "manual");
    setEditNotes(item.notes ?? "");
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

  // Build flat list of all sortable IDs for the single DndContext
  const allSortableIds: string[] = [];
  for (const cat of typedCategories) {
    allSortableIds.push(`cat-${cat.id}`);
    for (const group of cat.groups) {
      allSortableIds.push(`grp-${group.id}`);
      if (expandedGroups.has(group.id)) {
        for (const item of group.lineItems ?? []) {
          allSortableIds.push(`li-${item.id}`);
        }
      }
    }
    for (const item of cat.lineItems ?? []) {
      allSortableIds.push(`li-${item.id}`);
    }
  }
  for (const item of uncategorizedItems as LineItemData[]) {
    allSortableIds.push(`li-${item.id}`);
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
                  const standaloneItems = cat.lineItems ?? [];

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
                        const groupItems = group.lineItems ?? [];
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
                              onAddSubhire={() => {
                                setSubhireTarget({ categoryId: cat.id, groupId: group.id, label: `${cat.name} > ${group.title}` });
                                setShowSubhireDialog(true);
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
                                overbookedInfo={(overbookedMap as Record<string, OverbookedInfo>)[item.id]}
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
                          overbookedInfo={(overbookedMap as Record<string, OverbookedInfo>)[item.id]}
                          onEdit={() => openEditLineItem(item)}
                          onMove={() => { setMoveLineItemId(item.id); setMoveTargetGroupId("__uncategorized__"); }}
                          onRemove={() => removeMut.mutate(item.id)}
                        />
                      ))}
                    </React.Fragment>
                  );
                })}

                {/* Uncategorized items */}
                {(uncategorizedItems as LineItemData[]).map((item) => (
                  <SortableLineItemRow
                    key={item.id}
                    item={item}
                    indent=""
                    overbookedInfo={(overbookedMap as Record<string, OverbookedInfo>)[item.id]}
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
