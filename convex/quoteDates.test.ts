// @vitest-environment node
//
// convex/lib/quoteDates.ts — quote validity + expiry maths (#986).
//
// Two jobs:
//  1. PIN the duplication. The Convex bundler can't resolve `@/`, so this module
//     is a byte-for-byte mirror of src/lib/quote-validity.ts. This test imports
//     BOTH copies and asserts identical output over a matrix (same pattern as
//     convex/projectNumber.test.ts).
//  2. Prove the day-boundary behaviour the whole feature rests on: `validUntil`
//     is the END of its calendar day IN THE ORG'S TIMEZONE, resolved correctly
//     across DST transitions in both directions and across the year boundary. A
//     quote must not expire a day early for a PM in another state.
import { describe, test, expect } from "vitest";
import {
  addCalendarDays as convexAddDays,
  computeValidUntil as convexValidUntil,
  daysUntilValidUntil as convexDaysUntil,
  endOfDayInTimezone as convexEndOfDay,
  isPastValidUntil as convexIsPast,
  resolveQuoteValidityDays as convexResolveDays,
  startOfDayInTimezone as convexStartOfDay,
  DEFAULT_QUOTE_VALIDITY_DAYS as CONVEX_DEFAULT,
  QUOTE_EXPIRING_SOON_DAYS as CONVEX_EXPIRING_SOON,
  QUOTE_VALIDITY_BOUNDS as CONVEX_BOUNDS,
} from "./lib/quoteDates";
import {
  addCalendarDays as srcAddDays,
  computeValidUntil as srcValidUntil,
  daysUntilValidUntil as srcDaysUntil,
  endOfDayInTimezone as srcEndOfDay,
  isPastValidUntil as srcIsPast,
  resolveQuoteValidityDays as srcResolveDays,
  startOfDayInTimezone as srcStartOfDay,
  DEFAULT_QUOTE_VALIDITY_DAYS as SRC_DEFAULT,
  QUOTE_EXPIRING_SOON_DAYS as SRC_EXPIRING_SOON,
  QUOTE_VALIDITY_BOUNDS as SRC_BOUNDS,
} from "@/lib/quote-validity";

const DAY = 86_400_000;

const TIMEZONES = [
  undefined,
  "UTC",
  "Australia/Sydney", // DST, southern hemisphere, +10/+11
  "Australia/Brisbane", // no DST, +10 — the "same state, different rules" case
  "America/New_York", // DST, northern hemisphere, -5/-4
  "Asia/Kolkata", // +5:30 — a half-hour offset
  "Pacific/Chatham", // +12:45/+13:45 — a quarter-hour offset with DST
  "Not/AZone", // unresolvable → falls back to UTC, never throws
];

const INSTANTS = [
  Date.UTC(2026, 0, 1, 0, 0, 0), // year boundary
  Date.UTC(2026, 3, 4, 15, 30, 0), // AU DST end weekend (5 Apr 2026, 3am → 2am)
  Date.UTC(2026, 9, 3, 14, 0, 0), // AU DST start weekend (4 Oct 2026, 2am → 3am)
  Date.UTC(2026, 2, 8, 6, 59, 0), // US DST start (8 Mar 2026)
  Date.UTC(2026, 10, 1, 5, 59, 0), // US DST end (1 Nov 2026)
  Date.UTC(2026, 1, 27, 23, 59, 0), // leap-adjacent (2026 is not a leap year)
  Date.UTC(2024, 1, 28, 12, 0, 0), // leap year, day before 29 Feb
  Date.UTC(2026, 6, 26, 4, 0, 0), // the design doc's worked example (26 Jul)
];

const VALIDITY_DAYS = [1, 7, 14, 30, 45, 365];

describe("quoteDates — convex/lib == src/lib (byte-for-byte pin)", () => {
  test("the shared constants are identical", () => {
    expect(CONVEX_DEFAULT).toBe(SRC_DEFAULT);
    expect(CONVEX_EXPIRING_SOON).toBe(SRC_EXPIRING_SOON);
    expect(CONVEX_BOUNDS).toEqual(SRC_BOUNDS);
  });

  test("every function agrees across the timezone × instant × validity matrix", () => {
    for (const tz of TIMEZONES) {
      for (const instant of INSTANTS) {
        expect(convexStartOfDay(instant, tz)).toBe(srcStartOfDay(instant, tz));
        expect(convexEndOfDay(instant, tz)).toBe(srcEndOfDay(instant, tz));
        for (const days of VALIDITY_DAYS) {
          expect(convexValidUntil(instant, days, tz)).toBe(srcValidUntil(instant, days, tz));
        }
      }
    }
    for (const days of [-1, 0, 1, 31, 365, 400]) {
      expect(convexAddDays({ year: 2026, month: 7, day: 26 }, days)).toEqual(
        srcAddDays({ year: 2026, month: 7, day: 26 }, days),
      );
    }
    for (const configured of [undefined, null, 0, 1, 30, 365, 366, 14.5]) {
      expect(convexResolveDays(configured)).toBe(srcResolveDays(configured));
    }
    expect(convexIsPast(100, 200)).toBe(srcIsPast(100, 200));
    expect(convexDaysUntil(100, 200)).toBe(srcDaysUntil(100, 200));
  });
});

describe("computeValidUntil — the day-boundary contract", () => {
  test("lands on the END of the Nth calendar day after the quote date", () => {
    // The design doc's worked example: dated 26 Jul, valid 30 days → 25 Aug.
    const quoteDate = Date.UTC(2026, 6, 26, 9, 15, 0);
    const validUntil = computeIn("UTC", quoteDate, 30);
    expect(new Date(validUntil).toISOString()).toBe("2026-08-25T23:59:59.999Z");
  });

  test("resolves in the ORG's timezone, not the server's", () => {
    const quoteDate = Date.UTC(2026, 6, 26, 9, 15, 0); // 26 Jul UTC = 26 Jul 19:15 Sydney
    const sydney = computeIn("Australia/Sydney", quoteDate, 7);
    // 26 Jul 19:15 Sydney + 7 days = 2 Aug; end of 2 Aug at +10 = 2 Aug 13:59:59.999Z.
    expect(new Date(sydney).toISOString()).toBe("2026-08-02T13:59:59.999Z");
    expect(localPartsIn("Australia/Sydney", sydney)).toBe("2026-08-02 23:59:59");
    // A UTC-resolved answer would have been 10 hours later — that gap is exactly
    // the "expires a day early for a PM in another state" bug.
    expect(sydney).toBeLessThan(computeIn("UTC", quoteDate, 7));
  });

  test("a quote spanning a DST START keeps a whole final day (the 23h day)", () => {
    // Sydney springs forward 2am → 3am on 4 Oct 2026.
    const quoteDate = Date.UTC(2026, 8, 27, 2, 0, 0); // 27 Sep 12:00 Sydney
    const validUntil = computeIn("Australia/Sydney", quoteDate, 10); // → 7 Oct
    // 7 Oct is post-transition (+11), so end-of-day is 12:59:59.999Z.
    expect(new Date(validUntil).toISOString()).toBe("2026-10-07T12:59:59.999Z");
    expect(localPartsIn("Australia/Sydney", validUntil)).toBe("2026-10-07 23:59:59");
  });

  test("a quote spanning a DST END keeps a whole final day (the 25h day)", () => {
    // Sydney falls back 3am → 2am on 5 Apr 2026.
    const quoteDate = Date.UTC(2026, 2, 28, 2, 0, 0); // 28 Mar 13:00 Sydney (+11)
    const validUntil = computeIn("Australia/Sydney", quoteDate, 14); // → 11 Apr (+10)
    expect(new Date(validUntil).toISOString()).toBe("2026-04-11T13:59:59.999Z");
    expect(localPartsIn("Australia/Sydney", validUntil)).toBe("2026-04-11 23:59:59");
  });

  test("northern-hemisphere DST is handled the same way", () => {
    const quoteDate = Date.UTC(2026, 2, 1, 17, 0, 0); // 1 Mar 12:00 New York (-5)
    const validUntil = computeIn("America/New_York", quoteDate, 14); // → 15 Mar (-4)
    expect(localPartsIn("America/New_York", validUntil)).toBe("2026-03-15 23:59:59");
  });

  test("half- and quarter-hour offsets land on the local day, not a rounded one", () => {
    const quoteDate = Date.UTC(2026, 6, 26, 20, 0, 0); // 27 Jul 01:30 Kolkata
    expect(localPartsIn("Asia/Kolkata", computeIn("Asia/Kolkata", quoteDate, 30))).toBe("2026-08-26 23:59:59");
    expect(localPartsIn("Pacific/Chatham", computeIn("Pacific/Chatham", quoteDate, 30))).toBe("2026-08-26 23:59:59");
  });

  test("crosses month, year and leap-day boundaries", () => {
    expect(localPartsIn("UTC", computeIn("UTC", Date.UTC(2026, 11, 20), 30))).toBe("2027-01-19 23:59:59");
    expect(localPartsIn("UTC", computeIn("UTC", Date.UTC(2024, 1, 15), 30))).toBe("2024-03-16 23:59:59"); // via 29 Feb
  });

  test("an unresolvable timezone degrades to UTC instead of throwing", () => {
    expect(computeIn("Not/AZone", Date.UTC(2026, 6, 26), 30)).toBe(computeIn("UTC", Date.UTC(2026, 6, 26), 30));
  });
});

describe("expiry derivation", () => {
  const quoteDate = Date.UTC(2026, 6, 26, 9, 0, 0);
  const validUntil = computeIn("Australia/Sydney", quoteDate, 7);

  test("is not expired at any point on the final local day, and is the instant after", () => {
    expect(convexIsPast(validUntil, validUntil)).toBe(false);
    expect(convexIsPast(validUntil, validUntil - 1)).toBe(false);
    expect(convexIsPast(validUntil, validUntil + 1)).toBe(true);
  });

  test("never expires for an unstamped (draft) revision", () => {
    expect(convexIsPast(undefined, Date.now())).toBe(false);
    expect(convexIsPast(null, Date.now())).toBe(false);
  });

  test("daysUntilValidUntil counts down to 0 on the final day and goes negative after", () => {
    expect(convexDaysUntil(validUntil, validUntil - 3 * DAY)).toBe(3);
    expect(convexDaysUntil(validUntil, validUntil - 1)).toBe(0);
    expect(convexDaysUntil(validUntil, validUntil + DAY)).toBe(-1);
    expect(convexDaysUntil(null, 0)).toBeNull();
  });
});

describe("resolveQuoteValidityDays", () => {
  test("falls back to the default for unset, non-integer or out-of-range values", () => {
    expect(convexResolveDays(undefined)).toBe(CONVEX_DEFAULT);
    expect(convexResolveDays(null)).toBe(CONVEX_DEFAULT);
    expect(convexResolveDays(0)).toBe(CONVEX_DEFAULT);
    expect(convexResolveDays(366)).toBe(CONVEX_DEFAULT);
    expect(convexResolveDays(14.5)).toBe(CONVEX_DEFAULT);
  });

  test("passes through anything inside the shared bounds", () => {
    expect(convexResolveDays(CONVEX_BOUNDS.min)).toBe(CONVEX_BOUNDS.min);
    expect(convexResolveDays(CONVEX_BOUNDS.max)).toBe(CONVEX_BOUNDS.max);
    expect(convexResolveDays(7)).toBe(7);
  });
});

// ── helpers ────────────────────────────────────────────────────────────────
function computeIn(timezone: string, quoteDateMs: number, days: number): number {
  return convexValidUntil(quoteDateMs, days, timezone);
}

/** "YYYY-MM-DD HH:mm:ss" as read in `timezone` — asserts the LOCAL wall clock,
 *  which is the thing the feature actually promises. */
function localPartsIn(timezone: string, instantMs: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}:${get("second")}`;
}
