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

export interface DiscountFieldProps {
  id?: string;
  label?: string;
  value: string;
  onValueChange: (value: string) => void;
  mode: DiscountMode;
  onModeChange: (mode: DiscountMode) => void;
  disabled?: boolean;
  hint?: string;
}

/**
 * Discount amount input + $/% mode toggle. The mode is a pure client-side
 * display convenience — callers are responsible for resolving a `%` value
 * to a dollar amount before it reaches the schema/mutation (discount is
 * always persisted as a flat dollar amount; see `src/lib/validations/line-item.ts`).
 */
export function DiscountField({
  id,
  label = "Discount",
  value,
  onValueChange,
  mode,
  onModeChange,
  disabled,
  hint,
}: DiscountFieldProps) {
  return (
    <Field label={label} htmlFor={id}>
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
      {hint && <p className="t-micro text-muted">{hint}</p>}
    </Field>
  );
}
