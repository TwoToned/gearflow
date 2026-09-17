"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, focusRing } from "@/lib/utils";
import type { DayRailEntry } from "@/hooks/use-today-day-rail";

const HUE_DOT: Record<DayRailEntry["hue"], string> = {
  purple: "bg-purple", green: "bg-green", blue: "bg-blue",
};

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

export function TodayDayRail({
  entries,
  asOf,
  onRefresh,
}: {
  entries: DayRailEntry[] | undefined;
  asOf: number | undefined;
  onRefresh: () => void;
}) {
  return (
    <div className="rounded-[var(--r-lg)] border border-line bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="t-overline text-muted">Your day</h2>
        <AsOfStamp asOf={asOf} onRefresh={onRefresh} />
      </div>
      {entries === undefined ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full rounded-[var(--r)]" />
          <Skeleton className="h-10 w-full rounded-[var(--r)]" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-caption text-muted">Nothing scheduled.</p>
      ) : (
        <ul className="space-y-2.5">
          {entries.map((e) => (
            <li key={e.key}>
              <Link href={e.href} className={cn("group flex items-start gap-2 rounded-[var(--r)] -mx-1 px-1 py-0.5", focusRing)}>
                <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", HUE_DOT[e.hue])} aria-hidden />
                <div className="min-w-0">
                  {e.time && <p className="text-[11px] font-medium text-muted">{e.time}</p>}
                  <p className="truncate text-[13px] text-ink-2 group-hover:underline">{e.title}</p>
                  {e.subtitle && <p className="truncate text-caption text-faint">{e.subtitle}</p>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
