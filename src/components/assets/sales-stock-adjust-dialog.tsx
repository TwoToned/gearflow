"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface AdjustTarget {
  id: string;
  name: string;
  /** The pool (`available`) before the change. */
  available: number;
}

export interface AdjustRequest {
  targets: AdjustTarget[];
  delta: number;
  reason?: string;
}

/** The whole-number quantity the field holds, or null when it is blank, not a number, or zero. */
export function parseAdjustDelta(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/**
 * `Adjust stock…` (row ⋯ and bulk): ONE quantity applied to each model, plus a reason. The page owns the
 * write and its Undo; this dialog only collects the request.
 */
export function SalesStockAdjustDialog({
  targets,
  onClose,
  onSubmit,
}: {
  targets: AdjustTarget[] | null;
  onClose: () => void;
  onSubmit: (req: AdjustRequest) => Promise<void>;
}) {
  const [delta, setDelta] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const parsed = parseAdjustDelta(delta);
  const many = (targets?.length ?? 0) > 1;

  const reset = () => {
    setDelta("");
    setReason("");
  };
  const submit = async () => {
    if (!targets || parsed == null) return;
    setPending(true);
    try {
      await onSubmit({ targets, delta: parsed, reason: reason.trim() || undefined });
      reset();
      onClose();
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={targets !== null}
      onOpenChange={(open) => {
        if (!open) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{many ? `Adjust sale stock — ${targets!.length} models` : `Adjust sale stock — ${targets?.[0]?.name ?? ""}`}</DialogTitle>
          <DialogDescription>
            {many
              ? "The same quantity is applied to each model."
              : `Available now: ${targets?.[0]?.available ?? 0}.`}{" "}
            Enter a positive number for stock received, or a negative number to correct it down (a stocktake or damage write-off).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="sale-stock-delta">Quantity</Label>
            <Input
              id="sale-stock-delta"
              type="number"
              step="1"
              inputMode="numeric"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              placeholder="e.g. 20, or -3 to correct down"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sale-stock-reason">Reason (optional)</Label>
            <Textarea id="sale-stock-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Received PO #1234" rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="line" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={pending} disabled={parsed == null}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
