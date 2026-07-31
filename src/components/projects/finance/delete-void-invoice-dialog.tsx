"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

import { useInvoiceWrites } from "@/hooks/use-invoice-writes";
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

interface DeleteVoidInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  /** The invoice number (or id, if somehow unnumbered) — must match exactly. */
  label: string;
  onDeleted?: () => void;
}

/**
 * Delete a VOID invoice permanently (#1055) — the invoice-side counterpart to
 * quotes' `DeleteRecalledDialog`. This is a deliberate, explicitly-recorded
 * reversal of "a client-facing finance PDF is never deleted" — the friction
 * here is intentional. Server-validated typed confirmation: `confirmLabel`
 * must match `label` exactly (R-8.6.4 — the server re-checks this itself).
 * The server also refuses if the invoice still has any non-voided payment
 * recorded against it; this dialog surfaces whatever it rejects with rather
 * than re-deriving that check.
 */
export function DeleteVoidInvoiceDialog({ open, onOpenChange, invoiceId, label, onDeleted }: DeleteVoidInvoiceDialogProps) {
  const invoiceWrites = useInvoiceWrites();
  const [confirmLabel, setConfirmLabel] = useState("");
  const [pending, setPending] = useState(false);
  const matches = confirmLabel === label;

  function handleOpenChange(next: boolean) {
    if (!next) setConfirmLabel("");
    onOpenChange(next);
  }

  async function confirm() {
    if (!matches) return;
    setPending(true);
    try {
      await invoiceWrites.deleteVoid(invoiceId, { confirmLabel });
      toast.success(`Permanently deleted ${label}`);
      onDeleted?.();
      handleOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-t-out" /> Permanently delete {label}
          </DialogTitle>
          <DialogDescription>
            This client may already have opened or downloaded this document. Deleting it removes the row
            and its stored PDF for good — there is no undo, and no other copy is kept anywhere in Flow.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="confirm-delete-invoice-label">
            Type <span className="font-mono font-medium text-fg">{label}</span> to confirm
          </Label>
          <Input
            id="confirm-delete-invoice-label"
            value={confirmLabel}
            onChange={(e) => setConfirmLabel(e.target.value)}
            placeholder={label}
            autoComplete="off"
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="line" onClick={() => handleOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" variant="primary" loading={pending} disabled={!matches} onClick={() => void confirm()}>
            Delete permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
