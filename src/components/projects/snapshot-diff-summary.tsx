"use client";

import { useQuery } from "convex/react";
import { Badge } from "@/components/ui/badge";
import { api } from "../../../convex/_generated/api";
import {
  diffSnapshotEntries,
  projectTotalsFromEntry,
  type DiffRow,
  type FinancialTotals,
  type SnapshotEntryLike,
} from "@/lib/project-snapshot-diff";

/**
 * Shared "snapshot vs. current" diff rendering — the totals delta + per-row
 * added/removed/changed list. Originally inline in `project-versions-panel.tsx`
 * (#792); factored out (#990) so the unlock-session Save & relock / Discard
 * confirmation ("committing blind is the one thing that turns an audit trail
 * into noise", finance-workflow-ux.md §7.2) reuses the SAME rendering instead
 * of a second hand-built diff view (POLICY.md R-3.1). Both callers already
 * shared the diff logic itself (`src/lib/project-snapshot-diff.ts`); this
 * closes the gap for the presentation too.
 */
function money(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

interface SnapshotDiffSummaryProps {
  projectId: string;
  orgId: string;
  snapshotId: string;
  emptyLabel?: string;
}

function TotalsGrid({ before, after }: { before: FinancialTotals | null; after: FinancialTotals | null }) {
  if (!before && !after) return null;
  return (
    <div className="grid grid-cols-1 gap-3 rounded-[var(--radius)] border-2 border-line p-3.5 text-sm sm:grid-cols-3">
      <div>
        <p className="text-xs text-ink-2">Subtotal</p>
        <p>{money(before?.subtotal ?? null)} → {money(after?.subtotal ?? null)}</p>
      </div>
      <div>
        <p className="text-xs text-ink-2">Total</p>
        <p>{money(before?.total ?? null)} → {money(after?.total ?? null)}</p>
      </div>
      <div>
        <p className="text-xs text-ink-2">Margin</p>
        <p>{money(before?.margin ?? null)} → {money(after?.margin ?? null)}</p>
      </div>
    </div>
  );
}

const DIFF_BADGE_STATUS = { removed: "overbooked", added: "ok", changed: "warn" } as const;

function DiffRowItem({ row }: { row: DiffRow }) {
  return (
    <div className="flex items-center justify-between rounded-[var(--radius)] border border-line px-3 py-2 text-sm">
      <span className="flex items-center gap-2">
        <Badge status={DIFF_BADGE_STATUS[row.status]}>{row.status}</Badge>
        {row.label}
      </span>
      {(row.beforePrice != null || row.afterPrice != null) && (
        <span className="text-ink-2">
          {money(row.beforePrice)} → {money(row.afterPrice)}
        </span>
      )}
    </div>
  );
}

export function SnapshotDiffSummary({ projectId, orgId, snapshotId, emptyLabel }: SnapshotDiffSummaryProps) {
  const before = useQuery(api.projectLocksRead.snapshotEntries, { snapshotId, orgId });
  const after = useQuery(api.projectLocksRead.currentEntries, { projectId, orgId });

  if (before === undefined || after === undefined) {
    return <p className="text-sm text-ink-2">Loading changes…</p>;
  }

  const beforeEntries = before as SnapshotEntryLike[];
  const afterEntries = after as SnapshotEntryLike[];
  const rows = diffSnapshotEntries(beforeEntries, afterEntries);
  const beforeTotals = projectTotalsFromEntry(beforeEntries.find((e) => e.entityType === "project"));
  const afterTotals = projectTotalsFromEntry(afterEntries.find((e) => e.entityType === "project"));

  return (
    <div className="space-y-3">
      <TotalsGrid before={beforeTotals} after={afterTotals} />
      {rows.length === 0 ? (
        <p className="text-sm text-ink-2">{emptyLabel ?? "No changes."}</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((row) => (
            <DiffRowItem key={`${row.entityType}:${row.entityId}`} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
