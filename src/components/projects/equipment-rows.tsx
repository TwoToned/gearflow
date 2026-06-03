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
  BookmarkPlus,
  Handshake,
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
  // Preserve the exact original expression: any kitId, OR a non-child sub-hire.
  const hasChildren =
    (item.childLineItems?.length ?? 0) > 0 &&
    (!!item.kitId || (item.subHireId != null && !item.isKitChild));
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

export function GroupRow({
  group,
  isExpanded,
  indented,
  onToggle,
  onDelete,
  onEdit,
  onAddEquipment,
  onAddKit,
  onRecalculate,
  onSaveAsTemplate,
}: {
  group: GroupData;
  isExpanded: boolean;
  indented?: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onAddEquipment: () => void;
  onAddKit: () => void;
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
  onToggle,
  onEdit,
  onMove,
}: {
  group: SubHireGroupData;
  isExpanded: boolean;
  indented?: boolean;
  onToggle: () => void;
  /** Open the existing SubHireOrderDialog for this group's parent sub-hire. */
  onEdit: () => void;
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
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                  Edit in sub-hire order
                </DropdownMenuItem>
                {onMove && (
                  <DropdownMenuItem onClick={onMove}>
                    <Package className="mr-2 h-3.5 w-3.5" />
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

export function LineItemRow({
  item,
  indent,
  overbookedInfo,
  isUnconfirmed,
  isExpanded,
  onToggle,
  onEdit,
  onMove,
  onRemove,
}: {
  item: LineItemData;
  indent: string;
  overbookedInfo?: OverbookedInfo | null;
  isUnconfirmed?: boolean;
  isExpanded?: boolean;
  onToggle?: () => void;
  onEdit: () => void;
  onMove: () => void;
  onRemove: () => void;
}) {
  const desc = describeRow(item);
  const hasChildren = desc.hasChildren;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `li-${item.id}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Map content indent to grip indent (margin-based to avoid affecting column width)
  const gripIndent = indent === "ml-12" ? "ml-8" : indent === "ml-3" ? "ml-1" : "";

  // Deeper indent for child rows
  const childIndent = indent === "ml-12" ? "ml-16" : indent === "ml-3" ? "ml-8" : "ml-6";

  return (
    <>
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
            <Badge variant="outline" className="ml-1.5 text-xs bg-indigo-500/10 text-indigo-600 border-indigo-500/20">
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
    {/* Expanded child items (kit children / sub-hire group children) */}
    {isExpanded && hasChildren && item.childLineItems!.map((child) => (
      <TableRow key={child.id} className="bg-muted/30">
        <TableCell className="px-0" />
        <TableCell>
          <div className={`${childIndent}`}>
            <div className="flex items-center gap-2">
              <span className="text-sm text-fg-2">{child.model?.name ?? child.description ?? "—"}</span>
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
