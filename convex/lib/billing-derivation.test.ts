// @vitest-environment node
import { describe, expect, test } from "vitest";
import * as convexSide from "./billing-derivation";
import * as srcSide from "@/lib/billing-derivation";

/**
 * Parity pin (issue #943 / WS4): `convex/lib/billing-derivation.ts` is a
 * byte-parity port of `src/lib/billing-derivation.ts` (Convex mutations can't
 * import outside `convex/`, so the pure math is duplicated). This test proves
 * both copies produce IDENTICAL output across the full derivation matrix —
 * the "money gate" for this formula, same role as convex/recalc.test.ts /
 * convex/allocation.test.ts play for their own formulas. A future edit to one
 * copy without the other fails here before it ever reaches production.
 */

const DAY = 86_400_000;
const d = (n: number) => n * DAY;

describe("billing-derivation parity — src/lib vs convex/lib", () => {
  test.each([
    ["null/null dates", null, null],
    ["same day", d(0), d(0)],
    ["Fri->Mon (4d)", d(0), d(3)],
    ["6 days", d(0), d(5)],
    ["7 days", d(0), d(6)],
    ["8 days", d(0), d(7)],
    ["13 days", d(0), d(12)],
    ["14 days", d(0), d(13)],
    ["30 days", d(0), d(29)],
  ])("inclusiveCalendarDays parity: %s", (_label, start, end) => {
    expect(convexSide.inclusiveCalendarDays(start, end)).toBe(srcSide.inclusiveCalendarDays(start, end));
  });

  test.each([1, 2, 6, 7, 8, 13, 14, 21, 30, 90])("splitWeeksDays parity: %i days", (days) => {
    expect(convexSide.splitWeeksDays(days)).toEqual(srcSide.splitWeeksDays(days));
  });

  const RATE_CASES: Array<{ chargeableDays: number; dailyRate: number | null; weeklyRate: number | null }> = [
    { chargeableDays: 1, dailyRate: 20, weeklyRate: 100 },
    { chargeableDays: 2, dailyRate: 20, weeklyRate: 100 },
    { chargeableDays: 6, dailyRate: 20, weeklyRate: 100 },
    { chargeableDays: 7, dailyRate: 20, weeklyRate: 100 },
    { chargeableDays: 8, dailyRate: 20, weeklyRate: 100 },
    { chargeableDays: 13, dailyRate: 20, weeklyRate: 100 },
    { chargeableDays: 14, dailyRate: 20, weeklyRate: 100 },
    { chargeableDays: 10, dailyRate: 20, weeklyRate: null }, // daily-only model
    { chargeableDays: 8, dailyRate: null, weeklyRate: 100 }, // weekly-only model
    { chargeableDays: 5, dailyRate: null, weeklyRate: null }, // no rates at all
    { chargeableDays: 9, dailyRate: 45.5, weeklyRate: 199.99 }, // fractional rates
  ];

  test.each(RATE_CASES)(
    "computeBlendedCharge parity: %j",
    ({ chargeableDays, dailyRate, weeklyRate }) => {
      const a = convexSide.computeBlendedCharge({ chargeableDays, dailyRate, weeklyRate });
      const b = srcSide.computeBlendedCharge({ chargeableDays, dailyRate, weeklyRate });
      expect(a).toEqual(b);
    },
  );

  test.each([
    [d(0), d(7), null, null],
    [d(0), d(7), 3, null],
    [null, null, 0, 5],
  ])("deriveBillingSummary parity", (rentalStartMs, rentalEndMs, weeksOverride, daysOverride) => {
    const a = convexSide.deriveBillingSummary({ rentalStartMs, rentalEndMs, weeksOverride, daysOverride });
    const b = srcSide.deriveBillingSummary({ rentalStartMs, rentalEndMs, weeksOverride, daysOverride });
    expect(a).toEqual(b);
  });

  test("isBreakdownStale parity", () => {
    const stored = { weeks: 1, days: 2, weeklyRate: 100, dailyRate: 20, capped: false };
    const fresh = { weeks: 2, days: 0, weeklyRate: 100, dailyRate: 20, capped: false };
    expect(convexSide.isBreakdownStale(stored, fresh)).toBe(srcSide.isBreakdownStale(stored, fresh));
    expect(convexSide.isBreakdownStale(stored, { ...stored })).toBe(srcSide.isBreakdownStale(stored, { ...stored }));
  });
});
