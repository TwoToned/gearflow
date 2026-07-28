"use client";

import * as React from "react";
import { Lock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * #990 (Phase E) field-level lock affordance — finance-workflow-ux.md §7.3.
 * A wrapper, not per-form `disabled` props, so there is ONE implementation to
 * keep honest (POLICY.md R-3.1). When `locked`, every form control inside
 * `children` renders read-only with a 12px lock glyph and a tooltip naming
 * the reason + the exit, in the input's own metrics (no reflow — this only
 * overlays/dims what's already there).
 *
 * Uses a native `<fieldset disabled>` rather than cloning `disabled`/`readOnly`
 * onto a single child: `children` is sometimes a composite block (a checkbox +
 * a select + an input, e.g. `bulk-edit-line-items-dialog.tsx`'s discount row),
 * and `disabled` on a `<fieldset>` cascades to every native descendant control
 * — the browser removes them from tab order and blocks input, and each one's
 * own `:disabled` CSS (Tailwind's `disabled:opacity-45` etc., already on every
 * registry `Input`/`Select`) applies automatically since it reflects real
 * disabled state, not just the boolean attribute. The `tabIndex=0` on the
 * `<fieldset>` itself is what a keyboard user actually lands on — the
 * tooltip's focus trigger and the one thing left reachable inside.
 */
export interface LockedFieldProps {
  locked: boolean;
  /** The `[state] — [consequence]` tooltip line, e.g. `resolveLockCopy().oneLiner`. */
  reason: React.ReactNode;
  exitLabel?: string;
  onExit?: () => void;
  className?: string;
  children: React.ReactNode;
}

export function LockedField({ locked, reason, exitLabel, onExit, className, children }: LockedFieldProps) {
  const describedById = React.useId();

  if (!locked) return <>{children}</>;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <fieldset
            disabled
            tabIndex={0}
            aria-readonly="true"
            aria-describedby={describedById}
            className={cn("relative m-0 min-w-0 cursor-not-allowed border-0 p-0", className)}
          >
            <div className="opacity-70">{children}</div>
            <Lock
              className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-2"
              aria-hidden="true"
            />
          </fieldset>
        </TooltipTrigger>
        <TooltipContent id={describedById} className="max-w-xs">
          <p>{reason}</p>
          {exitLabel && onExit && (
            <button
              type="button"
              onClick={onExit}
              className="mt-1 font-semibold underline underline-offset-2"
            >
              {exitLabel}
            </button>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
