"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

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

interface DeleteRecalledDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quoteId: string;
  /** `<projectNumber> v<version>` — must match exactly what the user types. */
  label: string;
  onDeleted?: () => void;
}

/**
 * Recall-then-delete (#1029) — the ONE path in the app that permanently erases
 * a document a client may already hold, stored PDF included. This is a
 * deliberate, explicitly-recorded reversal of "a sent quote's document is
 * never truly deleted" (see docs/designs/quote-version-management-extensions.md
 * §2.2) — the friction here is intentional, not a UX oversight.
 *
 * Server-validated typed confirmation: `confirmLabel` must match `label`
 * EXACTLY (R-8.6.4 — the server re-checks this itself, this is UX only). Only
 * reachable from a row this component's caller has already confirmed is (a)
 * currently DRAFT via a prior recall and (b) not protected — this dialog
 * doesn't re-derive either, it just surfaces whatever the server rejects with.
 */
export function DeleteRecalledDialog({ open, onOpenChange, quoteId, label, onDeleted }: DeleteRecalledDialogProps) {
  const quoteWrites = useQuoteWrites();
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
      await quoteWrites.deleteRecalled(quoteId, { confirmLabel });
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
          <Label htmlFor="confirm-delete-label">
            Type <span className="font-mono font-medium text-fg">{label}</span> to confirm
          </Label>
          <Input
            id="confirm-delete-label"
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
