"use client";

import * as React from "react";
import { ChevronRight, Container, Handshake, Plus } from "lucide-react";
import { cn, focusRing } from "@/lib/utils";
import { formatCurrency } from "@/lib/formatters";
import { type LineItemData } from "./equipment-row-types";

/**
 * Presentational card primitives for the project equipment tab on mobile. Mirrors
 * the warehouse scan-card pattern (`scan-card.tsx`) so the two features read as one
 * family: `bg-card` ring for top-level surfaces, `bg-paper-2` tints for group headers.
 *
 * These are pure layout helpers with no data or subscription logic. The line-item
 * card itself is NOT here — it lives inside `LineItemRow` (equipment-rows.tsx) so it
 * can reuse that row's live collaboration / comment / assets subscriptions. This file
 * only holds the shared bits: the qty/price metric line, the group header card, and
 * the category heading + add affordance.
 */

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A compact `Qty N · $unit · $total` metric line + optional discount. */
export function MetricLine({ item, showCostColumn }: { item: LineItemData; showCostColumn?: boolean }) {
  const unit = num(item.unitPrice);
  const total = num(item.lineTotal);
  const discount = num(item.discount);
  const cost = num((item as { supplierUnitCost?: unknown }).supplierUnitCost);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
      <span className="text-caption text-muted tabular-nums">
        Qty <span className="text-ink-2">{item.quantity}</span>
      </span>
      {unit != null && (
        <span className="t-mono text-caption text-muted">
          {formatCurrency(unit)}
          {item.priceOverridden && (
            <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-warn align-middle" title="Manually set price" />
          )}
        </span>
      )}
      {showCostColumn && cost != null && (
        <span className="t-mono text-caption text-faint">cost {formatCurrency(cost)}</span>
      )}
      {total != null && (
        <span className="t-mono text-caption font-medium text-ink">{formatCurrency(total)}</span>
      )}
      {discount != null && discount > 0 && (
        <span className="text-micro text-ok">-{formatCurrency(discount)} disc.</span>
      )}
    </div>
  );
}

/** Header card for a project group or sub-hire group — expands to its children below. */
export function GroupCard({
  title,
  subtext,
  qty,
  total,
  isSubHire,
  isExpanded,
  onToggle,
  children,
  actions,
  dragHandleRef,
  dragAttributes,
  dragListeners,
  dragStyle,
  isDragging,
}: {
  title: string;
  subtext?: React.ReactNode;
  qty?: number;
  total?: number | null;
  isSubHire?: boolean;
  isExpanded?: boolean;
  onToggle?: () => void;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  /** Real @dnd-kit drag entry point for the whole card — pressing/holding
   *  anywhere on the card body (not a dedicated handle) starts the drag; see
   *  equipment-rows.tsx's `DragHandleControls` doc comment. Spread onto this
   *  root div rather than the inner toggle button so dragging isn't scoped
   *  to just the title/chevron area. */
  dragHandleRef?: (el: HTMLElement | null) => void;
  dragAttributes?: Record<string, unknown>;
  dragListeners?: Record<string, unknown>;
  /** `useSortable()`'s `transform`/`transition` as an inline style, and
   *  whether this is the ONE card currently being dragged — same contract as
   *  equipment-rows.tsx's `DragHandleControls`. */
  dragStyle?: React.CSSProperties;
  isDragging?: boolean;
}) {
  return (
    <>
      <div
        ref={dragHandleRef}
        data-drag-row="true"
        {...(dragAttributes as React.HTMLAttributes<HTMLDivElement> | undefined)}
        {...(dragListeners as React.HTMLAttributes<HTMLDivElement> | undefined)}
        style={dragStyle}
        className={cn(
          "flex min-h-11 touch-manipulation items-center gap-2 rounded-[var(--r)] bg-card px-3 py-2 ring-1 ring-line-2 active:cursor-grabbing md:cursor-grab",
          isDragging && "opacity-40",
        )}
      >
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={onToggle}
          className={cn("flex min-h-11 min-w-0 flex-1 items-center gap-1.5 text-left", focusRing)}
        >
          <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted transition-transform", isExpanded && "rotate-90")} />
          {isSubHire ? (
            <Handshake className="h-4 w-4 shrink-0 text-muted" />
          ) : (
            <Container className="h-4 w-4 shrink-0 text-muted" />
          )}
          <span className="min-w-0 flex-1">
            <span className="text-table-cell font-medium text-ink">{title}</span>
            {subtext && <span className="block text-caption text-muted">{subtext}</span>}
          </span>
          <span className="shrink-0 text-caption text-muted tabular-nums">
            {qty != null && <span>Qty {qty}</span>}
            {total != null && <span className="ml-2 t-mono text-ink-2">{formatCurrency(total)}</span>}
          </span>
        </button>
        {actions}
      </div>
      {isExpanded && children && <div className="space-y-1.5 pl-3">{children}</div>}
    </>
  );
}

/** Section heading for a category (folder glyph + label + optional add/kebab). */
export function CategoryCardHeading({
  name,
  action,
  dragHandleRef,
  dragAttributes,
  dragListeners,
  dragStyle,
  isDragging,
}: {
  name: string;
  action?: React.ReactNode;
  /** Same whole-surface drag entry point as `GroupCard` — see its doc comment. */
  dragHandleRef?: (el: HTMLElement | null) => void;
  dragAttributes?: Record<string, unknown>;
  dragListeners?: Record<string, unknown>;
  dragStyle?: React.CSSProperties;
  isDragging?: boolean;
}) {
  return (
    <div
      ref={dragHandleRef}
      data-drag-row="true"
      {...(dragAttributes as React.HTMLAttributes<HTMLDivElement> | undefined)}
      {...(dragListeners as React.HTMLAttributes<HTMLDivElement> | undefined)}
      style={dragStyle}
      className={cn(
        "flex touch-manipulation items-center justify-between gap-2 rounded-[var(--r)] px-1 pb-0.5 pt-3 active:cursor-grabbing md:cursor-grab",
        isDragging && "opacity-40",
      )}
    >
      <div className="flex items-center gap-1.5 text-caption font-semibold text-ink-2">
        <Container className="h-3.5 w-3.5" />
        {name}
      </div>
      {action}
    </div>
  );
}

/** A small "＋ Add" affordance used in the mobile category heading. */
export function CardAddButton({ onClick, label = "Add" }: { onClick?: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex min-h-8 items-center gap-1 rounded-[10px] border border-line bg-paper-2 px-2.5 text-caption font-medium text-ink-2 hover:text-ink",
        focusRing,
      )}
    >
      <Plus className="h-3.5 w-3.5" /> {label}
    </button>
  );
}
