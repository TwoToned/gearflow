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
import type { DateMoveImpactRow } from "@/hooks/use-date-move-gate";

const VISIBLE_ROW_CAP = 5;

/**
 * Date-move impact gate dialog (#1227, Q3) — shown ONLY when moving this
 * project's dates would create a hard gear shortage on another job. Same
 * grammar as `ConfirmStatusImpactDialog` on purpose — the two read as one
 * system. Non-blocking: "Save anyway" always proceeds with the same save the
 * user asked for; there is no code path where this dialog prevents it.
 */
export function DateMoveImpactDialog({
  open,
  rows,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  rows: DateMoveImpactRow[];
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const visible = rows.slice(0, VISIBLE_ROW_CAP);
  const hiddenCount = rows.length - visible.length;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warn" />
            Moving these dates creates a shortage
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-1.5 text-left">
              <ul className="space-y-1">
                {visible.map((row) => (
                  <li key={row.modelId}>
                    {row.qty} × {row.modelName} — also booked on {row.projectNumbers.join(", ")}
                  </li>
                ))}
                {hiddenCount > 0 && <li className="t-micro text-faint">+{hiddenCount} more</li>}
              </ul>
              <p className="t-micro text-faint">This is a heads-up, not a block — you can still save.</p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="line" onClick={onCancel} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={onConfirm} disabled={pending}>Save anyway</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
