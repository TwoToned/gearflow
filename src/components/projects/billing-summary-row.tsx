"use client";

/**
 * Derived billing weeks/days summary (#943) — shown in the project financial
 * header. Read-only "Billed as: N wk M d" derived from the project's rental
 * dates via src/lib/billing-derivation.ts `deriveBillingSummary`, with an
 * "edited" marker when a manual override is set. The Edit dialog lets an
 * operator override either field directly (persisted as
 * billingWeeksOverride/billingDaysOverride) or reset back to derived.
 */

import { useState } from "react";
import { Pencil, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { deriveBillingSummary } from "@/lib/billing-derivation";
import { useBillingOverride } from "@/hooks/use-billing-summary";
import { showError } from "@/lib/show-error";
import { cn } from "@/lib/utils";

interface BillingSummaryRowProps {
  projectId: string;
  orgId: string | undefined;
  rentalStartDate: Date | null;
  rentalEndDate: Date | null;
  billingWeeksOverride: number | null;
  billingDaysOverride: number | null;
}

export function BillingSummaryRow({
  projectId,
  orgId,
  rentalStartDate,
  rentalEndDate,
  billingWeeksOverride,
  billingDaysOverride,
}: BillingSummaryRowProps) {
  const [open, setOpen] = useState(false);
  const [weeksInput, setWeeksInput] = useState("");
  const [daysInput, setDaysInput] = useState("");
  const [saving, setSaving] = useState(false);
  const { setOverride, clearOverride } = useBillingOverride(orgId);

  const summary = deriveBillingSummary({
    rentalStartMs: rentalStartDate?.getTime(),
    rentalEndMs: rentalEndDate?.getTime(),
    weeksOverride: billingWeeksOverride,
    daysOverride: billingDaysOverride,
  });

  const openDialog = () => {
    setWeeksInput(String(summary.weeks));
    setDaysInput(String(summary.days));
    setOpen(true);
  };

  const handleSave = async () => {
    const weeks = Number(weeksInput);
    const days = Number(daysInput);
    if (!Number.isFinite(weeks) || !Number.isInteger(weeks) || weeks < 0 || weeks > 522) {
      showError(new Error("Weeks must be a whole number between 0 and 522."));
      return;
    }
    if (!Number.isFinite(days) || !Number.isInteger(days) || days < 0 || days > 6) {
      showError(new Error("Days must be a whole number between 0 and 6."));
      return;
    }
    setSaving(true);
    try {
      await setOverride(projectId, weeks, days);
      toast.success("Billing period updated");
      setOpen(false);
    } catch (e) {
      showError(e);
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDerived = async () => {
    setSaving(true);
    try {
      await clearOverride(projectId);
      toast.success("Reverted to derived billing period");
      setOpen(false);
    } catch (e) {
      showError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-fg-3">Billed as</span>
      <div className="flex items-center gap-1.5">
        <span className="tabular-nums text-xs text-fg-2">
          {summary.weeks} wk {summary.days} d
        </span>
        {summary.edited && (
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
              "bg-[oklch(0.72_0.17_70)]/15 text-[oklch(0.55_0.17_70)]",
            )}
          >
            edited
          </span>
        )}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              onClick={openDialog}
              aria-label="Edit billing period"
              className="text-fg-4 hover:text-fg-2 transition-colors"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Billing period</DialogTitle>
              <DialogDescription>
                Derived from the rental dates by default. Override to bill a different period —
                e.g. a negotiated flat week regardless of the exact date range.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="billing-weeks">Weeks</Label>
                <Input
                  id="billing-weeks"
                  type="number"
                  min={0}
                  max={522}
                  value={weeksInput}
                  onChange={(e) => setWeeksInput(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="billing-days">Days</Label>
                <Input
                  id="billing-days"
                  type="number"
                  min={0}
                  max={6}
                  value={daysInput}
                  onChange={(e) => setDaysInput(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter className="gap-2 sm:justify-between">
              {summary.edited && (
                <Button variant="ghost" size="sm" disabled={saving} onClick={handleResetToDerived}>
                  Reset to derived
                </Button>
              )}
              <Button size="sm" disabled={saving} onClick={handleSave} className="ml-auto">
                {saving && <Loader2 className="mr-1 size-3 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
