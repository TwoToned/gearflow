"use client";

/**
 * Inline (click-to-edit, save-on-blur/Tab) cell editors for the equipment
 * table — description, notes, unit price, discount. An alternative entry
 * point to the same `patchNative` write the full `EditLineItemDialog` uses
 * (`equipment-tab.tsx`'s `handleInlineLineItemUpdate` builds the payload via
 * `computeEditLineItemPayload`, the same shared helper the dialog calls) —
 * no separate mutation path, no separate validation (POLICY.md R-3.1).
 *
 * Each cell owns its own editing/draft/saving state. There's no cross-cell
 * "editing row" coordination — clicking a different cell just starts a
 * second independent edit, matching a spreadsheet's per-cell model.
 */

import { useEffect, useRef, useState } from "react";
import { ConvexError } from "convex/values";
import { formatCurrency } from "@/lib/formatters";
import {
  type DiscountMode,
  discountEntryValue,
  resolveDiscountAmount,
  toDiscountMode,
} from "@/lib/discount-mode";
import { cn, focusRing } from "@/lib/utils";

/** Shared numeric-input keydown: Enter commits (blurs), Escape cancels without saving. */
function handleEditKeyDown(
  e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  onCancel: () => void,
  commitOnEnter: boolean,
) {
  if (e.key === "Enter" && commitOnEnter) {
    e.preventDefault();
    (e.target as HTMLElement).blur();
  } else if (e.key === "Escape") {
    e.preventDefault();
    onCancel();
  }
}

export interface InlineEditableTextProps {
  value: string;
  placeholder?: string;
  maxLength?: number;
  multiline?: boolean;
  className?: string;
  disabled?: boolean;
  /** Truncate the static display to one line with an ellipsis (default true —
   *  matches the notes preview). Pass `false` for a field like description
   *  that should wrap within its flex container instead. */
  truncate?: boolean;
  ariaLabel: string;
  onSave: (next: string) => Promise<unknown>;
}

/** Click-to-edit text (description) or textarea (notes). Save fires on blur
 *  (which fires on Tab-out too, so no separate Tab handling is needed) or
 *  Enter (single-line only — Enter inserts a newline in the textarea).
 *  Escape reverts the draft and exits without saving. A no-op edit (draft ===
 *  current value after trimming) never calls `onSave`. */
export function InlineEditableText({
  value,
  placeholder,
  maxLength,
  multiline,
  className,
  disabled,
  truncate = true,
  ariaLabel,
  onSave,
}: InlineEditableTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) return;
    ref.current?.focus();
    ref.current?.select();
  }, [editing]);

  function startEditing() {
    setDraft(value);
    setEditing(true);
  }

  async function commit() {
    setEditing(false);
    const next = draft.trim();
    if (next === (value ?? "").trim()) return;
    setSaving(true);
    try {
      await onSave(next);
    } catch {
      // The caller's mutation already surfaces a toast on failure; the row
      // stays reactive, so it just reverts to the server value on its own.
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    const shared = {
      value: draft,
      maxLength,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
      onBlur: commit,
      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        handleEditKeyDown(e, () => setEditing(false), !multiline),
      className: cn(
        "w-full min-w-0 rounded-sm border border-line bg-paper px-1.5 py-0.5 text-body outline-none",
        focusRing,
        className,
      ),
      "aria-label": ariaLabel,
    };
    return multiline ? (
      <textarea ref={ref as React.Ref<HTMLTextAreaElement>} rows={2} {...shared} />
    ) : (
      <input ref={ref as React.Ref<HTMLInputElement>} type="text" {...shared} />
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        startEditing();
      }}
      className={cn(
        "block max-w-full rounded-sm px-1 -mx-1 text-left",
        truncate ? "truncate" : "break-words",
        !disabled && "cursor-text hover:bg-elev",
        saving && "opacity-60",
        focusRing,
        className,
      )}
      title={value || placeholder}
    >
      {value || <span className="text-faint">{placeholder}</span>}
    </button>
  );
}

export interface InlineEditablePriceProps {
  value: number | null;
  disabled?: boolean;
  className?: string;
  onSave: (next: number | undefined) => Promise<unknown>;
}

/** Click-to-edit unit price. Displays via `formatCurrency`; the input is a
 *  bare number (no currency symbol) while editing. */
export function InlineEditablePrice({ value, disabled, className, onSave }: InlineEditablePriceProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value != null ? String(value) : "");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    ref.current?.focus();
    ref.current?.select();
  }, [editing]);

  function startEditing() {
    setDraft(value != null ? String(value) : "");
    setEditing(true);
  }

  async function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== "" && Number.isNaN(Number(trimmed))) return; // garbage input — revert silently
    const next = trimmed === "" ? undefined : Number(trimmed);
    if ((next ?? null) === value) return;
    setSaving(true);
    try {
      await onSave(next);
    } catch {
      // Caller's mutation surfaces the error toast.
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <input
        ref={ref}
        type="number"
        step="0.01"
        min={0}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={commit}
        onKeyDown={(e) => handleEditKeyDown(e, () => setEditing(false), true)}
        className={cn(
          "w-24 rounded-sm border border-line bg-paper px-1.5 py-0.5 text-right t-data outline-none",
          focusRing,
          className,
        )}
        aria-label="Unit price"
      />
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        startEditing();
      }}
      className={cn(
        "rounded-sm px-1 -mx-1 tabular-nums",
        !disabled && "cursor-text hover:bg-elev",
        saving && "opacity-60",
        focusRing,
        className,
      )}
    >
      {formatCurrency(value)}
    </button>
  );
}

export interface InlineEditablePercentProps {
  /** 0-100, or null/undefined for "no discount". */
  value: number | null | undefined;
  disabled?: boolean;
  className?: string;
  onSave: (next: number) => Promise<unknown>;
}

/** Click-to-edit plain percentage (0-100, no `$`/`%` mode toggle) — sub-hire
 *  items store discount this way, unlike regular line items' resolved-dollar
 *  + entry-mode pair (see `InlineEditableDiscount`). Empty/zero renders the
 *  same hover-revealed "+ Discount" affordance as the regular cell. */
export function InlineEditablePercent({ value, disabled, className, onSave }: InlineEditablePercentProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ? String(value) : "");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    ref.current?.focus();
    ref.current?.select();
  }, [editing]);

  function startEditing() {
    setDraft(value ? String(value) : "");
    setEditing(true);
  }

  async function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    const parsed = trimmed === "" ? 0 : Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) return; // garbage input — revert silently
    const next = Math.min(parsed, 100);
    if (next === (value ?? 0)) return;
    setSaving(true);
    try {
      await onSave(next);
    } catch {
      // Caller's mutation surfaces the error toast.
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <input
        ref={ref}
        type="number"
        step="0.01"
        min={0}
        max={100}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={commit}
        onKeyDown={(e) => handleEditKeyDown(e, () => setEditing(false), true)}
        className={cn(
          "w-16 rounded-sm border border-line bg-paper px-1.5 py-0.5 text-right t-data outline-none",
          focusRing,
          className,
        )}
        aria-label="Discount %"
      />
    );
  }

  if (!value || value <= 0) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          startEditing();
        }}
        className={cn(
          "rounded-sm px-1 -mx-1 text-micro text-faint opacity-0 pointer-coarse:opacity-100 transition-opacity md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100",
          !disabled && "cursor-text hover:bg-elev hover:text-muted",
          focusRing,
          className,
        )}
      >
        + Discount
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        startEditing();
      }}
      className={cn(
        "rounded-sm px-1 -mx-1 text-micro text-ok",
        !disabled && "cursor-text hover:bg-elev",
        saving && "opacity-60",
        focusRing,
        className,
      )}
    >
      -{value}% disc.
    </button>
  );
}

export interface InlineEditableDiscountProps {
  discount: number | null;
  discountMode: string | null | undefined;
  /** Pre-discount line total (`lineGrossAmount(item)`) — what a `%` entry resolves against. */
  gross: number;
  disabled?: boolean;
  className?: string;
  onSave: (amount: number | undefined, mode: DiscountMode) => Promise<unknown>;
}

/** Click-to-edit discount: a numeric input plus a `$`/`%` mode toggle. When
 *  there's no discount yet, renders a subtle "+ Discount" affordance that
 *  only shows on row hover (mirrors the row's other hover-revealed actions)
 *  so empty lines don't get visually noisy. */
export function InlineEditableDiscount({
  discount,
  discountMode,
  gross,
  disabled,
  className,
  onSave,
}: InlineEditableDiscountProps) {
  const storedMode = toDiscountMode(discountMode);
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<DiscountMode>(storedMode);
  const [draft, setDraft] = useState(() => discountEntryValue(discount, storedMode, gross));
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    ref.current?.focus();
    ref.current?.select();
  }, [editing]);

  function startEditing() {
    setMode(storedMode);
    setDraft(discountEntryValue(discount, storedMode, gross));
    setEditing(true);
  }

  async function commit() {
    setEditing(false);
    const resolved = resolveDiscountAmount(mode, draft, gross);
    if ((resolved ?? null) === (discount ?? null) && mode === storedMode) return;
    setSaving(true);
    try {
      await onSave(resolved, mode);
    } catch {
      // Caller's mutation surfaces the error toast.
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div
        className="flex items-center justify-end gap-1"
        onClick={(e) => e.stopPropagation()}
        onBlur={(e) => {
          // Losing focus to the mode toggle (still inside this group) isn't a
          // commit — only commit once focus leaves the whole editor.
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          void commit();
        }}
      >
        <input
          ref={ref}
          type="number"
          step="0.01"
          min={0}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => handleEditKeyDown(e, () => setEditing(false), true)}
          className={cn(
            "w-16 rounded-sm border border-line bg-paper px-1.5 py-0.5 text-right t-data outline-none",
            focusRing,
          )}
          aria-label="Discount"
        />
        <button
          type="button"
          onClick={() => setMode((m) => (m === "%" ? "$" : "%"))}
          className={cn("rounded-sm border border-line px-1 text-micro text-muted hover:bg-elev", focusRing)}
          aria-label="Discount mode"
        >
          {mode}
        </button>
      </div>
    );
  }

  if (discount == null || Number(discount) <= 0) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          startEditing();
        }}
        className={cn(
          "rounded-sm px-1 -mx-1 text-micro text-faint opacity-0 pointer-coarse:opacity-100 transition-opacity md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100",
          !disabled && "cursor-text hover:bg-elev hover:text-muted",
          focusRing,
          className,
        )}
      >
        + Discount
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        startEditing();
      }}
      className={cn(
        "rounded-sm px-1 -mx-1 text-micro text-ok",
        !disabled && "cursor-text hover:bg-elev",
        saving && "opacity-60",
        focusRing,
        className,
      )}
    >
      -{formatCurrency(Number(discount))} disc.
    </button>
  );
}

/** Reads a `ConvexError`'s structured `data.code`, the pattern
 *  `use-justified-mutation.ts` already uses for `JUSTIFICATION_REQUIRED`. */
function convexErrorCode(e: unknown): string | undefined {
  if (!(e instanceof ConvexError) || typeof e.data !== "object" || e.data === null) return undefined;
  const code = (e.data as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function convexErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof ConvexError && typeof e.data === "object" && e.data !== null) {
    const message = (e.data as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return e instanceof Error ? e.message : fallback;
}

export interface InlineEditableQuantityProps {
  value: number;
  disabled?: boolean;
  className?: string;
  /** Resolves on success. On a rejected quantity increase, `patchNative`
   *  throws a `ConvexError` with `data.code === "INSUFFICIENT_STOCK"` — this
   *  component catches exactly that code to show a confirm-overbook step
   *  (mirroring `EditLineItemDialog`'s pre-fetched-availability checkbox,
   *  just reactive instead of proactive: no per-row availability query, the
   *  server's own re-check is the single source of truth). Call again with
   *  `allowOverbook: true` to confirm. Any OTHER rejection is assumed
   *  already toasted by the caller's mutation — this component just reverts
   *  silently. */
  onSave: (next: number, allowOverbook: boolean) => Promise<unknown>;
}

/** Click-to-edit quantity, with an inline overbook-confirm step in place of
 *  `EditLineItemDialog`'s checkbox. Not lock-gated — quantity is a
 *  *structural* field (`LOCKED_LINE_ITEM_FIELDS` doesn't include it), not a
 *  financial one, so it's ungated the same way description/notes are. */
export function InlineEditableQuantity({ value, disabled, className, onSave }: InlineEditableQuantityProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const [overbook, setOverbook] = useState<{ next: number; message: string } | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    ref.current?.focus();
    ref.current?.select();
  }, [editing]);

  function startEditing() {
    setDraft(String(value));
    setOverbook(null);
    setEditing(true);
  }

  async function attemptSave(next: number, allowOverbook: boolean) {
    setSaving(true);
    try {
      await onSave(next, allowOverbook);
      setOverbook(null);
    } catch (e) {
      if (convexErrorCode(e) === "INSUFFICIENT_STOCK") {
        setOverbook({ next, message: convexErrorMessage(e, "Not enough stock available for that quantity.") });
      }
      // Any other error: the caller's mutation already surfaced a toast —
      // just fall through and revert to the display value.
    } finally {
      setSaving(false);
    }
  }

  async function commit() {
    setEditing(false);
    const parsed = Math.round(Number(draft.trim()));
    if (!Number.isFinite(parsed) || parsed < 1 || parsed === value) return; // garbage/no-op — revert silently
    await attemptSave(parsed, false);
  }

  if (overbook) {
    return (
      <div
        className="flex flex-col items-end gap-1"
        onBlur={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setOverbook(null);
        }}
      >
        <span className="max-w-[140px] text-right text-micro text-t-out">{overbook.message}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setOverbook(null)}
            className={cn("rounded-sm border border-line px-1.5 py-0.5 text-micro text-muted hover:bg-elev", focusRing)}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => attemptSave(overbook.next, true)}
            className={cn("rounded-sm border border-out bg-out-soft px-1.5 py-0.5 text-micro text-t-out hover:bg-out-soft/80", focusRing)}
          >
            Overbook anyway
          </button>
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <input
        ref={ref}
        type="number"
        min={1}
        step={1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={commit}
        onKeyDown={(e) => handleEditKeyDown(e, () => setEditing(false), true)}
        className={cn(
          "w-14 rounded-sm border border-line bg-paper px-1.5 py-0.5 text-center t-data outline-none",
          focusRing,
          className,
        )}
        aria-label="Quantity"
      />
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        startEditing();
      }}
      className={cn(
        "rounded-sm px-1 -mx-1 tabular-nums",
        !disabled && "cursor-text hover:bg-elev",
        saving && "opacity-60",
        focusRing,
        className,
      )}
    >
      {value}
    </button>
  );
}
