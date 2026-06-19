"use client";

import * as React from "react";
import { Check, ArrowRight, Loader2, Ban } from "lucide-react";
import { cn, focusRing, disabledState } from "@/lib/utils";

/**
 * ProjectLifecycle — the RVLT job lifecycle as a hero stepper.
 *
 * Circular-node stepper (Enquiry → Quote → Confirmed → Prep → On site → Return)
 * matching the RVLT design-language lifecycle component:
 *   - completed stages: solid --ink filled node + white check
 *   - current stage: --card node with a 2px red ring + red number, bold label
 *   - upcoming stages: outlined (--line) node + muted number
 *   - connectors: ink before the current node, red on the active edge (current→next),
 *     muted --line after
 * A green "now" pill (top-right) names the live sub-status; an "Advance" affordance
 * moves to the next stage via the existing status mutation.
 */

export type LifecycleStageKey =
  | "enquiry" | "quote" | "confirmed" | "prep" | "onsite" | "return";

const STAGES: { key: LifecycleStageKey; label: string; statuses: string[] }[] = [
  { key: "enquiry", label: "Enquiry", statuses: ["ENQUIRY"] },
  { key: "quote", label: "Quote", statuses: ["QUOTING", "QUOTED"] },
  { key: "confirmed", label: "Confirmed", statuses: ["CONFIRMED"] },
  { key: "prep", label: "Prep", statuses: ["PREPPING"] },
  { key: "onsite", label: "On site", statuses: ["CHECKED_OUT", "ON_SITE"] },
  { key: "return", label: "Return", statuses: ["RETURNED", "COMPLETED", "INVOICED"] },
];

const STAGE_ENTRY_STATUS: Record<LifecycleStageKey, string> = {
  enquiry: "ENQUIRY", quote: "QUOTING", confirmed: "CONFIRMED",
  prep: "PREPPING", onsite: "CHECKED_OUT", return: "RETURNED",
};

const SUB_STATUS_LABEL: Record<string, string> = {
  ENQUIRY: "Enquiry", QUOTING: "Quoting", QUOTED: "Quoted", CONFIRMED: "Confirmed",
  PREPPING: "Prepping", CHECKED_OUT: "Deployed", ON_SITE: "On site",
  RETURNED: "Returned", COMPLETED: "Completed", INVOICED: "Invoiced", CANCELLED: "Cancelled",
};

function stageIndexForStatus(status: string): number {
  return STAGES.findIndex((s) => s.statuses.includes(status));
}

/** Connector j sits between node j and node j+1. */
function connectorClass(j: number, currentIdx: number): string {
  if (j < currentIdx) return "bg-ink";
  if (j === currentIdx) return "bg-red";
  return "bg-line";
}

export function ProjectLifecycle({
  status,
  onAdvance,
  advancing = false,
  canAdvance = true,
  className,
}: {
  status: string;
  onAdvance?: (nextStatus: string) => void;
  advancing?: boolean;
  canAdvance?: boolean;
  className?: string;
}) {
  const cancelled = status === "CANCELLED";
  const currentIdx = cancelled ? -1 : stageIndexForStatus(status);
  const nextStage = currentIdx >= 0 && currentIdx < STAGES.length - 1 ? STAGES[currentIdx + 1] : null;
  const subStatus = SUB_STATUS_LABEL[status] ?? status;
  const live = status === "ON_SITE" || status === "CHECKED_OUT";

  return (
    <section
      className={cn(
        "rounded-[var(--r-lg)] border-2 border-line bg-card p-4 shadow-[var(--sh-card)] sm:px-6 sm:py-5",
        className,
      )}
      aria-label="Project lifecycle"
    >
      {/* Top row: position pill + advance */}
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-line pb-3">
        <p className="t-overline text-faint">Lifecycle</p>
        <div className="flex items-center gap-2">
          {!cancelled ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-soft px-2.5 py-0.5 text-caption font-semibold text-ok">
              <span className={cn("size-1.5 rounded-full bg-ok", live && "motion-safe:animate-pulse")} aria-hidden />
              {subStatus}{live ? " now" : ""}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-out-soft px-2.5 py-0.5 text-caption font-semibold text-t-out">
              <Ban className="h-3 w-3" /> Cancelled
            </span>
          )}
          {!cancelled && nextStage && onAdvance && canAdvance && (
            <button
              type="button"
              onClick={() => onAdvance(STAGE_ENTRY_STATUS[nextStage.key])}
              disabled={advancing}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-[var(--r)] border-2 border-line bg-paper-2 px-3 py-1 text-caption font-semibold text-ink-2 transition-colors hover:border-red hover:text-ink",
                focusRing, disabledState,
              )}
            >
              {advancing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
              Advance
            </button>
          )}
        </div>
      </div>

      {cancelled ? (
        <p className="px-1 pb-1 t-micro text-muted">
          This job is off the pipeline. Reactivate it from the status menu to resume.
        </p>
      ) : (
        <ol className="flex items-start" role="list">
          {STAGES.map((s, i) => {
            const state = i < currentIdx ? "done" : i === currentIdx ? "current" : "upcoming";
            const isFirst = i === 0;
            const isLast = i === STAGES.length - 1;
            return (
              <li key={s.key} className="flex flex-1 flex-col items-center gap-2">
                {/* node + connectors */}
                <div className="flex w-full items-center">
                  <span className={cn("h-[2px] flex-1 rounded-full", isFirst ? "opacity-0" : connectorClass(i - 1, currentIdx))} aria-hidden />
                  <span
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-full text-ui-text font-bold transition-colors",
                      state === "done" && "bg-ink text-paper",
                      state === "current" && "border-2 border-red bg-card text-red",
                      state === "upcoming" && "border-2 border-line bg-card text-faint",
                    )}
                    aria-current={state === "current" ? "step" : undefined}
                  >
                    {state === "done" ? <Check className="h-4 w-4" strokeWidth={3} /> : i + 1}
                  </span>
                  <span className={cn("h-[2px] flex-1 rounded-full", isLast ? "opacity-0" : connectorClass(i, currentIdx))} aria-hidden />
                </div>
                {/* label */}
                <span
                  className={cn(
                    "text-center text-caption",
                    state === "current" ? "font-semibold text-ink" : state === "done" ? "text-muted" : "text-faint",
                  )}
                >
                  {s.label}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
