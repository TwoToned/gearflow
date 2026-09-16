"use client";
// use-client: interactive — renders a click target inside the send dialog (R-8.1.1)

import { Check } from "lucide-react";

import { projectStatusLabels } from "@/lib/status-labels";

/**
 * #1160 — the post-send status line. Two mutually exclusive states: when the
 * automation ran, this is a statement of fact with no decision attached (asking
 * about something already done is just noise); when the org opted out of the
 * "Quote sent" rule, it stays the passive offer this dialog has always shown.
 */
export function SendQuoteStatusNotice({
  sent,
  projectStatus,
  statusMoved,
  onMoveStatus,
}: {
  sent: { autoStatusChange: "QUOTED" | null; offerStatusChange: string | null };
  projectStatus?: string | null;
  statusMoved: boolean;
  onMoveStatus: () => void;
}) {
  if (sent.autoStatusChange) {
    return (
      <p className="flex items-center gap-2 rounded-[var(--radius)] border border-line px-3 py-2 text-sm text-muted">
        <Check className="h-3.5 w-3.5 shrink-0 text-ok" aria-hidden />
        Job moved to {projectStatusLabels[sent.autoStatusChange] ?? sent.autoStatusChange}.
      </p>
    );
  }
  if (!sent.offerStatusChange || statusMoved || projectStatus === sent.offerStatusChange) return null;
  return (
    <p className="rounded-[var(--radius)] border border-line px-3 py-2 text-sm">
      This job is at {projectStatusLabels[projectStatus ?? ""] ?? projectStatus}. Move it to{" "}
      {projectStatusLabels[sent.offerStatusChange] ?? sent.offerStatusChange}?{" "}
      <button type="button" className="font-semibold underline underline-offset-2" onClick={onMoveStatus}>
        Move
      </button>
    </p>
  );
}
