"use client";

import { RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn, focusRing } from "@/lib/utils";

/** Shared "as of … [refresh]" stamp — `TodayDayRail` and `TodayNeedsYouRail`
 *  render the exact same one (R-3.1), not two copies. Not exported: only
 *  `RailShell` below uses it directly. */
function AsOfStamp({ asOf, onRefresh }: { asOf: number | undefined; onRefresh: () => void }) {
  return (
    <div className="flex items-center gap-1.5">
      {asOf != null && (
        <span className="text-[10px] text-faint">as of {formatDistanceToNow(asOf, { addSuffix: true })}</span>
      )}
      <button
        type="button"
        aria-label="Refresh"
        onClick={onRefresh}
        className={cn("touch-target -m-2.5 flex items-center justify-center rounded-full text-muted hover:text-ink", focusRing)}
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * Shared bare/card shell for Today's rails: `bare` (the dashboard-
 * widget-board hosting, inside the shared `<DashboardCard>` shell) renders
 * just the header + body; the default (non-bare — `/today/page.tsx`'s own
 * usage) wraps them in the rail's own card + heading. Pulled out of
 * `TodayDayRail`/`TodayNeedsYouRail` themselves so the bare/non-bare branch
 * lives in exactly ONE place (R-3.1) rather than duplicated in both — which
 * is also what keeps each rail's own cyclomatic complexity under the R-3.6
 * threshold (adding this branch inline in both pushed `TodayNeedsYouRail`
 * over it; extracting it here is the fix, not a raised ratchet baseline).
 */
export function RailShell({
  bare,
  title,
  asOf,
  onRefresh,
  children,
}: {
  bare: boolean;
  title: string;
  asOf: number | undefined;
  onRefresh: () => void;
  children: React.ReactNode;
}) {
  const header = (
    <div className="mb-3 flex items-center justify-between">
      {bare ? <span /> : <h2 className="t-overline text-muted">{title}</h2>}
      <AsOfStamp asOf={asOf} onRefresh={onRefresh} />
    </div>
  );

  if (bare) {
    return (
      <>
        {header}
        {children}
      </>
    );
  }

  return (
    <div className="rounded-[var(--r-lg)] border border-line bg-card p-4">
      {header}
      {children}
    </div>
  );
}
