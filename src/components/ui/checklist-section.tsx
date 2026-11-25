"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";

import { cn, focusRing } from "@/lib/utils";

/**
 * `ChecklistSection` (UX Phase 12, §9d.6): a verdict, the things that are not clear as
 * rows each with ONE right-hand action, and the clear ones as one muted line. Purely
 * presentational: the caller derives the rows (the asset page feeds it `assetHealth()`),
 * so there is exactly one rule and this renders it. The job's readiness list keeps its
 * own section (Phase 7's file); both read the same dot grammar.
 */
export type ChecklistSeverity = "blocking" | "warning" | "pass" | "unknown";

export interface ChecklistRow {
  id: string;
  severity: ChecklistSeverity;
  title: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
}

const DOT: Record<ChecklistSeverity, string> = {
  blocking: "bg-action-red",
  warning: "bg-warn",
  unknown: "border-[1.5px] border-dashed border-muted",
  pass: "bg-ok",
};

const TONE: Record<ChecklistSeverity | "clear", string> = {
  blocking: "text-t-out",
  warning: "text-ink",
  unknown: "text-ink",
  pass: "text-ok",
  clear: "text-ok",
};

export function ChecklistSection({
  headline,
  tone,
  summary,
  rows,
  className,
}: {
  headline: string;
  tone: ChecklistSeverity | "clear";
  /** `4 of 6 checks clear`. */
  summary: string;
  rows: ChecklistRow[];
  className?: string;
}) {
  const open = rows.filter((r) => r.severity !== "pass");
  const clear = rows.filter((r) => r.severity === "pass");
  return (
    <section aria-label="Health" className={className}>
      <h2 className={cn("font-display text-section-title font-bold", TONE[tone])}>{headline}</h2>
      <p className="mt-0.5 text-caption text-muted">{summary}</p>
      {open.length > 0 ? (
        <ul className="mt-3">
          {open.map((r) => (
            <li key={r.id} className="border-t border-line">
              <button
                type="button"
                disabled={!r.onAction}
                onClick={r.onAction}
                className={cn("flex min-h-11 w-full items-center gap-3 py-2 text-left text-table-cell text-ink md:min-h-9", focusRing)}
              >
                <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", DOT[r.severity])} />
                <span className="min-w-0 flex-1">
                  {r.title}
                  {r.detail ? <span className="text-muted"> · {r.detail}</span> : null}
                </span>
                {r.actionLabel ? (
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-caption text-muted">
                    {r.actionLabel}
                    <ChevronRight className="size-3" aria-hidden="true" />
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {clear.length > 0 ? <p className="mt-2 border-t border-line pt-2 text-caption text-muted">{clear.map((r) => r.title).join(" · ")}</p> : null}
    </section>
  );
}
