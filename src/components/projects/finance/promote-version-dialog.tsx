"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useProjectVersionWrites, type PromoteRevisionResult } from "@/hooks/use-project-version-writes";
import type { SnapshotEntryLike } from "@/lib/project-snapshot-diff";
import { formatDate } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PromoteVersionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  orgId: string;
  targetRevision: number;
  targetSnapshotId: string;
  liveRevision: number;
  liveHasSnapshot: boolean;
  onPromoted: (result: PromoteRevisionResult) => void;
}

function isWarehouseBackedEntry(data: Record<string, unknown>): boolean {
  return data.assetId != null || data.bulkAssetId != null || data.kitId != null;
}

function entryLabel(data: Record<string, unknown>, entityId: string): string {
  return (data.description as string | undefined) ?? (data.title as string | undefined) ?? entityId;
}

interface PromoteAnalysis {
  lineItemCount: number;
  groupCount: number;
  serviceCount: number;
  windowChange: { from: [string, string] | null; to: [string, string] | null } | null;
  predictedConflicts: string[];
}

/** Best-effort CLIENT-SIDE preview of what `promoteRevisionNative` will do —
 *  the same `snapshotEntries`/`currentEntries` pair `RepriceFromRevisionDialog`
 *  already uses (design §4.3, "no new read path"). The predicted conflict list
 *  mirrors `isWarehouseBacked` (`convex/lib/projectSnapshots.ts`) so the dialog
 *  states the surprise BEFORE running rather than only after — the real,
 *  authoritative list is whatever the mutation itself returns. */
function analyzePromote(target: SnapshotEntryLike[], current: SnapshotEntryLike[]): PromoteAnalysis {
  const lineItemCount = target.filter((e) => e.entityType === "lineItem").length;
  const groupCount = target.filter((e) => e.entityType === "group").length;
  const serviceCount = target.filter((e) => e.entityType === "service").length;

  const targetProject = target.find((e) => e.entityType === "project")?.data;
  const currentProject = current.find((e) => e.entityType === "project")?.data;
  let windowChange: PromoteAnalysis["windowChange"] = null;
  if (targetProject && currentProject) {
    const before = [currentProject.rentalStartDate, currentProject.rentalEndDate];
    const after = [targetProject.rentalStartDate, targetProject.rentalEndDate];
    if (before[0] !== after[0] || before[1] !== after[1]) {
      windowChange = {
        to: after[0] && after[1] ? [formatDate(new Date(after[0] as number)), formatDate(new Date(after[1] as number))] : null,
        from: before[0] && before[1] ? [formatDate(new Date(before[0] as number)), formatDate(new Date(before[1] as number))] : null,
      };
    }
  }

  const targetLines = new Map(target.filter((e) => e.entityType === "lineItem").map((e) => [e.entityId, e]));
  const currentLines = new Map(current.filter((e) => e.entityType === "lineItem").map((e) => [e.entityId, e]));
  const predictedConflicts: string[] = [];
  for (const [id, entry] of currentLines) {
    if (!targetLines.has(id) && isWarehouseBackedEntry(entry.data)) {
      predictedConflicts.push(`${entryLabel(entry.data, id)} — checked out, won't be removed automatically.`);
    }
  }
  for (const [id, entry] of targetLines) {
    if (!currentLines.has(id) && isWarehouseBackedEntry(entry.data)) {
      predictedConflicts.push(`${entryLabel(entry.data, id)} — references warehouse stock, won't be re-added automatically.`);
    }
  }

  return { lineItemCount, groupCount, serviceCount, windowChange, predictedConflicts };
}

/**
 * The promote confirm dialog (design §4.3, #1080/#1097). States what changes
 * BEFORE it runs, because decision 9 makes this a wide-reaching write — the
 * rental window move in particular reaches outside this project (§5.2).
 *
 * Radix `Dialog` — no `AlertDialog` anywhere in this codebase (CLAUDE.md).
 */
export function PromoteVersionDialog({
  open,
  onOpenChange,
  projectId,
  orgId,
  targetRevision,
  targetSnapshotId,
  liveRevision,
  liveHasSnapshot,
  onPromoted,
}: PromoteVersionDialogProps) {
  const versionWrites = useProjectVersionWrites();
  const [pending, setPending] = useState(false);

  const targetEntries = useAuthedQuery(
    api.projectLocksRead.snapshotEntries,
    open ? { snapshotId: targetSnapshotId, orgId } : "skip",
  );
  const currentEntries = useAuthedQuery(
    api.projectLocksRead.currentEntries,
    open ? { projectId, orgId } : "skip",
  );

  const analysis = useMemo(() => {
    if (!targetEntries || !currentEntries) return null;
    return analyzePromote(targetEntries as SnapshotEntryLike[], currentEntries as SnapshotEntryLike[]);
  }, [targetEntries, currentEntries]);

  async function confirm() {
    setPending(true);
    try {
      const result = await versionWrites.promoteRevision(projectId, targetRevision);
      toast.success(
        result.conflicts.length > 0
          ? `v${targetRevision} is live — ${result.conflicts.length} item(s) need your review`
          : `v${targetRevision} is live`,
      );
      onPromoted(result);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to promote this version");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Make v{targetRevision} live?</DialogTitle>
          <DialogDescription>
            Rolls the project back to v{targetRevision}&rsquo;s captured state. This is a Convex transaction —
            either everything below happens, or nothing does.
          </DialogDescription>
        </DialogHeader>

        {!analysis ? (
          <p className="t-micro text-fg-4">Checking what will change…</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div>
              <p className="font-semibold text-fg">Rolled back to v{targetRevision}</p>
              <ul className="ml-4 list-disc space-y-0.5 text-fg-4">
                <li>
                  {analysis.lineItemCount} line item{analysis.lineItemCount === 1 ? "" : "s"}, {analysis.groupCount} group
                  {analysis.groupCount === 1 ? "" : "s"}, {analysis.serviceCount} service{analysis.serviceCount === 1 ? "" : "s"}
                </li>
                <li>All prices, discounts and tax</li>
                {analysis.windowChange && (
                  <li>
                    Rental window
                    {analysis.windowChange.to ? ` → ${analysis.windowChange.to[0]}–${analysis.windowChange.to[1]}` : " → not set"}
                    {analysis.windowChange.from ? ` (currently ${analysis.windowChange.from[0]}–${analysis.windowChange.from[1]})` : ""}
                  </li>
                )}
                <li>Client contact, venue, delivery address</li>
              </ul>
            </div>

            <div>
              <p className="font-semibold text-fg">Kept as-is</p>
              <ul className="ml-4 list-disc space-y-0.5 text-fg-4">
                <li>Project status, warehouse state, tasks, notes, files</li>
                <li>Anything already invoiced</li>
              </ul>
            </div>

            {analysis.predictedConflicts.length > 0 && (
              <div>
                <p className="flex items-center gap-1.5 font-semibold text-warn">
                  <AlertTriangle className="h-3.5 w-3.5" /> Needs your review after
                </p>
                <ul className="ml-4 list-disc space-y-0.5 text-fg-4">
                  {analysis.predictedConflicts.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Only shown when the outgoing live revision has already been sent
                (has a snapshot) — a fresh, never-sent draft is captured onto its
                OWN revision number instead (no new row appears in the list), and
                a byte-identical sent revision is skipped entirely (§3.4). */}
            {liveHasSnapshot && (
              <p className="t-micro text-fg-4">
                If v{liveRevision} has changed since it was sent, your current state will be saved as a new version
                first — nothing is ever silently overwritten.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="line" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" loading={pending} onClick={() => void confirm()}>
            Make v{targetRevision} live
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
