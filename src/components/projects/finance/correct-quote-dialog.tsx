"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useQuoteWrites } from "@/hooks/use-quote-writes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function toDateStr(ms: number | null | undefined): string {
  return new Date(ms ?? Date.now()).toISOString().slice(0, 10);
}

interface CorrectQuoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quoteId: string;
  version: number;
  currentQuoteDate: number | null | undefined;
  currentValidityDays: number | null | undefined;
}

/**
 * Correction (#1031) — a typo fix to the date PRINTED on an already-sent
 * revision. Deliberately narrow: no version bump, no price change, and the
 * dialog says so outright so nobody mistakes this for re-pricing (that's
 * "Create quote v(N+1)"). Owner-only — the row only renders this button for an
 * owner (`useIsOwner` in the rail), and the server re-checks unconditionally.
 */
export function CorrectQuoteDialog({
  open,
  onOpenChange,
  quoteId,
  version,
  currentQuoteDate,
  currentValidityDays,
}: CorrectQuoteDialogProps) {
  const quoteWrites = useQuoteWrites();
  const [quoteDateStr, setQuoteDateStr] = useState(() => toDateStr(currentQuoteDate));
  const [validityDaysStr, setValidityDaysStr] = useState(
    currentValidityDays != null ? String(currentValidityDays) : "",
  );
  const [pending, setPending] = useState(false);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setQuoteDateStr(toDateStr(currentQuoteDate));
      setValidityDaysStr(currentValidityDays != null ? String(currentValidityDays) : "");
    }
    onOpenChange(next);
  }

  async function confirm() {
    setPending(true);
    try {
      const result = await quoteWrites.correct(quoteId, {
        quoteDate: new Date(quoteDateStr),
        validityDays: validityDaysStr ? Number(validityDaysStr) : undefined,
      });
      // The date fix is already saved even if the render below failed — never
      // report failure for a write that actually succeeded (same shape as
      // `send`'s artifactReady handling).
      toast.success(
        result.artifactReady
          ? `Corrected v${version}'s date`
          : `Corrected v${version}'s date — document generation failed, retry from the rail`,
      );
      handleOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to correct");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Correct v{version}&rsquo;s date</DialogTitle>
          <DialogDescription>
            Fixes the date printed on the document — not a re-price. To change prices, create the next
            version instead. The old document stays retrievable; this generates a new one.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="correct-quote-date">Corrected date</Label>
            <Input
              id="correct-quote-date"
              type="date"
              value={quoteDateStr}
              onChange={(e) => setQuoteDateStr(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="correct-validity-days">Valid for (days, optional)</Label>
            <Input
              id="correct-validity-days"
              type="number"
              min={1}
              max={365}
              value={validityDaysStr}
              onChange={(e) => setValidityDaysStr(e.target.value)}
              placeholder="Keep the current validity window"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="line" onClick={() => handleOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" loading={pending} disabled={!quoteDateStr} onClick={() => void confirm()}>
            Save correction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
