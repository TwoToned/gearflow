"use client";

/**
 * Row + group rendering primitives for the project equipment tab.
 *
 * Extracted verbatim from equipment-tab.tsx (Phase 3 of the cross-type
 * group/category unification). This commit is a pure move — no behaviour
 * change. The 3-axis RowDescriptor refactor lands in the next commit.
 */

import { useState, useEffect, useRef } from "react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { api } from "../../../convex/_generated/api";
import {
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
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TableCell, TableRow } from "@/components/ui/table";
import { LockedField } from "@/components/ui/locked-field";
import { formatCurrency } from "@/lib/formatters";
import { parsePriceBreakdown, formatPriceBreakdown } from "@/lib/billing-derivation";
import { lineGrossAmount, type DiscountMode } from "@/lib/discount-mode";
import type { InlineLineItemPatch } from "@/lib/line-item-edit-payload";
import { cn, focusRing } from "@/lib/utils";
import { InlineEditableText, InlineEditablePrice, InlineEditableDiscount, InlineEditablePercent, InlineEditableQuantity } from "./line-item-inline-cells";
import { useRowShortcuts } from "./use-row-shortcuts";
import { ReviewMarkerBadge } from "@/components/collaboration/review-marker-badge";
import type { MarkerStatus } from "@/components/collaboration/review-marker-badge";
import { CommentThreadPanel } from "@/components/collaboration/comment-thread-panel";
import { useCollaborationWrites } from "@/hooks/use-collaboration-writes";
import { toast } from "sonner";
import type { LineItemData, GroupData, SubHireGroupData, CategoryData } from "./equipment-row-types";

export type {
  LineItemData,
  GroupData,
  SubHireGroupData,
  MixedGroupSlot,
  CategoryData,
} from "./equipment-row-types";

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

// ─── Drag entry point (every row kind) ───────────────────────────────────────
//
// The real @dnd-kit wiring, shared by LineItemRow, GroupRow, SubHireGroupRow,
// and CategoryRow. There is no dedicated drag handle — pressing and holding
// ANYWHERE on the row/card starts the drag (a small delay-based activation
// constraint on the sensor, see use-equipment-dnd.ts, distinguishes a quick
// tap/click from a deliberate hold, so nested buttons/checkboxes/inputs keep
// working normally). `dragHandleRef`/`dragAttributes`/`dragListeners` are
// `useSortable()`'s `setNodeRef`/`attributes`/`listeners`, spread onto the
// row's/card's ROOT element (the `<TableRow>` on desktop, the card container
// on mobile) so dnd-kit measures and tracks the actual visible surface being
// dragged — not a separate, differently-sized node — which is also what keeps
// the drag preview tracking the exact point the user grabbed instead of
// snapping to some other anchor. Kept generic (`Record<string, unknown>` for
// attributes/listeners) so this file stays free of a hard `@dnd-kit` import —
// the caller (equipment-tab.tsx, which DOES import dnd-kit) passes its
// `useSortable()` return values straight through.

export interface DragHandleControls {
  /** `useSortable()`'s `setNodeRef` — attach to the row/card ROOT element. */
  dragHandleRef?: (el: HTMLElement | null) => void;
  dragAttributes?: Record<string, unknown>;
  dragListeners?: Record<string, unknown>;
  /** `useSortable()`'s `transform`/`transition` turned into an inline style
   *  (equipment-tab.tsx's `buildDragStyle`) — applied to the same ROOT
   *  element as the ref/attributes/listeners above. This is what makes OTHER
   *  rows slide out of the way live while something is dragged over them. */
  dragStyle?: React.CSSProperties;
  /** True for the ONE row currently being dragged. Dims it in place (rather
   *  than leaving it fully visible while an unrelated floating preview
   *  follows the cursor) so it reads as "this line lifted up", not "a new
   *  one appeared". */
  isDragging?: boolean;
  /** No drag entry point at all when true (e.g. sub-hire/kit group children,
   *  which aren't independently reorderable). */
  isDragDisabled?: boolean;
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
import { UnpricedBadge } from "./unpriced-badge";
import { LineAssetsIndicator } from "./line-assets-indicator";
import { MetricLine, GroupCard, CategoryCardHeading, CardAddButton } from "./equipment-cards";
import { ReportIssueDialog } from "@/components/warehouse/report-issue-dialog";

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

/** A single inline-edited field on a project group's own price cells. Unlike
 *  `InlineLineItemPatch`'s "discount" variant, `price` and `discount` are
 *  separate variants (not a shared object) because `updateGroupPriceNative`'s
 *  `price` arg is always-required/full-replace while `discount`/
 *  `discountMode` are set-or-clear-when-provided — the caller
 *  (`equipment-tab.tsx`'s `handleInlineGroupPriceUpdate`) needs to know which
 *  one was actually edited to resend the untouched value for the other. */
export type GroupInlinePricePatch =
  | { field: "price"; value: number | undefined }
  | { field: "discount"; value: number | undefined; discountMode: DiscountMode };

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
  commentBadge,
  dragHandleRef,
  dragAttributes,
  dragListeners,
  dragStyle,
  isDragging,
  isDragDisabled,
  onInlinePriceUpdate,
  moneyLocked,
  lockReason,
  onUnlockExit,
}: {
  group: GroupData;
  isExpanded: boolean;
  indented?: boolean;
  orgId?: string;
  projectId?: string;
  /** Open / blocking comment counts for this group's thread target. */
  commentBadge?: { open: number; blocking: number };
  /** 8H — render the Cost column cell. Project groups don't have a
   *  separate cost concept, so the cell renders an em-dash. */
  showCostColumn?: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
  /** Phase 6c — opens the unified PriceEditDialog in project-group mode.
   *  Kept alongside inline editing (below) as a redundant entry point. */
  onEditPrice?: () => void;
  onAddEquipment: () => void;
  onAddKit: () => void;
  /** Open the move-to-category dialog. Optional so callers that don't
   *  want the affordance (e.g. read-only views) can omit it. */
  onMove?: () => void;
  onSaveAsTemplate?: () => void;
  /** Inline click-to-edit price/discount cells — the same
   *  `updateGroupPriceNative` write `onEditPrice`'s dialog makes. */
  onInlinePriceUpdate?: (group: GroupData, patch: GroupInlinePricePatch) => Promise<unknown>;
  /** Unlike sub-hire groups' cost/charge, a project group's price/discount
   *  IS financial-lock-gated server-side — real gating, not cosmetic. */
  moneyLocked?: boolean;
  lockReason?: string;
  onUnlockExit?: () => void;
} & DragHandleControls) {
  const priceVal = group.price != null ? Number(group.price) : null;
  const discountVal = group.discount != null ? Number(group.discount) : 0;
  const groupTotal = priceVal != null ? Math.max(0, priceVal * group.quantity - discountVal) : null;
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
        qty={group.quantity}
        total={groupTotal}
        isExpanded={isExpanded}
        onToggle={onToggle}
        dragHandleRef={dragHandleRef}
        dragAttributes={dragAttributes}
        dragListeners={dragListeners}
        dragStyle={dragStyle}
        isDragging={isDragging}
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
    <TableRow
      className={cn("group/row", !isDragDisabled && "cursor-grab active:cursor-grabbing", isDragging && "opacity-40")}
      style={dragStyle}
      ref={dragHandleRef}
      data-drag-row="true"
      {...(dragAttributes as React.HTMLAttributes<HTMLTableRowElement> | undefined)}
      {...(dragListeners as React.HTMLAttributes<HTMLTableRowElement> | undefined)}
      {...shortcuts}
    >
      <TableCell className="px-0" />
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
        {onInlinePriceUpdate ? (
          <LockedField
            locked={!!moneyLocked}
            reason={lockReason ?? "This project's financials are locked."}
            exitLabel="Manage unlock"
            onExit={onUnlockExit}
          >
            <div className="flex justify-end">
              <InlineEditablePrice
                value={priceVal}
                onSave={(next) => onInlinePriceUpdate(group, { field: "price", value: next })}
              />
            </div>
            <div className="flex justify-end">
              <InlineEditableDiscount
                discount={discountVal > 0 ? discountVal : null}
                discountMode={group.discountMode}
                gross={lineGrossAmount({ unitPrice: priceVal, quantity: group.quantity, duration: 1 })}
                onSave={(amount, mode) => onInlinePriceUpdate(group, { field: "discount", value: amount, discountMode: mode })}
              />
            </div>
          </LockedField>
        ) : (
          <>
            {priceVal != null ? formatCurrency(priceVal) : <span className="text-faint">—</span>}
            {discountVal > 0 && (
              <p className="text-micro text-ok">-{formatCurrency(discountVal)} disc.</p>
            )}
          </>
        )}
        {group.pricedUnderLock && (
          <div className="mt-0.5 flex justify-end">
            <UnpricedBadge />
          </div>
        )}
      </TableCell>
      {showCostColumn && (
        <TableCell className="text-right whitespace-nowrap t-data text-faint">
          —
        </TableCell>
      )}
      <TableCell className="text-right font-medium whitespace-nowrap t-data">
        {groupTotal != null ? formatCurrency(groupTotal) : <span className="text-faint">—</span>}
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
  dragHandleRef,
  dragAttributes,
  dragListeners,
  dragStyle,
  isDragging,
  isDragDisabled,
  onInlinePriceUpdate,
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
   *  (charge + cost). Kept alongside inline editing (below) as a redundant
   *  entry point, same as LineItemRow's pencil "Edit" button. */
  onEditPrice?: () => void;
  /** Open the move dialog so the group can be reassigned to a different
   *  category (or uncategorised). */
  onMove?: () => void;
  /** Inline click-to-edit charge/cost cells — the same `updateGroup` call
   *  `onEditPrice`'s dialog makes, just per-cell. Omitted (mobile, or a
   *  future caller that doesn't want it) falls back to the static display. */
  onInlinePriceUpdate?: (group: SubHireGroupData, patch: { cost?: number | null; charge?: number | null }) => Promise<unknown>;
} & DragHandleControls) {
  const charge = group.charge != null ? Number(group.charge) : null;
  const cost = group.cost != null ? Number(group.cost) : null;
  const margin = charge != null && cost != null ? charge - cost : null;
  const supplierName = group.subHire.supplier?.name ?? "Supplier";
  const shortcuts = useRowShortcuts({ e: onEdit, m: onMove }, "equipment");
  const isMobile = useIsMobile();
  // "Show as sub-hired" (showOnDocs) only governs client-document visibility —
  // staff always see the Subhire badge/icon here — but the "via {supplier}"
  // text names the actual supplier, so it's suppressed with the same toggle
  // the client-facing docs use, even in this internal-only project view.
  const marginLabel = margin != null ? `${formatCurrency(margin * group.quantity)} margin` : null;
  const subhireLine = [group.showOnDocs ? `via ${supplierName}` : null, marginLabel].filter(Boolean).join(" · ") || null;

  // ── Mobile: sub-hire group header card (children render as sibling cards). ──
  if (isMobile) {
    return (
      <GroupCard
        title={group.title}
        isSubHire
        subtext={subhireLine}
        qty={group.quantity}
        total={charge != null ? charge * group.quantity : null}
        isExpanded={isExpanded}
        onToggle={onToggle}
        dragHandleRef={dragHandleRef}
        dragAttributes={dragAttributes}
        dragListeners={dragListeners}
        dragStyle={dragStyle}
        isDragging={isDragging}
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
    <TableRow
      className={cn("group/row", !isDragDisabled && "cursor-grab active:cursor-grabbing", isDragging && "opacity-40")}
      style={dragStyle}
      ref={dragHandleRef}
      data-drag-row="true"
      {...(dragAttributes as React.HTMLAttributes<HTMLTableRowElement> | undefined)}
      {...(dragListeners as React.HTMLAttributes<HTMLTableRowElement> | undefined)}
      {...shortcuts}
    >
      <TableCell className="px-0" />
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
              {subhireLine && <span className="text-caption text-muted">{subhireLine}</span>}
            </div>
          </button>
        </div>
      </TableCell>
      <TableCell className="text-center t-data">{group.quantity}</TableCell>
      <TableCell className="text-right whitespace-nowrap t-data">
        {onInlinePriceUpdate ? (
          <InlineEditablePrice
            value={charge}
            onSave={(next) => onInlinePriceUpdate(group, { charge: next ?? null })}
          />
        ) : charge != null ? (
          formatCurrency(charge)
        ) : (
          <span className="text-faint">—</span>
        )}
      </TableCell>
      {showCostColumn && (
        <TableCell className="text-right whitespace-nowrap t-data">
          {onInlinePriceUpdate ? (
            <InlineEditablePrice
              value={cost}
              onSave={(next) => onInlinePriceUpdate(group, { cost: next ?? null })}
            />
          ) : cost != null ? (
            formatCurrency(cost)
          ) : (
            <span className="text-faint">—</span>
          )}
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
  onRename,
  onDelete,
  onAddEquipment,
  onAddKit,
  onAddCustom,
  dragHandleRef,
  dragAttributes,
  dragListeners,
  dragStyle,
  isDragging,
  isDragDisabled,
}: {
  cat: CategoryData;
  /** Total rendered column count (COL_COUNT + cost). The header cell spans this so it
   *  stays consistent with the separator/empty rows when the cost column is shown. */
  columnCount: number;
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
} & DragHandleControls) {
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
        dragHandleRef={dragHandleRef}
        dragAttributes={dragAttributes}
        dragListeners={dragListeners}
        dragStyle={dragStyle}
        isDragging={isDragging}
        action={
          <div className="flex shrink-0 items-center gap-1">
            {onAddEquipment && <CardAddButton onClick={onAddEquipment} />}
            {categoryMenu}
          </div>
        }
      />
    );
  }

  return (
    <TableRow
      className={cn(
        "group/cat border-b-0 bg-paper-2/50 hover:bg-elev",
        !isDragDisabled && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40",
      )}
      style={dragStyle}
      ref={dragHandleRef}
      data-drag-row="true"
      {...(dragAttributes as React.HTMLAttributes<HTMLTableRowElement> | undefined)}
      {...(dragListeners as React.HTMLAttributes<HTMLTableRowElement> | undefined)}
    >
      <TableCell colSpan={columnCount} className="py-2 px-1">
        <div className="flex items-center gap-1.5">
          <h3 className="t-overline text-muted">{cat.name}</h3>
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
  markerByTarget,
  onToggle,
  onEdit,
  onMoveToCategory,
  onMoveToGroup,
  onRemove,
  onClick,
  dragHandleRef,
  dragAttributes,
  dragListeners,
  dragStyle,
  isDragging,
  isDragDisabled,
  onInlineUpdate,
  moneyLocked,
  lockReason,
  onUnlockExit,
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
  /** Project-wide review-marker map (one subscription, built by the caller)
   *  looked up by target key instead of this row mounting its own subscription. */
  markerByTarget?: Map<string, { status: string; reason?: string }>;
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
  /** Inline (click-to-edit, save-on-blur) price/discount/description/notes —
   *  same `patchNative` write `onEdit`'s dialog uses. Omitted for rows whose
   *  `onEdit` opens something OTHER than `EditLineItemDialog` (e.g. sub-hire
   *  group children, which manage price via cost/charge on the group) —
   *  those cells stay static. */
  onInlineUpdate?: (item: LineItemData, patch: InlineLineItemPatch) => Promise<unknown>;
  /** #990/#791 — money fields (price/discount) render read-only when the
   *  project's financials are locked, mirroring `EditLineItemDialog`'s
   *  `locked` prop. */
  moneyLocked?: boolean;
  lockReason?: string;
  onUnlockExit?: () => void;
} & DragHandleControls) {
  const desc = describeRow(item);
  const hasChildren = desc.hasChildren;
  // Per-unit serials are shown via the compact LineAssetsIndicator (icon +
  // hover), not inline text or expandable rows — keeps the table calm.

  // A sub-hire GROUP CHILD (as opposed to an ungrouped/standalone sub-hire
  // item, which stays on the regular patchNative path) — its price/discount
  // cells route through updateSubHireItemNative instead. See
  // sub-hire-item-edit-payload.ts and equipment-tab.tsx's
  // handleInlineLineItemUpdate.
  const isSubHireGroupChild = item.subHireGroupId != null;

  // Captures the shift key on checkbox click so the row-level handler can extend
  // a range — Radix's onCheckedChange doesn't forward the originating event.
  const shiftKeyRef = useRef(false);
  const { setReviewMarker } = useCollaborationWrites();

  // Collaboration: reactive review marker for this row, looked up from the
  // project-wide map the caller (equipment-tab.tsx) already subscribes to
  // ONCE — NOT a per-row subscription (targetId differs per row, so Convex can't
  // dedupe a per-row getReviewMarker query the way it dedupes the identical-args
  // listThreadCommentCounts call below).
  const liveMarker = markerByTarget?.get(item.id);
  // Comment counts for all line items on the project — Convex dedupes this
  // identical subscription across every row, so it's a single live query.
  const commentCounts = useAuthedQuery(
    api.collaboration.listThreadCommentCounts,
    orgId && projectId ? { orgId, entityType: "project", entityId: projectId } : "skip"
  ) as Record<string, { open: number; total: number; blockingOpen: number }> | undefined;
  const myCounts = commentCounts?.[item.id];
  const openComments = myCounts?.open ?? 0;
  const blockingComments = myCounts?.blockingOpen ?? 0;

  // Phase 4 live-build feedback: briefly highlight the row whenever its data
  // changes — on the editor's own save and on a realtime update pushed by
  // another collaborator. Compares the serialised `updatedAt` baseline; the
  // ref is seeded at mount so there's no flash on first render.
  // Normalise to a stable primitive so two equal-value Date instances (if a
  // non-serialised row ever reaches here) don't false-flash on every render.
  const updatedAtKey =
    item.updatedAt instanceof Date ? item.updatedAt.getTime() : item.updatedAt ?? null;
  const [justChanged, setJustChanged] = useState(false);
  // "Report Issue" (GitHub #898) — only offered while the line is CHECKED_OUT
  // (deployed on the job); Pick/Prep/Returned lines go through the ordinary
  // check-queue flow instead.
  const [reportIssueOpen, setReportIssueOpen] = useState(false);
  const canReportIssue = item.status === "CHECKED_OUT";
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
          {canReportIssue && (
            <DropdownMenuItem
              onClick={() => setReportIssueOpen(true)}
              className="text-warn data-[highlighted]:bg-warn-soft data-[highlighted]:text-warn"
            >
              <AlertTriangle className="mr-2 h-3.5 w-3.5" />
              Report issue
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
          <span className={cn("break-words text-ink text-table-cell", isContainer && "font-medium")}>{name}</span>
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
        {desc.isSubhire && item.supplier && item.showSubhireOnDocs && (
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
          ref={dragHandleRef}
          data-drag-row="true"
          {...(dragAttributes as React.HTMLAttributes<HTMLDivElement> | undefined)}
          {...(dragListeners as React.HTMLAttributes<HTMLDivElement> | undefined)}
          style={dragStyle}
          className={cn(
            "flex min-h-11 touch-manipulation items-start gap-2 rounded-[var(--r)] bg-card transition-colors",
            isContainer ? "px-3 py-2 ring-1 ring-line-2" : "px-3 py-2 ring-1 ring-line",
            isSelected && "ring-2 ring-red",
            justChanged && "collab-changed",
            !isDragDisabled && "active:cursor-grabbing md:cursor-grab",
            isDragging && "opacity-40",
          )}
        >
          {selectable && (
            <span
              onMouseDown={(e) => {
                shiftKeyRef.current = e.shiftKey;
              }}
              onPointerDown={(e) => e.stopPropagation()}
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
            {item.childLineItems!.map((child) => (
              <div key={child.id} className="rounded-[var(--r)] bg-paper-2/40 py-2 pl-6 pr-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-table-cell text-ink-2">{child.model?.name ?? child.description ?? "—"}</span>
                  {/* Kit members / accessories carry their serial on a per-unit row now
                      — same indicator (tag + fulfillment status + history) as every
                      other line. Reassign is suppressed: the mutation rejects kit
                      children (per-kit-slot reassign is Phase 4). */}
                  <LineAssetsIndicator units={child.units} lineAssetTag={child.asset?.assetTag} lineItemId={child.id} modelId={child.modelId} disableReassign={child.childKind === "ACCESSORY"} kitMember={child.childKind !== "ACCESSORY"} />
                  {child.childKind === "ACCESSORY" && (
                    <Badge status="neutral" className="px-1.5 py-0 text-[10px]">Accessory</Badge>
                  )}
                </div>
                {child.notes && (
                  <p className="mt-0.5 truncate text-caption text-muted">{child.notes}</p>
                )}
                <MetricLine item={child} showCostColumn={showCostColumn} />
              </div>
            ))}
          </div>
        )}
        {canReportIssue && (
          <ReportIssueDialog
            open={reportIssueOpen}
            onOpenChange={setReportIssueOpen}
            targetLabel={name}
            projectId={projectId}
            lineItemId={item.id}
          />
        )}
      </div>
    );
  }

  return (
    <>
    <TableRow
      className={cn(
        "group/row",
        isSelected && "bg-select",
        justChanged && "collab-changed",
        !isDragDisabled && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40",
      )}
      style={dragStyle}
      onClick={onClick}
      ref={dragHandleRef}
      data-drag-row="true"
      {...(dragAttributes as React.HTMLAttributes<HTMLTableRowElement> | undefined)}
      {...(dragListeners as React.HTMLAttributes<HTMLTableRowElement> | undefined)}
      {...shortcuts}
    >
      <TableCell className="px-0" />
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
              onPointerDown={(e) => e.stopPropagation()}
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
          {onInlineUpdate && !item.model ? (
            // Only editable when there's no model backing the row — a
            // model-backed line always displays `model.name` regardless of
            // `description` (see the read fallback below), so editing this
            // field inline for one would visibly do nothing on save.
            <InlineEditableText
              value={item.description ?? ""}
              placeholder="—"
              maxLength={500}
              truncate={false}
              ariaLabel="Description"
              className="font-medium"
              onSave={(next) => onInlineUpdate(item, { field: "description", value: next })}
            />
          ) : (
            <span className="font-medium break-words">
              {item.model?.name ?? item.description ?? "—"}
            </span>
          )}
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
          {/* Collaboration badge: review marker */}
          {liveMarker && liveMarker.status !== "resolved" && (
            <ReviewMarkerBadge
              status={liveMarker.status as MarkerStatus}
              reason={liveMarker.reason}
              className="ml-1"
            />
          )}
        </div>
        {desc.isSubhire && item.supplier && item.showSubhireOnDocs && (
          <p className={`text-caption text-muted mt-0.5 ${indent}`}>via {item.supplier.name}</p>
        )}
        {onInlineUpdate ? (
          <InlineEditableText
            value={item.notes ?? ""}
            placeholder="+ Add note"
            maxLength={2000}
            multiline
            ariaLabel="Notes"
            className={cn(
              `text-caption mt-0.5 max-w-[300px] ${indent}`,
              item.notes
                ? "text-muted"
                : "text-faint opacity-0 pointer-coarse:opacity-100 transition-opacity md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100",
            )}
            onSave={(next) => onInlineUpdate(item, { field: "notes", value: next })}
          />
        ) : (
          item.notes && (
            <p className={`text-caption text-muted mt-0.5 truncate max-w-[300px] ${indent}`} title={item.notes}>{item.notes}</p>
          )
        )}
      </TableCell>
      <TableCell className="text-center t-data">
        {onInlineUpdate ? (
          <InlineEditableQuantity
            value={item.quantity}
            onSave={(next, allowOverbook) => onInlineUpdate(item, { field: "quantity", value: next, allowOverbook })}
          />
        ) : (
          item.quantity
        )}
      </TableCell>
      <TableCell className="text-right whitespace-nowrap t-data">
        {onInlineUpdate && isSubHireGroupChild ? (
          // Sub-hire GROUP CHILDREN route through updateSubHireItemNative
          // (equipment-tab.tsx's handleInlineLineItemUpdate), not patchNative
          // — that mutation isn't lock-gated (same as SubHireOrderDialog's
          // item form today), so no <LockedField> here. Discount is a plain
          // 0-100% (no $/% mode — sub-hire items don't have that concept).
          <>
            <div className="flex items-center justify-end gap-1">
              <InlineEditablePrice
                value={item.unitPrice != null ? Number(item.unitPrice) : null}
                onSave={(next) => onInlineUpdate(item, { field: "unitPrice", value: next })}
              />
              {item.priceOverridden && (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-warn shrink-0" title="Manually set price" />
              )}
            </div>
            <div className="flex justify-end">
              <InlineEditablePercent
                value={item.discount != null ? Number(item.discount) : null}
                onSave={(next) => onInlineUpdate(item, { field: "discountPercent", value: next })}
              />
            </div>
          </>
        ) : onInlineUpdate ? (
          <LockedField
            locked={!!moneyLocked}
            reason={lockReason ?? "This project's financials are locked."}
            exitLabel="Manage unlock"
            onExit={onUnlockExit}
          >
            <div className="flex items-center justify-end gap-1">
              <InlineEditablePrice
                value={item.unitPrice != null ? Number(item.unitPrice) : null}
                onSave={(next) => onInlineUpdate(item, { field: "unitPrice", value: next })}
              />
              {item.priceOverridden && (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-warn shrink-0" title="Manually set price" />
              )}
            </div>
            <div className="flex justify-end">
              <InlineEditableDiscount
                discount={item.discount != null ? Number(item.discount) : null}
                discountMode={item.discountMode}
                gross={lineGrossAmount({
                  unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
                  quantity: item.quantity,
                  duration: item.duration,
                })}
                onSave={(amount, mode) => onInlineUpdate(item, { field: "discount", value: amount, discountMode: mode })}
              />
            </div>
          </LockedField>
        ) : (
          <>
            <div className="flex items-center justify-end gap-1">
              {formatCurrency(item.unitPrice != null ? Number(item.unitPrice) : null)}
              {item.priceOverridden && (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-warn shrink-0" title="Manually set price" />
              )}
            </div>
            {item.discount != null && Number(item.discount) > 0 && (
              <p className="text-micro text-ok">-{formatCurrency(Number(item.discount))} disc.</p>
            )}
          </>
        )}
        {/* #990 — `pricedUnderLock` is the server's actual record of a
            `defaultToZero` reset, not an inference from "currently locked +
            currently $0" (which false-positives on a row that's been $0 since
            before any lock ever existed). Kit children are excluded — they're
            not independently priced by design. */}
        {item.pricedUnderLock && !item.isKitChild && (
          <div className="mt-0.5 flex justify-end">
            <UnpricedBadge />
          </div>
        )}
        {(() => {
          // #943 — derived billing weeks/days breakdown for an auto-priced
          // line, e.g. "2 wk @ $150.00 + 3 d @ $30.00" / "charged as 1 wk
          // (capped)". Nothing renders for a manually-priced line (no stored
          // breakdown) or malformed/legacy data (parsePriceBreakdown -> null).
          const breakdown = parsePriceBreakdown(item.priceBreakdown);
          const label = breakdown ? formatPriceBreakdown(breakdown) : "";
          return label ? <p className="text-micro text-faint">{label}</p> : null;
        })()}
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
                {canReportIssue && (
                  <DropdownMenuItem
                    onClick={() => setReportIssueOpen(true)}
                    className="text-warn data-[highlighted]:bg-warn-soft data-[highlighted]:text-warn"
                  >
                    <AlertTriangle className="mr-2 h-3.5 w-3.5" />
                    Report issue
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
              {/* Kit members / accessories now carry their serial on a per-unit
                  row — same indicator (tag + fulfillment status + history) as every
                  other line. Reassign is suppressed: the mutation rejects kit
                  children (per-kit-slot reassign is Phase 4). */}
              <LineAssetsIndicator units={child.units} lineAssetTag={child.asset?.assetTag} lineItemId={child.id} modelId={child.modelId} disableReassign={child.childKind === "ACCESSORY"} kitMember={child.childKind !== "ACCESSORY"} />
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
    {canReportIssue && (
      <ReportIssueDialog
        open={reportIssueOpen}
        onOpenChange={setReportIssueOpen}
        targetLabel={name}
        projectId={projectId}
        lineItemId={item.id}
      />
    )}
    </>
  );
}
