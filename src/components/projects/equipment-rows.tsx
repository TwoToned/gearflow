"use client";

/**
 * Row + group rendering primitives for the project equipment tab.
 *
 * Extracted verbatim from equipment-tab.tsx (Phase 3 of the cross-type
 * group/category unification). This commit is a pure move — no behaviour
 * change. The 3-axis RowDescriptor refactor lands in the next commit.
 */

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import {
  GripVertical,
  ChevronRight,
  Plus,
  Package,
  MoreHorizontal,
  Trash2,
  Pencil,
  RefreshCw,
  AlertTriangle,
  MessageCircle,
  BookmarkPlus,
  Handshake,
  ArrowRightLeft,
  Sparkles,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TableCell, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/formatters";
import { useRowShortcuts } from "./use-row-shortcuts";
import { ReviewMarkerBadge } from "@/components/collaboration/review-marker-badge";
import type { MarkerStatus } from "@/components/collaboration/review-marker-badge";
import { CommentThreadPanel } from "@/components/collaboration/comment-thread-panel";
import { setReviewMarker } from "@/server/collaboration";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LineItemData {
  id: string;
  modelId?: string | null;
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
  // `isSubhire` removed (Wave 2). Use `subHireId != null` to detect sub-hire items.
  isCustomItem?: boolean;
  isKitChild?: boolean;
  subHireId?: string | null;
  /** Sub-hire group this synthetic line item belongs to. Used by the
   *  flat-list filter to suppress sub-hire group parent rows now that
   *  SubHireGroupRow renders the group itself (Phase 5c). */
  subHireGroupId?: string | null;
  kitId?: string | null;
  /** Child discriminator: KIT (kit member) vs ACCESSORY (permanently attached
   *  to a parent asset). Drives the "Accessory" badge on child rows. */
  childKind?: string | null;
  pricingMode?: string | null;
  status?: string;
  prepStatus?: string | null;
  supplier?: { name: string } | null;
  model?: { name: string; dailyRate?: unknown; weeklyRate?: unknown; monthlyRate?: unknown } | null;
  asset?: { assetTag?: string | null } | null;
  /** Post-cutover per-unit assignments. Source of truth for which
   *  physical assets a multi-quantity line is using. */
  units?: Array<{
    id: string;
    ordinal: number;
    asset?: { id: string; assetTag: string } | null;
    bulkAsset?: { id: string; assetTag: string } | null;
  }>;
  kit?: { name?: string } | null;
  childLineItems?: LineItemData[];
  /** Optimistic-concurrency baseline — Prisma `updatedAt` (serialised). Sent
   *  back on save so the server can reject stale writes (collaboration). */
  updatedAt?: string | Date | number | null;
}

export interface GroupData {
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

export interface SubHireGroupData {
  id: string;
  title: string;
  quantity: number;
  cost: unknown;
  charge: unknown;
  sortOrder: number;
  targetCategoryId: string | null;
  showOnQuote?: boolean;
  showOnDocs?: boolean;
  subHire: {
    id: string;
    orderNumber: string;
    status: string;
    supplier?: { id: string; name: string } | null;
  };
  items?: Array<{
    id: string;
    description?: string | null;
    quantity: number;
    unitCost?: unknown;
    unitCharge?: unknown;
  }>;
  /** Synthetic parent ProjectLineItem(s) — usually 0 or 1. The parent's
   *  childLineItems are what the row renders when expanded. */
  lineItems?: LineItemData[];
}

/** Discriminated slot used by equipment-tab to iterate the mixed
 *  ProjectGroup + SubHireGroup list inside a category in CategorySlot
 *  order (Phase 5b). */
export type MixedGroupSlot =
  | { kind: "project"; sortOrder: number; projectGroupId: string }
  | { kind: "subHire"; sortOrder: number; subHireGroupId: string };

/**
 * Drop Matrix 8C from the cross-type unification plan. Returns a reason
 * string when the active row is NOT allowed to land on the over target,
 * or null when the drop is allowed (or out of this matrix's scope —
 * positive-path moves are decided downstream by handleDragEnd).
 *
 * The matrix rejects:
 *   - line items (own-stock, custom, kit) dropped onto a sub-hire group
 *   - project groups dropped onto a sub-hire group (no nested groups)
 *   - sub-hire groups dropped onto a project group (no nested groups)
 *
 * It deliberately does NOT reject:
 *   - line items onto categories or project groups (existing flow)
 *   - sub-hire groups dropped onto a category (Drop Matrix row allows the
 *     cross-category move, even though the visual target is a row
 *     belonging to a different kind)
 */
export function getDisallowedDropReason(
  activeId: string,
  overId: string,
): string | null {
  if (activeId.startsWith("li-") && overId.startsWith("shg-")) {
    return "Own-stock, custom, and kit items can't enter a sub-hire group.";
  }
  if (activeId.startsWith("grp-") && overId.startsWith("shg-")) {
    return "Project groups can't be nested inside a sub-hire group.";
  }
  if (activeId.startsWith("shg-") && overId.startsWith("grp-")) {
    return "Sub-hire groups can't be nested inside a project group.";
  }
  return null;
}

export interface CategoryData {
  id: string;
  name: string;
  sortOrder: number;
  groups: GroupData[];
  subHireGroupTargets?: SubHireGroupData[];
  mixedGroups?: MixedGroupSlot[];
  lineItems?: LineItemData[];
}

export const COL_COUNT = 6;

// Kit children and sub-hire group children both have isKitChild=true —
// filter them from flat rendering so they only appear nested under their parent.
export function isRealKitChild(item: LineItemData) {
  return item.isKitChild === true;
}

// Merge tombstones (status CANCELLED, qty 0) are inert residue left by the
// split-collapse migrations. getProject already filters them at the query
// layer; this is belt-and-suspenders so a stale cache / optimistic update
// can't resurrect a ghost row. Normal line-item removal hard-deletes, so a
// CANCELLED line item is never anything but merge residue.
function isMergeTombstone(item: LineItemData) {
  return item.status === "CANCELLED";
}

// The synthetic parent ProjectLineItem of a sub-hire group has
// `subHireGroupId` set, `isKitChild=false`, and no parent. From Phase 5c
// onwards the equipment tab renders that group as a SubHireGroupRow
// instead — so this parent line item must NOT also show up as a flat
// row, or every sub-hire group would appear twice.
function isSubHireGroupParent(item: LineItemData) {
  return item.subHireGroupId != null && item.isKitChild !== true;
}

// One predicate for "should this row appear in the flat list".
export function isHiddenFromList(item: LineItemData) {
  return isRealKitChild(item) || isMergeTombstone(item) || isSubHireGroupParent(item);
}

// ─── Row descriptor (cross-type unification) ─────────────────────────────────
//
// A line-item row is described by three independent axes, NOT one flat "kind"
// enum — a sub-hire group child is simultaneously a `subhire` source AND a
// `child` role, which a flat enum can't represent. `describeRow` derives the
// axes that are computable from the item alone (`container` is contextual and
// supplied by the caller in later phases). Each field below preserves the
// EXACT boolean expression the row previously used inline, so rendering is
// unchanged — this is a readability refactor, not a behaviour change.

export type RowSource = "owned" | "subhire" | "custom";
export type RowRole = "parent" | "child" | "standalone";

export interface RowDescriptor {
  /** owned stock / sub-hire / ad-hoc custom — drives the leading kind icon. */
  source: RowSource;
  /** parent (has expandable children) / child / standalone. */
  role: RowRole;
  /** kit parent: `kitId` set and not itself a kit child. */
  isKit: boolean;
  /** sub-hire line: `subHireId` set OR legacy `type === "SUBHIRE"`. */
  isSubhire: boolean;
  /** show the expand chevron (kit parent or sub-hire group parent with children). */
  hasChildren: boolean;
}

export function describeRow(item: LineItemData): RowDescriptor {
  const isSubhire = item.subHireId != null || item.type === "SUBHIRE";
  const isKit = !!item.kitId && !item.isKitChild;
  // An accessory parent is a plain top-level asset line (no kitId, no sub-hire)
  // whose children are permanently-attached accessories — they expand the same
  // way kit members do.
  const isAccessoryParent =
    !item.isKitChild &&
    !item.kitId &&
    (item.childLineItems?.some((c) => c.childKind === "ACCESSORY") ?? false);
  // Preserve the exact original expression: any kitId, OR a non-child sub-hire,
  // PLUS accessory parents.
  const hasChildren =
    (item.childLineItems?.length ?? 0) > 0 &&
    (!!item.kitId || (item.subHireId != null && !item.isKitChild) || isAccessoryParent);
  const source: RowSource = item.isCustomItem ? "custom" : isSubhire ? "subhire" : "owned";
  const role: RowRole = item.isKitChild ? "child" : hasChildren ? "parent" : "standalone";
  return { source, role, isKit, isSubhire, hasChildren };
}

// ─── Overbooked info type ───────────────────────────────────────────────────

export type OverbookedInfo = {
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
                <Badge variant="outline" className="ml-1.5 cursor-help text-xs bg-blue-500/10 text-blue-600 border-blue-500/20">
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
    ? "bg-blue-500/10 text-blue-600 border-blue-500/20"
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

export function GroupRow({
  group,
  isExpanded,
  indented,
  isRejectedDropTarget,
  showCostColumn,
  onToggle,
  onDelete,
  onEdit,
  onEditPrice,
  onAddEquipment,
  onAddKit,
  onMove,
  onRecalculate,
  onSaveAsTemplate,
}: {
  group: GroupData;
  isExpanded: boolean;
  indented?: boolean;
  /** Drop Matrix 8C — render the disallowed-drop rejection bar when a
   *  drag of an incompatible source is currently hovering this row. */
  isRejectedDropTarget?: boolean;
  /** 8H — render the Cost column cell. Project groups don't have a
   *  separate cost concept, so the cell renders an em-dash. */
  showCostColumn?: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
  /** Phase 6c — opens the unified PriceEditDialog in project-group mode. */
  onEditPrice?: () => void;
  onAddEquipment: () => void;
  onAddKit: () => void;
  /** Open the move-to-category dialog. Optional so callers that don't
   *  want the affordance (e.g. read-only views) can omit it. */
  onMove?: () => void;
  onRecalculate?: () => void;
  onSaveAsTemplate?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `grp-${group.id}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const priceVal = group.price != null ? Number(group.price) : null;
  const rejectionClasses = isRejectedDropTarget
    ? "border-l-2 border-l-red-500 cursor-not-allowed"
    : "";
  const shortcuts = useRowShortcuts({ e: onEdit, m: onMove, d: onDelete }, "equipment");

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      data-rejected-drop={isRejectedDropTarget ? "true" : undefined}
      className={`group/row ${isDragging ? "opacity-30" : ""} ${rejectionClasses}`}
      {...shortcuts}
    >
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
      {showCostColumn && (
        <TableCell className="text-right hidden md:table-cell t-data text-fg-3">
          —
        </TableCell>
      )}
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
                {onEditPrice && (
                  <DropdownMenuItem onClick={onEditPrice}>
                    <Pencil className="mr-2 h-3.5 w-3.5" />
                    Edit price
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={onAddEquipment}>
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  Add Equipment
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onAddKit}>
                  <Package className="mr-2 h-3.5 w-3.5" />
                  Add Kit
                </DropdownMenuItem>
                {onRecalculate && (
                  <DropdownMenuItem onClick={onRecalculate}>
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                    Recalculate Prices
                  </DropdownMenuItem>
                )}
                {onSaveAsTemplate && (
                  <DropdownMenuItem onClick={onSaveAsTemplate}>
                    <BookmarkPlus className="mr-2 h-3.5 w-3.5" />
                    Save as Template
                  </DropdownMenuItem>
                )}
                {onMove && (
                  <DropdownMenuItem onClick={onMove}>
                    <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />
                    Move to category
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

// ─── Sortable sub-hire group row ────────────────────────────────────────────
//
// Mirrors GroupRow's table shape but with sub-hire-specific affordances:
// Handshake icon, "via Supplier" sub-line, charge in the unit-price column
// (decision 8H — margin is shown as a sub-line under the title), and a
// kebab limited to actions that make sense for a PO-owned group.
//
// Drag handle uses the `shg-<id>` prefix so the unified DnD context can
// distinguish sub-hire groups from project groups (`grp-<id>`).

export function SubHireGroupRow({
  group,
  isExpanded,
  indented,
  isRejectedDropTarget,
  showCostColumn,
  onToggle,
  onEdit,
  onEditPrice,
  onMove,
}: {
  group: SubHireGroupData;
  isExpanded: boolean;
  indented?: boolean;
  /** Drop Matrix 8C — when true this row is the current hovered target
   *  of a disallowed drag. Renders a 2px red left edge + not-allowed
   *  cursor as the visual cue. */
  isRejectedDropTarget?: boolean;
  /** 8H — render the Cost column cell showing the supplier cost. */
  showCostColumn?: boolean;
  onToggle: () => void;
  /** Open the existing SubHireOrderDialog for this group's parent sub-hire. */
  onEdit: () => void;
  /** Phase 6c — opens the unified PriceEditDialog in sub-hire mode
   *  (charge + cost). */
  onEditPrice?: () => void;
  /** Open the move dialog so the group can be reassigned to a different
   *  category (or uncategorised). */
  onMove?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `shg-${group.id}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const charge = group.charge != null ? Number(group.charge) : null;
  const cost = group.cost != null ? Number(group.cost) : null;
  const margin = charge != null && cost != null ? charge - cost : null;
  const supplierName = group.subHire.supplier?.name ?? "Supplier";
  const rejectionClasses = isRejectedDropTarget
    ? "border-l-2 border-l-red-500 cursor-not-allowed"
    : "";
  const shortcuts = useRowShortcuts({ e: onEdit, m: onMove }, "equipment");

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      data-rejected-drop={isRejectedDropTarget ? "true" : undefined}
      className={`group/row ${isDragging ? "opacity-30" : ""} ${rejectionClasses}`}
      {...shortcuts}
    >
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
        <div className={`flex items-start gap-1.5 ${indented ? "ml-2" : ""}`}>
          <button
            type="button"
            onClick={onToggle}
            className="flex items-start gap-1.5 text-left"
          >
            <ChevronRight
              className={`mt-0.5 h-4 w-4 shrink-0 text-fg-3 transition-transform ${
                isExpanded ? "rotate-90" : ""
              }`}
            />
            <div className="flex flex-col">
              <span className="flex items-center gap-1.5 font-semibold">
                <Handshake className="h-3.5 w-3.5 text-fg-3" />
                {group.title}
              </span>
              <span className="text-xs text-fg-3">
                via {supplierName}
                {margin != null && (
                  <>
                    {" · "}
                    {formatCurrency(margin * group.quantity)} margin
                  </>
                )}
              </span>
            </div>
          </button>
        </div>
      </TableCell>
      <TableCell className="text-center t-data">{group.quantity}</TableCell>
      <TableCell className="text-right hidden md:table-cell t-data">
        {charge != null ? formatCurrency(charge) : "--"}
      </TableCell>
      <TableCell className="text-center hidden lg:table-cell t-data">--</TableCell>
      {showCostColumn && (
        <TableCell className="text-right hidden md:table-cell t-data">
          {cost != null ? formatCurrency(cost) : "--"}
        </TableCell>
      )}
      <TableCell className="text-right font-medium hidden sm:table-cell t-data">
        {charge != null ? formatCurrency(charge * group.quantity) : "--"}
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
                <DropdownMenuLabel>Sub-hire</DropdownMenuLabel>
                {onEditPrice && (
                  <DropdownMenuItem onClick={onEditPrice}>
                    <Pencil className="mr-2 h-3.5 w-3.5" />
                    Edit price
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                  Edit in sub-hire order
                </DropdownMenuItem>
                {onMove && (
                  <DropdownMenuItem onClick={onMove}>
                    <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />
                    Move to category
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── Sortable category row ──────────────────────────────────────────────────

export function CategoryRow({
  cat,
  onRename,
  onDelete,
  onAddEquipment,
  onAddKit,
  onAddCustom,
}: {
  cat: CategoryData;
  onRename: () => void;
  onDelete: () => void;
  /** Open the unified add dialog scoped to this category (no group).
   *  All three are optional so callers can opt in. The kebab section
   *  hides entirely when none are supplied. Sub-hire is intentionally
   *  absent — sub-hire orders don't carry a categoryId, only their
   *  groups do, so adding a sub-hire "to a category" is not a clean
   *  semantic. Use the toolbar Add for sub-hires. */
  onAddEquipment?: () => void;
  onAddKit?: () => void;
  onAddCustom?: () => void;
}) {
  const hasAddActions = !!(onAddEquipment || onAddKit || onAddCustom);
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
                {hasAddActions && (
                  <>
                    {onAddEquipment && (
                      <DropdownMenuItem onClick={onAddEquipment}>
                        <Plus className="mr-2 h-3.5 w-3.5" />
                        Add Equipment
                      </DropdownMenuItem>
                    )}
                    {onAddKit && (
                      <DropdownMenuItem onClick={onAddKit}>
                        <Package className="mr-2 h-3.5 w-3.5" />
                        Add Kit
                      </DropdownMenuItem>
                    )}
                    {onAddCustom && (
                      <DropdownMenuItem onClick={onAddCustom}>
                        <Sparkles className="mr-2 h-3.5 w-3.5" />
                        Add Custom Item
                      </DropdownMenuItem>
                    )}
                  </>
                )}
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

export function LineItemRow({
  item,
  indent,
  overbookedInfo,
  isUnconfirmed,
  isExpanded,
  isSelected,
  showCostColumn,
  orgId,
  projectId,
  onToggle,
  onEdit,
  onMoveToCategory,
  onMoveToGroup,
  onRemove,
  onClick,
}: {
  item: LineItemData;
  indent: string;
  overbookedInfo?: OverbookedInfo | null;
  isUnconfirmed?: boolean;
  isExpanded?: boolean;
  /** Multi-select: highlight this row */
  isSelected?: boolean;
  /** 8H — render the Cost column cell. Standalone line items don't carry
   *  a supplier-cost concept, so the cell renders an em-dash. */
  showCostColumn?: boolean;
  /** Collaboration: org and project identifiers for live status badges. */
  orgId?: string;
  projectId?: string;
  onToggle?: () => void;
  onEdit: () => void;
  /** Opens the "Move to category" dialog. The item lands under a
   *  category as a standalone item (groupId = null). */
  onMoveToCategory: () => void;
  /** Opens the "Move to group" dialog. The item lands inside a
   *  specific group and adopts its category. */
  onMoveToGroup: () => void;
  onRemove: () => void;
  /** Multi-select: row click handler (not firing for grip handle clicks) */
  onClick?: (e: React.MouseEvent) => void;
}) {
  const desc = describeRow(item);
  const hasChildren = desc.hasChildren;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `li-${item.id}` });

  // Collaboration: reactive lock and review marker for this row
  const liveLock = useQuery(
    api.collaboration.getLock,
    orgId && projectId ? { orgId, entityType: "project", entityId: projectId, targetType: "lineItem", targetId: item.id } : "skip"
  );
  const liveMarker = useQuery(
    api.collaboration.getReviewMarker,
    orgId && projectId ? { orgId, entityId: projectId, targetId: item.id } : "skip"
  );
  const hasActiveLock = liveLock && !liveLock.isStale && liveLock.status === "active";
  const handleMarker = async (status: MarkerStatus) => {
    if (!projectId) return;
    try {
      await setReviewMarker("project", projectId, "lineItem", item.id, status);
      toast.success(status === "resolved" ? "Marker resolved" : "Marker updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update marker");
    }
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Map content indent to grip indent (margin-based to avoid affecting column width)
  const gripIndent = indent === "ml-12" ? "ml-8" : indent === "ml-3" ? "ml-1" : "";

  // Deeper indent for child rows
  const childIndent = indent === "ml-12" ? "ml-16" : indent === "ml-3" ? "ml-8" : "ml-6";

  // `m` binds to "Move to category" — it's the broader, lossless
  // pick (an item with no group is still meaningful). Group moves
  // need the explicit kebab path. Matches the precedent set by
  // category-only being the default destination state.
  const shortcuts = useRowShortcuts({ e: onEdit, m: onMoveToCategory, d: onRemove }, "equipment");

  return (
    <>
    <TableRow
      ref={setNodeRef}
      style={style}
      className={`${isDragging ? "opacity-30" : ""} ${isSelected ? "bg-accent/20" : ""}`}
      onClick={onClick}
      {...shortcuts}
    >
      <TableCell className="px-0">
        <div className={`flex justify-end ${gripIndent || "px-1"}`}>
          <button
            type="button"
            className="flex cursor-grab items-center px-1 text-fg-3 hover:text-fg active:cursor-grabbing"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        </div>
      </TableCell>
      <TableCell>
        <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 ${indent}`}>
          {hasChildren && (
            <button type="button" onClick={onToggle} className="shrink-0 text-fg-3 hover:text-fg transition-transform" style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
          <span className="font-medium break-words">
            {item.model?.name ?? item.description ?? "—"}
          </span>
          {hasChildren && (
            <span className="text-xs text-fg-3">{item.childLineItems!.length} item{item.childLineItems!.length !== 1 ? "s" : ""}</span>
          )}
          {(() => {
            // Show asset tags from per-unit fulfillment if present
            // (post-cutover, line.asset is null on multi-quantity
            // serialised lines — the tags live on units). Single-asset
            // legacy lines still render via item.asset.assetTag.
            const unitTags = (item.units ?? [])
              .map((u) => u.asset?.assetTag ?? u.bulkAsset?.assetTag)
              .filter((t): t is string => !!t);
            if (unitTags.length === 1) {
              return <span className="text-xs text-fg-3">({unitTags[0]})</span>;
            }
            if (unitTags.length > 1) {
              return (
                <span className="text-xs text-fg-3">
                  ({unitTags.slice(0, 2).join(", ")}
                  {unitTags.length > 2 ? ` +${unitTags.length - 2}` : ""})
                </span>
              );
            }
            if (item.asset?.assetTag) {
              return <span className="text-xs text-fg-3">({item.asset.assetTag})</span>;
            }
            return null;
          })()}
          {desc.isKit && (
            <Badge variant="outline" className="ml-1.5 text-xs bg-blue-500/10 text-blue-600 border-blue-500/20">
              Kit
            </Badge>
          )}
          {desc.isKit && item.pricingMode === "ITEMIZED" && (
            <Badge variant="outline" className="ml-1 text-xs">
              Itemized
            </Badge>
          )}
          {item.isOptional && (
            <Badge variant="outline" className="ml-1.5 text-xs bg-amber-500/10 text-amber-600 border-amber-500/20">
              Optional
            </Badge>
          )}
          {desc.isSubhire && (
            <Badge variant="outline" className="ml-1.5 text-xs bg-cyan-500/10 text-cyan-600 border-cyan-500/20">
              Subhire
            </Badge>
          )}
          {item.isCustomItem && (
            <Badge variant="outline" className="ml-1.5 text-xs bg-muted text-fg-3 border-border/60">
              Custom
            </Badge>
          )}
          {isUnconfirmed && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger render={
                  <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded bg-amber-500/15">
                    <AlertTriangle className="h-3 w-3 text-amber-500" />
                  </span>
                } />
                <TooltipContent>
                  <p className="text-xs">Sub-hire order not yet confirmed — costs and items may change</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
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
          {/* Collaboration badges: editing lock + review marker */}
          {hasActiveLock && (
            <span
              className="inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none ml-1"
              style={{
                background: liveLock.ownerColor + "22",
                borderColor: liveLock.ownerColor + "66",
                color: liveLock.ownerColor,
              }}
              title={`${liveLock.ownerName} is editing`}
            >
              ✏ {liveLock.ownerName.split(" ")[0]}
            </span>
          )}
          {liveMarker && liveMarker.status !== "resolved" && (
            <ReviewMarkerBadge
              status={liveMarker.status as MarkerStatus}
              reason={liveMarker.reason}
              className="ml-1"
            />
          )}
        </div>
        {desc.isSubhire && item.supplier && (
          <p className={`text-xs text-fg-3 mt-0.5 ${indent}`}>via {item.supplier.name}</p>
        )}
        {item.notes && (
          <p className={`text-xs text-fg-3 mt-0.5 truncate max-w-[300px] ${indent}`} title={item.notes}>{item.notes}</p>
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
      {showCostColumn && (
        <TableCell className="text-right hidden md:table-cell t-data text-fg-3">
          —
        </TableCell>
      )}
      <TableCell className="text-right font-medium hidden sm:table-cell t-data">
        {formatCurrency(item.lineTotal != null ? Number(item.lineTotal) : null)}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          {orgId && projectId && (
            <CommentThreadPanel
              orgId={orgId}
              entityType="project"
              entityId={projectId}
              targetType="lineItem"
              targetId={item.id}
              triggerLabel=""
            >
              <Button variant="ghost" size="icon-sm" title="Comments">
                <MessageCircle className="h-3.5 w-3.5" />
              </Button>
            </CommentThreadPanel>
          )}
          <Button variant="ghost" size="icon-sm" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
              <MoreHorizontal className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Item</DropdownMenuLabel>
                <DropdownMenuItem onClick={onMoveToCategory}>
                  <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />
                  Move to category
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onMoveToGroup}>
                  <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />
                  Move to group
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleMarker("needs_review")}>
                  <BookmarkPlus className="mr-2 h-3.5 w-3.5" />
                  Needs review
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleMarker("follow_up")}>
                  <Handshake className="mr-2 h-3.5 w-3.5" />
                  Follow up
                </DropdownMenuItem>
                {liveMarker && liveMarker.status !== "resolved" && (
                  <DropdownMenuItem onClick={() => handleMarker("resolved")}>
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                    Resolve marker
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={onRemove}
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
    {/* Expanded child items (kit children / sub-hire group children) */}
    {isExpanded && hasChildren && item.childLineItems!.map((child) => (
      <TableRow key={child.id} className="bg-muted/30">
        <TableCell className="px-0">
          <div className="flex justify-end ml-16 px-1 text-fg-3/40">
            <GripVertical className="h-4 w-4" />
          </div>
        </TableCell>
        <TableCell>
          <div className={`${childIndent}`}>
            <div className="flex items-center gap-2">
              <span className="text-sm text-fg-2">{child.model?.name ?? child.description ?? "—"}</span>
              {child.childKind === "ACCESSORY" && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-fg-3">
                  Accessory
                </Badge>
              )}
            </div>
            {child.notes && (
              <p className="text-xs text-fg-3 mt-0.5 truncate max-w-[300px]">{child.notes}</p>
            )}
          </div>
        </TableCell>
        <TableCell className="text-center t-data text-fg-2">{child.quantity}</TableCell>
        <TableCell className="text-right hidden md:table-cell t-data text-fg-2">
          {formatCurrency(child.unitPrice != null ? Number(child.unitPrice) : null)}
        </TableCell>
        <TableCell className="text-right hidden sm:table-cell t-data text-fg-2">
          {formatCurrency(child.lineTotal != null ? Number(child.lineTotal) : null)}
        </TableCell>
        <TableCell />
      </TableRow>
    ))}
    </>
  );
}
