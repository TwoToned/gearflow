"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useProjectVersionWrites, type MakeLiveResult } from "@/hooks/use-project-version-writes";
import type { ProjectVersionSummary } from "@/components/projects/project-version-context";

/**
 * Project Versioning v2, Phase 5 (#1231, parent #1221, design §5.5) — Make
 * live. A pointer flip (`versions.makeLiveNative`), never a restore: nothing
 * is deleted, so this dialog states what CHANGES before it runs (which
 * version becomes live) and, after it runs, what needs a human look
 * (warehouse conflicts the mutation LISTS, never blocks on — §4.4/D6).
 *
 * Replaces `PromoteVersionDialog` (deleted) — same job, wired onto the real
 * `projectVersions`-table verb instead of the old quote-revision/snapshot
 * "promote" model. Uses `Dialog` with explicit confirm/cancel buttons — no
 * `AlertDialog` exists in this codebase (CLAUDE.md).
 */
interface MakeLiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetVersion: ProjectVersionSummary;
  liveVersion: ProjectVersionSummary | null;
  projectId: string;
  onMadeLive: (result: MakeLiveResult) => void;
}

function ConflictsList({ conflicts }: { conflicts: string[] }) {
  if (conflicts.length === 0) return null;
  return (
    <div className="rounded-[var(--r)] border-l-[3px] border-l-warn bg-warn-soft px-3 py-2.5 text-caption text-warn">
      <p className="mb-1 flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {conflicts.length} item{conflicts.length === 1 ? "" : "s"} {conflicts.length === 1 ? "needs" : "need"} a look
      </p>
      <ul className="list-disc space-y-0.5 pl-5">
        {conflicts.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
    </div>
  );
}

export function MakeLiveDialog({ open, onOpenChange, targetVersion, liveVersion, projectId, onMadeLive }: MakeLiveDialogProps) {
  const { makeLive } = useProjectVersionWrites(projectId);
  const [result, setResult] = useState<MakeLiveResult | null>(null);

  const mutation = useServerMutation({
    mutationFn: () => makeLive(targetVersion.id),
    onSuccess: (r) => {
      setResult(r);
      onMadeLive(r);
      if (r.conflicts.length === 0) {
        toast.success(`v${targetVersion.number} is live`);
        onOpenChange(false);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function close(nextOpen: boolean) {
    if (!nextOpen) setResult(null);
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Make v{targetVersion.number} live</DialogTitle>
          <DialogDescription>
            {liveVersion ? `v${liveVersion.number} stays as a saved version — nothing is deleted.` : "Nothing is deleted."}{" "}
            Checked-out gear, invoices and paperwork carry over by lineage. The warehouse, availability and any future
            document will follow v{targetVersion.number} from now on.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <ConflictsList conflicts={result.conflicts} />
        ) : (
          <p className="text-caption text-muted">
            This doesn&apos;t send anything to the client — quote v{targetVersion.number} hasn&apos;t been sent unless you send it
            separately.
          </p>
        )}

        <DialogFooter>
          {result ? (
            <Button type="button" onClick={() => close(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button type="button" variant="line" onClick={() => close(false)} disabled={mutation.isPending}>
                Cancel
              </Button>
              <Button type="button" loading={mutation.isPending} onClick={() => mutation.mutate(undefined)}>
                <Sparkles className="h-3.5 w-3.5" /> Make v{targetVersion.number} live
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
