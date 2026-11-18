"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** "Add to job?" for a scanned asset that is not on the job (adds it, then preps it). */
export function AddToJobDialog({
  open, assetName, pending, onCancel, onAdd,
}: {
  open: boolean;
  assetName: string | undefined;
  pending: boolean;
  onCancel: () => void;
  onAdd: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Add to job?</DialogTitle></DialogHeader>
        <p className="text-ui-text text-muted">
          <span className="font-medium text-ink">{assetName}</span> is not on this project. Would you like to add it and check it out?
        </p>
        <DialogFooter>
          <Button variant="line" onClick={onCancel}>Cancel</Button>
          <Button disabled={pending} loading={pending} onClick={onAdd}>Add &amp; deploy</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
