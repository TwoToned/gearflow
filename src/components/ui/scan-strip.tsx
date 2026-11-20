"use client";

import * as React from "react";
import { CheckCircle2, AlertTriangle, XCircle, CloudOff, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * One scan result on the strip (spec §5.7, §9.4). Presentational: the single
 * scan pipeline (Phase 3) decides tone, text and which of `undo` / `action`
 * apply, once, and hands them in here.
 */
export interface ScanStripEntry {
  id: string;
  /**
   * success · warning (needs a check) · error (not on this job) · neutral
   * (saved on device · syncing) · info (a look-up result: nothing was written,
   * nothing is wrong, e.g. `SK-0012 · packed for #2341`).
   */
  tone: "success" | "warning" | "error" | "neutral" | "info";
  text: string;
  /** Muted secondary text, e.g. a relative time or serial. */
  detail?: string;
  /**
   * Success only, when reversible. Pass `AnnouncedWrite.scanUndo` from
   * `announceWarehouseWrite` UNCHANGED: it is the exact guarded closure the
   * toast's own Undo calls (CLAUDE.md "A second UI surface reuses the exact
   * reverse trigger"). The strip adds no second guard and never re-derives a
   * reverse mutation. Omit once the toast window has passed.
   */
  undo?: () => void | Promise<void>;
  /** Warning → `Run check`; error → `Add & prep`. */
  action?: { label: string; onSelect: () => void | Promise<void> };
  /**
   * Extra controls at the row's end, after Undo / action: an `Open` link, or an
   * `Outcome ▾` built with ActionMenu's `trigger`. The surface owns them.
   */
  trailing?: React.ReactNode;
}

const TONE: Record<ScanStripEntry["tone"], { Icon: typeof CheckCircle2; className: string }> = {
  success: { Icon: CheckCircle2, className: "text-ok" },
  warning: { Icon: AlertTriangle, className: "text-warn" },
  error: { Icon: XCircle, className: "text-t-out" },
  neutral: { Icon: CloudOff, className: "text-muted" },
  info: { Icon: Info, className: "text-info" },
};

/** The last scans, newest first. Collapses to nothing when empty. */
export function ScanStrip({
  entries,
  className,
}: {
  entries: ScanStripEntry[];
  className?: string;
}) {
  if (entries.length === 0) return null;
  return (
    <ul
      aria-label="Recent scans"
      aria-live="polite"
      className={cn("flex flex-col gap-1", className)}
    >
      {entries.map((e) => {
        const { Icon, className: tone } = TONE[e.tone];
        return (
          <li
            key={e.id}
            data-tone={e.tone}
            className="flex min-h-11 items-center gap-2 rounded-[var(--r)] border border-line px-3 text-ui-text"
          >
            <Icon aria-hidden="true" className={cn("h-4 w-4 shrink-0", tone)} />
            <span className="min-w-0 flex-1 truncate text-ink">{e.text}</span>
            {e.detail ? <span className="shrink-0 text-caption text-muted">{e.detail}</span> : null}
            {e.undo ? (
              <Button size="sm" variant="ghost" onClick={() => void e.undo?.()}>
                Undo
              </Button>
            ) : null}
            {e.action ? (
              <Button size="sm" variant="ghost" onClick={() => void e.action?.onSelect()}>
                {e.action.label}
              </Button>
            ) : null}
            {e.trailing}
          </li>
        );
      })}
    </ul>
  );
}
