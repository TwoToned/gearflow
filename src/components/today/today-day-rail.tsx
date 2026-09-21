"use client";

import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, focusRing } from "@/lib/utils";
import type { DayRailEntry } from "@/hooks/use-today-day-rail";
import { RailShell } from "@/components/today/today-rail-shell";

const HUE_DOT: Record<DayRailEntry["hue"], string> = {
  purple: "bg-purple", green: "bg-green", blue: "bg-blue",
};

export function TodayDayRail({
  entries,
  asOf,
  error,
  onRefresh,
  /** the widget board — the dashboard-widget-board hosts this inside the shared
   *  `<DashboardCard>` shell, which already supplies the card/title; `bare`
   *  skips this component's own so the two don't nest. The default
   *  (non-bare) rendering is `/today`'s pre-hide (D10C) look. */
  bare = false,
}: {
  entries: DayRailEntry[] | undefined;
  asOf: number | undefined;
  error?: Error | null;
  onRefresh: () => void;
  bare?: boolean;
}) {
  return (
    <RailShell bare={bare} title="Your day" asOf={asOf} onRefresh={onRefresh}>
      {entries === undefined && error ? (
        <div className="flex items-center gap-2 border-l-2 border-l-t-out pl-2 py-1">
          <p className="flex-1 text-caption text-t-out">Couldn&apos;t load today&apos;s schedule.</p>
          <button type="button" onClick={onRefresh} className="text-caption font-medium text-primary underline">
            Retry
          </button>
        </div>
      ) : entries === undefined ? (
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
      {error && entries !== undefined && (
        <p className="mt-2 text-[10px] text-t-out">Couldn&apos;t refresh — showing the last loaded data.</p>
      )}
    </RailShell>
  );
}
