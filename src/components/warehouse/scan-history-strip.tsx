"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Info } from "lucide-react";
import { timeAgo } from "@/lib/collaboration-colors";
import { focusRing } from "@/lib/utils";
import type { ScanFeedbackKind } from "@/lib/scan-feedback";
import type { ScanHistoryRecord } from "@/hooks/use-scan-feedback";

/** The window an Undo action stays live on the strip — matches the toast's
 *  own duration (`UNDO_TOAST_DURATION_MS` in `warehouse-undo-toast.ts`) so
 *  the two surfaces never disagree about whether an undo is still offered. */
const UNDO_WINDOW_MS = 10_000;

/** Relative time and the Undo window both change without a re-render firing
 *  on their own — recompute both on a 10s tick rather than per render. */
const TICK_MS = 10_000;

/** Verdict glyph + text intent, kept literal per the design doc (not
 *  `status-colors.ts`'s generic intent map — `exception` reads as a warning
 *  here, and `info` is deliberately muted rather than the info-blue used
 *  elsewhere in the app). */
const KIND_GLYPH: Record<ScanFeedbackKind, { Icon: typeof CheckCircle2; className: string }> = {
  success: { Icon: CheckCircle2, className: "text-ok" },
  exception: { Icon: AlertTriangle, className: "text-warn" },
  error: { Icon: XCircle, className: "text-t-out" },
  info: { Icon: Info, className: "text-muted" },
};

/**
 * Reverse-chronological strip of the last five scan verdicts (#1223, D6 — an
 * in-memory, per-session working-memory aid, not a log; the activity log is
 * the log). Renders above the scan input on every scan surface. Collapses to
 * nothing when there's nothing to show — a scan input is its own call to
 * action, it doesn't need an empty placeholder above it.
 *
 * See FEATUREDOCS/12 (Scan Feedback) and the design doc's item 6 UI spec.
 */
export function ScanHistoryStrip({ entries }: { entries: ScanHistoryRecord[] }) {
  const [expanded, setExpanded] = useState(false);
  // Re-derived every TICK_MS so relative time + the Undo window age out even
  // if nothing else changes the page — `now` lives in state rather than a
  // bare `Date.now()` call in the render body, which React treats as impure.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  if (entries.length === 0) return null;

  return (
    <div className="mb-2">
      <p className="t-micro text-muted px-1 pb-1 uppercase tracking-wide">Recent</p>
      <div aria-live="polite" aria-atomic="false" className="flex flex-col gap-1">
        {entries.map((entry, i) => {
          const { Icon, className } = KIND_GLYPH[entry.kind];
          const showUndo = !!entry.undo && now - entry.at < UNDO_WINDOW_MS;
          // Rows 3-5 collapse to a "Show all" expander on mobile (§15 — a
          // phone can't fit 5 rows + the scan input + tab chrome above the
          // fold); desktop (sm+) always shows all five.
          const mobileHidden = i >= 2 && !expanded;
          return (
            <div
              key={`${entry.at}-${i}`}
              className={`flex min-h-11 items-center gap-2 rounded-[var(--r)] bg-paper-2/40 px-3 py-2 ${
                mobileHidden ? "hidden sm:flex" : "flex"
              }`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${className}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="truncate font-medium text-ui-text text-ink">{entry.label}</span>
                  <span className="text-caption text-muted">{entry.outcome}</span>
                </div>
              </div>
              <span className="t-micro text-muted shrink-0 tabular-nums">{timeAgo(entry.at)}</span>
              {showUndo && entry.undo && (
                <button
                  type="button"
                  onClick={() => void entry.undo?.run()}
                  className={`t-micro shrink-0 rounded-[var(--r)] px-2 py-1 font-semibold text-red hover:bg-red-soft ${focusRing}`}
                >
                  {entry.undo.label}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {entries.length > 2 && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className={`t-micro mt-1 px-1 text-muted underline sm:hidden ${focusRing}`}
        >
          {expanded ? "Show less" : "Show all"}
        </button>
      )}
    </div>
  );
}
