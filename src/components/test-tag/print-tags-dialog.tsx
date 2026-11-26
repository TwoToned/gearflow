"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";

import { LabelTemplate } from "@/components/test-tag/label-template";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { plural } from "@/lib/list-write-toast";
import { api } from "../../../convex/_generated/api";

interface Labels {
  labels: { id: string; testTagId: string; result: "PASS" | "FAIL"; testDate: number; nextDueDate: number; testerName: string }[];
  skipped: { id: string; testTagId: string }[];
}

/** The printout itself: portaled to the body (a dialog's transform would offset it), on screen never, in print only. */
function TagSheet({ labels }: { labels: Labels["labels"] }) {
  return createPortal(
    <div className="test-tag-sheet hidden print:block" data-testid="tag-sheet">
      {labels.map((l) => (
        <LabelTemplate key={l.id} sheet testTagId={l.testTagId} result={l.result} testDate={new Date(l.testDate)} nextDueDate={new Date(l.nextDueDate)} testerName={l.testerName} />
      ))}
    </div>,
    document.body,
  );
}

function useLabels(ids: string[] | null, orgId: string | undefined) {
  const data = useAuthedQuery(api.testTagList.labelsFor, ids && orgId ? { orgId, ids } : "skip") as Labels | undefined;
  return { data, labels: data?.labels ?? [], skipped: data?.skipped ?? [] };
}

/** Names what is not printed (never tested), so a missing label is never a surprise. */
function SkippedNote({ skipped }: { skipped: Labels["skipped"] }) {
  if (skipped.length === 0) return null;
  return (
    <p className="py-2 text-ui-text text-muted" role="status">
      Not printed (never tested): {skipped.map((s) => s.testTagId).join(", ")}.
    </p>
  );
}

/**
 * `Print tags` (UX Phase 14, 14a-3b): one printout of the selected items' labels, each through the ONE `LabelTemplate`
 * (sheet mode: a label per page). The data is `testTagList.labelsFor` (the latest test of each item); an item that has
 * never been tested has no label and is named, never printed blank. `ids` null = closed.
 */
export function PrintTagsDialog({ ids, orgId, onClose }: { ids: string[] | null; orgId: string | undefined; onClose: () => void }) {
  const { data, labels, skipped } = useLabels(ids, orgId);
  return (
    <>
      <Dialog open={ids !== null} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Print tags</DialogTitle>
            <DialogDescription>{data ? `${plural(labels.length, "label")} ready to print, one per page.` : "Loading the latest test of each item…"}</DialogDescription>
          </DialogHeader>
          <SkippedNote skipped={skipped} />
          <DialogFooter>
            <Button variant="line" onClick={onClose}>Cancel</Button>
            <Button onClick={() => window.print()} disabled={labels.length === 0}><Printer className="mr-2 h-4 w-4" />Print</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {ids !== null && labels.length > 0 && <TagSheet labels={labels} />}
    </>
  );
}
