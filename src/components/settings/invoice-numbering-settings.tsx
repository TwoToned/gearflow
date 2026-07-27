"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PROJECT_NUMBER_TOKENS, validateProjectNumberFormat, type IncrementReset } from "@/lib/project-number";
import { DEFAULT_INVOICE_NUMBER_FORMAT } from "@/lib/invoice-number";

/**
 * WS1 (#940) — cloned from `ProjectNumberingSettings` (per the issue spec).
 * Same template engine (zero engine change), same token vocabulary — the
 * only difference from the project version is there's no "leave blank for
 * manual entry" option (an invoice is ALWAYS auto-numbered, at issue time)
 * and no live preview (that would need its own peek server action reading
 * the "INV:"-namespaced counter — not built in this PR; the format is
 * validated inline instead).
 */
const RESET_LABELS: Record<IncrementReset, string> = {
  NONE: "Never (one running counter)",
  YEARLY: "Every year",
  MONTHLY: "Every month",
  DAILY: "Every day",
};

interface Props {
  format: string;
  reset: IncrementReset;
  padding: number;
  disabled?: boolean;
  onChange: (patch: { format?: string; reset?: IncrementReset; padding?: number }) => void;
}

export function InvoiceNumberingSettings({ format, reset, padding, disabled, onChange }: Props) {
  const effectiveFormat = format || DEFAULT_INVOICE_NUMBER_FORMAT;
  const formatError = validateProjectNumberFormat(effectiveFormat);

  return (
    <div className="sm:col-span-2 space-y-3 rounded-lg border border-border/60 bg-bg-2/40 p-4">
      <div>
        <h4 className="t-body font-medium text-fg">Invoice numbers</h4>
        <p className="t-micro text-fg-3">
          Every issued invoice is auto-numbered (drafts stay unnumbered) — there is no manual override.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2 sm:col-span-1">
          <Label htmlFor="invoiceNumberFormat">Format</Label>
          <Input
            id="invoiceNumberFormat"
            value={format}
            onChange={(e) => onChange({ format: e.target.value })}
            placeholder={DEFAULT_INVOICE_NUMBER_FORMAT}
            disabled={disabled}
            spellCheck={false}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="invoiceNumberReset">Counter resets</Label>
          <Select value={reset} onValueChange={(v) => onChange({ reset: v as IncrementReset })} disabled={disabled}>
            <SelectTrigger id="invoiceNumberReset">
              <SelectValue>{RESET_LABELS[reset]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(RESET_LABELS) as IncrementReset[]).map((r) => (
                <SelectItem key={r} value={r}>{RESET_LABELS[r]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="invoiceNumberPadding">Increment digits</Label>
          <Input
            id="invoiceNumberPadding"
            type="number"
            min={1}
            max={8}
            value={padding}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) onChange({ padding: Math.max(1, Math.min(8, Math.round(n))) });
            }}
            disabled={disabled}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {PROJECT_NUMBER_TOKENS.map((t) => (
          <span key={t.token} className="t-micro text-fg-3">
            <code className="rounded bg-bg-3 px-1 text-fg-2">{t.token}</code> {t.description}
          </span>
        ))}
      </div>

      {formatError && <p className="t-micro text-destructive">{formatError}</p>}
    </div>
  );
}
