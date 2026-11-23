"use client";

import { useEffect, useState } from "react";
import { useConvex } from "convex/react";
import { AlertTriangle, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useProjectVersionWrites, type MakeLiveResult } from "@/hooks/use-project-version-writes";
import { useActiveOrganization } from "@/lib/auth-client";
import { announceListWrite } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";
import { makeLivePreviewRows, type MakeLivePreview } from "@/lib/versions-tab";
import type { ProjectVersionSummary } from "@/components/projects/project-version-context";
import { api } from "../../../../convex/_generated/api";

/**
 * Make live (Project Versioning v2 design §5.5, restyled by UX Phase 8,
 * §7b.4). A pointer flip (`versions.makeLiveNative`), never a restore:
 * nothing is deleted, so the dialog says what FOLLOWS before it runs, in calm
 * rows (Warehouse / Availability / Invoices) from the counts-only
 * `versionsPreview.makeLivePreview`, and after it runs lists what needs a
 * human look (the conflicts the mutation LISTS, never blocks on, §4.4/D6).
 *
 * The preview is advisory and fails OPEN: a slow, failed or empty read shows
 * the static copy and the confirm button still works (playbook §3.6). It is a
 * one-shot read, so it never re-subscribes.
 *
 * Undo (only when `conflicts.length === 0`): `makeLiveNative(previous)` with
 * `expectLiveVersionId` = the version this call made live. The SERVER refuses
 * (`VERSION_LIVE_MOVED`) if the pointer has moved since; the client never
 * supplies prior values. With conflicts nothing offers Undo: physical work has
 * been carried and the flip is no longer an exact inverse.
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

/** One-shot, fail-open read: `null` while loading or when it failed (both show the static copy). */
function useMakeLivePreview(projectId: string, versionId: string): MakeLivePreview | null {
  const convex = useConvex();
  const { data: activeOrg } = useActiveOrganization();
  const organizationId = activeOrg?.id;
  const [preview, setPreview] = useState<MakeLivePreview | null>(null);
  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    convex
      .query(api.versionsPreview.makeLivePreview, { organizationId, projectId, versionId })
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [convex, organizationId, projectId, versionId]);
  return preview;
}

function PreviewRows({ preview, target }: { preview: MakeLivePreview | null; target: ProjectVersionSummary }) {
  if (!preview) {
    return (
      <p className="text-caption text-muted">
        Checked-out gear, invoices and paperwork carry over by lineage. The warehouse, availability and any future document will follow v
        {target.number} from now on.
      </p>
    );
  }
  return (
    <dl className="divide-y divide-line text-table-cell">
      {makeLivePreviewRows(preview).map((r) => (
        <div key={r.label} className="grid grid-cols-[6.5rem_1fr] gap-3 py-2 first:pt-0">
          <dt className="font-medium text-ink">{r.label}</dt>
          <dd className="text-ink-2">{r.text}</dd>
        </div>
      ))}
      {preview.truncated ? <p className="pt-2 text-caption text-muted">This job is large, so these counts are partial.</p> : null}
    </dl>
  );
}

export function MakeLiveDialog({ open, onOpenChange, targetVersion, liveVersion, projectId, onMadeLive }: MakeLiveDialogProps) {
  const { makeLive } = useProjectVersionWrites(projectId);
  const [result, setResult] = useState<MakeLiveResult | null>(null);
  const preview = useMakeLivePreview(projectId, targetVersion.id);

  const mutation = useServerMutation({
    mutationFn: () => makeLive(targetVersion.id),
    onSuccess: (r) => {
      setResult(r);
      onMadeLive(r);
      if (r.conflicts.length > 0) return;
      announceListWrite({
        title: `v${targetVersion.number} is live`,
        undoneTitle: liveVersion ? `v${liveVersion.number} is live again` : "Undone",
        performUndo: async () => {
          await makeLive(r.previousLiveVersionId, { expectLiveVersionId: r.liveVersionId });
        },
      });
      onOpenChange(false);
    },
    onError: (e: Error) => showError(e, { fallbackTitle: "Couldn't make it live" }),
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
            {liveVersion ? `v${liveVersion.number} stays saved — nothing is deleted.` : "Nothing is deleted."} This sends nothing to the
            client.
          </DialogDescription>
        </DialogHeader>

        {result ? <ConflictsList conflicts={result.conflicts} /> : <PreviewRows preview={preview} target={targetVersion} />}

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
