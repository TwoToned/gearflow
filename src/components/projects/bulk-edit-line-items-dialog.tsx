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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import type { BulkLineItemPatch } from "@/hooks/use-line-item-writes";

const PRICING_LABELS: Record<string, string> = {
  PER_DAY: "Per day",
  PER_WEEK: "Per week",
  PER_HOUR: "Per hour",
  FLAT: "Flat",
  OPTIMIZED: "Optimized",
};

type PricingType = NonNullable<BulkLineItemPatch["pricingType"]>;

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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  isPending?: boolean;
  onSubmit: (patch: BulkLineItemPatch) => void;
}) {
  const [pricingOn, setPricingOn] = React.useState(false);
  const [pricingType, setPricingType] = React.useState<PricingType>("PER_DAY");

  const [discountOn, setDiscountOn] = React.useState(false);
  const [discount, setDiscount] = React.useState("");
  const [discountMode, setDiscountMode] = React.useState<"$" | "%">("$");

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
      setNotesOn(false);
      setNotes("");
      setOptionalOn(false);
      setIsOptional(false);
    }
  }, [open]);

  const anyEnabled = pricingOn || discountOn || notesOn || optionalOn;

  const handleSave = () => {
    const patch: BulkLineItemPatch = {};
    if (pricingOn) patch.pricingType = pricingType;
    if (discountOn) {
      const value = Number(discount);
      patch.discount =
        discount.trim() === "" || !Number.isFinite(value) || value <= 0
          ? null
          : { mode: discountMode, value };
    }
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
          <div className="flex items-start gap-3">
            <Checkbox
              id="bulk-discount-on"
              checked={discountOn}
              onCheckedChange={(v: boolean | "indeterminate") => setDiscountOn(v === true)}
              className="mt-1"
            />
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="bulk-discount">Discount</Label>
              <div className="flex gap-1">
                <Input
                  id="bulk-discount"
                  type="number"
                  step="0.01"
                  min={0}
                  placeholder="0"
                  value={discount}
                  onChange={(e) => {
                    setDiscount(e.target.value);
                    setDiscountOn(true);
                  }}
                  disabled={!discountOn}
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={() => setDiscountMode(discountMode === "$" ? "%" : "$")}
                  disabled={!discountOn}
                  className="shrink-0 w-9 h-9 rounded-md border border-input text-sm font-medium hover:bg-accent transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  {discountMode}
                </button>
              </div>
              <p className="text-caption text-muted">
                Clears the discount when left blank or zero.
                {discountMode === "%" &&
                  " Percentage is applied to each item's own line value."}
              </p>
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
          <Button onClick={handleSave} disabled={!anyEnabled || isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Apply to {count} item{count === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
