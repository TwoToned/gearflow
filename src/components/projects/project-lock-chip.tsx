"use client";

import { Lock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { resolveLockCopy, type LockCopyStatus } from "@/lib/lock-copy";
import { intentStyles } from "@/lib/status-colors";
import { cn } from "@/lib/utils";

interface ProjectLockChipProps {
  status: LockCopyStatus & { loading: boolean };
  className?: string;
}

/**
 * #1230 (successor to #990's Phase E surface 1) — always-mounted header chip
 * beside the project status. Renders from the SAME `resolveLockCopy()` the
 * lock strip uses, so the two surfaces can never say different things. Null
 * (no chip) when pricing is open — a project mid-quoting isn't a lock state
 * worth a permanent badge next to its name.
 *
 * Own `TooltipProvider` (no global one, CLAUDE.md) — a real Radix tooltip,
 * not a bare `title` attribute, so the reason is keyboard/screen-reader
 * reachable the same way every other lock surface's tooltip is.
 */
export function ProjectLockChip({ status, className }: ProjectLockChipProps) {
  if (status.loading) return null;
  const copy = resolveLockCopy(status);
  if (!copy.chipLabel) return null;

  const styles = intentStyles[copy.intent];

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() =>
              document.getElementById("lock-strip")?.scrollIntoView({ behavior: "smooth", block: "center" })
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-badge font-bold transition-opacity hover:opacity-80",
              styles.pill,
              className,
            )}
            aria-label={`${copy.chipLabel} — jump to lock details`}
          >
            <Lock className="h-3 w-3" aria-hidden="true" />
            {copy.chipLabel}
          </button>
        </TooltipTrigger>
        <TooltipContent>{copy.oneLiner}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
