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
 * #793 shared justification dialog — `Dialog` (never `AlertDialog`, per
 * CLAUDE.md), required textarea + char counter against the server bounds
 * (10–1000 chars, `convex/lib/fieldGuards.ts`). Paired with
 * `useJustifiedMutation` so every gated equipment/group/service/crew surface
 * prompts identically instead of a per-form one-off.
 */
const MIN = 10;
const MAX = 1000;

interface JustificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (justification: string) => void;
  onCancel: () => void;
  pending?: boolean;
  error?: string | null;
  /** Current project status, surfaced in the copy per #793's spec'd wording. */
  status?: string;
}

export function JustificationDialog({
  open,
  onOpenChange,
  onConfirm,
  onCancel,
  pending,
  error,
  status,
}: JustificationDialogProps) {
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
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(v) : onCancel())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Describe this change</DialogTitle>
          <DialogDescription>
            {status
              ? `This project is ${status} — describe why this change is needed.`
              : "Describe why this change is needed."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Textarea
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. Client swapped the LED wall for a bigger one on site."
            maxLength={MAX}
            aria-invalid={value.length > 0 && !valid}
            aria-label="Justification"
          />
          <div className="flex justify-between text-xs text-ink-2">
            <span>Minimum {MIN} characters.</span>
            <span>{value.length}/{MAX}</span>
          </div>
          {error && <p className="text-xs text-t-out">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="line" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => onConfirm(trimmed)}
            disabled={!valid || pending}
          >
            {pending ? "Saving..." : "Confirm change"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
