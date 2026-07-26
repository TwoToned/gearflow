/**
 * Pure calendar-cadence math for WS6 #945 recurring preventative maintenance.
 *
 * Locked decision (docs/research/rentman-gap-priorities.md tracking issue #936,
 * Tier-2 outcomes): fixed calendar cadence = interval (months) + anchor date.
 * The whole pool comes due together on a fixed schedule; late completion does
 * NOT shift the next due date — so cycle k's due date is always computed from
 * the ORIGINAL anchor (`anchor + k*intervalMonths`), never by adding the
 * interval to whichever due date most recently fired (which would drift a
 * Jan-31 anchor to Feb-28, then Mar-28 instead of Mar-31).
 *
 * All math is UTC-based (calendar days, not timezone-sensitive wall-clock).
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** One-time migration helper: nearest whole month for a day-based interval
 *  (models.maintenanceIntervalDays -> serviceSchedules.intervalMonths). Floors
 *  at 1 month — a schedule with a 0-month cadence is meaningless. */
export function daysToNearestMonths(days: number): number {
  return Math.max(1, Math.round(days / 30));
}

/**
 * Add `months` calendar months to `anchorMs` (UTC), clamping the day-of-month
 * to the last day of the resulting month when the original day doesn't exist
 * there (e.g. Jan 31 + 1 month -> Feb 28, or Feb 29 on a leap year). Time-of-day
 * (hours/minutes/seconds/ms) is preserved from the anchor.
 */
export function addMonthsClamped(anchorMs: number, months: number): number {
  const a = new Date(anchorMs);
  const targetMonthIndex = a.getUTCMonth() + months;
  const targetYear = a.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;

  // Day 0 of the month AFTER the target = the last day of the target month.
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(a.getUTCDate(), lastDayOfTargetMonth);

  return Date.UTC(
    targetYear,
    targetMonth,
    day,
    a.getUTCHours(),
    a.getUTCMinutes(),
    a.getUTCSeconds(),
    a.getUTCMilliseconds(),
  );
}

/** The due date (epoch ms) for cycle `k` (0-indexed; cycle 0 = the anchor itself). */
export function dueDateForCycle(anchorMs: number, intervalMonths: number, k: number): number {
  return addMonthsClamped(anchorMs, intervalMonths * k);
}

/**
 * The highest cycle index `k` whose due date is `<= nowMs`, or `null` if even
 * cycle 0 (the anchor) is still in the future (the schedule hasn't started
 * yet). Approximates `k` from a calendar month-count then corrects by a
 * bounded walk — avoids iterating from k=0 for an anchor set years in the past.
 */
export function currentCycleIndex(
  anchorMs: number,
  intervalMonths: number,
  nowMs: number,
): number | null {
  if (intervalMonths < 1) throw new RangeError("intervalMonths must be >= 1");
  if (nowMs < anchorMs) return null;

  const a = new Date(anchorMs);
  const n = new Date(nowMs);
  const monthDiff = (n.getUTCFullYear() - a.getUTCFullYear()) * 12 + (n.getUTCMonth() - a.getUTCMonth());
  let k = Math.max(0, Math.floor(monthDiff / intervalMonths));

  // Correct forward: approximation can undershoot when `now`'s day-of-month is
  // past the anchor's (or clamping pulled a due date earlier in its month).
  while (dueDateForCycle(anchorMs, intervalMonths, k + 1) <= nowMs) k++;
  // Correct backward: approximation can overshoot the opposite way.
  while (k > 0 && dueDateForCycle(anchorMs, intervalMonths, k) > nowMs) k--;

  return dueDateForCycle(anchorMs, intervalMonths, k) <= nowMs ? k : null;
}

/** The due date (epoch ms) of the current cycle, or `null` if not due yet. */
export function resolveCurrentDueDate(
  anchorMs: number,
  intervalMonths: number,
  nowMs: number,
): number | null {
  const k = currentCycleIndex(anchorMs, intervalMonths, nowMs);
  return k === null ? null : dueDateForCycle(anchorMs, intervalMonths, k);
}

/** Whole days between two epoch-ms timestamps (used only for test fixtures/debugging). */
export function daysBetween(aMs: number, bMs: number): number {
  return Math.round((bMs - aMs) / MS_PER_DAY);
}
