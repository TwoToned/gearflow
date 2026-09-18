import { datePartsInTimezone } from "./projectNumber";
import { addCalendarDays, startOfDayInTimezone } from "./quoteDates";
import type { WorkRecurrenceFrequency } from "./workVocabulary";

/**
 * Recurrence next-occurrence math (#1244, design §8.2: "the next occurrence
 * is created when the current one is done (Todoist model), never
 * pre-generated"). Convex-side only — unlike workVocabulary.ts, this is not
 * shared with the client (nothing previews "next due date" in the UI yet),
 * so it's free to import the existing org-timezone helpers rather than stay
 * import-free. Every day boundary resolves in the ORG's timezone (R-9.3),
 * never UTC or the browser's — same rule as quoteDates.ts itself.
 */

export interface WorkRecurrenceSpec {
  freq: WorkRecurrenceFrequency;
  daysOfWeek?: number[];
  dayOfMonth?: number;
}

function instantFromParts(year: number, month: number, day: number, timezone?: string): number {
  return startOfDayInTimezone(Date.UTC(year, month - 1, day), timezone);
}

/**
 * The next occurrence's due date, given the CURRENT occurrence's due date
 * (or, absent a due date, `now`) and its recurrence rule. Always strictly
 * after the input instant.
 */
export function computeNextOccurrenceDueDate(
  fromMs: number,
  recurrence: WorkRecurrenceSpec,
  timezone?: string,
): number {
  const parts = datePartsInTimezone(new Date(fromMs), timezone);

  if (recurrence.freq === "daily") {
    const next = addCalendarDays(parts, 1);
    return instantFromParts(next.year, next.month, next.day, timezone);
  }

  if (recurrence.freq === "weekly") {
    const days = (recurrence.daysOfWeek ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    if (days.length === 0) {
      const next = addCalendarDays(parts, 7);
      return instantFromParts(next.year, next.month, next.day, timezone);
    }
    for (let offset = 1; offset <= 7; offset++) {
      const cand = addCalendarDays(parts, offset);
      const dow = new Date(Date.UTC(cand.year, cand.month - 1, cand.day)).getUTCDay();
      if (days.includes(dow)) return instantFromParts(cand.year, cand.month, cand.day, timezone);
    }
    // Unreachable (a week always contains every weekday), but keep a safe
    // fallback rather than throw inside a mutation over a malformed rule.
    const next = addCalendarDays(parts, 7);
    return instantFromParts(next.year, next.month, next.day, timezone);
  }

  // monthly — same day-of-month next month, clamped to the shorter month
  // (e.g. the 31st recurs on the 30th of a 30-day month).
  const dayOfMonth = recurrence.dayOfMonth ?? parts.day;
  const nextMonth = parts.month === 12 ? 1 : parts.month + 1;
  const nextYear = parts.month === 12 ? parts.year + 1 : parts.year;
  const daysInNextMonth = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
  const clampedDay = Math.min(Math.max(1, dayOfMonth), daysInNextMonth);
  return instantFromParts(nextYear, nextMonth, clampedDay, timezone);
}
