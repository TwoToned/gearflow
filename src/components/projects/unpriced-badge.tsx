"use client";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * #791 amber "Unpriced" badge for a $0-defaulted line/group/service added
 * while the project's financials were locked. Wraps its own `TooltipProvider`
 * — there is no global provider in this app (CLAUDE.md).
 */
export function UnpricedBadge({ className }: { className?: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge status="warn" className={className}>
            Unpriced
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          Added after the quote was confirmed — price it deliberately via Unlock financials.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
