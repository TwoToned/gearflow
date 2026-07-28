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
import { SnapshotDiffSummary } from "@/components/projects/snapshot-diff-summary";

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

            <p className="text-sm font-semibold">Changes since this version</p>
            <SnapshotDiffSummary
              projectId={projectId}
              orgId={orgId}
              snapshotId={selected.id}
              emptyLabel="No changes — the project matches this version."
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
