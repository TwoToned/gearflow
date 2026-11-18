"use client";

/**
 * Send offers (spec 8): lists who gets what, flags clashes (advisory: a clash
 * never stops an offer) and members with no email (skipped, call them).
 * Sending is one `sendCrewOffers` call; emails cannot be unsent, so there is
 * no Undo, only this confirmation.
 */
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface OfferRow {
  id: string;
  name: string;
  email: string | null;
  serviceTitle: string;
  /** e.g. `Booked: #2338`; advisory only. */
  clash?: string;
}

export function splitOffers(rows: OfferRow[]): { sendable: OfferRow[]; noEmail: OfferRow[] } {
  return { sendable: rows.filter((r) => !!r.email), noEmail: rows.filter((r) => !r.email) };
}

export function SendOffersDialog({
  open,
  onOpenChange,
  rows,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: OfferRow[];
  pending: boolean;
  onConfirm: (ids: string[]) => void;
}) {
  const { sendable, noEmail } = splitOffers(rows);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{"Send " + sendable.length + " offer" + (sendable.length === 1 ? "" : "s") + "?"}</DialogTitle>
          <DialogDescription>Each person gets an email with accept and decline links.</DialogDescription>
        </DialogHeader>
        <ul className="max-h-64 space-y-1 overflow-y-auto text-ui-text">
          {sendable.map((r) => (
            <li key={r.id} className="flex items-baseline gap-2">
              <span className="font-medium text-ink">{r.name}</span>
              <span className="text-muted">{r.serviceTitle}</span>
              {r.clash && <span className="ml-auto text-warn">{r.clash}</span>}
            </li>
          ))}
        </ul>
        {noEmail.length > 0 && (
          <p className="text-caption text-warn">
            {noEmail.map((r) => r.name).join(", ") + " have no email and will be skipped. Call them."}
          </p>
        )}
        <DialogFooter>
          <Button variant="line" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={sendable.length === 0 || pending} onClick={() => onConfirm(sendable.map((r) => r.id))}>
            {"Send " + sendable.length}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
