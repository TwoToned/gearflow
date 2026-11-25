"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useInvoiceWrites } from "@/hooks/use-invoice-writes";
import { convexErrorMessage } from "@/lib/errors/convex-error-message";
import { formatCurrency } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Credit note for an ISSUED invoice (UX Phase 10, spec §8b) — the UI for the
 * existing `invoicesWrites.createCreditNative` verb. It cuts a DRAFT credit
 * negating the invoice's total; nothing is issued, numbered or pushed to Xero
 * until someone uses `Issue…` on that draft, and an unwanted draft is removed
 * with `Delete draft` (confirmed). So creating one needs no Undo of its own,
 * and issuing it (financial issue) gets none either.
 */
export function CreditNoteDialog({
  open,
  onOpenChange,
  invoiceId,
  invoiceNumber,
  total,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  invoiceNumber: string;
  total: number;
}) {
  const invoiceWrites = useInvoiceWrites();
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);

  async function create() {
    setPending(true);
    try {
      await invoiceWrites.createCredit(invoiceId, notes.trim() || undefined);
      toast.success(`Credit note draft created for ${invoiceNumber}`);
      setNotes("");
      onOpenChange(false);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Failed to create the credit note"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Credit {invoiceNumber}</DialogTitle>
          <DialogDescription>
            Creates a draft credit note for {formatCurrency(total)}, the whole invoice. Nothing is sent or numbered until you issue
            the draft; delete the draft if you change your mind.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="credit-note-notes">Notes (optional)</Label>
          <Textarea id="credit-note-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} placeholder="Why is this being credited?" />
        </div>
        <DialogFooter>
          <Button type="button" variant="line" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" loading={pending} onClick={() => void create()}>
            Create credit note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
