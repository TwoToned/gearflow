"use client";

import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ConfirmImpact } from "@/hooks/use-confirm-status-gate";

/**
 * Confirm-time gate dialog (spec decision, WS3 #942) — shown ONLY when
 * confirming this project would create hard overbookings and/or leave crew
 * unconfirmed. Non-blocking: "Confirm anyway" always proceeds with the same
 * status change the user asked for; there is no code path where this dialog
 * prevents a confirm.
 */
export function ConfirmStatusImpactDialog({
  open,
  impact,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  impact: ConfirmImpact | null;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warn" />
            Confirming this project will create a gap
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-1.5 text-left">
              {!!impact?.hardOverbookingModelCount && (
                <p>
                  {impact.hardOverbookingModelCount} model{impact.hardOverbookingModelCount === 1 ? "" : "s"} would go{" "}
                  <strong className="text-t-out">hard-overbooked</strong> ({impact.hardOverbookingQty} unit
                  {impact.hardOverbookingQty === 1 ? "" : "s"} short) once this project&apos;s demand is treated as
                  confirmed.
                </p>
              )}
              {!!impact?.unconfirmedCrewCount && (
                <p>
                  {impact.unconfirmedCrewCount} crew assignment{impact.unconfirmedCrewCount === 1 ? "" : "s"} on this
                  project {impact.unconfirmedCrewCount === 1 ? "isn't" : "aren't"} confirmed yet.
                </p>
              )}
              <p className="t-micro text-faint">This is a heads-up, not a block — you can still confirm.</p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="line" onClick={onCancel} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={onConfirm} disabled={pending}>Confirm anyway</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
