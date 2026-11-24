/**
 * The ONE next-due rule for a test & tag record (D52, Phase 16): next due = the test
 * date plus the asset's interval in calendar months. It is DERIVED, never typed — the
 * server computes it in `testTagRecordsWrites.createNative`, and the Scan page displays
 * the same function's result (src imports this module, following the `warehouseStage`
 * precedent), so the date a tester sees is the date that is stored.
 *
 * A FAILED test stores the same derived date (owner, 2026-11-21): the UI reads it as
 * "Next due after repair", and the asset stays FAILED until a passing test, so the
 * reminder digest never treats an unrepaired fail as merely overdue.
 *
 * Calendar months in UTC, clamped at month end: 31 Jan + 1 month = 28 Feb (29 in a
 * leap year), never 3 Mar. The time of day is kept.
 */

/** The interval an asset without one is tested on — matches `testTagAssetsWrites`' create default. */
export const DEFAULT_TEST_INTERVAL_MONTHS = 3;

function daysInUtcMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** `testDate` + `months` calendar months (UTC, clamped at month end). A missing or
 *  non-positive interval falls back to {@link DEFAULT_TEST_INTERVAL_MONTHS}. */
export function deriveNextDueDate(testDate: number, months: number | null | undefined): number {
  const interval = months && months > 0 ? Math.floor(months) : DEFAULT_TEST_INTERVAL_MONTHS;
  const d = new Date(testDate);
  const total = d.getUTCMonth() + interval;
  const year = d.getUTCFullYear() + Math.floor(total / 12);
  const monthIndex = total % 12;
  const day = Math.min(d.getUTCDate(), daysInUtcMonth(year, monthIndex));
  return Date.UTC(
    year,
    monthIndex,
    day,
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  );
}
