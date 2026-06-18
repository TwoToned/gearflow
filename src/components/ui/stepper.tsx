"use client";

import * as React from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * RVLT lifecycle stepper (DESIGN.md §15.4a) — the canonical project-status spine
 * (Enquiry → Quote → Confirmed → Prep → On site → Return). States:
 *   done   = --ink fill + check
 *   now    = red ring + --red-soft glow + bold label
 *   future = --line-2 ring, --faint label
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
  future: "border-line-2 bg-card text-faint",
};
const labelCls: Record<StepState, string> = {
  done: "text-ink-2",
  now: "font-semibold text-ink",
  future: "text-faint",
};

function LifecycleStepper({
  steps,
  onStepClick,
  className,
  ...props
}: React.HTMLAttributes<HTMLOListElement> & {
  steps: Step[];
  onStepClick?: (index: number) => void;
}) {
  return (
    <ol
      className={cn(
        "flex flex-col md:flex-row md:items-start md:overflow-x-auto",
        className,
      )}
      {...props}
    >
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        // the connector after a done step is "done" (ink); the one bridging into `now` is active (red)
        const connState: StepState =
          s.state === "done" && steps[i + 1]?.state !== "future" ? "done" : steps[i + 1]?.state === "now" ? "now" : "future";
        const Ring = onStepClick ? "button" : "span";
        return (
          <React.Fragment key={i}>
            <li className="flex items-center gap-3 md:flex-1 md:flex-col md:items-center md:gap-2 md:min-w-[88px]">
              <Ring
                type={onStepClick ? "button" : undefined}
                onClick={onStepClick ? () => onStepClick(i) : undefined}
                aria-current={s.state === "now" ? "step" : undefined}
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full border-2 font-mono text-[12px] font-bold transition-shadow",
                  ring[s.state],
                  onStepClick && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)]",
                )}
              >
                {s.state === "done" ? <Check className="size-4" strokeWidth={3} /> : i + 1}
              </Ring>
              <span className={cn("text-[13px] md:text-[12px]", labelCls[s.state])}>{s.label}</span>
            </li>
            {!last && (
              <span
                aria-hidden
                className={cn(
                  // vertical on mobile (under the ring), horizontal on md+ (aligned to ring centre)
                  "my-0.5 ml-[13px] h-4 w-0.5 shrink-0 rounded md:my-0 md:ml-0 md:mt-[13px] md:h-0.5 md:w-auto md:min-w-5 md:flex-1",
                  connState === "done" ? "bg-ink" : connState === "now" ? "bg-red" : "bg-line-2",
                )}
              />
            )}
          </React.Fragment>
        );
      })}
    </ol>
  );
}

export { LifecycleStepper };
