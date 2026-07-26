"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * "Unlock financials" (#791, scope FINANCIAL) / "Full unlock" (#792, scope
 * FULL) open dialog — `Dialog` + required justification textarea (10–1000
 * chars, mirrors `convex/projectUnlockSessionsWrites.ts`'s server bound).
 * Opening captures a snapshot (the discard target) and is fully audited.
 */
const MIN = 10;
const MAX = 1000;

interface UnlockSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (justification: string) => void | Promise<void>;
  pending?: boolean;
  error?: string | null;
  /** FULL = #792 hard-lock override (admin/owner/PM only); FINANCIAL = #791. */
  scope: "FINANCIAL" | "FULL";
}

export function UnlockSessionDialog({
  open,
  onOpenChange,
  onConfirm,
  pending,
  error,
  scope,
}: UnlockSessionDialogProps) {
  const [value, setValue] = React.useState("");
  // Reset the field when the dialog transitions closed — the React-recommended
  // "adjust state during render" pattern (not an effect, so no extra render
  // pass / cascading-setState lint warning).
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) setValue("");
  }

  const trimmed = value.trim();
  const valid = trimmed.length >= MIN && trimmed.length <= MAX;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{scope === "FULL" ? "Open a full unlock session" : "Unlock financials"}</DialogTitle>
          <DialogDescription>
            {scope === "FULL"
              ? "This project is completed and hard-locked. Opening a full unlock session lets you edit structure and financials until you save & relock or discard. Restricted to org admins/owners and this project's assigned PM(s)."
              : "This project's financials are locked. Opening an unlock session lets you edit money fields until you save & relock or discard. Every change is logged and attributable to this session."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Textarea
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. Client requested a last-minute discount adjustment."
            maxLength={MAX}
            aria-invalid={value.length > 0 && !valid}
            aria-label="Unlock justification"
          />
          <div className="flex justify-between text-xs text-ink-2">
            <span>Minimum {MIN} characters.</span>
            <span>{value.length}/{MAX}</span>
          </div>
          {error && <p className="text-xs text-t-out">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="line" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onConfirm(trimmed)} disabled={!valid || pending}>
            {pending ? "Opening..." : "Unlock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
