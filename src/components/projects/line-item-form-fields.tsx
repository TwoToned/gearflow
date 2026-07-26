"use client";

/**
 * Shared building blocks for the project line-item add/edit forms
 * (equipment/kit/custom-item/sub-hire add, plus their edit-side
 * counterparts). Extracted per issue #883 — `SectionTitle`/`Field` were
 * byte-identical copy-paste across four add forms, and the `$`/`%`
 * discount toggle had three independently hand-rolled implementations
 * (equipment-add-form, edit-line-item-dialog, bulk-edit-line-items-dialog)
 * that had quietly drifted in exact classes. One shared version each.
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, focusRing } from "@/lib/utils";

export type DiscountMode = "$" | "%";

/**
 * Resolves a raw discount input to the flat dollar amount the schema/mutation
 * expects — discount is always persisted as a flat $ amount (never a
 * percentage), so every caller needs this same conversion before submit.
 * `%` mode multiplies against `grossAmount` (the pre-discount line/bundle
 * total); `$` mode passes the value through unchanged. Returns `undefined`
 * for blank/zero/invalid input — "nothing to discount".
 */
export function resolveDiscountAmount(
  mode: DiscountMode,
  rawValue: number | string | null | undefined,
  grossAmount: number,
): number | undefined {
  // Blank/unset is distinct from an explicit 0 — a blank field means "no
  // discount" (or, for callers with an omit-to-preserve mutation like
  // updateGroupPriceNative, "don't touch the existing discount"), while a
  // deliberately typed 0 clears/zeroes a previously-set discount. Checking
  // the raw value BEFORE Number() coercion is what keeps that distinction —
  // `Number(0)` is falsy too, so a truthiness check alone would collapse them.
  if (rawValue === "" || rawValue == null) return undefined;
  const raw = Number(rawValue);
  if (!Number.isFinite(raw) || raw < 0) return undefined;
  return mode === "%" ? Math.round(grossAmount * raw) / 100 : raw;
}

export function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h3 className="text-card-title font-bold text-ink">{title}</h3>
      {hint && <p className="mt-0.5 t-micro text-muted">{hint}</p>}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-red"> *</span>}
      </Label>
      {children}
    </div>
  );
}

export interface DiscountAmountInputProps {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  mode: DiscountMode;
  onModeChange: (mode: DiscountMode) => void;
  disabled?: boolean;
}

/**
 * Discount amount input + $/% mode toggle, with no Field/Label wrapper — for
 * callers that supply their own label (e.g. bulk-edit-line-items-dialog's
 * checkbox-gated field rows). Most callers want `DiscountField` below instead.
 * The mode is a pure client-side display convenience — callers are responsible
 * for resolving a `%` value to a dollar amount before it reaches the
 * schema/mutation (discount is always persisted as a flat dollar amount; see
 * `src/lib/validations/line-item.ts`).
 */
export function DiscountAmountInput({
  id,
  value,
  onValueChange,
  mode,
  onModeChange,
  disabled,
}: DiscountAmountInputProps) {
  return (
    <div className="flex gap-1.5">
      <Input
        id={id}
        type="number"
        step="0.01"
        min={0}
        placeholder="0"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        disabled={disabled}
        className="flex-1"
      />
      <button
        type="button"
        onClick={() => onModeChange(mode === "$" ? "%" : "$")}
        disabled={disabled}
        title={mode === "$" ? "Switch to percentage" : "Switch to dollars"}
        className={cn(
          "h-11 w-11 shrink-0 rounded-[var(--radius)] border-2 border-input bg-card text-ui-text font-medium text-ink transition-colors hover:bg-paper-2 disabled:cursor-not-allowed disabled:opacity-45",
          focusRing,
        )}
      >
        {mode}
      </button>
    </div>
  );
}

export interface DiscountFieldProps extends DiscountAmountInputProps {
  label?: string;
  hint?: string;
}

/** `DiscountAmountInput` wrapped in `Field` (its own label). */
export function DiscountField({ label = "Discount", hint, ...inputProps }: DiscountFieldProps) {
  return (
    <Field label={label} htmlFor={inputProps.id}>
      <DiscountAmountInput {...inputProps} />
      {hint && <p className="t-micro text-muted">{hint}</p>}
    </Field>
  );
}
