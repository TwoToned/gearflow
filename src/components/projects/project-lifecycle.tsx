"use client";

import * as React from "react";
import { Check, ArrowRight, Loader2, MoreHorizontal } from "lucide-react";
import { cn, focusRing, disabledState } from "@/lib/utils";
import { fireConfettiFromElement } from "@/lib/confetti";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * ProjectLifecycle — the RVLT job lifecycle as a hero stepper.
 *
 * Circular-node stepper (Enquiry → Quote → Confirmed → Prep → On site → Return →
 * Completed) matching the RVLT design-language lifecycle component:
 *   - completed stages: solid --ink filled node + white check
 *   - current stage: --card node with a 2px red ring + red number, bold label
 *   - upcoming stages: outlined (--line) node + muted number
 *   - connectors: ink before the current node, red on the active edge (current→next),
 *     muted --line after
 *
 * Chrome-free: the page places this block inside the hero card. Controls sit at the
 * right end of the row — an "Advance to {next}" button plus a `⋯` menu that is the
 * full status picker (also the reactivate affordance when cancelled).
 */

export type LifecycleStageKey =
  | "enquiry" | "quote" | "confirmed" | "prep" | "onsite" | "return" | "completed";

const STAGES: { key: LifecycleStageKey; label: string; statuses: string[] }[] = [
  { key: "enquiry", label: "Enquiry", statuses: ["ENQUIRY"] },
  { key: "quote", label: "Quote", statuses: ["QUOTING", "QUOTED"] },
  { key: "confirmed", label: "Confirmed", statuses: ["CONFIRMED"] },
  { key: "prep", label: "Prep", statuses: ["PREPPING"] },
  { key: "onsite", label: "On site", statuses: ["CHECKED_OUT", "ON_SITE"] },
  { key: "return", label: "Return", statuses: ["RETURNED"] },
  { key: "completed", label: "Completed", statuses: ["COMPLETED", "INVOICED"] },
];

const STAGE_ENTRY_STATUS: Record<LifecycleStageKey, string> = {
  enquiry: "ENQUIRY", quote: "QUOTING", confirmed: "CONFIRMED",
  prep: "PREPPING", onsite: "CHECKED_OUT", return: "RETURNED",
  completed: "COMPLETED",
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
  statuses,
  onStatusChange,
  className,
}: {
  status: string;
  onAdvance?: (nextStatus: string) => void;
  advancing?: boolean;
  canAdvance?: boolean;
  /** Full status list for the `⋯` picker — value + human label. */
  statuses?: { value: string; label: string }[];
  /** Called when a status is chosen from the `⋯` picker. */
  onStatusChange?: (value: string) => void;
  className?: string;
}) {
  const cancelled = status === "CANCELLED";
  const currentIdx = cancelled ? -1 : stageIndexForStatus(status);
  const nextStage = currentIdx >= 0 && currentIdx < STAGES.length - 1 ? STAGES[currentIdx + 1] : null;

  const showAdvance = !cancelled && nextStage && onAdvance && canAdvance;
  const showMenu = !!onStatusChange && !!statuses;

  // Celebrate the big milestones: confetti bursts out of the node when a job
  // becomes Confirmed or Completed — but only on the actual transition, never
  // on initial load of an already-confirmed/completed job.
  const nodeRefs = React.useRef<(HTMLSpanElement | null)[]>([]);
  const prevStatus = React.useRef(status);
  React.useEffect(() => {
    if (prevStatus.current !== status) {
      if (status === "CONFIRMED" || status === "COMPLETED") {
        const idx = stageIndexForStatus(status);
        // next frame so the node has its final position before we read it
        requestAnimationFrame(() =>
          fireConfettiFromElement(nodeRefs.current[idx], { power: 16 }),
        );
      }
      prevStatus.current = status;
    }
  }, [status]);

  // On mobile the stepper scrolls sideways instead of compressing all 7 stages into
  // the viewport, so keep the current stage centered (and re-center when it advances).
  const olRef = React.useRef<HTMLOListElement>(null);
  React.useEffect(() => {
    const ol = olRef.current;
    const node = nodeRefs.current[currentIdx];
    if (!ol || !node || ol.scrollWidth <= ol.clientWidth) return;
    const olRect = ol.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const delta = nodeRect.left - olRect.left - ol.clientWidth / 2 + nodeRect.width / 2;
    ol.scrollBy({ left: delta, behavior: "smooth" });
  }, [currentIdx]);

  const controls = (showAdvance || showMenu) && (
    <div className="flex shrink-0 items-center gap-2">
      {showAdvance && (
        <button
          type="button"
          onClick={() => onAdvance!(STAGE_ENTRY_STATUS[nextStage!.key])}
          disabled={advancing}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-[var(--r)] border-2 border-line bg-paper-2 px-3 py-1.5 text-caption font-semibold text-ink-2 transition-colors hover:border-red hover:text-ink",
            focusRing, disabledState,
          )}
        >
          {advancing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Advance to {nextStage!.label}
          {!advancing && <ArrowRight className="h-3.5 w-3.5" />}
        </button>
      )}
      {showMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Set status"
              className={cn(
                "inline-flex size-9 items-center justify-center rounded-[var(--r)] border-2 border-line bg-paper-2 text-ink-2 transition-colors hover:border-red hover:text-ink",
                focusRing, disabledState,
              )}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <div className="px-2.5 py-1 text-caption font-semibold text-muted">
              Set status
            </div>
            {statuses!.map((s) => (
              <DropdownMenuItem key={s.value} onClick={() => onStatusChange!(s.value)}>
                <Check
                  className={cn("h-4 w-4 text-red", s.value !== status && "opacity-0")}
                  strokeWidth={3}
                  aria-hidden
                />
                {s.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );

  return (
    <div
      className={cn(
        "flex flex-col gap-3 lg:flex-row lg:items-center",
        className,
      )}
      aria-label="Project lifecycle"
    >
      {cancelled ? (
        <p className="min-w-0 flex-1 t-micro text-t-out">
          This job is off the pipeline. Reactivate it from the status menu to resume.
        </p>
      ) : (
        <ol
          ref={olRef}
          className="flex min-w-0 flex-1 items-start overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="list"
        >
          {STAGES.map((s, i) => {
            const state = i < currentIdx ? "done" : i === currentIdx ? "current" : "upcoming";
            const isFirst = i === 0;
            const isLast = i === STAGES.length - 1;
            return (
              <li key={s.key} className="flex min-w-[76px] flex-1 flex-col items-center gap-2">
                {/* node + connectors */}
                <div className="flex w-full items-center">
                  <span className={cn("h-[2px] flex-1 rounded-full", isFirst ? "opacity-0" : connectorClass(i - 1, currentIdx))} aria-hidden />
                  <span
                    ref={(el) => {
                      nodeRefs.current[i] = el;
                    }}
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
                    "whitespace-nowrap text-center text-caption",
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
      {controls}
    </div>
  );
}
