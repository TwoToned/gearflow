"use client";

import { Lock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { lockTierForStatus } from "../../../convex/lib/projectLocks";

const TIER_LABEL: Record<string, string> = {
  FINANCE_LOCKED: "Pricing locked — this job is confirmed.",
  JUSTIFY: "Changes need a reason — this job is on site.",
  HARD_LOCKED: "Locked — this job is completed.",
};

/**
 * #990 (Phase E) surface 6 — the list/board/card lock glyph. Derived from
 * `status` alone via the SAME `lockTierForStatus` the server's
 * `assertLifecycleGuard` resolves from (`convex/lib/projectLocks.ts`,
 * POLICY.md R-3.1) — no second row query, and no re-derived boundary.
 *
 * Deliberately status-only: the quote-send lock (`resolveLockTier`'s
 * `QUOTE_SENT` case, #988) needs each row's current-revision quote state,
 * which `projects.listPage`/`listBoard` don't carry today and a per-row
 * lookup would reintroduce the exact per-project-loop cost #942 flagged.
 * An OPEN-status project with a sent quote won't show a glyph here — it
 * still shows correctly everywhere it's actually opened (header chip, lock
 * strip), so this is a coverage gap, not a wrong answer.
 */
export function ProjectLockGlyph({ status, className }: { status: string | null | undefined; className?: string }) {
  const tier = lockTierForStatus(status);
  if (tier === "OPEN") return null;
  const label = TIER_LABEL[tier] ?? "Locked";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className={cn("inline-flex shrink-0 rounded-sm text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red", className)}
          >
            <Lock className="h-3 w-3" aria-label={label} />
          </span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
