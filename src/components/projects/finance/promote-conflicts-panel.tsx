"use client";

import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PromoteRevisionResult } from "@/hooks/use-project-version-writes";

interface PromoteConflictsPanelProps {
  result: PromoteRevisionResult | null;
  onDismiss: () => void;
}

/**
 * Post-promote conflicts (design §4.3) — a PERSISTENT panel, not a toast: a
 * warehouse-backed item a promote couldn't reconcile automatically is a work
 * list, and a toast that scrolls away is how warehouse desync happens
 * quietly. Stays mounted until explicitly dismissed.
 */
export function PromoteConflictsPanel({ result, onDismiss }: PromoteConflictsPanelProps) {
  if (!result || result.conflicts.length === 0) return null;

  return (
    <div role="alert" className="space-y-2 rounded-[var(--r)] border border-warn/40 bg-warn/5 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 font-semibold text-warn">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {` v${result.liveRevision} is live — ${result.conflicts.length} item${result.conflicts.length === 1 ? "" : "s"} ${result.conflicts.length === 1 ? "needs" : "need"} your review`}
        </p>
        <Button type="button" variant="line" size="sm" aria-label="Dismiss" onClick={onDismiss}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <ul className="ml-5 list-disc space-y-0.5 text-sm text-fg-4">
        {result.conflicts.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      {result.autoSavedRevision != null && (
        <p className="t-micro text-fg-4">Your prior state was saved as v{result.autoSavedRevision} before promoting.</p>
      )}
    </div>
  );
}
