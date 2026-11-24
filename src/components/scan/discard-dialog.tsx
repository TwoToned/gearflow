"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * `Discard this check?` (spec §9i.3): a scan, a mode change or Clear over unsaved
 * answers asks first. Escape and Keep both keep the answers (Escape never resets).
 */
export function DiscardDialog({
  open,
  noun,
  tag,
  onKeep,
  onDiscard,
}: {
  open: boolean;
  noun: "check" | "test";
  tag: string | null;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onKeep())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Discard this {noun}?</DialogTitle>
          <DialogDescription>
            {tag ? `The answers for ${tag} are not saved.` : "The answers are not saved."} Discarding them can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="line" onClick={onKeep}>
            Keep {noun === "check" ? "checking" : "testing"}
          </Button>
          <Button onClick={onDiscard}>
            Discard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
