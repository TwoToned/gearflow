/**
 * Laying dated work out on the Work tab's day-strip (#tae40e).
 *
 * A work item with both a start and a due date RUNS over that stretch rather
 * than happening at a point. The Work tab's calendar is a day-strip, not a
 * month grid (see `work-calendar-view.tsx` for why there is no grid library in
 * the tree), so a span's honest rendering there is not a drawn bar — it is the
 * item appearing under **every day it runs**, marked as start / middle / end
 * so the strip reads as one continuous thing rather than three coincidences.
 *
 * Plain module, no React: the day arithmetic is the part that can be wrong in
 * ways nothing on screen would show, so it is the part with unit tests.
 */

import { shiftCalendarDate, type CalendarDate } from "./work-due-dates";

/** How a given day relates to the item sitting on it. */
export type SpanPosition = "point" | "start" | "middle" | "end";

export interface DatedWorkItem {
  id: string;
  dueDate: string | null;
  startDate?: string | null;
}

/**
 * The most days one item may occupy on the strip.
 *
 * A span is a working stretch — a build week, a run of show days — not a
 * project phase, and nothing on this strip is improved by one row repeating
 * two hundred times. Past the cap the item keeps its two ENDS (where a reader
 * actually looks for it) and drops the middle, which is the part that only
 * ever said "still running". A cap that silently truncated the tail instead
 * would hide the deadline, which is the one day that matters.
 */
export const MAX_SPAN_DAYS = 31;

/** `YYYY-MM-DD`, or null for an item with no date at all. */
const dayOf = (iso: string | null | undefined): CalendarDate | null =>
  iso ? iso.slice(0, 10) : null;

/**
 * Every (day, position) an item occupies.
 *
 * An item with no start, a start equal to its due date, or a start AFTER it
 * (which the writer rejects, but a row stored before the guard existed could
 * still carry) is one point on its due date — never a backwards span and never
 * a crash. The inversion collapses to a point rather than throwing because
 * this is a renderer: a bad row should look wrong, not take the tab down.
 */
export function spanDays(item: DatedWorkItem): { day: CalendarDate; position: SpanPosition }[] {
  const due = dayOf(item.dueDate);
  if (!due) return [];

  const start = dayOf(item.startDate);
  if (!start || start >= due) return [{ day: due, position: "point" }];

  const days: { day: CalendarDate; position: SpanPosition }[] = [{ day: start, position: "start" }];
  let cursor = shiftCalendarDate(start, 1);
  // `days.length` counts the start; stop one short so the end always fits.
  while (cursor < due && days.length < MAX_SPAN_DAYS - 1) {
    days.push({ day: cursor, position: "middle" });
    cursor = shiftCalendarDate(cursor, 1);
  }
  days.push({ day: due, position: "end" });
  return days;
}

/** True when the item runs over more than one day. */
export const isSpan = (item: DatedWorkItem): boolean => {
  const due = dayOf(item.dueDate);
  const start = dayOf(item.startDate);
  return !!due && !!start && start < due;
};

/**
 * The text a spanning row carries on the strip, e.g. "runs 12 Oct → 14 Oct,
 * day 2 of 3". Without it a middle day is indistinguishable from an item that
 * is simply due that day, which is the whole thing the span was added to say.
 */
export function spanCaption(
  item: DatedWorkItem,
  day: CalendarDate,
  format: (d: CalendarDate) => string,
): string | null {
  const due = dayOf(item.dueDate);
  const start = dayOf(item.startDate);
  if (!due || !start || start >= due) return null;

  const total = daysBetween(start, due) + 1;
  const index = daysBetween(start, day) + 1;
  return `${format(start)} → ${format(due)} · day ${index} of ${total}`;
}

/** Whole calendar days from `a` to `b`, by UTC parts — never by dividing an
 *  instant difference, which a DST shift makes fractional. */
export function daysBetween(a: CalendarDate, b: CalendarDate): number {
  const toUtc = (d: CalendarDate) => {
    const [y, m, day] = d.split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}
