"use client";

import React, { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Package,
  Wrench,
  Users,
  Truck,
  MoreHorizontal,
  Plus,
  Trash2,
  Pencil,
  Container,
  ChevronRight,
  GripVertical,
} from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { getProject } from "@/server/projects";
import {
  removeLineItem,
  addKitLineItem,
  checkKitAvailability,
  reorderLineItems,
} from "@/server/line-items";
import { getKits } from "@/server/kits";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusIndicator } from "@/components/ui/status-indicator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { AddEquipmentDialog } from "./add-equipment-dialog";
import { EditLineItemDialog } from "./edit-line-item-dialog";
import { useActiveOrganization } from "@/lib/auth-client";

interface LineItemsPanelProps {
  projectId: string;
  rentalStartDate?: Date;
  rentalEndDate?: Date;
}

const typeIcons: Record<string, React.ElementType> = {
  EQUIPMENT: Package,
  SERVICE: Wrench,
  LABOUR: Users,
  TRANSPORT: Truck,
  MISC: MoreHorizontal,
};

const pricingLabels: Record<string, string> = {
  PER_DAY: "/day",
  PER_WEEK: "/week",
  FLAT: "flat",
  PER_HOUR: "/hr",
};

import { lineItemStatusLabels, formatLabel } from "@/lib/status-labels";

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "--";
  return `$${Number(value).toLocaleString("en-AU", { minimumFractionDigits: 2 })}`;
}

function OverbookedBadge({ info }: { info?: { overBy: number; totalStock: number; effectiveStock?: number; totalBooked: number; inherited?: boolean; unavailableAssets?: number; reducedOnly?: boolean; hasOverbookedChildren?: boolean; hasReducedChildren?: boolean } | null }) {
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
            <TooltipContent>
              Contains items that are over capacity
            </TooltipContent>
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
            <Badge
              variant="outline"
              className={`ml-1.5 cursor-help text-xs ${colorClass}`}
            >
              {label}
            </Badge>
          }
        />
        <TooltipContent>
          {getTooltip()}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Types for the flat sortable list
// ---------------------------------------------------------------------------
type LineItem = NonNullable<
  Awaited<ReturnType<typeof getProject>>
>["lineItems"][number];

interface SortableRow {
  id: string;
  type: "group-header" | "item";
  groupName: string | null;
  /** Only for type === "item" */
  item?: LineItem;
  /** Only for type === "group-header" — ids of items in this group */
  itemIds?: string[];
}

// ---------------------------------------------------------------------------
// Build the flat sortable list from top-level items
// ---------------------------------------------------------------------------
function buildSortableRows(topLevelItems: LineItem[]): SortableRow[] {
  // First, consolidate items: group members should be contiguous.
  // Collect items by group, preserving the order of first appearance.
  const ungrouped: LineItem[] = [];
  const groupOrder: string[] = [];
  const groupMap = new Map<string, LineItem[]>();

  for (const item of topLevelItems) {
    const group = item.groupName || null;
    if (!group) {
      ungrouped.push(item);
    } else {
      if (!groupMap.has(group)) {
        groupOrder.push(group);
        groupMap.set(group, []);
      }
      groupMap.get(group)!.push(item);
    }
  }

  // Build the flat list: ungrouped items first (in their original order),
  // then each group with header + items (in order of first appearance).
  // But we need to respect the relative ordering between ungrouped items
  // and groups. Use the sortOrder of the first item in each section.
  interface Section {
    type: "ungrouped" | "group";
    groupName?: string;
    firstSortOrder: number;
    items: LineItem[];
  }

  const sections: Section[] = [];

  if (ungrouped.length > 0) {
    sections.push({
      type: "ungrouped",
      firstSortOrder: ungrouped[0].sortOrder,
      items: ungrouped,
    });
  }

  for (const group of groupOrder) {
    const items = groupMap.get(group)!;
    sections.push({
      type: "group",
      groupName: group,
      firstSortOrder: items[0].sortOrder,
      items,
    });
  }

  // Sort sections by their first item's sortOrder
  sections.sort((a, b) => a.firstSortOrder - b.firstSortOrder);

  // Flatten into sortable rows
  const rows: SortableRow[] = [];
  for (const section of sections) {
    if (section.type === "group") {
      rows.push({
        id: `group:${section.groupName}`,
        type: "group-header",
        groupName: section.groupName!,
        itemIds: section.items.map((i) => i.id),
      });
      for (const item of section.items) {
        rows.push({
          id: item.id,
          type: "item",
          groupName: section.groupName!,
          item,
        });
      }
    } else {
      for (const item of section.items) {
        rows.push({
          id: item.id,
          type: "item",
          groupName: null,
          item,
        });
      }
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Sortable item row component
// ---------------------------------------------------------------------------
function SortableItemRow({
  item,
  isGrouped,
  parentGroupDragging,
  expandedKits,
  onToggleKit,
  onEdit,
  onDelete,
  isDeletePending,
  isDragOverlay,
}: {
  item: LineItem;
  isGrouped?: boolean;
  parentGroupDragging?: boolean;
  expandedKits: Set<string>;
  onToggleKit: (id: string) => void;
  onEdit: (item: LineItem) => void;
  onDelete: (id: string, isKit: boolean) => void;
  isDeletePending: boolean;
  isDragOverlay?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: isDragOverlay });

  const style = isDragOverlay
    ? undefined
    : {
        transform: CSS.Transform.toString(transform),
        transition,
      };

  const isKitParent = !!item.kitId && !item.isKitChild;
  const isGroupParent = isKitParent;
  const Icon = isGroupParent ? Container : (typeIcons[item.type] || Package);
  const itemName = isGroupParent
    ? item.description || "Unnamed Kit"
    : item.type === "EQUIPMENT"
      ? [item.model?.name, item.model?.modelNumber].filter(Boolean).join(" - ") ||
        item.description ||
        "Unnamed item"
      : item.description || "Unnamed item";
  const isExpanded = expandedKits.has(item.id);
  const childItems = isGroupParent ? (item.childLineItems || []) : [];

  return (
    <React.Fragment>
      <TableRow
        ref={setNodeRef}
        style={style}
        className={`${isGroupParent ? "bg-bg-inset/30" : ""} ${isDragging || parentGroupDragging ? "opacity-30" : ""} ${isDragOverlay ? "bg-background" : ""}`}
      >
        <TableCell className={`w-8 px-1 ${isGrouped ? "pl-6" : ""}`}>
          <button
            type="button"
            className="flex h-full cursor-grab items-center px-1 text-fg-3 hover:text-fg active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            {isGroupParent ? (
              <button
                type="button"
                onClick={() => onToggleKit(item.id)}
                className="flex items-center gap-1.5 text-left"
              >
                <ChevronRight
                  className={`h-4 w-4 shrink-0 text-fg-3 transition-transform ${
                    isExpanded ? "rotate-90" : ""
                  }`}
                />
                <Icon className="h-4 w-4 shrink-0 text-fg-3" />
                <div>
                  <span className="font-medium">{itemName}</span>
                  <Badge
                    variant="outline"
                    className={`ml-2 text-xs ${isKitParent ? "bg-indigo-500/10 text-indigo-600 border-indigo-500/20" : "bg-orange-500/10 text-orange-600 border-orange-500/20"}`}
                  >
                    {isKitParent ? "Kit" : "Prep"}
                  </Badge>
                  {item.pricingMode === "ITEMIZED" && (
                    <Badge variant="outline" className="ml-1 text-xs">
                      Itemized
                    </Badge>
                  )}
                  {item.isOverbooked && (
                    <OverbookedBadge info={item.overbookedInfo} />
                  )}
                  <span className="ml-2 text-xs text-fg-3">
                    {childItems.length} item{childItems.length !== 1 ? "s" : ""}
                  </span>
                </div>
              </button>
            ) : (
              <>
                <Icon className="h-4 w-4 shrink-0 text-fg-3" />
                <div>
                  <span className="font-medium">{itemName}</span>
                  {item.isOptional && (
                    <Badge
                      variant="outline"
                      className="ml-2 text-xs bg-amber-500/10 text-amber-600 border-amber-500/20"
                    >
                      Optional
                    </Badge>
                  )}
                  {item.isSubhire && (
                    <Badge
                      variant="outline"
                      className="ml-2 text-xs bg-cyan-500/10 text-cyan-600 border-cyan-500/20"
                    >
                      Subhire
                    </Badge>
                  )}
                  {item.isOverbooked && (
                    <OverbookedBadge info={item.overbookedInfo} />
                  )}
                  {item.isSubhire && item.supplier && (
                    <p className="text-xs text-fg-3 mt-0.5">
                      via {item.supplier.name}
                    </p>
                  )}
                  {item.notes && (
                    <p className="text-xs text-fg-3 mt-0.5">
                      {item.notes}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </TableCell>
        <TableCell className="text-center t-data">{item.quantity}</TableCell>
        <TableCell className="text-right hidden md:table-cell t-data">
          {formatCurrency(item.unitPrice as number | null)}
          {item.unitPrice != null && (
            <span className="text-xs text-fg-3 ml-0.5">
              {pricingLabels[item.pricingType]}
            </span>
          )}
        </TableCell>
        <TableCell className="text-center hidden lg:table-cell t-data">{item.duration}</TableCell>
        <TableCell className="text-right font-medium hidden sm:table-cell t-data">
          {formatCurrency(item.lineTotal as number | null)}
        </TableCell>
        <TableCell className="hidden sm:table-cell">
          <StatusIndicator category="lineItem" value={item.status} label={lineItemStatusLabels[item.status] || formatLabel(item.status)} variant="pill" />
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onEdit(item)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onDelete(item.id, isKitParent)}
              disabled={isDeletePending}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {isKitParent &&
        isExpanded &&
        (
          childItems as Array<{
            id: string;
            model?: { name: string } | null;
            description?: string | null;
            asset?: { assetTag: string } | null;
            kitId?: string | null;
            kit?: { assetTag: string; name: string } | null;
            childLineItems?: Array<{
              id: string;
              model?: { name: string } | null;
              description?: string | null;
              asset?: { assetTag: string } | null;
              quantity: number;
              duration: number;
              unitPrice?: unknown;
              lineTotal?: unknown;
              isOverbooked?: boolean;
              overbookedInfo?: { overBy: number; totalStock: number; totalBooked: number } | null;
            }>;
            quantity: number;
            duration: number;
            unitPrice?: unknown;
            lineTotal?: unknown;
            isOverbooked?: boolean;
            overbookedInfo?: { overBy: number; totalStock: number; totalBooked: number } | null;
          }>
        ).map((child) => {
          const isNestedKit = !!child.kitId && (child.childLineItems?.length ?? 0) > 0;
          const nestedChildren = child.childLineItems || [];
          return (
            <React.Fragment key={child.id}>
              <TableRow className="bg-bg-inset/10">
                <TableCell className="w-8" />
                <TableCell>
                  <div className="flex items-center gap-2 pl-8">
                    {isNestedKit ? (
                      <Container className="h-3.5 w-3.5 shrink-0 text-fg-3" />
                    ) : (
                      <Package className="h-3.5 w-3.5 shrink-0 text-fg-3" />
                    )}
                    <div>
                      <span className={`text-sm ${isNestedKit ? "font-medium" : ""}`}>
                        {child.model?.name || child.description || "Unnamed"}
                      </span>
                      {child.asset?.assetTag && (
                        <span className="ml-1.5 text-xs text-fg-3">
                          ({child.asset.assetTag})
                        </span>
                      )}
                      {isNestedKit && (
                        <>
                          <Badge variant="outline" className="ml-1.5 text-xs bg-indigo-500/10 text-indigo-600 border-indigo-500/20">Kit</Badge>
                          <span className="ml-1.5 text-xs text-fg-3">
                            {nestedChildren.length} item{nestedChildren.length !== 1 ? "s" : ""}
                          </span>
                        </>
                      )}
                      {child.isOverbooked && (
                        <OverbookedBadge info={child.overbookedInfo} />
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-center text-sm t-data">
                  {isNestedKit ? nestedChildren.length : child.quantity}
                </TableCell>
                <TableCell className="text-right text-sm hidden md:table-cell t-data">
                  {formatCurrency(child.unitPrice as number | null)}
                </TableCell>
                <TableCell className="text-center text-sm hidden lg:table-cell t-data">
                  {child.duration}
                </TableCell>
                <TableCell className="text-right text-sm hidden sm:table-cell t-data">
                  {formatCurrency(child.lineTotal as number | null)}
                </TableCell>
                <TableCell className="hidden sm:table-cell" />
                <TableCell />
              </TableRow>
              {isNestedKit && nestedChildren.map((nested) => (
                <TableRow key={nested.id} className="bg-bg-inset/5">
                  <TableCell className="w-8" />
                  <TableCell>
                    <div className="flex items-center gap-2 pl-14">
                      <Package className="h-3 w-3 shrink-0 text-fg-3" />
                      <div>
                        <span className="text-sm text-fg-3">
                          {nested.model?.name || nested.description || "Unnamed"}
                        </span>
                        {nested.asset?.assetTag && (
                          <span className="ml-1.5 text-xs text-fg-3">
                            ({nested.asset.assetTag})
                          </span>
                        )}
                        {nested.isOverbooked && (
                          <OverbookedBadge info={nested.overbookedInfo} />
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-center text-sm text-fg-3 t-data">
                    {nested.quantity}
                  </TableCell>
                  <TableCell className="text-right text-sm hidden md:table-cell text-fg-3 t-data">
                    {formatCurrency(nested.unitPrice as number | null)}
                  </TableCell>
                  <TableCell className="text-center text-sm hidden lg:table-cell text-fg-3 t-data">
                    {nested.duration}
                  </TableCell>
                  <TableCell className="text-right text-sm hidden sm:table-cell text-fg-3 t-data">
                    {formatCurrency(nested.lineTotal as number | null)}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell" />
                  <TableCell />
                </TableRow>
              ))}
            </React.Fragment>
          );
        })}
    </React.Fragment>
  );
}

// ---------------------------------------------------------------------------
// Sortable group header component
// ---------------------------------------------------------------------------
function SortableGroupHeader({
  id,
  groupName,
  groupItems,
  isDragOverlay,
}: {
  id: string;
  groupName: string;
  groupItems?: LineItem[];
  isDragOverlay?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: isDragOverlay });

  const style = isDragOverlay
    ? undefined
    : {
        transform: CSS.Transform.toString(transform),
        transition,
      };

  return (
    <React.Fragment>
      <TableRow
        ref={setNodeRef}
        style={style}
        className={`border-b-0 ${isDragging ? "opacity-30" : ""} ${isDragOverlay ? "bg-bg-inset" : ""}`}
      >
        <TableCell colSpan={8} className="py-2 px-1">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="flex cursor-grab items-center px-1 text-fg-3 hover:text-fg active:cursor-grabbing"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-4 w-4" />
            </button>
            <h3 className="text-sm font-semibold text-fg-3">
              {groupName}
            </h3>
          </div>
        </TableCell>
      </TableRow>
      {/* In the drag overlay, render a compact preview of group items */}
      {isDragOverlay && groupItems && groupItems.length > 0 && (
        groupItems.map((item) => {
          const isKitParent = !!item.kitId && !item.isKitChild;
          const isGroupParent = isKitParent;
          const Icon = isGroupParent ? Container : (typeIcons[item.type] || Package);
          const name = isGroupParent
            ? item.description || "Unnamed Kit"
            : item.type === "EQUIPMENT"
              ? [item.model?.name, item.model?.modelNumber].filter(Boolean).join(" - ") ||
                item.description || "Unnamed"
              : item.description || "Unnamed";
          return (
            <TableRow key={item.id} className="bg-background/80">
              <TableCell className="w-8 px-1" />
              <TableCell>
                <div className="flex items-center gap-2 pl-4">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-fg-3" />
                  <span className="text-sm">{name}</span>
                </div>
              </TableCell>
              <TableCell className="text-center text-sm t-data">{item.quantity}</TableCell>
              <TableCell className="text-right text-sm hidden md:table-cell t-data">
                {formatCurrency(item.unitPrice as number | null)}
              </TableCell>
              <TableCell className="text-center text-sm hidden lg:table-cell t-data">{item.duration}</TableCell>
              <TableCell className="text-right text-sm font-medium hidden sm:table-cell t-data">
                {formatCurrency(item.lineTotal as number | null)}
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <StatusIndicator category="lineItem" value={item.status} label={lineItemStatusLabels[item.status] || formatLabel(item.status)} variant="pill" />
              </TableCell>
              <TableCell />
            </TableRow>
          );
        })
      )}
    </React.Fragment>
  );
}

// ---------------------------------------------------------------------------
// Main panel component
// ---------------------------------------------------------------------------
export function LineItemsPanel({
  projectId,
  rentalStartDate,
  rentalEndDate,
}: LineItemsPanelProps) {
  const queryClient = useQueryClient();
  const [equipmentDialogOpen, setEquipmentDialogOpen] = useState(false);
  const [kitDialogOpen, setKitDialogOpen] = useState(false);
  const [selectedKitId, setSelectedKitId] = useState("");
  const [kitPricingMode, setKitPricingMode] = useState<
    "KIT_PRICE" | "ITEMIZED"
  >("KIT_PRICE");
  const [kitUnitPrice, setKitUnitPrice] = useState("");
  const [kitGroupName, setKitGroupName] = useState("");
  const [expandedKits, setExpandedKits] = useState<Set<string>>(new Set());
  const [editingItem, setEditingItem] = useState<LineItem | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: project } = useQuery({
    queryKey: ["project", orgId, projectId],
    queryFn: () => getProject(projectId),
  });

  const { data: kitsData } = useQuery({
    queryKey: ["kits", orgId],
    queryFn: () => getKits({ pageSize: 200 }),
    enabled: kitDialogOpen,
  });

  const { data: kitAvailability } = useQuery({
    queryKey: [
      "kit-availability",
      orgId,
      selectedKitId,
      rentalStartDate?.toISOString(),
      rentalEndDate?.toISOString(),
      projectId,
    ],
    queryFn: () =>
      checkKitAvailability(
        selectedKitId,
        rentalStartDate!,
        rentalEndDate!,
        projectId,
      ),
    enabled:
      kitDialogOpen &&
      !!selectedKitId &&
      !!rentalStartDate &&
      !!rentalEndDate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => removeLineItem(id),
    onSuccess: () => {
      toast.success("Line item removed");
      queryClient.invalidateQueries({ queryKey: ["project", orgId, projectId] });
      queryClient.invalidateQueries({ queryKey: ["project-overbooked", projectId] });
    },
    onError: (e) => toast.error(e.message),
  });

  const addKitMutation = useMutation({
    mutationFn: () =>
      addKitLineItem(
        projectId,
        selectedKitId,
        kitPricingMode,
        kitPricingMode === "KIT_PRICE" && kitUnitPrice
          ? parseFloat(kitUnitPrice)
          : undefined,
        kitGroupName || undefined,
      ),
    onSuccess: () => {
      if (kitGroupName) addExtraGroup(kitGroupName);
      toast.success("Kit added to project");
      queryClient.invalidateQueries({ queryKey: ["project", orgId, projectId] });
      queryClient.invalidateQueries({ queryKey: ["project-overbooked", projectId] });
      setKitDialogOpen(false);
      setSelectedKitId("");
      setKitPricingMode("KIT_PRICE");
      setKitUnitPrice("");
      setKitGroupName("");
    },
    onError: (e) => toast.error(e.message),
  });

  const reorderMutation = useMutation({
    mutationFn: ({
      itemIds,
      groupUpdates,
    }: {
      itemIds: string[];
      groupUpdates?: { id: string; groupName: string | null }[];
    }) => reorderLineItems(projectId, itemIds, groupUpdates),
    onError: (e) => {
      toast.error("Failed to reorder: " + e.message);
      queryClient.invalidateQueries({ queryKey: ["project", orgId, projectId] });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["project", orgId, projectId] });
    },
  });

  const lineItems: LineItem[] = project?.lineItems || [];

  const [extraGroups, setExtraGroups] = useState<string[]>([]);

  const existingGroups = useMemo(() => {
    const names = new Set<string>();
    for (const item of lineItems) {
      if (item.groupName) names.add(item.groupName);
    }
    for (const g of extraGroups) {
      names.add(g);
    }
    return [...names].sort();
  }, [lineItems, extraGroups]);

  const addExtraGroup = useCallback((group: string) => {
    setExtraGroups((prev) => prev.includes(group) ? prev : [...prev, group]);
  }, []);

  const topLevelItems = useMemo(
    () => lineItems.filter((item) => !item.isKitChild),
    [lineItems],
  );

  const sortableRows = useMemo(
    () => buildSortableRows(topLevelItems),
    [topLevelItems],
  );

  const sortableIds = useMemo(
    () => sortableRows.map((r) => r.id),
    [sortableRows],
  );

  // Find the active row for the drag overlay
  const activeRow = activeId
    ? sortableRows.find((r) => r.id === activeId)
    : null;

  // When dragging a group, we need the group name to fade out its items
  const draggingGroupName =
    activeRow?.type === "group-header" ? activeRow.groupName : null;

  // Collect items for the group being dragged (for the overlay)
  const draggingGroupItems = useMemo(() => {
    if (!draggingGroupName) return [];
    return topLevelItems.filter((i) => i.groupName === draggingGroupName);
  }, [draggingGroupName, topLevelItems]);

  const toggleKitExpanded = useCallback((kitItemId: string) => {
    setExpandedKits((prev) => {
      const next = new Set(prev);
      if (next.has(kitItemId)) {
        next.delete(kitItemId);
      } else {
        next.add(kitItemId);
      }
      return next;
    });
  }, []);

  const handleDelete = useCallback(
    (id: string, isKit: boolean) => {
      const msg = isKit
        ? "Remove this kit and all its items?"
        : "Remove this line item?";
      if (confirm(msg)) {
        deleteMutation.mutate(id);
      }
    },
    [deleteMutation],
  );

  // -----------------------------------------------------------------------
  // DnD handlers
  // -----------------------------------------------------------------------
  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeIdx = sortableRows.findIndex((r) => r.id === active.id);
    const overIdx = sortableRows.findIndex((r) => r.id === over.id);
    if (activeIdx === -1 || overIdx === -1) return;

    const activeRow = sortableRows[activeIdx];

    if (activeRow.type === "group-header") {
      // Move the entire group (header + all its items)
      handleGroupMove(activeIdx, overIdx);
    } else {
      // Move a single item
      handleItemMove(activeIdx, overIdx);
    }
  }

  function handleGroupMove(fromIdx: number, toIdx: number) {
    const row = sortableRows[fromIdx];
    const groupName = row.groupName!;

    // Collect indices: the header + all consecutive items belonging to this group
    const groupIndices = [fromIdx];
    for (let i = fromIdx + 1; i < sortableRows.length; i++) {
      const r = sortableRows[i];
      if (r.type === "item" && r.groupName === groupName) {
        groupIndices.push(i);
      } else {
        break;
      }
    }

    // Remove the group rows from the list
    const remaining = sortableRows.filter(
      (_, i) => !groupIndices.includes(i),
    );
    const groupRows = groupIndices.map((i) => sortableRows[i]);

    // Snap the insertion point to a section boundary in the remaining list.
    // A section boundary is index 0, or the start of a group header, or just
    // after the last item of a section (where a group/ungrouped block ends).
    const rawInsert = (() => {
      if (toIdx > fromIdx) {
        const removedBefore = groupIndices.filter((i) => i < toIdx).length;
        return toIdx - removedBefore + 1;
      }
      return toIdx;
    })();

    // Find all valid boundary positions in `remaining`
    const boundaries: number[] = [0]; // start is always valid
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].type === "group-header") {
        boundaries.push(i);
      }
      // After the last item of a group (next is a different group or end)
      if (
        remaining[i].type === "item" &&
        (i + 1 >= remaining.length ||
          remaining[i + 1].type === "group-header" ||
          remaining[i + 1].groupName !== remaining[i].groupName)
      ) {
        boundaries.push(i + 1);
      }
    }
    // Deduplicate and sort
    const uniqueBoundaries = [...new Set(boundaries)].sort((a, b) => a - b);

    // Pick the closest boundary to rawInsert
    let insertAt = uniqueBoundaries[0];
    let minDist = Math.abs(rawInsert - insertAt);
    for (const b of uniqueBoundaries) {
      const dist = Math.abs(rawInsert - b);
      if (dist < minDist) {
        minDist = dist;
        insertAt = b;
      }
    }

    // Clamp
    insertAt = Math.max(0, Math.min(remaining.length, insertAt));

    // Insert group rows at the new position
    const newRows = [
      ...remaining.slice(0, insertAt),
      ...groupRows,
      ...remaining.slice(insertAt),
    ];

    persistOrder(newRows);
  }

  function handleItemMove(fromIdx: number, toIdx: number) {
    const newRows = arrayMove(sortableRows, fromIdx, toIdx);
    // Determine if the item moved into a different group
    const movedRow = newRows[toIdx];
    const movedItemId = movedRow.id;

    // Find what group context the item is now in by looking at surrounding rows
    let newGroupName: string | null = null;
    for (let i = toIdx - 1; i >= 0; i--) {
      const r = newRows[i];
      if (r.type === "group-header") {
        newGroupName = r.groupName;
        break;
      }
      if (r.type === "item") {
        newGroupName = r.groupName;
        break;
      }
    }

    const groupUpdates: { id: string; groupName: string | null }[] = [];
    if (newGroupName !== movedRow.groupName) {
      groupUpdates.push({ id: movedItemId, groupName: newGroupName });
      // Update in the local rows so persistOrder sees the right data
      movedRow.groupName = newGroupName;
    }

    persistOrder(newRows, groupUpdates);
  }

  function persistOrder(
    newRows: SortableRow[],
    groupUpdates?: { id: string; groupName: string | null }[],
  ) {
    // Extract only item IDs in order (skip group headers)
    const orderedItemIds = newRows
      .filter((r) => r.type === "item")
      .map((r) => r.id);

    // Optimistic update: reorder lineItems in the cache
    queryClient.setQueryData(
      ["project", projectId],
      (old: Awaited<ReturnType<typeof getProject>> | undefined) => {
        if (!old) return old;
        const itemMap = new Map(old.lineItems.map((li) => [li.id, li]));
        const reordered = orderedItemIds.flatMap((id, index) => {
          const li = itemMap.get(id);
          if (!li) return [];
          const groupChange = groupUpdates?.find((g) => g.id === id);
          return [
            {
              ...li,
              sortOrder: index,
              ...(groupChange ? { groupName: groupChange.groupName } : {}),
            },
          ];
        });
        // Add kit children back (they keep their parent's order context)
        const children = old.lineItems.filter((li) => li.isKitChild);
        return {
          ...old,
          lineItems: [...reordered, ...children],
        };
      },
    );

    reorderMutation.mutate({ itemIds: orderedItemIds, groupUpdates });
  }

  function handleDragCancel() {
    setActiveId(null);
  }

  return (
    <div className="space-y-4">
      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setEquipmentDialogOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          <span className="hidden sm:inline">Add </span>Equipment
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setKitDialogOpen(true)}
        >
          <Container className="mr-1.5 h-4 w-4" />
          <span className="hidden sm:inline">Add </span>Kit
        </Button>
      </div>

      {topLevelItems.length === 0 ? (
        <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <div className="py-8 text-center text-fg-3">
            <Package className="mx-auto mb-2 h-8 w-8 opacity-50" />
            <p>No line items yet.</p>
            <p className="text-xs mt-1">
              Add equipment, services, and labour to this project.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="rounded-md border overflow-x-auto">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8 px-1" />
                    <TableHead>Item</TableHead>
                    <TableHead className="text-center w-16">Qty</TableHead>
                    <TableHead className="text-right w-28 hidden md:table-cell">
                      Unit Price
                    </TableHead>
                    <TableHead className="text-center w-20 hidden lg:table-cell">
                      Duration
                    </TableHead>
                    <TableHead className="text-right w-28 hidden sm:table-cell">Total</TableHead>
                    <TableHead className="w-24 hidden sm:table-cell">Status</TableHead>
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <SortableContext
                    items={sortableIds}
                    strategy={verticalListSortingStrategy}
                  >
                    {sortableRows.map((row) =>
                      row.type === "group-header" ? (
                        <SortableGroupHeader
                          key={row.id}
                          id={row.id}
                          groupName={row.groupName!}
                        />
                      ) : (
                        <SortableItemRow
                          key={row.id}
                          item={row.item!}
                          isGrouped={!!row.groupName}
                          parentGroupDragging={!!draggingGroupName && draggingGroupName === row.groupName}
                          expandedKits={expandedKits}
                          onToggleKit={toggleKitExpanded}
                          onEdit={setEditingItem}
                          onDelete={handleDelete}
                          isDeletePending={deleteMutation.isPending}
                        />
                      ),
                    )}
                  </SortableContext>
                </TableBody>
              </Table>

              <DragOverlay>
                {activeRow ? (
                  <div className="rounded-md border bg-background shadow-xl">
                    <table className="w-full">
                      <tbody>
                        {activeRow.type === "group-header" ? (
                          <SortableGroupHeader
                            id={activeRow.id}
                            groupName={activeRow.groupName!}
                            groupItems={draggingGroupItems}
                            isDragOverlay
                          />
                        ) : (
                          <SortableItemRow
                            item={activeRow.item!}
                            isGrouped={!!activeRow.groupName}
                            expandedKits={expandedKits}
                            onToggleKit={toggleKitExpanded}
                            onEdit={setEditingItem}
                            onDelete={handleDelete}
                            isDeletePending={false}
                            isDragOverlay
                          />
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          </div>

          {/* Totals */}
          {project && (
            <div className="rounded-lg bg-bg-surface p-4 surface-ring">
              <div className="py-4">
                <div className="space-y-1 text-sm max-w-xs ml-auto">
                  <div className="flex justify-between">
                    <span className="text-fg-3">Subtotal</span>
                    <span className="font-medium t-data">
                      {formatCurrency(project.subtotal as number | null)}
                    </span>
                  </div>
                  {project.discountPercent != null &&
                    Number(project.discountPercent) > 0 && (
                      <div className="flex justify-between text-fg-3">
                        <span>
                          Discount ({Number(project.discountPercent)}%)
                        </span>
                        <span className="t-data">
                          -
                          {formatCurrency(
                            project.discountAmount as number | null,
                          )}
                        </span>
                      </div>
                    )}
                  <div className="flex justify-between text-fg-3">
                    <span>GST (10%)</span>
                    <span className="t-data">
                      {formatCurrency(project.taxAmount as number | null)}
                    </span>
                  </div>
                  <div className="my-1 h-px bg-border" />
                  <div className="flex justify-between text-base">
                    <span className="font-semibold">Total</span>
                    <span className="font-semibold t-data">
                      {formatCurrency(project.total as number | null)}
                    </span>
                  </div>
                  {project.invoicedTotal != null && (
                    <>
                      <div className="my-1 h-px bg-border" />
                      <div className="flex justify-between text-base">
                        <span className="font-semibold text-primary">Invoiced Total</span>
                        <span className="font-semibold text-primary t-data">
                          {formatCurrency(project.invoicedTotal as unknown as number | null)}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <AddEquipmentDialog
        projectId={projectId}
        rentalStartDate={rentalStartDate}
        rentalEndDate={rentalEndDate}
        open={equipmentDialogOpen}
        onOpenChange={setEquipmentDialogOpen}
      />

      <EditLineItemDialog
        projectId={projectId}
        existingGroups={existingGroups}
        onGroupCreated={addExtraGroup}
        rentalStartDate={rentalStartDate}
        rentalEndDate={rentalEndDate}
        lineItem={editingItem}
        open={!!editingItem}
        onOpenChange={(open) => {
          if (!open) setEditingItem(null);
        }}
      />

      {/* Add Kit Dialog */}
      <Dialog
        open={kitDialogOpen}
        onOpenChange={(open) => {
          setKitDialogOpen(open);
          if (!open) {
            setSelectedKitId("");
            setKitPricingMode("KIT_PRICE");
            setKitUnitPrice("");
            setKitGroupName("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Kit to Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Kit</Label>
              <ComboboxPicker
                value={selectedKitId}
                onChange={setSelectedKitId}
                options={(kitsData?.kits || []).map((kit) => ({
                  value: kit.id,
                  label: `${kit.assetTag} - ${kit.name}`,
                  description: kit.category?.name,
                }))}
                placeholder="Select a kit..."
                searchPlaceholder="Search kits..."
                emptyMessage="No kits found."
              />
            </div>

            <div className="space-y-2">
              <Label>Group Name</Label>
              <ComboboxPicker
                value={kitGroupName}
                onChange={setKitGroupName}
                options={existingGroups.map((g) => ({ value: g, label: g }))}
                placeholder="e.g. Audio, Lighting"
                searchPlaceholder="Search or type new group..."
                emptyMessage="Type to create a new group."
                allowClear
                creatable
              />
            </div>

            {selectedKitId &&
              kitAvailability &&
              !kitAvailability.available && (
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
              onClick={() => addKitMutation.mutate()}
              disabled={
                !selectedKitId ||
                addKitMutation.isPending ||
                (kitAvailability && !kitAvailability.available)
              }
            >
              {addKitMutation.isPending ? "Adding..." : "Add Kit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
