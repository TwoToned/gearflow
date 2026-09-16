"use client";

import { Lock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { isConfirmedOrLater } from "../../../convex/lib/projectLocks";

const LABEL = "Pricing locked — this job is confirmed.";

/**
 * #1230 (successor to #990's Phase E surface 6) — the list/board/card lock
 * glyph. Derived from `status` alone via `isConfirmedOrLater`
 * (`convex/lib/projectLocks.ts`, POLICY.md R-3.1) — no second row query.
 *
 * Deliberately status-only, same documented coverage gap the original #990
 * glyph carried: a quote-sent lock on an otherwise-OPEN-status project
 * (`quotesWrites.sendNative`'s own D55 lock) needs each row's quote state,
 * which `projects.listPage`/`listBoard` don't carry today and a per-row
 * lookup would reintroduce the exact per-project-loop cost #942 flagged. Not
 * shown here doesn't mean not locked — the header chip and lock strip both
 * resolve the real `projects.pricingLocked` field correctly once opened.
 */
export function ProjectLockGlyph({ status, className }: { status: string | null | undefined; className?: string }) {
  if (!isConfirmedOrLater(status)) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className={cn("inline-flex shrink-0 rounded-sm text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red", className)}
          >
            <Lock className="h-3 w-3" aria-label={LABEL} />
          </span>
        </TooltipTrigger>
        <TooltipContent>{LABEL}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
