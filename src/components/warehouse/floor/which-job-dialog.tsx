"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ReceiveTarget } from "@/lib/floor-receive";
import type { WhichJob } from "./use-receive-scan";

/**
 * `Which job?` (spec §9c.4): a tag that is out on more than one job is never
 * auto-picked. Each job is one row with its own Return; a bulk tag gets a
 * quantity per job (defaulting to what that job still has out) and the dialog
 * stays open so the desk can split one bin across jobs.
 */
export function WhichJobDialog({
  state,
  onClose,
  onReturn,
}: {
  state: WhichJob | null;
  onClose: () => void;
  onReturn: (target: ReceiveTarget, quantity?: number) => Promise<void>;
}) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [done, setDone] = useState<Set<string>>(new Set());
  const reset = () => {
    setQty({});
    setDone(new Set());
    onClose();
  };

  const run = async (t: ReceiveTarget) => {
    const q = t.kind === "bulk" ? Math.min(t.quantity, Math.max(1, qty[t.projectId] ?? t.quantity)) : undefined;
    await onReturn(t, q);
    if (t.kind === "bulk") setDone((d) => new Set(d).add(t.projectId));
    else reset();
  };

  return (
    <Dialog open={state != null} onOpenChange={(o) => !o && reset()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Which job?</DialogTitle>
          <DialogDescription>{state?.label} is out on more than one job. Pick where it came back from.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col divide-y divide-line">
          {state?.options.map((t) => (
            <li key={`${t.projectId}-${"lineItemId" in t ? t.lineItemId : ""}`} className="flex min-h-12 items-center gap-3 py-2">
              <span className="min-w-0 flex-1 truncate text-ui-text text-ink">
                <span className="font-mono text-muted">#{t.projectNumber}</span> {t.projectName}
              </span>
              {t.kind === "bulk" ? (
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={t.quantity}
                  aria-label={`Quantity for #${t.projectNumber}`}
                  className="h-11 w-20 rounded-[var(--r)] border border-line bg-elev px-2 text-reading-body tabular-nums"
                  value={qty[t.projectId] ?? t.quantity}
                  onChange={(e) => setQty((s) => ({ ...s, [t.projectId]: Number(e.target.value) }))}
                />
              ) : null}
              {done.has(t.projectId) ? (
                <span className="text-caption text-ok">Returned</span>
              ) : (
                <Button size="sm" onClick={() => void run(t)}>{`Return to #${t.projectNumber}`}</Button>
              )}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
