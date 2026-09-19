/**
 * The composer's due-date presets (work-layer v2, §4.1's "when" chip).
 *
 * Every boundary resolves in the ORG's timezone, the same rule
 * `today-buckets.ts` buckets by. That pairing is the whole point: a task the
 * composer calls "Today" must land in Today's `today` bucket, and it only does
 * if both sides agree on which calendar day it is. Resolving "today" from the
 * BROWSER's clock puts a task a day out the moment the browser isn't in the
 * org's zone — the bug `today-buckets.ts` was written to avoid, which would
 * walk straight back in through the writer if the writer used a different
 * clock from the reader.
 *
 * Plain module, no React/Convex — unit-testable on its own.
 */

/** A `YYYY-MM-DD` calendar date, the shape `useProjectTaskWrites().create`
 *  takes and converts to epoch ms. */
export type CalendarDate = string;

export const WORK_DUE_PRESETS = ["today", "tomorrow", "none"] as const;
export type WorkDuePreset = (typeof WORK_DUE_PRESETS)[number];

export const WORK_DUE_PRESET_LABELS: Record<WorkDuePreset, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  none: "No date",
};

/**
 * The calendar date `instantMs` falls on in `timezone`, as `YYYY-MM-DD`.
 *
 * `en-CA` is the locale whose short date format IS ISO order, so this needs no
 * part re-assembly. An unknown/blank timezone falls back to the runtime's own
 * zone rather than throwing, matching `startOfDayInTimezone`'s posture.
 */
export function calendarDateInTimezone(instantMs: number, timezone?: string): CalendarDate {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(instantMs));
  } catch {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(
      new Date(instantMs),
    );
  }
}

/**
 * Add `days` calendar days to a `YYYY-MM-DD`.
 *
 * Pure UTC arithmetic on the date parts, never `+ 86_400_000` on an instant:
 * UTC has no DST, so "add a day" here can't skip or repeat one. Adding a fixed
 * 24 hours to an instant CAN, on the two days a year a zone shifts — which is
 * exactly the off-by-one a due date must not have. Same technique as
 * `addCalendarDays` in `quote-validity.ts`.
 */
export function shiftCalendarDate(date: CalendarDate, days: number): CalendarDate {
  const [year, month, day] = date.split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return date;
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** The `YYYY-MM-DD` a preset resolves to, or `null` for "no date". */
export function resolveDuePreset(
  preset: WorkDuePreset,
  nowMs: number,
  timezone?: string,
): CalendarDate | null {
  if (preset === "none") return null;
  const today = calendarDateInTimezone(nowMs, timezone);
  return preset === "today" ? today : shiftCalendarDate(today, 1);
}
