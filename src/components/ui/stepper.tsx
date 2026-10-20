"use client";

import * as React from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * RVLT lifecycle stepper (DESIGN.md §15.4a) — the canonical project-status spine
 * (Enquiry → Quote → Confirmed → Prep → On site → Return). States:
 *   done   = --ink fill + check
 *   now    = red ring + --red-soft glow + bold label
 *   future = --line-2 ring, --muted label (--faint is never text, §3.8)
 * The list is named (`label`, default "Project lifecycle") and every step announces its stage and
 * state ("Quote, done", "Confirmed, current stage", "Prep, not started"), clickable or not.
 * Vertical timeline on mobile, horizontal on md+ (§16.9a). Rings are clickable when onStepClick is set.
 */
export type StepState = "done" | "now" | "future";
export interface Step {
  label: string;
  state: StepState;
}

const ring: Record<StepState, string> = {
  done: "border-ink bg-ink text-paper",
  now: "border-red text-red shadow-[0_0_0_5px_var(--red-soft)]",
  future: "border-line-2 bg-card text-muted",
};
const labelCls: Record<StepState, string> = {
  done: "text-ink-2",
  now: "font-semibold text-ink",
  future: "text-muted",
};
// Spoken after the visible stage name; the numeric ring is decorative.
const stateText: Record<StepState, string> = {
  done: " done",
  now: " current stage",
  future: " not started",
};

function LifecycleStepper({
  steps,
  onStepClick,
  label = "Project lifecycle",
  className,
  ...props
}: React.HTMLAttributes<HTMLOListElement> & {
  steps: Step[];
  onStepClick?: (index: number) => void;
  /** Accessible name of the list, e.g. "Riverside festival lifecycle". */
  label?: string;
}) {
  return (
    <ol aria-label={label} className={cn("flex flex-col md:flex-row md:items-start", className)} {...props}>
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        // the connector after a done step is "done" (ink); the one bridging into `now` is active (red)
        const connState: StepState =
          s.state === "done" && steps[i + 1]?.state !== "future" ? "done" : steps[i + 1]?.state === "now" ? "now" : "future";
        // A clickable step is one button holding its ring and its label, so the whole step is the
        // press target (at least 44px, §16.8, §16.9a) and the label names it.
        const Step = onStepClick ? "button" : "div";
        return (
          <li key={i} className="relative flex flex-col md:min-w-[88px] md:flex-1 md:items-center">
            <Step
              type={onStepClick ? "button" : undefined}
              onClick={onStepClick ? () => onStepClick(i) : undefined}
              aria-current={s.state === "now" ? "step" : undefined}
              aria-label={`${s.label} ${stateText[s.state].trim()}`}
              className={cn(
                "relative z-[1] flex min-h-11 items-center gap-3 rounded-[var(--radius)] text-left md:min-w-11 md:flex-col md:gap-2 md:text-center",
                onStepClick && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full border-2 font-mono text-[12px] font-bold transition-shadow",
                  ring[s.state],
                )}
              >
                {s.state === "done" ? <Check className="size-4" strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn("text-[13px] md:text-[12px]", labelCls[s.state])}>
                {s.label}
                <span className="sr-only">{stateText[s.state]}</span>
              </span>
            </Step>
            {!last && (
              <span
                aria-hidden
                className={cn(
                  // vertical under the ring on phones; on md+ a line from this ring to the next
                  "ml-[13px] h-4 w-0.5 shrink-0 rounded md:absolute md:left-[calc(50%+18px)] md:right-[calc(-50%+18px)] md:top-[13px] md:ml-0 md:h-0.5 md:w-auto",
                  connState === "done" ? "bg-ink" : connState === "now" ? "bg-red" : "bg-line-2",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export { LifecycleStepper };
