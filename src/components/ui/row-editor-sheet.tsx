"use client";

import * as React from "react";
import { ChevronRight, Minus, Plus } from "lucide-react";
import { ActionMenu } from "@/components/ui/action-menu";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { useFormatters } from "@/components/providers/format-provider";
import {
  discountEntryValue,
  lineGrossAmount,
  resolveDiscountAmount,
  discountPercentOf,
  type DiscountMode,
} from "@/lib/discount-mode";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import { rowEditorSchema } from "@/lib/validations/line-item";
import { cn } from "@/lib/utils";
import { computeLineTotal } from "../../../convex/lib/lineTotal";

/**
 * `RowEditorSheet` (spec §5.8, §9l.3): the phone's answer to inline editing.
 * A full-row tap opens this sheet: qty stepper, price, discount `$ / %`, the
 * DERIVED total, an availability notice with a sub-hire shortcut, drill-ins
 * (accessories, serials, notes) and the rest of the row's menu.
 *
 * It owns no persistence: Save calls ONE `onSave(patch)` (Phase 2a wires it to
 * `patchNative`, the same mutation the desktop inline cells call, which
 * toasts). The server is the authority on every price (R-9.3): the total shown
 * is the same pure `computeLineTotal` the server uses, as a preview only.
 *
 * Money rules held here: `discount` is sent as the resolved flat dollar amount
 * with `discountMode` beside it, the percentage is never stored; a blank price
 * or discount is `null` in the patch (cleared), never `0`.
 */
export interface RowEditorInitial {
  quantity: number;
  unitPrice?: number | null;
  /** The stored flat dollar amount. */
  discount?: number | null;
  discountMode?: DiscountMode | null;
  /** Days/periods the price multiplies by (default 1). */
  duration?: number;
}

/** Only the fields that changed. `null` = cleared (blank), never `0`. */
interface RowEditorPatch {
  quantity?: number;
  unitPrice?: number | null;
  discount?: number | null;
  discountMode?: DiscountMode;
}

interface RowEditorDrillIn {
  key: string;
  label: string;
  /** Muted trailing summary, e.g. `3 accessories`. */
  detail?: string;
  onOpen: () => void;
}

export interface RowEditorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  initial: RowEditorInitial;
  onSave: (patch: RowEditorPatch) => void | Promise<void>;
  /** Hide the price + discount block (a line with no price to edit). */
  priceEditable?: boolean;
  availability?: {
    message: string;
    tone: "warning" | "error";
    /** The sub-hire shortcut. */
    action?: { label: string; onSelect: () => void };
  };
  drillIns?: RowEditorDrillIn[];
  /** The rest of the row's menu. */
  menu?: ActionMenuSpec;
}

/** Re-expresses a typed discount in the other mode, via the stored dollar amount. */
export function convertDiscountEntry(
  raw: string,
  from: DiscountMode,
  to: DiscountMode,
  gross: number,
): string {
  const amount = resolveDiscountAmount(from, raw, gross);
  if (amount == null) return "";
  if (to === "$") return String(amount);
  const pct = discountPercentOf(amount, gross);
  return pct == null ? "" : String(pct);
}

interface Draft {
  quantity: string;
  unitPrice: string;
  discount: string;
  mode: DiscountMode;
}

function toDraft(i: RowEditorInitial): Draft {
  const mode = i.discountMode === "%" ? "%" : "$";
  const gross = lineGrossAmount({ unitPrice: i.unitPrice, quantity: i.quantity, duration: i.duration });
  return {
    quantity: String(i.quantity),
    unitPrice: i.unitPrice == null ? "" : String(i.unitPrice),
    discount: discountEntryValue(i.discount, mode, gross),
    mode,
  };
}

/** Parses a draft; `ok:false` when the schema rejects it (e.g. qty 0). */
function parseDraft(d: Draft) {
  return rowEditorSchema.safeParse({
    quantity: d.quantity,
    unitPrice: d.unitPrice,
    discount: d.discount,
    discountMode: d.mode,
  });
}

/** The resolved flat dollar discount for a parsed draft (`undefined` = none). */
function resolvedDiscount(d: Draft, qty: number, price: number | undefined, duration: number) {
  const gross = lineGrossAmount({ unitPrice: price, quantity: qty, duration });
  return resolveDiscountAmount(d.mode, d.discount, gross);
}

function discountPatch(initial: RowEditorInitial, d: Draft, qty: number, price: number | undefined): RowEditorPatch {
  const discount = resolvedDiscount(d, qty, price, initial.duration ?? 1) ?? null;
  const modeChanged = d.mode !== (initial.discountMode === "%" ? "%" : "$");
  const changed = discount !== (initial.discount ?? null) || (modeChanged && discount != null);
  return changed ? { discount, discountMode: discount == null ? "$" : d.mode } : {};
}

/** The patch between the initial row and a valid draft: changed fields only. */
function buildRowPatch(
  initial: RowEditorInitial,
  d: Draft,
  parsed: { quantity: number; unitPrice?: number },
): RowEditorPatch {
  const price = parsed.unitPrice ?? null;
  return {
    ...(parsed.quantity !== initial.quantity ? { quantity: parsed.quantity } : {}),
    ...(price !== (initial.unitPrice ?? null) ? { unitPrice: price } : {}),
    ...discountPatch(initial, d, parsed.quantity, parsed.unitPrice),
  };
}

function Stepper({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const n = Number(value);
  const bump = (by: number) => onChange(String(Math.max(1, (Number.isFinite(n) ? n : 1) + by)));
  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="line" size="icon" aria-label="Decrease quantity" onClick={() => bump(-1)}>
        <Minus aria-hidden="true" />
      </Button>
      <input
        aria-label="Quantity"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-16 rounded-[var(--r)] border-2 border-line-2 bg-paper text-center text-reading-body tabular-nums text-ink"
      />
      <Button type="button" variant="line" size="icon" aria-label="Increase quantity" onClick={() => bump(1)}>
        <Plus aria-hidden="true" />
      </Button>
    </div>
  );
}

function ModeSwitch({ mode, onChange }: { mode: DiscountMode; onChange: (m: DiscountMode) => void }) {
  return (
    <div role="radiogroup" aria-label="Discount type" className="flex shrink-0 overflow-hidden rounded-[var(--r)] border-2 border-line-2">
      {(["$", "%"] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          aria-label={m === "$" ? "Dollars" : "Percent"}
          onClick={() => onChange(m)}
          className={cn("size-11 text-reading-body font-semibold", mode === m ? "bg-ink text-paper" : "text-muted")}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

const fieldInput =
  "h-11 w-full rounded-[var(--r)] border-2 border-line-2 bg-paper px-3 text-reading-body tabular-nums text-ink placeholder:text-muted";

function useRowDraft(open: boolean, initial: RowEditorInitial) {
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(initial));
  // Re-seed whenever the sheet opens on a (possibly different) row.
  React.useEffect(() => {
    if (open) setDraft(toDraft(initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed on open only
  }, [open]);

  const parsed = parseDraft(draft);
  const duration = initial.duration ?? 1;
  const data = parsed.success ? parsed.data : null;
  const total = data
    ? computeLineTotal(data.unitPrice, data.quantity, duration, resolvedDiscount(draft, data.quantity, data.unitPrice, duration))
    : null;
  const patch = data ? buildRowPatch(initial, draft, data) : null;
  const set = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const switchMode = (to: DiscountMode) => {
    if (to === draft.mode) return;
    const gross = lineGrossAmount({
      unitPrice: data ? data.unitPrice : initial.unitPrice,
      quantity: data ? data.quantity : initial.quantity,
      duration,
    });
    set({ mode: to, discount: convertDiscountEntry(draft.discount, draft.mode, to, gross) });
  };
  return { draft, set, switchMode, total, patch };
}

function AvailabilityNotice({ a }: { a: NonNullable<RowEditorSheetProps["availability"]> }) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-[var(--r)] px-3 py-2 text-table-cell",
        a.tone === "error" ? "bg-out-soft text-t-out" : "bg-paper-2 text-warn",
      )}
    >
      <span className="flex-1">{a.message}</span>
      {a.action ? (
        <Button type="button" size="sm" variant="line" onClick={a.action.onSelect}>
          {a.action.label}
        </Button>
      ) : null}
    </div>
  );
}

function DrillIns({ items }: { items: RowEditorDrillIn[] }) {
  return (
    <ul className="-mx-4 border-t border-line">
      {items.map((d) => (
        <li key={d.key}>
          <button
            type="button"
            onClick={d.onOpen}
            className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-card-title active:bg-paper-2"
          >
            <span className="flex-1">{d.label}</span>
            {d.detail ? <span className="text-table-cell text-muted">{d.detail}</span> : null}
            <ChevronRight className="size-4 text-muted" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function RowEditorSheet({
  open,
  onOpenChange,
  title,
  subtitle,
  initial,
  onSave,
  priceEditable = true,
  availability,
  drillIns,
  menu,
}: RowEditorSheetProps) {
  const { formatCurrency } = useFormatters();
  const { draft, set, switchMode, total, patch } = useRowDraft(open, initial);
  const [saving, setSaving] = React.useState(false);
  const canSave = !!patch && Object.keys(patch).length > 0 && !saving;

  const save = async () => {
    if (!patch) return;
    setSaving(true);
    try {
      await onSave(patch);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title={title} description={subtitle}>
      <div className="flex flex-col gap-4 px-4 pb-2 pt-2">
        {menu ? (
          <div className="flex justify-end">
            <ActionMenu spec={menu} label="More actions" />
          </div>
        ) : null}

        {availability ? <AvailabilityNotice a={availability} /> : null}

        <div className="flex items-center justify-between gap-3 text-ui-text font-medium text-ink">
          <span aria-hidden="true">Quantity</span>
          <Stepper value={draft.quantity} onChange={(quantity) => set({ quantity })} />
        </div>

        {priceEditable ? (
          <>
            <label className="flex flex-col gap-1 text-table-cell text-muted">
              Price
              <input
                aria-label="Price"
                inputMode="decimal"
                placeholder="Blank = unpriced"
                value={draft.unitPrice}
                onChange={(e) => set({ unitPrice: e.target.value })}
                className={fieldInput}
              />
            </label>
            <div className="flex items-end gap-2">
              <label className="flex flex-1 flex-col gap-1 text-table-cell text-muted">
                Discount
                <input
                  aria-label="Discount"
                  inputMode="decimal"
                  placeholder="None"
                  value={draft.discount}
                  onChange={(e) => set({ discount: e.target.value })}
                  className={fieldInput}
                />
              </label>
              <ModeSwitch mode={draft.mode} onChange={switchMode} />
            </div>
          </>
        ) : null}

        <div className="flex items-baseline justify-between border-t border-line pt-3">
          <span className="text-table-cell text-muted">Total</span>
          <output aria-label="Total" className="text-section-header font-semibold tabular-nums text-ink">
            {formatCurrency(total)}
          </output>
        </div>

        {drillIns?.length ? <DrillIns items={drillIns} /> : null}

        <div className="flex gap-2">
          <Button type="button" variant="line" className="flex-1" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" className="flex-1" disabled={!canSave} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
