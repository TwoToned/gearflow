"use client";

import * as React from "react";
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isBefore,
  isSameDay,
  isSameMonth,
  isToday,
  isWithinInterval,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn, focusRing } from "@/lib/utils";

export type DateRange = { start?: Date; end?: Date };

const WEEKDAYS_MON_FIRST = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const WEEKDAYS_SUN_FIRST = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/**
 * Inline range calendar (date-fns, no external calendar dep). Two-click range
 * selection with live hover preview. RVLT-tokenised: endpoints fill --red,
 * the in-between span fills --red-soft.
 */
export function RangeCalendar({
  value,
  onChange,
  className,
  /** I6 (#1086) — the org's week start (0 = Sunday, 1 = Monday). Defaults
   *  to Monday, the pre-#1086 hardcoded behaviour, for a caller that hasn't
   *  threaded the org's `useOrgWeekStartsOn()` through yet. */
  weekStartsOn = 1,
  /** I3 (#1082) — BCP-47 locale for the month header (e.g. "en-US"). Defaults
   *  to the pre-#1082 AU rendering for a caller that hasn't threaded the
   *  org's `useFormatters().config.locale` through yet. */
  locale = "en-AU",
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
  weekStartsOn?: 0 | 1;
  locale?: string;
}) {
  const WEEKDAYS = weekStartsOn === 0 ? WEEKDAYS_SUN_FIRST : WEEKDAYS_MON_FIRST;
  const [viewMonth, setViewMonth] = React.useState<Date>(
    () => startOfMonth(value.start ?? new Date()),
  );
  const [hover, setHover] = React.useState<Date | null>(null);

  // Keep the visible month in sync when the range is set externally (presets).
  // Adjust-state-during-render (React's recommended pattern) keyed on the
  // primitive epoch — `value.start` is a fresh Date instance each render, so a
  // ref-equality dep would loop; the primitive only changes on a real pick.
  const startTime = value.start?.getTime();
  const [syncedStart, setSyncedStart] = React.useState(startTime);
  if (startTime !== syncedStart) {
    setSyncedStart(startTime);
    if (value.start && !isSameMonth(viewMonth, value.start)) {
      setViewMonth(startOfMonth(value.start));
    }
  }

  const gridStart = startOfWeek(startOfMonth(viewMonth), { weekStartsOn });
  const gridEnd = endOfWeek(endOfMonth(viewMonth), { weekStartsOn });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  // Preview end while choosing the second endpoint.
  const previewEnd = value.start && !value.end && hover ? hover : value.end;
  const lo = value.start;
  const hi = previewEnd && lo && isBefore(previewEnd, lo) ? lo : previewEnd;
  const realLo = previewEnd && lo && isBefore(previewEnd, lo) ? previewEnd : lo;

  function handleClick(day: Date) {
    if (!value.start || value.end) {
      // start a fresh selection
      onChange({ start: day, end: undefined });
    } else {
      // close the range (swap if the user clicked before the start)
      if (isBefore(day, value.start)) onChange({ start: day, end: value.start });
      else onChange({ start: value.start, end: day });
    }
  }

  return (
    <div className={cn("select-none", className)}>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setViewMonth((m) => subMonths(m, 1))}
          className={cn("flex size-8 items-center justify-center rounded-[var(--r)] text-muted transition-colors hover:bg-paper-2 hover:text-ink", focusRing)}
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-[14px] font-semibold text-ink">
          {viewMonth.toLocaleDateString(locale, { month: "long", year: "numeric" })}
        </span>
        <button
          type="button"
          onClick={() => setViewMonth((m) => addMonths(m, 1))}
          className={cn("flex size-8 items-center justify-center rounded-[var(--r)] text-muted transition-colors hover:bg-paper-2 hover:text-ink", focusRing)}
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-y-1">
        {WEEKDAYS.map((d) => (
          <div key={d} className="pb-1 text-center text-[11px] font-medium text-faint">{d}</div>
        ))}
        {days.map((day) => {
          const inMonth = isSameMonth(day, viewMonth);
          const isStart = realLo && isSameDay(day, realLo);
          const isEnd = hi && isSameDay(day, hi);
          const inRange =
            realLo && hi && isWithinInterval(day, { start: realLo, end: hi });
          const isEndpoint = isStart || isEnd;
          const single = realLo && hi && isSameDay(realLo, hi);

          return (
            <button
              type="button"
              key={day.toISOString()}
              onClick={() => handleClick(day)}
              onMouseEnter={() => setHover(day)}
              onMouseLeave={() => setHover(null)}
              className={cn(
                "relative mx-auto flex size-9 items-center justify-center rounded-[var(--r)] text-table-cell transition-colors focus-visible:z-10",
                focusRing,
                // range fill underlay (square so segments join up)
                inRange && !isEndpoint && "bg-red-soft text-ink",
                inRange && isStart && !single && "rounded-l-[var(--r)] bg-red-soft",
                inRange && isEnd && !single && "rounded-r-[var(--r)] bg-red-soft",
              )}
            >
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-[var(--r)] transition-colors",
                  !inMonth && "text-faint/50",
                  inMonth && !inRange && !isEndpoint && "text-ink hover:bg-paper-2",
                  isEndpoint && "bg-red font-semibold text-white",
                  !isEndpoint && isToday(day) && "ring-1 ring-inset ring-line",
                )}
              >
                {format(day, "d")}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Common hire-duration presets. Each returns a range anchored on `from`. */
export const DURATION_PRESETS: { label: string; days: number; weekend?: boolean }[] = [
  { label: "1 day", days: 0 },
  { label: "2 days", days: 1 },
  { label: "Weekend", days: 2, weekend: true },
  { label: "1 week", days: 6 },
];

/** Build a range from a preset, anchored on `from` (defaults to today). */
export function presetRange(
  preset: (typeof DURATION_PRESETS)[number],
  from?: Date,
): DateRange {
  let start = from ?? new Date();
  if (preset.weekend) {
    // jump to the upcoming Friday
    const day = start.getDay(); // 0 Sun … 6 Sat
    const delta = (5 - day + 7) % 7;
    start = addDays(start, delta);
  }
  return { start, end: addDays(start, preset.days) };
}

/** Inclusive day-count label, e.g. "5 days". */
export function rangeLengthLabel(range: DateRange): string | null {
  if (!range.start || !range.end) return null;
  const n = Math.abs(differenceInCalendarDays(range.end, range.start)) + 1;
  return n === 1 ? "1 day" : `${n} days`;
}
