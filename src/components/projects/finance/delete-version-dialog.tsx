"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useQuoteWrites } from "@/hooks/use-quote-writes";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface DeleteVersionTarget {
  id: string;
  version: number;
}

/**
 * Delete a version — shared by `ProjectQuoteRail` (Finance tab) and the
 * header `ProjectVersionSwitcher` (R-3.1: one dialog, not two hand-built
 * copies of the same isLiveDraft branch). Two cases, same shape the rail
 * already distinguished:
 *
 * - The LIVE never-sent draft → `deleteDraftNative`, which rolls
 *   `revision`/`liveRevision` back (#1028).
 * - A saved-but-never-sent NON-live version (one `saveVersion`/an
 *   auto-capture left behind) → `deleteVersionNative`, which touches neither
 *   counter (#1080/#1097).
 *
 * A plain confirm, no text field — nothing outside the company has ever seen
 * either case. Recall-then-delete (#1029) is a different, stricter dialog
 * (`DeleteRecalledDialog`) for a revision that WAS sent; this one never fires
 * for that (the server rejects it too if the row somehow changed underneath
 * the click). Real `Dialog`, not `window.confirm` (CLAUDE.md — no
 * `AlertDialog` anywhere in this codebase).
 */
export function DeleteVersionDialog({
  target,
  liveRevision,
  onClose,
}: {
  target: DeleteVersionTarget | null;
  liveRevision: number;
  onClose: () => void;
}) {
  const quoteWrites = useQuoteWrites();
  const [pending, setPending] = useState(false);
  const isLiveDraft = target != null && target.version === liveRevision;

  async function confirm() {
    if (!target) return;
    setPending(true);
    try {
      if (isLiveDraft) {
        const result = await quoteWrites.deleteDraft(target.id);
        toast.success(
          result.revision === target.version
            ? `Deleted v${target.version}`
            : `Deleted v${target.version} — back to v${result.revision}`,
        );
      } else {
        await quoteWrites.deleteVersion(target.id);
        toast.success(`Deleted v${target.version}`);
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete {isLiveDraft ? "draft" : "version"} v{target?.version}</DialogTitle>
          <DialogDescription>
            {isLiveDraft
              ? "Nobody outside the company has seen this draft. Deleting it frees the version number for the next one."
              : "Nobody outside the company has seen this saved version. Deleting it removes its captured state — the version numbers already ahead of it are unaffected."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="line" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" loading={pending} onClick={() => void confirm()}>
            Delete {isLiveDraft ? "draft" : "version"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
