"use client";

import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * #990 (Phase E) action-level lock affordance — finance-workflow-ux.md §7.4
 * "the `disabled` trap": a native `disabled` button fires no pointer events,
 * so its tooltip never opens — a dead control with no explanation, worse than
 * the toast it replaces. `GatedButton` instead renders `aria-disabled="true"`
 * + a no-op handler + a real tooltip (in its own `TooltipProvider` — there is
 * no global one, CLAUDE.md) and stays keyboard-focusable.
 *
 * `gated={false}` renders a plain `Button` — this component is meant to wrap
 * every mutation-triggering button unconditionally, with the caller deciding
 * `gated` from `useProjectLockStatus`.
 */
export interface GatedButtonProps extends ButtonProps {
  gated: boolean;
  /** The `[state] — [consequence]` tooltip line, e.g. from `resolveLockCopy().oneLiner`. */
  reason: React.ReactNode;
  /** Optional exit CTA rendered as a second tooltip line/link. */
  exitLabel?: string;
  onExit?: () => void;
}

export const GatedButton = React.forwardRef<HTMLButtonElement, GatedButtonProps>(
  ({ gated, reason, exitLabel, onExit, className, onClick, children, ...props }, ref) => {
    if (!gated) {
      return (
        <Button ref={ref} className={className} onClick={onClick} {...props}>
          {children}
        </Button>
      );
    }

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              ref={ref}
              aria-disabled="true"
              className={cn(className, "opacity-45 cursor-not-allowed hover:translate-y-0 active:translate-y-0")}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              {...props}
            >
              {children}
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
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
  },
);
GatedButton.displayName = "GatedButton";
