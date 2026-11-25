import { datePartsInTimezone } from "./projectNumber";

/**
 * The ONE rule for "is this task late" (UX Phase 10, owner ruling Q4).
 *
 * A task's `dueDate` is stored as UTC midnight of the calendar date the user
 * typed (`new Date("YYYY-MM-DD").getTime()`), so its CALENDAR DAY is the UTC day
 * of that instant, whatever the viewer's timezone. "Today" is the calendar day
 * `now` falls on in the ORG's timezone (`orgSettings.timezone`, the one invoice
 * due days use); with no timezone stored, UTC. A task is overdue when its due
 * day is before today and it is still open. The client, the readiness query and
 * the tab badge all call this; none keeps its own copy.
 */

export type TaskDueBucket = "OVERDUE" | "TODAY" | "TOMORROW" | "THIS_WEEK" | "LATER" | "NO_DATE";

const DAY_MS = 24 * 60 * 60 * 1000;

const dayNumber = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);

/**
 * The zone "today" is read in: the org's, and UTC when none is stored OR the stored
 * one is not a real IANA zone. Never the PROCESS zone: `datePartsInTimezone`
 * with no zone uses the host's, so the browser and the server would disagree on what
 * day it is. This is the ONE place that default lives.
 */
export function dueClockZone(timezone: string | undefined | null): string {
  if (!timezone) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return timezone;
  } catch {
    return "UTC";
  }
}

/** The org-local calendar day of `now`, as a whole day number. */
export function todayDayNumber(now: number, timezone?: string): number {
  const p = datePartsInTimezone(new Date(now), dueClockZone(timezone));
  return dayNumber(p.year, p.month, p.day);
}

/** The stored due date's calendar day, as a whole day number (UTC day). */
export function dueDayNumber(dueDate: number): number {
  return Math.floor(dueDate / DAY_MS);
}

const isOpen = (status: string | undefined) => status === "TODO" || status === "IN_PROGRESS";

export function isTaskOverdue(task: { status?: string; dueDate?: number | null }, now: number, timezone?: string): boolean {
  if (!isOpen(task.status) || task.dueDate == null) return false;
  return dueDayNumber(task.dueDate) < todayDayNumber(now, timezone);
}

/** "This week" = the next 2–6 days after tomorrow (a rolling week, no week-start dependence). */
export function taskDueBucket(dueDate: number | null | undefined, now: number, timezone?: string): TaskDueBucket {
  if (dueDate == null) return "NO_DATE";
  const diff = dueDayNumber(dueDate) - todayDayNumber(now, timezone);
  if (diff < 0) return "OVERDUE";
  if (diff === 0) return "TODAY";
  if (diff === 1) return "TOMORROW";
  return diff <= 6 ? "THIS_WEEK" : "LATER";
}
