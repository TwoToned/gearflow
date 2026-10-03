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

export const WORK_DUE_PRESETS = ["today", "tomorrow", "nextWeek", "none"] as const;
export type WorkDuePreset = (typeof WORK_DUE_PRESETS)[number];

export const WORK_DUE_PRESET_LABELS: Record<WorkDuePreset, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  nextWeek: "Next week",
  none: "No date",
};

/** How many calendar days past today each preset lands. `none` has no
 *  offset — it is the absence of a date, not a date far away. */
const PRESET_DAY_OFFSET: Record<Exclude<WorkDuePreset, "none">, number> = {
  today: 0,
  tomorrow: 1,
  nextWeek: 7,
};

/**
 * What the composer's "when" chip is currently set to: one of the presets, or
 * a calendar date the user picked outright.
 *
 * A union rather than `preset | customDate` as two pieces of state, because
 * the two can't both be in force and a shape that can't represent that can't
 * drift (R-3.1). Everything that needs "so what date IS it" goes through
 * `resolveWorkDue`; everything that needs "what do I print on the chip" goes
 * through `workDueLabel`. No caller re-derives either.
 */
export type WorkDueValue =
  | { kind: "preset"; preset: WorkDuePreset }
  | { kind: "date"; date: CalendarDate };

/** The composer's starting "when". A job's work is undated until someone says
 *  otherwise; personal work defaults to today, which is the list it lands in. */
export const workDueDefault = (hasProject: boolean): WorkDueValue => ({
  kind: "preset",
  preset: hasProject ? "none" : "today",
});

/** The `YYYY-MM-DD` this value means, or `null` for "no date". */
export function resolveWorkDue(
  value: WorkDueValue,
  nowMs: number,
  timezone?: string,
): CalendarDate | null {
  return value.kind === "date" ? value.date : resolveDuePreset(value.preset, nowMs, timezone);
}

/**
 * The chip's text. A picked date prints as a short human date ("12 Oct", with
 * the year only when it isn't this one) rather than the raw ISO string — the
 * chip is read at a glance, and `2026-10-12` isn't.
 */
export function workDueLabel(value: WorkDueValue, nowMs: number, timezone?: string): string {
  if (value.kind === "preset") return WORK_DUE_PRESET_LABELS[value.preset];
  return formatCalendarDate(value.date, calendarDateInTimezone(nowMs, timezone));
}

/** `YYYY-MM-DD` → "12 Oct" (same year as `todayDate`) or "12 Oct 2027". */
export function formatCalendarDate(date: CalendarDate, todayDate: CalendarDate): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return date;
  // Midday UTC, never midnight: the parts go straight back out through the
  // UTC getters, so no zone can pull the rendered day off by one.
  const at = new Date(Date.UTC(year, month - 1, day, 12));
  const sameYear = date.slice(0, 4) === todayDate.slice(0, 4);
  return at.toLocaleDateString(undefined, {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

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
  return shiftCalendarDate(today, PRESET_DAY_OFFSET[preset]);
}

/**
 * A work item's DATES as the composer holds them: when it is due, and
 * optionally when it starts.
 *
 * A row with both runs as a SPAN — it draws as a bar on the Work tab's
 * calendar and stays visible in every list for the whole stretch. A start with
 * no due date is not a span (there is nothing to run to), so it is not
 * representable here: `start` is only ever read alongside a resolved `due`.
 */
export interface WorkDates {
  due: WorkDueValue;
  /** `null` = no start; the row is a point on its due date. */
  start: CalendarDate | null;
}

export const workDatesDefault = (hasProject: boolean): WorkDates => ({
  due: workDueDefault(hasProject),
  start: null,
});

/**
 * The pair as the writer takes it, with the ordering invariant applied.
 *
 * A start that is after the due date, or a start with no due date at all, is
 * dropped rather than sent — the span it describes does not exist. The Convex
 * mutation rejects the same pair (`assertDateSpanOrdered`), so this is the
 * client half of one rule, not a second rule: the UI's job is to not make the
 * user round-trip a server error for something it can see is impossible.
 */
export function resolveWorkDates(
  dates: WorkDates,
  nowMs: number,
  timezone?: string,
): { dueDate: CalendarDate | null; startDate: CalendarDate | null } {
  const dueDate = resolveWorkDue(dates.due, nowMs, timezone);
  const startDate = dates.start && dueDate && dates.start <= dueDate ? dates.start : null;
  return { dueDate, startDate };
}

/**
 * The date chip's text. A span prints both ends ("12–14 Oct"); a point prints
 * one. Uses the SAME `workDueLabel`/`formatCalendarDate` the point case does,
 * so the two can't drift into different date formats on one chip.
 */
export function workDatesLabel(dates: WorkDates, nowMs: number, timezone?: string): string {
  const dueText = workDueLabel(dates.due, nowMs, timezone);
  const { startDate, dueDate } = resolveWorkDates(dates, nowMs, timezone);
  if (!startDate || !dueDate) return dueText;
  const today = calendarDateInTimezone(nowMs, timezone);
  // The due end keeps its own label so a preset still reads as "Today", not as
  // a date the user never typed.
  return `${formatCalendarDate(startDate, today)} \u2192 ${dueText}`;
}
