"use client";
// use-client: interactive picker fields (R-8.1.1)

import { Label } from "@/components/ui/label";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { useXeroLinked, useXeroIntegration } from "@/hooks/use-xero-linked";

/**
 * Shared Xero account-code / tax-type picker fields for the coding cascade
 * (WS1 #940 follow-up) — org default (Settings -> Xero) -> category default
 * -> model/kit default -> line/service override. `convex/lib/xeroAccountCascade.ts`
 * is the resolver; these components are the write side for the 3 levels
 * that had no UI (category/model/kit defaults, line/service overrides).
 *
 * Self-gating on `useXeroLinked()` (return null when unlinked) so every call
 * site gets "hidden but retained, inert" for free — matches every other
 * Xero-linked-only surface (FEATUREDOCS/66 "Linked gate"), not a per-caller
 * decision that could drift.
 */

interface XeroAccountOption {
  AccountID: string;
  Code?: string;
  Name: string;
}
interface XeroTaxRateOption {
  Name: string;
  TaxType: string;
}

/** Exported so Settings -> Xero's org-default pickers share this exact
 *  mapping instead of a second hand-maintained copy (R-3.1).
 *
 *  Filters out accounts with no `Code`: Xero's Invoices API `AccountCode`
 *  field takes the short account CODE, never the internal `AccountID` GUID,
 *  so a codeless account is never a valid selection here regardless. This
 *  also fixes a real bug — `a.Code ?? a.AccountID` (the old fallback) only
 *  triggers on null/undefined, not on `Code: ""` (which Xero returns for
 *  accounts with no code assigned), so that account's `value` silently
 *  collapsed to `""` — the exact sentinel `ComboboxPicker` treats as
 *  "nothing selected." Every UNSET field then matched that account by
 *  coincidence and rendered it as if selected ("defaults to the first
 *  account" — whichever codeless account happened to be in the list). */
export function useXeroCodingOptions() {
  const integration = useXeroIntegration();
  const accounts = (integration?.cachedAccounts as XeroAccountOption[] | undefined) ?? [];
  const taxRates = (integration?.cachedTaxRates as XeroTaxRateOption[] | undefined) ?? [];
  const accountOptions = accounts
    .filter((a) => !!a.Code)
    .map((a) => ({
      value: a.Code as string,
      label: a.Name,
      description: a.Code,
    }));
  const taxRateOptions = taxRates
    .filter((t) => !!t.TaxType)
    .map((t) => ({
      value: t.TaxType,
      label: t.Name,
      description: t.TaxType,
    }));
  return { accountOptions, taxRateOptions };
}

interface XeroAccountCodeFieldProps {
  value: string | null | undefined;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  helpText?: string;
}

/** A single "Xero account" picker — used once on category/kit forms, twice
 *  (rental + sale) on the model form, and once as a per-line/service override. */
export function XeroAccountCodeField({
  value,
  onChange,
  label = "Xero account",
  placeholder = "Inherit from default",
  helpText,
}: XeroAccountCodeFieldProps) {
  const linked = useXeroLinked();
  const { accountOptions } = useXeroCodingOptions();
  if (!linked) return null;
  return (
    <div className="space-y-1.5">
      <Label className="t-micro text-fg-3">{label}</Label>
      <ComboboxPicker
        value={value ?? ""}
        onChange={onChange}
        options={accountOptions}
        placeholder={placeholder}
        searchPlaceholder="Search accounts…"
        emptyMessage="No accounts found."
        allowClear
        className="w-full"
      />
      {helpText && <p className="t-micro text-fg-3">{helpText}</p>}
    </div>
  );
}

interface XeroTaxTypeFieldProps {
  value: string | null | undefined;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  helpText?: string;
}

/** A single "Xero GST tax type" picker — the tax-type cascade is only 2
 *  levels (line/service override -> org default), so this has no
 *  category/model/kit equivalent. */
export function XeroTaxTypeField({
  value,
  onChange,
  label = "Xero tax type",
  placeholder = "Use org default",
  helpText,
}: XeroTaxTypeFieldProps) {
  const linked = useXeroLinked();
  const { taxRateOptions } = useXeroCodingOptions();
  if (!linked) return null;
  return (
    <div className="space-y-1.5">
      <Label className="t-micro text-fg-3">{label}</Label>
      <ComboboxPicker
        value={value ?? ""}
        onChange={onChange}
        options={taxRateOptions}
        placeholder={placeholder}
        searchPlaceholder="Search tax types…"
        emptyMessage="No tax types found."
        allowClear
        className="w-full"
      />
      {helpText && <p className="t-micro text-fg-3">{helpText}</p>}
    </div>
  );
}
