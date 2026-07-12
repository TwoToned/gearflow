"use client";

/**
 * Row + group rendering primitives for the project equipment tab.
 *
 * Extracted verbatim from equipment-tab.tsx (Phase 3 of the cross-type
 * group/category unification). This commit is a pure move — no behaviour
 * change. The 3-axis RowDescriptor refactor lands in the next commit.
 */

import { useState, useEffect, useRef, type CSSProperties } from "react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { api } from "../../../convex/_generated/api";
import {
  ChevronRight,
  ChevronUp,
  ChevronDown,
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
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TableCell, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/formatters";
import { cn, focusRing } from "@/lib/utils";
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
   *  physical assets a multi-quantity line is using. `status` /
   *  `returnCondition` drive the per-unit fulfillment badge (Deployed /
   *  Returned) — RETURNED units are retained as the "what went out" history. */
  units?: Array<{
    id: string;
    ordinal: number;
    status?: string | null;
    returnCondition?: string | null;
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

// ─── Reorder move buttons ────────────────────────────────────────────────────
//
// Replaces the former drag handle. Small stacked ▲/▼ buttons that move a row
// up or down by one position within its scope. The ▲ is disabled on the first
// row and the ▼ on the last; the parent computes the new ordered id array and
// calls the matching server reorder action.

export interface MoveControls {
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}

function MoveButtons({
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  className,
}: MoveControls & { className?: string }) {
  if (!onMoveUp && !onMoveDown) return null;
  return (
    // Hover/focus-reveal cluster (declutter): hidden by default on desktop,
    // shown on row hover or keyboard focus. Stays visible on touch (no hover)
    // by gating the hide behind `md:` — mirrors the category kebab pattern.
    <div
      className={cn(
        "flex flex-col items-center transition-opacity md:opacity-0 md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100",
        className,
      )}
    >
      <button
        type="button"
        aria-label="Move up"
        disabled={!canMoveUp}
        onClick={(e) => {
          e.stopPropagation();
          onMoveUp?.();
        }}
        className={cn(
          "rounded-sm text-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-25",
          focusRing,
        )}
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label="Move down"
        disabled={!canMoveDown}
        onClick={(e) => {
          e.stopPropagation();
          onMoveDown?.();
        }}
        className={cn(
          "rounded-sm text-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-25",
          focusRing,
        )}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// Column count used for category-row + empty-state colSpans. Spans every
// column except the trailing actions column. Dropped the orphan
// rental-quantity column (no header, rendered a bare "—") → 6 → 5.
export const COL_COUNT = 5;

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

// Row descriptors + the per-unit fulfillment badge map live in a pure module so
// they stay unit-testable without loading this component's Convex/React imports.
// Re-exported here so existing consumers keep importing from equipment-rows.
export {
  taggedUnitCount,
  describeRow,
  unitFulfillmentBadge,
  type RowSource,
  type RowRole,
  type RowDescriptor,
} from "./equipment-row-descriptors";
import { describeRow } from "./equipment-row-descriptors";
import { LineAssetsIndicator } from "./line-assets-indicator";
import { MetricLine, GroupCard, CategoryCardHeading, CardAddButton } from "./equipment-cards";

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
            <TooltipTrigger asChild>
              <Badge status="overbooked" className="ml-1.5 cursor-help">
                Overbooked
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Contains items that are over capacity</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              {/* Reduced stock = info (blue). Badge has no info status, so this is
                  a blue-soft override on a neutral pill (warehouse precedent). */}
              <Badge status="neutral" className="ml-1.5 cursor-help bg-blue-soft text-blue">
                Reduced stock
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              Contains items with {unavail} asset{unavail !== 1 ? "s" : ""} in maintenance or lost
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </>
    );
  }

  const isReduced = info.reducedOnly;
  // Reduced = info (blue override on neutral); inherited-overbook = warn;
  // direct overbook = error (t-out). Status §3 / §1.
  const badgeStatus = isReduced ? "neutral" : info.inherited ? "warn" : "overbooked";
  const colorClass = isReduced ? "bg-blue-soft text-blue" : "";
  const label = isReduced ? "Reduced stock" : "Overbooked";

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
        <TooltipTrigger asChild>
          <Badge status={badgeStatus} className={cn("ml-1.5 cursor-help", colorClass)}>
            {label}
          </Badge>
        </TooltipTrigger>
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
  showCostColumn,
  onToggle,
  onDelete,
  onEdit,
  onEditPrice,
  onAddEquipment,
  onAddKit,
  onMove,
  onSaveAsTemplate,
  orgId,
  projectId,
  lockedBy,
  commentBadge,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  group: GroupData;
  isExpanded: boolean;
  indented?: boolean;
  orgId?: string;
  projectId?: string;
  /** Passive "X is editing" badge — fed from a single entity-level lock
   *  subscription in the parent so we don't mount a hook per row. */
  lockedBy?: { name: string; color: string } | null;
  /** Open / blocking comment counts for this group's thread target. */
  commentBadge?: { open: number; blocking: number };
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
  onSaveAsTemplate?: () => void;
} & MoveControls) {
  const priceVal = group.price != null ? Number(group.price) : null;
  const shortcuts = useRowShortcuts({ e: onEdit, m: onMove, d: onDelete }, "equipment");
  const isMobile = useIsMobile();

  // ── Mobile: group header card (children render as sibling cards below). ──
  const groupMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
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
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onAddEquipment}>
            <Plus className="mr-2 h-3.5 w-3.5" />
            Add equipment
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onAddKit}>
            <Package className="mr-2 h-3.5 w-3.5" />
            Add kit
          </DropdownMenuItem>
          {onSaveAsTemplate && (
            <DropdownMenuItem onClick={onSaveAsTemplate}>
              <BookmarkPlus className="mr-2 h-3.5 w-3.5" />
              Save as template
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
            className="text-t-out data-[highlighted]:bg-out-soft data-[highlighted]:text-t-out"
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  if (isMobile) {
    return (
      <GroupCard
        title={group.title}
        subtext={
          lockedBy ? (
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: lockedBy.color }} />
              Editing: {lockedBy.name}
            </span>
          ) : undefined
        }
        qty={group.quantity}
        total={priceVal != null ? priceVal * group.quantity : null}
        isExpanded={isExpanded}
        onToggle={onToggle}
        actions={
          <div className="flex shrink-0 items-center gap-0.5">
            {orgId && projectId && (
              <CommentThreadPanel
                orgId={orgId}
                entityType="project"
                entityId={projectId}
                targetType="group"
                targetId={group.id}
                triggerLabel=""
              >
                <Button
                  variant="ghost"
                  size="icon"
                  title={commentBadge?.blocking ? `${commentBadge.blocking} blocking group comment${commentBadge.blocking === 1 ? "" : "s"}` : "Comments"}
                  className={cn("relative size-8", commentBadge?.blocking && "text-red")}
                >
                  <MessageCircle className="h-4 w-4" />
                  {commentBadge?.blocking ? (
                    <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red px-0.5 text-[8px] font-medium text-white">
                      {commentBadge.blocking}
                    </span>
                  ) : commentBadge?.open ? (
                    <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-paper-2 px-0.5 text-[8px] font-medium text-ink-2 ring-1 ring-line">
                      {commentBadge.open}
                    </span>
                  ) : null}
                </Button>
              </CommentThreadPanel>
            )}
            {groupMenu}
          </div>
        }
      />
    );
  }

  return (
    <TableRow className="group/row" {...shortcuts}>
      <TableCell className="px-0">
        <div className={`flex justify-end ${indented ? "ml-3" : "px-1"}`}>
          <MoveButtons
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
          />
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
              className={`h-4 w-4 shrink-0 text-muted transition-transform ${
                isExpanded ? "rotate-90" : ""
              }`}
            />
            <span className="font-semibold">{group.title}</span>
          </button>
        </div>
      </TableCell>
      <TableCell className="text-center t-data">{group.quantity}</TableCell>
      <TableCell className="text-right whitespace-nowrap t-data">
        {priceVal != null ? formatCurrency(priceVal) : <span className="text-faint">—</span>}
      </TableCell>
      {showCostColumn && (
        <TableCell className="text-right whitespace-nowrap t-data text-faint">
          —
        </TableCell>
      )}
      <TableCell className="text-right font-medium whitespace-nowrap t-data">
        {priceVal != null ? formatCurrency(priceVal * group.quantity) : <span className="text-faint">—</span>}
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-0.5 flex-nowrap">
          {/* Hover/focus-reveal action cluster (declutter): hidden by default
              on desktop, shown on row hover or keyboard focus. Stays visible
              on touch (no hover) via the `md:` gate. Constrained to the w-32
              actions cell (justify-end + flex-nowrap) so the icons stay
              right-aligned and never overflow onto the Total column. */}
          <div className="flex items-center justify-end gap-0.5 flex-nowrap transition-opacity md:opacity-0 md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100">
            {orgId && projectId && (
              <CommentThreadPanel
                orgId={orgId}
                entityType="project"
                entityId={projectId}
                targetType="group"
                targetId={group.id}
                triggerLabel=""
              >
                <Button
                  variant="ghost"
                  size="icon"
                  title={commentBadge?.blocking ? `${commentBadge.blocking} blocking group comment${commentBadge.blocking === 1 ? "" : "s"}` : "Comments"}
                  className={cn("relative size-8", commentBadge?.blocking && "text-red")}
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  {commentBadge?.blocking ? (
                    <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red px-0.5 text-[8px] font-medium text-white">
                      {commentBadge.blocking}
                    </span>
                  ) : commentBadge?.open ? (
                    <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-paper-2 px-0.5 text-[8px] font-medium text-ink-2 ring-1 ring-line">
                      {commentBadge.open}
                    </span>
                  ) : null}
                </Button>
              </CommentThreadPanel>
            )}
            <Button variant="ghost" size="icon" className="size-8" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
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
                    Add equipment
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onAddKit}>
                    <Package className="mr-2 h-3.5 w-3.5" />
                    Add kit
                  </DropdownMenuItem>
                  {onSaveAsTemplate && (
                    <DropdownMenuItem onClick={onSaveAsTemplate}>
                      <BookmarkPlus className="mr-2 h-3.5 w-3.5" />
                      Save as template
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
                    className="text-t-out data-[highlighted]:bg-out-soft data-[highlighted]:text-t-out"
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {/* Lock badge stays visible (not part of the hover cluster) — it
              signals another editor and must always be seen. */}
          {lockedBy ? (
            <Badge status="neutral" className="gap-1 text-[10px]">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: lockedBy.color }}
              />
              Editing: {lockedBy.name}
            </Badge>
          ) : null}
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
  showCostColumn,
  onToggle,
  onEdit,
  onEditPrice,
  onMove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  group: SubHireGroupData;
  isExpanded: boolean;
  indented?: boolean;
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
} & MoveControls) {
  const charge = group.charge != null ? Number(group.charge) : null;
  const cost = group.cost != null ? Number(group.cost) : null;
  const margin = charge != null && cost != null ? charge - cost : null;
  const supplierName = group.subHire.supplier?.name ?? "Supplier";
  const shortcuts = useRowShortcuts({ e: onEdit, m: onMove }, "equipment");
  const isMobile = useIsMobile();

  // ── Mobile: sub-hire group header card (children render as sibling cards). ──
  if (isMobile) {
    return (
      <GroupCard
        title={group.title}
        isSubHire
        subtext={
          <>
            via {supplierName}
            {margin != null && <> · {formatCurrency(margin * group.quantity)} margin</>}
          </>
        }
        qty={group.quantity}
        total={charge != null ? charge * group.quantity : null}
        isExpanded={isExpanded}
        onToggle={onToggle}
        actions={
          <div className="flex shrink-0 items-center gap-0.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
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
        }
      />
    );
  }

  return (
    <TableRow className="group/row" {...shortcuts}>
      <TableCell className="px-0">
        <div className={`flex justify-end ${indented ? "ml-3" : "px-1"}`}>
          <MoveButtons
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
          />
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
              className={`mt-0.5 h-4 w-4 shrink-0 text-muted transition-transform ${
                isExpanded ? "rotate-90" : ""
              }`}
            />
            <div className="flex flex-col">
              <span className="flex items-center gap-1.5 font-semibold">
                <Handshake className="h-3.5 w-3.5 text-muted" />
                {group.title}
              </span>
              <span className="text-caption text-muted">
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
      <TableCell className="text-right whitespace-nowrap t-data">
        {charge != null ? formatCurrency(charge) : <span className="text-faint">—</span>}
      </TableCell>
      {showCostColumn && (
        <TableCell className="text-right whitespace-nowrap t-data">
          {cost != null ? formatCurrency(cost) : <span className="text-faint">—</span>}
        </TableCell>
      )}
      <TableCell className="text-right font-medium whitespace-nowrap t-data">
        {charge != null ? formatCurrency(charge * group.quantity) : <span className="text-faint">—</span>}
      </TableCell>
      <TableCell>
        {/* Constrained to the w-32 actions cell (justify-end + flex-nowrap) so
            the icons stay right-aligned and never overflow onto the Total
            column. Sub-hire groups carry no orgId/projectId, so they
            legitimately have no comment affordance — edit + more only. */}
        <div className="flex items-center justify-end gap-0.5 flex-nowrap transition-opacity md:opacity-0 md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100">
          <Button variant="ghost" size="icon" className="size-8" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
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
  columnCount,
  lockedBy,
  onRename,
  onDelete,
  onAddEquipment,
  onAddKit,
  onAddCustom,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  cat: CategoryData;
  /** Total rendered column count (COL_COUNT + cost). The header cell spans this so it
   *  stays consistent with the separator/empty rows when the cost column is shown. */
  columnCount: number;
  /** Passive "X is editing" badge — fed from the parent's single
   *  entity-level lock subscription, looked up by category target key. */
  lockedBy?: { name: string; color: string } | null;
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
} & MoveControls) {
  const hasAddActions = !!(onAddEquipment || onAddKit || onAddCustom);
  const isMobile = useIsMobile();

  const categoryMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Category</DropdownMenuLabel>
          {hasAddActions && (
            <>
              {onAddEquipment && (
                <DropdownMenuItem onClick={onAddEquipment}>
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  Add equipment
                </DropdownMenuItem>
              )}
              {onAddKit && (
                <DropdownMenuItem onClick={onAddKit}>
                  <Package className="mr-2 h-3.5 w-3.5" />
                  Add kit
                </DropdownMenuItem>
              )}
              {onAddCustom && (
                <DropdownMenuItem onClick={onAddCustom}>
                  <Sparkles className="mr-2 h-3.5 w-3.5" />
                  Add custom item
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
            className="text-t-out data-[highlighted]:bg-out-soft data-[highlighted]:text-t-out"
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // ── Mobile: category heading (add affordance + overflow kebab). ──
  if (isMobile) {
    return (
      <CategoryCardHeading
        name={cat.name}
        action={
          <div className="flex shrink-0 items-center gap-1">
            {lockedBy ? (
              <Badge status="neutral" className="gap-1 text-[10px]">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: lockedBy.color }} />
                {lockedBy.name}
              </Badge>
            ) : null}
            {onAddEquipment && <CardAddButton onClick={onAddEquipment} />}
            {categoryMenu}
          </div>
        }
      />
    );
  }

  return (
    <TableRow className="group/cat border-b-0 bg-paper-2/50 hover:bg-elev">
      <TableCell colSpan={columnCount} className="py-2 px-1">
        <div className="flex items-center gap-1.5">
          <MoveButtons
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            className="px-1 md:group-hover/cat:opacity-100 md:group-focus-within/cat:opacity-100"
          />
          <h3 className="t-overline text-muted">{cat.name}</h3>
          {lockedBy ? (
            <Badge status="neutral" className="gap-1 text-[10px]">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: lockedBy.color }}
              />
              Editing: {lockedBy.name}
            </Badge>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8 opacity-0 transition-opacity pointer-coarse:opacity-100 group-hover/cat:opacity-100 focus-visible:opacity-100">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Category</DropdownMenuLabel>
                {hasAddActions && (
                  <>
                    {onAddEquipment && (
                      <DropdownMenuItem onClick={onAddEquipment}>
                        <Plus className="mr-2 h-3.5 w-3.5" />
                        Add equipment
                      </DropdownMenuItem>
                    )}
                    {onAddKit && (
                      <DropdownMenuItem onClick={onAddKit}>
                        <Package className="mr-2 h-3.5 w-3.5" />
                        Add kit
                      </DropdownMenuItem>
                    )}
                    {onAddCustom && (
                      <DropdownMenuItem onClick={onAddCustom}>
                        <Sparkles className="mr-2 h-3.5 w-3.5" />
                        Add custom item
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
                  className="text-t-out data-[highlighted]:bg-out-soft data-[highlighted]:text-t-out"
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
  selectable,
  selectionActive,
  onSelectChange,
  showCostColumn,
  orgId,
  projectId,
  onToggle,
  onEdit,
  onMoveToCategory,
  onMoveToGroup,
  onRemove,
  onClick,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  item: LineItemData;
  indent: string;
  overbookedInfo?: OverbookedInfo | null;
  isUnconfirmed?: boolean;
  isExpanded?: boolean;
  /** Multi-select: highlight this row */
  isSelected?: boolean;
  /** Multi-select: render a selection checkbox (top-level line items only). */
  selectable?: boolean;
  /** Multi-select: a selection exists, so keep the checkbox visible. */
  selectionActive?: boolean;
  /** Multi-select: checkbox toggled (shiftKey enables range select). */
  onSelectChange?: (checked: boolean, shiftKey: boolean) => void;
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
} & MoveControls) {
  const desc = describeRow(item);
  const hasChildren = desc.hasChildren;
  // Per-unit serials are shown via the compact LineAssetsIndicator (icon +
  // hover), not inline text or expandable rows — keeps the table calm.

  // Captures the shift key on checkbox click so the row-level handler can extend
  // a range — Radix's onCheckedChange doesn't forward the originating event.
  const shiftKeyRef = useRef(false);

  // Collaboration: reactive lock and review marker for this row
  const liveLock = useAuthedQuery(
    api.collaboration.getLock,
    orgId && projectId ? { orgId, entityType: "project", entityId: projectId, targetType: "lineItem", targetId: item.id } : "skip"
  );
  const liveMarker = useAuthedQuery(
    api.collaboration.getReviewMarker,
    orgId && projectId ? { orgId, entityId: projectId, targetId: item.id } : "skip"
  );
  // Comment counts for all line items on the project — Convex dedupes this
  // identical subscription across every row, so it's a single live query.
  const commentCounts = useAuthedQuery(
    api.collaboration.listThreadCommentCounts,
    orgId && projectId ? { orgId, entityType: "project", entityId: projectId } : "skip"
  ) as Record<string, { open: number; total: number; blockingOpen: number }> | undefined;
  const myCounts = commentCounts?.[item.id];
  const openComments = myCounts?.open ?? 0;
  const blockingComments = myCounts?.blockingOpen ?? 0;
  const hasActiveLock = liveLock && !liveLock.isStale && liveLock.status === "active";

  // Phase 4 live-build feedback: briefly highlight the row whenever its data
  // changes — on the editor's own save and on a realtime update pushed by
  // another collaborator. Compares the serialised `updatedAt` baseline; the
  // ref is seeded at mount so there's no flash on first render.
  // Normalise to a stable primitive so two equal-value Date instances (if a
  // non-serialised row ever reaches here) don't false-flash on every render.
  const updatedAtKey =
    item.updatedAt instanceof Date ? item.updatedAt.getTime() : item.updatedAt ?? null;
  const [justChanged, setJustChanged] = useState(false);
  const prevUpdatedAt = useRef(updatedAtKey);
  useEffect(() => {
    if (updatedAtKey === prevUpdatedAt.current) return;
    prevUpdatedAt.current = updatedAtKey;
    setJustChanged(true);
    const t = setTimeout(() => setJustChanged(false), 1600);
    return () => clearTimeout(t);
  }, [updatedAtKey]);

  const handleMarker = async (status: MarkerStatus) => {
    if (!projectId) return;
    try {
      await setReviewMarker("project", projectId, "lineItem", item.id, status);
      toast.success(status === "resolved" ? "Marker resolved" : "Marker updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update marker");
    }
  };

  const style = (
    hasActiveLock ? { ["--collab-color"]: liveLock.ownerColor } : {}
  ) as CSSProperties;

  // Map content indent to grip indent (margin-based to avoid affecting column width)
  const gripIndent = indent === "ml-12" ? "ml-8" : indent === "ml-3" ? "ml-1" : "";

  // Deeper indent for child rows
  const childIndent = indent === "ml-12" ? "ml-16" : indent === "ml-3" ? "ml-8" : "ml-6";

  // `m` binds to "Move to category" — it's the broader, lossless
  // pick (an item with no group is still meaningful). Group moves
  // need the explicit kebab path. Matches the precedent set by
  // category-only being the default destination state.
  const shortcuts = useRowShortcuts({ e: onEdit, m: onMoveToCategory, d: onRemove }, "equipment");
  const isMobile = useIsMobile();

  const name = item.model?.name ?? item.description ?? "—";

  // Same badge set the desktop row shows — computed from the same live vars so
  // the card keeps full collaboration / overbook / prep parity.
  const badges = (
    <>
      {desc.isKit && (
        <Badge status="neutral" className="bg-blue-soft text-blue">Kit</Badge>
      )}
      {desc.isKit && item.pricingMode === "ITEMIZED" && (
        <Badge status="neutral">Itemized</Badge>
      )}
      {item.isOptional && <Badge status="warn">Optional</Badge>}
      {desc.isSubhire && (
        <Badge status="neutral" className="bg-blue-soft text-blue">Subhire</Badge>
      )}
      {item.isCustomItem && <Badge status="neutral">Custom</Badge>}
      {isUnconfirmed && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-warn-soft">
                <AlertTriangle className="h-3 w-3 text-warn" />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-caption">Sub-hire order not yet confirmed — costs and items may change</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {item.status === "CANCELLED" && <Badge status="overbooked">Cancelled</Badge>}
      {item.prepStatus === "PREPPED" && <Badge status="ok">Prepped</Badge>}
      <OverbookedBadge info={overbookedInfo} />
      {hasActiveLock && (
        <span
          className="inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none"
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
        <ReviewMarkerBadge status={liveMarker.status as MarkerStatus} reason={liveMarker.reason} />
      )}
    </>
  );

  const lineItemMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label="Item actions">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Item</DropdownMenuLabel>
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Edit
          </DropdownMenuItem>
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
            className="text-t-out data-[highlighted]:bg-out-soft data-[highlighted]:text-t-out"
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // ── Mobile: line-item card. Tapping the body toggles selection (like the
  // warehouse ScanItemCard); edit / move / delete live behind the kebab. ──
  if (isMobile) {
    // Tier: kits / accessory-parents render as "container" cards (leading glyph,
    // heavier ring, bolder title); plain leaf line items are smaller and lighter
    // so the hierarchy reads at a glance. Grouped / sub-hire members (indent ml-12)
    // get a small left inset so they sit visually under their container card.
    const isContainer = hasChildren;
    const nestInset = indent === "ml-12" ? "ml-3" : "";
    const bodyInner = (
      <>
        <div className="flex flex-wrap items-center gap-1.5">
          {isContainer && <Package className="h-3.5 w-3.5 shrink-0 text-muted" />}
          <span className={cn("break-words text-ink", isContainer ? "font-medium" : "text-table-cell")}>{name}</span>
          {hasChildren && (
            <span className="text-caption text-muted">
              {item.childLineItems!.length} item{item.childLineItems!.length !== 1 ? "s" : ""}
            </span>
          )}
          <LineAssetsIndicator
            units={item.units}
            lineAssetTag={item.asset?.assetTag}
            lineItemId={item.id}
            modelId={item.modelId}
          />
          {badges}
        </div>
        {desc.isSubhire && item.supplier && (
          <p className="text-caption text-muted">via {item.supplier.name}</p>
        )}
        {item.notes && (
          <p className="mt-0.5 truncate text-caption text-muted" title={item.notes}>{item.notes}</p>
        )}
        <MetricLine item={item} showCostColumn={showCostColumn} />
      </>
    );
    return (
      <div className={cn("space-y-1.5", nestInset)}>
        <div
          style={style}
          className={cn(
            "flex min-h-11 items-start gap-2 rounded-[var(--r)] bg-card transition-colors",
            isContainer ? "px-3 py-2.5 ring-1 ring-line-2" : "px-3 py-2 ring-1 ring-line",
            isSelected && "ring-2 ring-red",
            hasActiveLock && "collab-editing",
            justChanged && "collab-changed",
          )}
        >
          {selectable && (
            <span
              onMouseDown={(e) => {
                shiftKeyRef.current = e.shiftKey;
              }}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex min-h-11 min-w-8 shrink-0 items-center justify-center"
            >
              <Checkbox
                aria-label="Select item"
                checked={!!isSelected}
                onCheckedChange={(v: boolean | "indeterminate") =>
                  onSelectChange?.(v === true, shiftKeyRef.current)
                }
              />
            </span>
          )}
          {selectable ? (
            <button
              type="button"
              aria-pressed={!!isSelected}
              onMouseDown={(e) => {
                shiftKeyRef.current = e.shiftKey;
              }}
              onClick={() => onSelectChange?.(!isSelected, shiftKeyRef.current)}
              className={cn("min-w-0 flex-1 text-left", focusRing)}
            >
              {bodyInner}
            </button>
          ) : (
            <div className="min-w-0 flex-1">{bodyInner}</div>
          )}
          <div className="flex shrink-0 items-center gap-0.5">
            {hasChildren && (
              <button
                type="button"
                aria-label={isExpanded ? "Collapse" : "Expand"}
                aria-expanded={isExpanded}
                onClick={onToggle}
                className={cn("inline-flex min-h-11 min-w-8 items-center justify-center text-muted hover:text-ink", focusRing)}
              >
                <ChevronRight className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-90")} />
              </button>
            )}
            {orgId && projectId && (
              <CommentThreadPanel
                orgId={orgId}
                entityType="project"
                entityId={projectId}
                targetType="lineItem"
                targetId={item.id}
                triggerLabel=""
              >
                <Button
                  variant="ghost"
                  size="icon"
                  title={
                    blockingComments > 0
                      ? `${blockingComments} blocking comment${blockingComments === 1 ? "" : "s"}`
                      : openComments > 0
                        ? `${openComments} open comment${openComments === 1 ? "" : "s"}`
                        : "Comments"
                  }
                  className={cn("relative size-8", blockingComments > 0 && "text-red")}
                >
                  <MessageCircle className="h-4 w-4" />
                  {blockingComments > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red px-0.5 text-[8px] font-medium text-white">
                      {blockingComments}
                    </span>
                  ) : openComments > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[8px] font-medium text-primary-foreground">
                      {openComments}
                    </span>
                  ) : null}
                </Button>
              </CommentThreadPanel>
            )}
            {lineItemMenu}
          </div>
        </div>
        {/* Expanded child items (kit members / accessories) as nested cards. */}
        {isExpanded && hasChildren && (
          <div className="space-y-1.5">
            {item.childLineItems!.map((child) => {
              const childTags = (child.units ?? [])
                .map((u) => u.asset?.assetTag ?? u.bulkAsset?.assetTag)
                .filter((t): t is string => !!t);
              const tag = childTags[0] ?? child.asset?.assetTag ?? null;
              const extra = childTags.length > 1 ? ` +${childTags.length - 1}` : "";
              return (
                <div key={child.id} className="rounded-[var(--r)] bg-paper-2/40 py-2 pl-6 pr-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-table-cell text-ink-2">{child.model?.name ?? child.description ?? "—"}</span>
                    {tag && <span className="t-mono text-caption text-muted">({tag}{extra})</span>}
                    {child.childKind === "ACCESSORY" && (
                      <Badge status="neutral" className="px-1.5 py-0 text-[10px]">Accessory</Badge>
                    )}
                  </div>
                  {child.notes && (
                    <p className="mt-0.5 truncate text-caption text-muted">{child.notes}</p>
                  )}
                  <MetricLine item={child} showCostColumn={showCostColumn} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
    <TableRow
      style={style}
      className={cn(
        "group/row",
        isSelected && "bg-select",
        hasActiveLock && "collab-editing",
        justChanged && "collab-changed",
      )}
      onClick={onClick}
      {...shortcuts}
    >
      <TableCell className="px-0">
        <div className={`flex justify-end ${gripIndent || "px-1"}`}>
          <MoveButtons
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
          />
        </div>
      </TableCell>
      <TableCell>
        <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 ${indent}`}>
          {selectable && (
            <span
              // Capture the shift key on mousedown — it fires before the click →
              // onCheckedChange sequence, so the ref is fresh when the checkbox's
              // change handler reads it (Radix doesn't forward the event). onClick
              // stops the row-click select handler (the checkbox owns its toggle).
              onMouseDown={(e) => {
                shiftKeyRef.current = e.shiftKey;
              }}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "shrink-0 transition-opacity",
                isSelected || selectionActive
                  ? "opacity-100"
                  : "opacity-0 pointer-coarse:opacity-100 group-hover/row:opacity-100",
              )}
            >
              <Checkbox
                aria-label="Select item"
                checked={!!isSelected}
                onCheckedChange={(v: boolean | "indeterminate") =>
                  onSelectChange?.(v === true, shiftKeyRef.current)
                }
              />
            </span>
          )}
          {hasChildren && (
            <button type="button" onClick={onToggle} className={cn("shrink-0 rounded-sm text-muted transition-transform hover:text-ink", focusRing)} style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
          <span className="font-medium break-words">
            {item.model?.name ?? item.description ?? "—"}
          </span>
          {hasChildren && (
            <span className="text-caption text-muted">{item.childLineItems!.length} item{item.childLineItems!.length !== 1 ? "s" : ""}</span>
          )}
          <LineAssetsIndicator
            units={item.units}
            lineAssetTag={item.asset?.assetTag}
            lineItemId={item.id}
            modelId={item.modelId}
          />
          {desc.isKit && (
            // Kit = info (blue) — Badge has no info status, so blue-soft override on neutral.
            <Badge status="neutral" className="ml-1.5 bg-blue-soft text-blue">
              Kit
            </Badge>
          )}
          {desc.isKit && item.pricingMode === "ITEMIZED" && (
            <Badge status="neutral" className="ml-1">
              Itemized
            </Badge>
          )}
          {item.isOptional && (
            <Badge status="warn" className="ml-1.5">
              Optional
            </Badge>
          )}
          {desc.isSubhire && (
            // Sub-hire = info (blue) override on neutral (warehouse precedent).
            <Badge status="neutral" className="ml-1.5 bg-blue-soft text-blue">
              Subhire
            </Badge>
          )}
          {item.isCustomItem && (
            <Badge status="neutral" className="ml-1.5">
              Custom
            </Badge>
          )}
          {isUnconfirmed && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="ml-1.5 inline-flex h-5 w-5 items-center justify-center rounded bg-warn-soft">
                    <AlertTriangle className="h-3 w-3 text-warn" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-caption">Sub-hire order not yet confirmed — costs and items may change</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {item.status === "CANCELLED" && (
            <Badge status="overbooked" className="ml-1.5">
              Cancelled
            </Badge>
          )}
          {item.prepStatus === "PREPPED" && (
            <Badge status="ok" className="ml-1.5">
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
          <p className={`text-caption text-muted mt-0.5 ${indent}`}>via {item.supplier.name}</p>
        )}
        {item.notes && (
          <p className={`text-caption text-muted mt-0.5 truncate max-w-[300px] ${indent}`} title={item.notes}>{item.notes}</p>
        )}
      </TableCell>
      <TableCell className="text-center t-data">{item.quantity}</TableCell>
      <TableCell className="text-right whitespace-nowrap t-data">
        <div className="flex items-center justify-end gap-1">
          {formatCurrency(item.unitPrice != null ? Number(item.unitPrice) : null)}
          {item.priceOverridden && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-warn shrink-0" title="Manually set price" />
          )}
        </div>
        {item.discount != null && Number(item.discount) > 0 && (
          <p className="text-micro text-ok">-{formatCurrency(Number(item.discount))} disc.</p>
        )}
      </TableCell>
      {showCostColumn && (
        <TableCell className="text-right whitespace-nowrap t-data text-faint">
          —
        </TableCell>
      )}
      <TableCell className="text-right font-medium whitespace-nowrap t-data">
        {formatCurrency(item.lineTotal != null ? Number(item.lineTotal) : null)}
      </TableCell>
      <TableCell>
        {/* Hover/focus-reveal action cluster (declutter): hidden by default on
            desktop, shown on row hover or keyboard focus. Stays visible on touch
            (no hover) via the `md:` gate. Constrained to the w-32 actions cell
            (justify-end + flex-nowrap) so the comment/edit/more icons stay
            right-aligned and never overflow onto the Total column. */}
        <div className="flex items-center justify-end gap-0.5 flex-nowrap transition-opacity md:opacity-0 md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100">
          {orgId && projectId && (
            <CommentThreadPanel
              orgId={orgId}
              entityType="project"
              entityId={projectId}
              targetType="lineItem"
              targetId={item.id}
              triggerLabel=""
            >
              <Button
                variant="ghost"
                size="icon"
                title={
                  blockingComments > 0
                    ? `${blockingComments} blocking comment${blockingComments === 1 ? "" : "s"}`
                    : openComments > 0
                      ? `${openComments} open comment${openComments === 1 ? "" : "s"}`
                      : "Comments"
                }
                className={cn("relative size-8", blockingComments > 0 && "text-red")}
              >
                <MessageCircle className="h-3.5 w-3.5" />
                {blockingComments > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red px-0.5 text-[8px] font-medium text-white">
                    {blockingComments}
                  </span>
                ) : openComments > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[8px] font-medium text-primary-foreground">
                    {openComments}
                  </span>
                ) : null}
              </Button>
            </CommentThreadPanel>
          )}
          <Button variant="ghost" size="icon" className="size-8" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
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
                  className="text-t-out data-[highlighted]:bg-out-soft data-[highlighted]:text-t-out"
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
    {/* Expanded child items (kit children / sub-hire group children).
        Child rows carry a subtle tint; the name's indent conveys nesting. */}
    {isExpanded && hasChildren && item.childLineItems!.map((child) => (
      <TableRow key={child.id} className="bg-paper-2/40">
        <TableCell className="px-0" />
        <TableCell>
          <div className={`${childIndent}`}>
            <div className="flex items-center gap-2">
              <span className="text-table-cell text-ink-2">{child.model?.name ?? child.description ?? "—"}</span>
              {(() => {
                // Kit members carry their serial on the child line's `asset`
                // (no unit row); accessories carry it on `units`. Prefer unit
                // tags, fall back to the line-level asset tag.
                const childTags = (child.units ?? [])
                  .map((u) => u.asset?.assetTag ?? u.bulkAsset?.assetTag)
                  .filter((t): t is string => !!t);
                const tag = childTags[0] ?? child.asset?.assetTag ?? null;
                if (!tag) return null;
                const extra = childTags.length > 1 ? ` +${childTags.length - 1}` : "";
                return <span className="t-mono text-caption text-muted">({tag}{extra})</span>;
              })()}
              {child.childKind === "ACCESSORY" && (
                <Badge status="neutral" className="text-[10px] px-1.5 py-0">
                  Accessory
                </Badge>
              )}
            </div>
            {child.notes && (
              <p className="text-caption text-muted mt-0.5 truncate max-w-[300px]">{child.notes}</p>
            )}
          </div>
        </TableCell>
        <TableCell className="text-center t-data text-ink-2">{child.quantity}</TableCell>
        <TableCell className="text-right whitespace-nowrap t-data text-ink-2">
          {formatCurrency(child.unitPrice != null ? Number(child.unitPrice) : null)}
        </TableCell>
        {showCostColumn && <TableCell className="text-right whitespace-nowrap t-data" />}
        <TableCell className="text-right whitespace-nowrap t-data text-ink-2">
          {formatCurrency(child.lineTotal != null ? Number(child.lineTotal) : null)}
        </TableCell>
        {/* Child rows can't be price-edited or reordered independently, so the
            actions cell renders empty — but the w-32 column is still reserved
            so every row's columns align with the colgroup. */}
        <TableCell />
      </TableRow>
    ))}
    </>
  );
}
