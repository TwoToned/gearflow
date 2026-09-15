"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LockedField } from "@/components/ui/locked-field";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BulkLineItemPatch } from "@/hooks/use-line-item-writes";
import { DiscountAmountInput, type DiscountMode } from "./line-item-form-fields";

const PRICING_LABELS: Record<string, string> = {
  PER_DAY: "Per day",
  PER_WEEK: "Per week",
  PER_HOUR: "Per hour",
  FLAT: "Flat",
  OPTIMIZED: "Optimized",
};

type PricingType = NonNullable<BulkLineItemPatch["pricingType"]>;

/** Split out of `handleSave` below to keep its own cyclomatic complexity down (R-3.6). */
function resolveBulkDiscount(mode: DiscountMode, raw: string): BulkLineItemPatch["discount"] {
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(value) || value <= 0) return null;
  return { mode, value };
}

/** Split out of `handleSave` below to keep its own cyclomatic complexity down (R-3.6). */
function resolveBulkTaxRate(raw: string): BulkLineItemPatch["taxRate"] {
  const value = Number(raw);
  return raw.trim() === "" || !Number.isFinite(value) ? null : value;
}

/**
 * Bulk-edit the shared fields of many selected line items at once.
 *
 * Each field has its own enable toggle — only ticked fields are sent, so an
 * untouched field is never overwritten across the selection. Fields mirror the
 * bulk-settable shortlist: pricing type, discount ($/%), notes, and the optional
 * flag. Per-item-only fields (quantity, unit price, description) are deliberately
 * absent. Save is disabled until at least one field is enabled.
 */
export function BulkEditLineItemsDialog({
  open,
  onOpenChange,
  count,
  isPending,
  onSubmit,
  locked,
  lockReason,
  onUnlockExit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  isPending?: boolean;
  onSubmit: (patch: BulkLineItemPatch) => void;
  /** #990 — the Discount field (the only money field here) renders read-only
   *  via `<LockedField>` when true. Pricing type/notes/optional aren't
   *  locked fields (`convex/lib/projectLocks.ts`'s `LOCKED_LINE_ITEM_FIELDS`
   *  is `unitPrice`/`discount`/`duration` — pricing TYPE isn't in that list). */
  locked?: boolean;
  lockReason?: string;
  onUnlockExit?: () => void;
}) {
  const [pricingOn, setPricingOn] = React.useState(false);
  const [pricingType, setPricingType] = React.useState<PricingType>("PER_DAY");

  const [discountOn, setDiscountOn] = React.useState(false);
  const [discount, setDiscount] = React.useState("");
  const [discountMode, setDiscountMode] = React.useState<DiscountMode>("$");

  // T3 (#1091, docs/designs/tax-model.md §3) — per-line tax rate override,
  // bulk-settable like discount above.
  const [taxRateOn, setTaxRateOn] = React.useState(false);
  const [taxRate, setTaxRate] = React.useState("");

  const [notesOn, setNotesOn] = React.useState(false);
  const [notes, setNotes] = React.useState("");

  const [optionalOn, setOptionalOn] = React.useState(false);
  const [isOptional, setIsOptional] = React.useState(false);

  // Reset every field whenever the dialog re-opens.
  React.useEffect(() => {
    if (open) {
      setPricingOn(false);
      setPricingType("PER_DAY");
      setDiscountOn(false);
      setDiscount("");
      setDiscountMode("$");
      setTaxRateOn(false);
      setTaxRate("");
      setNotesOn(false);
      setNotes("");
      setOptionalOn(false);
      setIsOptional(false);
    }
  }, [open]);

  const anyEnabled = pricingOn || discountOn || taxRateOn || notesOn || optionalOn;

  const handleSave = () => {
    const patch: BulkLineItemPatch = {};
    if (pricingOn) patch.pricingType = pricingType;
    if (discountOn) patch.discount = resolveBulkDiscount(discountMode, discount);
    if (taxRateOn) patch.taxRate = resolveBulkTaxRate(taxRate);
    if (notesOn) patch.notes = notes.trim() === "" ? null : notes;
    if (optionalOn) patch.isOptional = isOptional;
    onSubmit(patch);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Bulk edit {count} item{count === 1 ? "" : "s"}
          </DialogTitle>
          <DialogDescription>
            Enable a field to apply the same value to every selected item.
            Untouched fields are left as they are.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Pricing type */}
          <div className="flex items-start gap-3">
            <Checkbox
              id="bulk-pricing-on"
              checked={pricingOn}
              onCheckedChange={(v: boolean | "indeterminate") => setPricingOn(v === true)}
              className="mt-1"
            />
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="bulk-pricing-on">Pricing type</Label>
              <Select
                value={pricingType}
                onValueChange={(v: string) => {
                  if (v) {
                    setPricingType(v as PricingType);
                    setPricingOn(true);
                  }
                }}
                disabled={!pricingOn}
              >
                <SelectTrigger>
                  <SelectValue>{PRICING_LABELS[pricingType]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRICING_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Discount */}
          <LockedField
            locked={!!locked}
            reason={lockReason ?? "Pricing is locked."}
            exitLabel={onUnlockExit ? "Unlock financials" : undefined}
            onExit={onUnlockExit}
          >
            <div className="flex items-start gap-3">
              <Checkbox
                id="bulk-discount-on"
                checked={discountOn}
                onCheckedChange={(v: boolean | "indeterminate") => setDiscountOn(v === true)}
                className="mt-1"
              />
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="bulk-discount">Discount</Label>
                <DiscountAmountInput
                  id="bulk-discount"
                  value={discount}
                  onValueChange={(value) => {
                    setDiscount(value);
                    setDiscountOn(true);
                  }}
                  mode={discountMode}
                  onModeChange={setDiscountMode}
                  disabled={!discountOn}
                />
                <p className="text-caption text-muted">
                  Clears the discount when left blank or zero.
                  {discountMode === "%" &&
                    " Percentage is applied to each item's own line value."}
                </p>
              </div>
            </div>
          </LockedField>

          {/* Tax rate — T3 (#1091, docs/designs/tax-model.md §3) */}
          <div className="flex items-start gap-3">
            <Checkbox
              id="bulk-tax-rate-on"
              checked={taxRateOn}
              onCheckedChange={(v: boolean | "indeterminate") => setTaxRateOn(v === true)}
              className="mt-1"
            />
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="bulk-tax-rate">Tax rate override</Label>
              <Input
                id="bulk-tax-rate"
                type="number"
                step="0.01"
                min={0}
                max={100}
                placeholder="Inherit"
                value={taxRate}
                onChange={(e) => {
                  setTaxRate(e.target.value);
                  setTaxRateOn(true);
                }}
                disabled={!taxRateOn}
              />
              <p className="text-caption text-muted">Clears the override (inherits the project&apos;s rate) when left blank.</p>
            </div>
          </div>

          {/* Notes */}
          <div className="flex items-start gap-3">
            <Checkbox
              id="bulk-notes-on"
              checked={notesOn}
              onCheckedChange={(v: boolean | "indeterminate") => setNotesOn(v === true)}
              className="mt-1"
            />
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="bulk-notes">Notes</Label>
              <Textarea
                id="bulk-notes"
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  setNotesOn(true);
                }}
                disabled={!notesOn}
                rows={2}
                placeholder="Applied to every selected item (blank clears)."
              />
            </div>
          </div>

          {/* Optional flag */}
          <div className="flex items-start gap-3">
            <Checkbox
              id="bulk-optional-on"
              checked={optionalOn}
              onCheckedChange={(v: boolean | "indeterminate") => setOptionalOn(v === true)}
              className="mt-1"
            />
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="bulk-optional-on">Optional</Label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={isOptional}
                  onCheckedChange={(v: boolean | "indeterminate") => {
                    setIsOptional(v === true);
                    setOptionalOn(true);
                  }}
                  disabled={!optionalOn}
                />
                <span className="text-muted">
                  Mark selected items as optional
                </span>
              </label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="line" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={isPending} disabled={!anyEnabled}>
            Apply to {count} item{count === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
