import { describe, expect, test } from "vitest";
import {
  inclusiveCalendarDays,
  splitWeeksDays,
  computeBlendedCharge,
  formatPriceBreakdown,
  parsePriceBreakdown,
  serializePriceBreakdown,
  deriveBillingSummary,
  isBreakdownStale,
  roundMoney,
  type PriceBreakdown,
} from "./billing-derivation";

const DAY = 86_400_000;
const d = (n: number) => n * DAY; // epoch-ms helper: day N since epoch

describe("inclusiveCalendarDays", () => {
  test("same day = 1", () => {
    expect(inclusiveCalendarDays(d(0), d(0))).toBe(1);
  });
  test("Fri→Mon = 4 (inclusive)", () => {
    expect(inclusiveCalendarDays(d(0), d(3))).toBe(4);
  });
  test("null dates default to 1 day", () => {
    expect(inclusiveCalendarDays(null, null)).toBe(1);
    expect(inclusiveCalendarDays(d(0), null)).toBe(1);
    expect(inclusiveCalendarDays(undefined, d(5))).toBe(1);
  });
  test("non-finite input defaults to 1 day", () => {
    expect(inclusiveCalendarDays(NaN, d(5))).toBe(1);
  });
  test("mid-day timestamps still floor to calendar days", () => {
    const start = d(0) + 20 * 60 * 60 * 1000; // 8pm day 0
    const end = d(1) + 2 * 60 * 60 * 1000; // 2am day 1
    expect(inclusiveCalendarDays(start, end)).toBe(2);
  });
});

describe("splitWeeksDays", () => {
  test.each([
    [1, 0, 1],
    [6, 0, 6],
    [7, 1, 0],
    [8, 1, 1],
    [13, 1, 6],
    [14, 2, 0],
  ])("%i days -> %i weeks, %i remainder days", (total, weeks, days) => {
    expect(splitWeeksDays(total)).toEqual({ weeks, days });
  });
});

// The full derivation matrix from the issue: 1d/2d/6d-cap/7d/8d/13d-cap/14d,
// daily-only models, null dates. Rates chosen so a week (100) costs less than
// 6 daily days (6*20=120) — the standard capping scenario.
const DAILY = 20;
const WEEKLY = 100;

describe("computeBlendedCharge — derivation matrix (weekly + daily tiers)", () => {
  test("1 day", () => {
    const { perUnitCharge, breakdown } = computeBlendedCharge({ chargeableDays: 1, dailyRate: DAILY, weeklyRate: WEEKLY });
    expect(breakdown).toEqual({ weeks: 0, days: 1, weeklyRate: WEEKLY, dailyRate: DAILY, capped: false });
    expect(perUnitCharge).toBe(20);
  });

  test("2 days", () => {
    const { perUnitCharge, breakdown } = computeBlendedCharge({ chargeableDays: 2, dailyRate: DAILY, weeklyRate: WEEKLY });
    expect(breakdown).toEqual({ weeks: 0, days: 2, weeklyRate: WEEKLY, dailyRate: DAILY, capped: false });
    expect(perUnitCharge).toBe(40);
  });

  test("6 days — capped (6×daily=120 > 1×weekly=100)", () => {
    const { perUnitCharge, breakdown } = computeBlendedCharge({ chargeableDays: 6, dailyRate: DAILY, weeklyRate: WEEKLY });
    expect(breakdown).toEqual({ weeks: 1, days: 0, weeklyRate: WEEKLY, dailyRate: DAILY, capped: true });
    expect(perUnitCharge).toBe(100);
  });

  test("7 days — exactly one week, never capped (no remainder)", () => {
    const { perUnitCharge, breakdown } = computeBlendedCharge({ chargeableDays: 7, dailyRate: DAILY, weeklyRate: WEEKLY });
    expect(breakdown).toEqual({ weeks: 1, days: 0, weeklyRate: WEEKLY, dailyRate: DAILY, capped: false });
    expect(perUnitCharge).toBe(100);
  });

  test("8 days — 1 week + 1 day, not capped (100+20=120 < 2×100=200)", () => {
    const { perUnitCharge, breakdown } = computeBlendedCharge({ chargeableDays: 8, dailyRate: DAILY, weeklyRate: WEEKLY });
    expect(breakdown).toEqual({ weeks: 1, days: 1, weeklyRate: WEEKLY, dailyRate: DAILY, capped: false });
    expect(perUnitCharge).toBe(120);
  });

  test("13 days — capped to 2 weeks (1wk+6d=100+120=220 > 2×100=200)", () => {
    const { perUnitCharge, breakdown } = computeBlendedCharge({ chargeableDays: 13, dailyRate: DAILY, weeklyRate: WEEKLY });
    expect(breakdown).toEqual({ weeks: 2, days: 0, weeklyRate: WEEKLY, dailyRate: DAILY, capped: true });
    expect(perUnitCharge).toBe(200);
  });

  test("14 days — exactly two weeks, never capped", () => {
    const { perUnitCharge, breakdown } = computeBlendedCharge({ chargeableDays: 14, dailyRate: DAILY, weeklyRate: WEEKLY });
    expect(breakdown).toEqual({ weeks: 2, days: 0, weeklyRate: WEEKLY, dailyRate: DAILY, capped: false });
    expect(perUnitCharge).toBe(200);
  });

  test("daily-only model (no weeklyRate) — plain days × dailyRate, never capped", () => {
    const { perUnitCharge, breakdown } = computeBlendedCharge({ chargeableDays: 10, dailyRate: DAILY, weeklyRate: null });
    expect(breakdown).toEqual({ weeks: 0, days: 10, weeklyRate: null, dailyRate: DAILY, capped: false });
    expect(perUnitCharge).toBe(200);
  });

  test("null dailyRate + weeklyRate set — remainder days charge as 0 (no daily rate to fall back on)", () => {
    const { perUnitCharge, breakdown } = computeBlendedCharge({ chargeableDays: 8, dailyRate: null, weeklyRate: WEEKLY });
    // uncapped = 1*100 + 1*0 = 100; capped = 2*100 = 200 -> uncapped wins (not capped)
    expect(breakdown).toEqual({ weeks: 1, days: 1, weeklyRate: WEEKLY, dailyRate: null, capped: false });
    expect(perUnitCharge).toBe(100);
  });

  test("null dates (via inclusiveCalendarDays default) -> 1 day", () => {
    const days = inclusiveCalendarDays(null, null);
    const { breakdown } = computeBlendedCharge({ chargeableDays: days, dailyRate: DAILY, weeklyRate: WEEKLY });
    expect(breakdown).toEqual({ weeks: 0, days: 1, weeklyRate: WEEKLY, dailyRate: DAILY, capped: false });
  });

  test("both rates missing — $0 charge, no throw", () => {
    const { perUnitCharge, breakdown } = computeBlendedCharge({ chargeableDays: 5, dailyRate: null, weeklyRate: null });
    expect(perUnitCharge).toBe(0);
    expect(breakdown.capped).toBe(false);
  });
});

describe("formatPriceBreakdown", () => {
  test("uncapped weeks + days", () => {
    const b: PriceBreakdown = { weeks: 2, days: 3, weeklyRate: 50, dailyRate: 10, capped: false };
    expect(formatPriceBreakdown(b)).toBe("2 wk @ $50.00 + 3 d @ $10.00");
  });
  test("capped", () => {
    const b: PriceBreakdown = { weeks: 1, days: 0, weeklyRate: 100, dailyRate: 20, capped: true };
    expect(formatPriceBreakdown(b)).toBe("charged as 1 wk (capped)");
  });
  test("daily-only", () => {
    const b: PriceBreakdown = { weeks: 0, days: 4, weeklyRate: null, dailyRate: 25, capped: false };
    expect(formatPriceBreakdown(b)).toBe("4 d @ $25.00");
  });
});

describe("serialize/parsePriceBreakdown round-trip", () => {
  test("round-trips cleanly", () => {
    const b: PriceBreakdown = { weeks: 1, days: 2, weeklyRate: 100, dailyRate: 20, capped: false };
    expect(parsePriceBreakdown(serializePriceBreakdown(b))).toEqual(b);
  });
  test("null/malformed input returns null, never throws", () => {
    expect(parsePriceBreakdown(null)).toBeNull();
    expect(parsePriceBreakdown(undefined)).toBeNull();
    expect(parsePriceBreakdown("not json")).toBeNull();
    expect(parsePriceBreakdown('{"weeks": "not a number"}')).toBeNull();
  });
});

describe("deriveBillingSummary", () => {
  test("derived when no override", () => {
    expect(
      deriveBillingSummary({ rentalStartMs: d(0), rentalEndMs: d(7), weeksOverride: null, daysOverride: null }),
    ).toEqual({ weeks: 1, days: 1, edited: false });
  });
  test("override wins and flips the edited marker", () => {
    expect(
      deriveBillingSummary({ rentalStartMs: d(0), rentalEndMs: d(7), weeksOverride: 3, daysOverride: null }),
    ).toEqual({ weeks: 3, days: 1, edited: true });
  });
  test("both overridden", () => {
    expect(
      deriveBillingSummary({ rentalStartMs: null, rentalEndMs: null, weeksOverride: 0, daysOverride: 5 }),
    ).toEqual({ weeks: 0, days: 5, edited: true });
  });
});

describe("isBreakdownStale", () => {
  test("identical breakdowns are not stale", () => {
    const b: PriceBreakdown = { weeks: 1, days: 2, weeklyRate: 100, dailyRate: 20, capped: false };
    expect(isBreakdownStale(b, { ...b })).toBe(false);
  });
  test("changed weeks/days is stale", () => {
    const stored: PriceBreakdown = { weeks: 1, days: 2, weeklyRate: 100, dailyRate: 20, capped: false };
    const fresh: PriceBreakdown = { weeks: 2, days: 0, weeklyRate: 100, dailyRate: 20, capped: false };
    expect(isBreakdownStale(stored, fresh)).toBe(true);
  });
  test("changed capped flag is stale", () => {
    const stored: PriceBreakdown = { weeks: 1, days: 0, weeklyRate: 100, dailyRate: 20, capped: true };
    const fresh: PriceBreakdown = { weeks: 1, days: 0, weeklyRate: 100, dailyRate: 20, capped: false };
    expect(isBreakdownStale(stored, fresh)).toBe(true);
  });
});

test("roundMoney half-up on cents", () => {
  expect(roundMoney(1.005)).toBeCloseTo(1, 2);
  expect(roundMoney(19.999)).toBe(20);
});
