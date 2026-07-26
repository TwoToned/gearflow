"use client";

/**
 * Shared primitives for the project line-item add/edit forms (equipment,
 * kit, custom-item, sub-hire adds; line-item/group/bulk edits).
 *
 * Extracted per GitHub issue #883 — `equipment-add-form.tsx` is the
 * reference pattern the rest of the add/edit forms converge on. Before this,
 * `SectionTitle`/`Field` were hand-duplicated in equipment-add-form.tsx,
 * kit-add-form.tsx, and custom-item-add-form.tsx, and the `$`/`%`
 * discount-toggle input (plus its percentage->dollar resolution math) was
 * independently reimplemented in equipment-add-form.tsx and
 * edit-line-item-dialog.tsx (bulk-edit-line-items-dialog.tsx resolves `%`
 * server-side per item, so it only shares the toggle UI, not the math). A
 * second hand-maintained copy of the same bounds/markup is a defect even
 * while it stays in sync (POLICY.md R-3.1/R-8.2.4).
 */

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn, focusRing } from "@/lib/utils";

export function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h3 className="text-card-title font-bold text-ink">{title}</h3>
      {hint && <p className="mt-0.5 t-micro text-muted">{hint}</p>}
    </div>
  );
}

export function Field({
  label, htmlFor, required, children,
}: {
  label: string; htmlFor?: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}{required && <span className="text-red"> *</span>}</Label>
      {children}
    </div>
  );
}

export type DiscountMode = "$" | "%";

/**
 * Resolve a discount input to the flat dollar amount the schema/mutation
 * expects. In `%` mode the value is a percentage of `gross` (unitPrice x
 * quantity x duration), rounded to the nearest cent. In `$` mode the value
 * passes through unchanged. A non-positive/blank discount, or a `%`
 * discount with no resolvable `gross` (e.g. price left blank for
 * auto-pricing), returns `undefined` rather than misapplying the raw
 * percentage number as a dollar amount.
 */
export function resolveDiscountAmount(
  mode: DiscountMode,
  discount: number | undefined,
  gross: number | undefined,
): number | undefined {
  if (discount == null || !Number.isFinite(discount) || discount <= 0) return undefined;
  if (mode !== "%") return discount;
  if (gross == null || !Number.isFinite(gross)) return undefined;
  return Math.round(gross * discount) / 100;
}

/**
 * The `$`/`%` discount field — an amount input paired with a mode-toggle
 * button. `inputProps` is spread onto the underlying `Input` so callers can
 * use either an RHF `register(...)` spread or a plain controlled
 * `value`/`onChange` pair.
 */
export function DiscountField({
  id,
  label = "Discount",
  hint,
  mode,
  onModeChange,
  disabled,
  inputProps,
}: {
  id: string;
  label?: string;
  hint?: string;
  mode: DiscountMode;
  onModeChange: (mode: DiscountMode) => void;
  disabled?: boolean;
  inputProps: React.ComponentProps<typeof Input>;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <div className="flex gap-1.5">
        <Input
          id={id}
          type="number"
          step="0.01"
          min={0}
          placeholder="0"
          disabled={disabled}
          className="flex-1"
          {...inputProps}
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
      {hint && <p className="mt-1 t-micro text-muted">{hint}</p>}
    </Field>
  );
}
