"use client";

import { ChevronLeft, ChevronRight, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterWord, type ListFilterDef } from "@/components/ui/list-page-parts";
import { displayDate } from "@/lib/crew-planner";
import { formatDateDayMonth, formatMonthYear } from "@/lib/formatters";
import type { ScheduleRange } from "@/lib/schedule";
import { cn } from "@/lib/utils";
import type { ScheduleUrl } from "./use-schedule-url";

/** `10 – 16 Nov` for a week, `November 2026` for a month. */
export function rangeLabel(range: ScheduleRange): string {
  if (range.zoom === "month") return formatMonthYear(displayDate(range.start));
  const last = range.days[range.days.length - 1];
  return `${formatDateDayMonth(displayDate(range.start))} – ${formatDateDayMonth(displayDate(last))}`;
}

const ZOOMS = [
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
] as const;

function ZoomWords({ url }: { url: ScheduleUrl }) {
  return (
    <span role="group" aria-label="Zoom" className="ml-2 flex items-center gap-3">
      {ZOOMS.map((z) => (
        <button
          key={z.key}
          type="button"
          aria-pressed={url.range.zoom === z.key}
          onClick={() => url.setZoom(z.key)}
          className={cn(
            "min-h-9 border-b-2 text-ui-text font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red",
            url.range.zoom === z.key ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {z.label}
        </button>
      ))}
    </span>
  );
}

/**
 * The Schedule's toolbar (§9o.2): `‹ 10 – 16 Nov ›  Today  | Week  Month`,
 * search, then the filters as words that read their value. Every one is the URL.
 * Zoom is desktop only: a phone is always one week of day chips (§9o.6).
 */
export function ScheduleToolbar({ url, defs, phone }: { url: ScheduleUrl; defs: ListFilterDef[]; phone: boolean }) {
  const f = url.state.filters;
  const active = Object.keys(f).length > 0 || !!url.state.q.trim();
  return (
    <div className="flex flex-col gap-1 md:flex-row md:items-center md:gap-3">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label={url.range.zoom === "month" ? "Previous month" : "Previous week"} onClick={() => url.step(-1)}>
          <ChevronLeft className="size-5" />
        </Button>
        <span className="min-w-[112px] text-center font-mono text-ui-text font-medium text-ink" data-testid="schedule-range">
          {rangeLabel(url.range)}
        </span>
        <Button variant="ghost" size="icon" aria-label={url.range.zoom === "month" ? "Next month" : "Next week"} onClick={() => url.step(1)}>
          <ChevronRight className="size-5" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => url.step(0)}>
          Today
        </Button>
        {!phone && <ZoomWords url={url} />}
      </div>
      <div className="relative md:w-72">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
        <Input
          type="search"
          aria-label="Search jobs"
          placeholder="Search job, client or model"
          value={url.state.q}
          onChange={(e) => url.setSearch(e.target.value)}
          className="h-11 pl-9 text-base md:h-9 md:text-ui-text"
        />
      </div>
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto md:flex-1 md:overflow-visible">
        {defs.map((d) => (
          <FilterWord key={d.key} def={d} chosen={f[d.key] ?? []} onChange={(v) => url.setFilter(d.key, v)} />
        ))}
        {active && (
          <button type="button" onClick={url.clear} className="min-h-11 shrink-0 text-ui-text text-muted hover:text-ink md:min-h-9">
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
