"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PinnedAboveBottomNav } from "@/components/ui/bulk-bar";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import type { RowSelection } from "@/lib/primitives/types";

/**
 * The ticked-row bar of every warehouse stage (spec §9.4): inline under the table on desktop; on a phone it
 * is pinned above the bottom nav (the same dock `BulkBar` uses), so the stage verb is always one thumb away.
 * Verbs are children (buttons); it renders nothing with nothing ticked.
 */
export function StageActionBar({ selection, children }: { selection: Pick<RowSelection, "count" | "clear">; children: React.ReactNode }) {
  const isMobile = useIsMobile();
  if (selection.count <= 0) return null;
  const bar = (
    <div
      role="toolbar"
      aria-label="Stage actions"
      className={cn(
        "flex flex-wrap items-center gap-2",
        isMobile && "rounded-[var(--r)] border-2 border-line-2 bg-elev px-3 py-2 shadow-[var(--sh-card)] [&_button]:min-h-11",
      )}
    >
      {isMobile && <span className="text-ui-text font-medium text-ink tabular-nums">{selection.count} selected</span>}
      {children}
      {isMobile ? (
        <Button size="icon" variant="ghost" className="ml-auto" aria-label="Clear selection" onClick={selection.clear}><X className="h-4 w-4" /></Button>
      ) : (
        <Button size="sm" variant="line" onClick={selection.clear}>Clear</Button>
      )}
    </div>
  );
  return isMobile ? <PinnedAboveBottomNav>{bar}</PinnedAboveBottomNav> : bar;
}
