// @vitest-environment node
// D52 — the one next-due rule (convex/lib/testTagNextDue.ts).
import { describe, expect, test } from "vitest";
import { DEFAULT_TEST_INTERVAL_MONTHS, deriveNextDueDate } from "./testTagNextDue";

const utc = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min);

describe("deriveNextDueDate", () => {
  test("adds calendar months and keeps the time of day", () => {
    expect(deriveNextDueDate(utc(2026, 11, 21, 14, 5), 3)).toBe(utc(2027, 2, 21, 14, 5));
  });

  test("rolls over the year", () => {
    expect(deriveNextDueDate(utc(2026, 11, 30), 12)).toBe(utc(2027, 11, 30));
    expect(deriveNextDueDate(utc(2026, 12, 15), 1)).toBe(utc(2027, 1, 15));
  });

  test("clamps at month end (never spills into the next month)", () => {
    expect(deriveNextDueDate(utc(2025, 1, 31), 1)).toBe(utc(2025, 2, 28));
    expect(deriveNextDueDate(utc(2024, 1, 31), 1)).toBe(utc(2024, 2, 29)); // leap year
    expect(deriveNextDueDate(utc(2026, 8, 31), 3)).toBe(utc(2026, 11, 30));
  });

  test("a missing or non-positive interval uses the 3-month default", () => {
    expect(DEFAULT_TEST_INTERVAL_MONTHS).toBe(3);
    const d = utc(2026, 5, 10);
    expect(deriveNextDueDate(d, undefined)).toBe(utc(2026, 8, 10));
    expect(deriveNextDueDate(d, null)).toBe(utc(2026, 8, 10));
    expect(deriveNextDueDate(d, 0)).toBe(utc(2026, 8, 10));
  });

  test("long intervals (the register allows up to 120 months)", () => {
    expect(deriveNextDueDate(utc(2026, 2, 28), 120)).toBe(utc(2036, 2, 28));
  });
});
