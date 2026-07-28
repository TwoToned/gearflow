"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { diffSnapshotEntries, type SnapshotEntryLike } from "@/lib/project-snapshot-diff";
import { summarizeDrift, describeDrift } from "@/lib/quote-drift";

interface QuoteDriftIndicatorProps {
  projectId: string;
  orgId: string;
  /** The live (SENT/ACCEPTED) revision's `snapshotId` — null renders nothing. */
  snapshotId: string | null;
  version: number;
  onSeeWhatChanged?: () => void;
}

/**
 * "Changed since v2 was sent" (#989 §6.5) — renders nothing on an untouched
 * project (zero-noise, mirroring `ProjectConflictsBanner`). Gates on the live
 * revision's stored snapshot, not the whole project's snapshot history.
 */
export function QuoteDriftIndicator({ projectId, orgId, snapshotId, version, onSeeWhatChanged }: QuoteDriftIndicatorProps) {
  const snapshotEntries = useQuery(
    api.projectLocksRead.snapshotEntries,
    snapshotId ? { snapshotId, orgId } : "skip",
  );
  const currentEntries = useQuery(
    api.projectLocksRead.currentEntries,
    snapshotId ? { projectId, orgId } : "skip",
  );

  if (!snapshotId || snapshotEntries === undefined || currentEntries === undefined) return null;

  const rows = diffSnapshotEntries(snapshotEntries as SnapshotEntryLike[], currentEntries as SnapshotEntryLike[]);
  const summary = summarizeDrift(rows);
  if (!summary.hasDrift) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border-l-[3px] border-l-warn bg-warn-soft px-3 py-2 text-sm text-warn">
      <span>
        This job no longer matches v{version} — {describeDrift(summary)}.
      </span>
      {onSeeWhatChanged && (
        <button type="button" className="shrink-0 font-semibold underline underline-offset-2" onClick={onSeeWhatChanged}>
          See what changed
        </button>
      )}
    </div>
  );
}
