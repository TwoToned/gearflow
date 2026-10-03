"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useQuoteWrites } from "@/hooks/use-quote-writes";
import { convexErrorMessage } from "@/lib/errors/convex-error-message";
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

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

interface AcceptQuoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quoteId: string;
  version: number;
  /** Whether this revision's `validUntil` has passed. Purely informational —
   *  expiry is an operator's out to re-quote, never a hard stop on the
   *  client's yes (2026-09), so this never disables the confirm button. */
  isExpired?: boolean;
  onAccepted?: (offerStatusChange: string | null) => void;
}

/**
 * Mark accepted (#989 §3.6) — a dialog, not a bare click. A one-click accept
 * would silently drop the acceptance date + reference (PO number, email
 * subject) an accountant will later need.
 */
export function AcceptQuoteDialog({ open, onOpenChange, quoteId, version, isExpired, onAccepted }: AcceptQuoteDialogProps) {
  const quoteWrites = useQuoteWrites();
  const [acceptedAtStr, setAcceptedAtStr] = useState(todayStr());
  const [acceptanceRef, setAcceptanceRef] = useState("");
  const [pending, setPending] = useState(false);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setAcceptedAtStr(todayStr());
      setAcceptanceRef("");
    }
    onOpenChange(next);
  }

  async function confirm() {
    setPending(true);
    try {
      const result = await quoteWrites.markAccepted(quoteId, {
        acceptedAt: new Date(acceptedAtStr),
        acceptanceRef: acceptanceRef || undefined,
      });
      toast.success(`Marked v${version} accepted — this project can now be confirmed`);
      onAccepted?.(result.offerStatusChange);
      handleOpenChange(false);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Failed to mark accepted"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Mark v{version} accepted</DialogTitle>
          <DialogDescription>Records when the client accepted and an optional reference.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {isExpired && (
            <p className="rounded-[var(--radius)] border-l-[3px] border-l-warn bg-warn-soft px-3 py-2 text-sm text-warn">
              This revision&rsquo;s validity date has passed. That&rsquo;s just an out to re-quote at a new
              price — you can still mark it accepted at the price the client was sent.
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="accepted-at">Accepted on</Label>
            <Input id="accepted-at" type="date" value={acceptedAtStr} onChange={(e) => setAcceptedAtStr(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acceptance-ref">Reference (optional)</Label>
            <Input
              id="acceptance-ref"
              value={acceptanceRef}
              onChange={(e) => setAcceptanceRef(e.target.value)}
              placeholder="PO number, email subject…"
              maxLength={200}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="line" onClick={() => handleOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" loading={pending} onClick={() => void confirm()}>
            Mark accepted
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
