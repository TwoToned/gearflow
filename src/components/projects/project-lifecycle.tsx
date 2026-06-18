"use client";

import * as React from "react";
import { Check, ArrowRight, Loader2, Ban } from "lucide-react";
import { format } from "date-fns";
import { cn, focusRing, disabledState } from "@/lib/utils";

/**
 * ProjectLifecycle — the RVLT job lifecycle as a hero stage bar.
 *
 * Six stages (Enquiry → Quote → Confirmed → Prep → On site → Return) rendered as
 * interlocking chevron segments. Completed stages fill red-soft with a check, the
 * current stage fills solid --red (§1 "live/active"), upcoming stages stay muted.
 * The current sub-status and the schedule date for each stage are surfaced, and an
 * "Advance" affordance moves the project to the next stage via the existing mutation.
 *
 * Pattern sources: monday.com Deal stages, Salesforce path, Pipedrive stage bar —
 * re-rendered in the RVLT language (hard offset, 2px outline, single red accent).
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

// First status of each stage — what "Advance" sets when moving INTO that stage.
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

const ARROW = 16; // px depth of the chevron notch/point

function fmtDate(d?: Date | null) {
  return d && !isNaN(d.getTime()) ? format(d, "EEE d MMM") : null;
}

export function ProjectLifecycle({
  status,
  dateByStage,
  onAdvance,
  advancing = false,
  canAdvance = true,
  className,
}: {
  status: string;
  /** Optional schedule date to annotate under a stage (e.g. prep→load-in). */
  dateByStage?: Partial<Record<LifecycleStageKey, Date | null>>;
  onAdvance?: (nextStatus: string) => void;
  advancing?: boolean;
  canAdvance?: boolean;
  className?: string;
}) {
  const cancelled = status === "CANCELLED";
  const currentIdx = cancelled ? -1 : stageIndexForStatus(status);
  const nextStage = currentIdx >= 0 && currentIdx < STAGES.length - 1 ? STAGES[currentIdx + 1] : null;
  const subStatus = SUB_STATUS_LABEL[status] ?? status;
  const currentStageLabel = currentIdx >= 0 ? STAGES[currentIdx].label : null;
  // Only show the sub-status chip when it adds info beyond the stage name.
  const showSub = currentStageLabel && subStatus.toLowerCase() !== currentStageLabel.toLowerCase();

  return (
    <section
      className={cn(
        "rounded-[var(--r-lg)] border-2 border-line bg-card p-3 shadow-[var(--sh-card)] sm:p-4",
        cancelled && "opacity-90",
        className,
      )}
      aria-label="Project lifecycle"
    >
      {cancelled ? (
        <div className="flex items-center gap-2.5 px-1 py-1.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-out-soft text-t-out">
            <Ban className="h-4 w-4" />
          </span>
          <div>
            <p className="text-ui-text font-semibold text-ink">Cancelled</p>
            <p className="t-micro text-muted">This job is off the pipeline. Reactivate it from the status menu to resume.</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* Chevron stage bar */}
          <ol className="flex min-w-0 flex-1 overflow-x-auto" role="list">
            {STAGES.map((s, i) => {
              const state = i < currentIdx ? "done" : i === currentIdx ? "current" : "upcoming";
              const isFirst = i === 0;
              const isLast = i === STAGES.length - 1;
              const clip = isFirst
                ? `polygon(0 0, calc(100% - ${ARROW}px) 0, 100% 50%, calc(100% - ${ARROW}px) 100%, 0 100%)`
                : isLast
                  ? `polygon(0 0, 100% 0, 100% 100%, 0 100%, ${ARROW}px 50%)`
                  : `polygon(0 0, calc(100% - ${ARROW}px) 0, 100% 50%, calc(100% - ${ARROW}px) 100%, 0 100%, ${ARROW}px 50%)`;
              const stageDate = fmtDate(dateByStage?.[s.key]);
              return (
                <li
                  key={s.key}
                  className={cn(
                    "relative flex min-w-[92px] flex-1 flex-col items-center justify-center gap-0.5 py-2 transition-colors",
                    !isFirst && "-ml-[10px]",
                    state === "done" && "bg-red-soft text-red",
                    state === "current" && "bg-red text-white shadow-[var(--sh-stk)]",
                    state === "upcoming" && "bg-paper-2 text-faint",
                  )}
                  style={{ clipPath: clip, paddingLeft: isFirst ? 12 : ARROW + 8, paddingRight: isLast ? 12 : ARROW + 8, zIndex: state === "current" ? STAGES.length + 1 : STAGES.length - i }}
                  aria-current={state === "current" ? "step" : undefined}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold leading-none",
                        state === "done" && "bg-red text-white",
                        state === "current" && "bg-white text-red",
                        state === "upcoming" && "border border-faint/50 text-faint",
                      )}
                    >
                      {state === "done" ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : i + 1}
                    </span>
                    <span className={cn("truncate text-caption font-semibold", state === "current" && "text-white")}>
                      {s.label}
                    </span>
                  </span>
                  {stageDate && (
                    <span className={cn("truncate text-[10px] leading-none", state === "current" ? "text-white/80" : "text-muted")}>
                      {stageDate}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>

          {/* Current sub-status + advance */}
          <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end sm:gap-1.5">
            {showSub && (
              <span className="inline-flex items-center rounded-full bg-red-soft px-2.5 py-0.5 text-caption font-semibold text-red">
                {subStatus}
              </span>
            )}
            {nextStage && onAdvance && canAdvance && (
              <button
                type="button"
                onClick={() => onAdvance(STAGE_ENTRY_STATUS[nextStage.key])}
                disabled={advancing}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-[var(--r)] border-2 border-red bg-red px-3 py-1.5 text-caption font-semibold text-white transition-[transform,box-shadow] shadow-[var(--sh-stk)]",
                  "motion-safe:active:scale-[0.97] hover:shadow-[var(--sh-halo)]",
                  focusRing, disabledState,
                )}
              >
                {advancing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                Advance to {nextStage.label.toLowerCase()}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
