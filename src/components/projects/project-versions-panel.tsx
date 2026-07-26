"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "../../../convex/_generated/api";
import {
  diffSnapshotEntries,
  projectTotalsFromEntry,
  type SnapshotEntryLike,
} from "@/lib/project-snapshot-diff";

/**
 * #792 "Versions" UI — list of whole-project snapshots (CONFIRMED/COMPLETED/
 * UNLOCK), a read-only "as of" summary, and a diff against current (or another
 * version). Renders through simplified read-only rows, not the live editable
 * tab (per #792's spec — deliberately not reusing the equipment tab wholesale).
 */
const REASON_LABEL: Record<string, string> = {
  CONFIRMED: "Confirmed",
  COMPLETED: "Completed",
  UNLOCK: "Unlock session opened",
};

function money(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

interface ProjectVersionsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  orgId: string;
}

export function ProjectVersionsPanel({ open, onOpenChange, projectId, orgId }: ProjectVersionsPanelProps) {
  const snapshots = useQuery(api.projectLocksRead.listSnapshots, open ? { projectId, orgId } : "skip");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const selected = snapshots?.find((s) => s.id === selectedId) ?? null;
  const selectedEntries = useQuery(
    api.projectLocksRead.snapshotEntries,
    selectedId ? { snapshotId: selectedId, orgId } : "skip",
  );
  const currentEntries = useQuery(
    api.projectLocksRead.currentEntries,
    selectedId ? { projectId, orgId } : "skip",
  );

  const diff = React.useMemo(() => {
    if (!selectedEntries || !currentEntries) return null;
    const before = selectedEntries as SnapshotEntryLike[];
    const after = currentEntries as SnapshotEntryLike[];
    return {
      rows: diffSnapshotEntries(before, after),
      before: projectTotalsFromEntry(before.find((e) => e.entityType === "project")),
      after: projectTotalsFromEntry(after.find((e) => e.entityType === "project")),
    };
  }, [selectedEntries, currentEntries]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Versions</DialogTitle>
          <DialogDescription>
            Snapshots captured when this project was confirmed, completed, or unlocked. Compare any version against the current state.
          </DialogDescription>
        </DialogHeader>

        {!selected && (
          <div className="space-y-2">
            {snapshots === undefined && <p className="text-sm text-ink-2">Loading…</p>}
            {snapshots?.length === 0 && <p className="text-sm text-ink-2">No versions yet.</p>}
            {snapshots?.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedId(s.id)}
                className="flex w-full items-center justify-between rounded-[var(--radius)] border-2 border-line px-3.5 py-2.5 text-left hover:border-ink-2"
              >
                <span className="flex items-center gap-2 text-sm">
                  <Badge status="neutral">{REASON_LABEL[s.reason] ?? s.reason}</Badge>
                  {s.statusFrom && s.statusTo && (
                    <span className="text-ink-2">{s.statusFrom} → {s.statusTo}</span>
                  )}
                </span>
                <span className="text-xs text-ink-2">
                  {new Date(s.takenAt).toLocaleString()} · {s.takenByName ?? s.takenBy}
                </span>
              </button>
            ))}
          </div>
        )}

        {selected && (
          <div className="space-y-4">
            <Button variant="line" size="sm" onClick={() => setSelectedId(null)}>
              ← Back to versions
            </Button>

            {diff && (diff.before || diff.after) && (
              <div className="grid grid-cols-3 gap-3 rounded-[var(--radius)] border-2 border-line p-3.5 text-sm">
                <div>
                  <p className="text-xs text-ink-2">Subtotal</p>
                  <p>{money(diff.before?.subtotal ?? null)} → {money(diff.after?.subtotal ?? null)}</p>
                </div>
                <div>
                  <p className="text-xs text-ink-2">Total</p>
                  <p>{money(diff.before?.total ?? null)} → {money(diff.after?.total ?? null)}</p>
                </div>
                <div>
                  <p className="text-xs text-ink-2">Margin</p>
                  <p>{money(diff.before?.margin ?? null)} → {money(diff.after?.margin ?? null)}</p>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <p className="text-sm font-semibold">Changes since this version</p>
              {!diff && <p className="text-sm text-ink-2">Loading…</p>}
              {diff && diff.rows.length === 0 && (
                <p className="text-sm text-ink-2">No changes — the project matches this version.</p>
              )}
              {diff?.rows.map((row) => (
                <div
                  key={`${row.entityType}:${row.entityId}`}
                  className="flex items-center justify-between rounded-[var(--radius)] border border-line px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <Badge
                      status={row.status === "removed" ? "overbooked" : row.status === "added" ? "ok" : "warn"}
                    >
                      {row.status}
                    </Badge>
                    {row.label}
                  </span>
                  {(row.beforePrice != null || row.afterPrice != null) && (
                    <span className="text-ink-2">
                      {money(row.beforePrice)} → {money(row.afterPrice)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
