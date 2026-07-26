import { describe, test, expect } from "vitest";
import {
  addMonthsClamped,
  dueDateForCycle,
  currentCycleIndex,
  resolveCurrentDueDate,
  daysToNearestMonths,
} from "./serviceScheduleCore";

/**
 * WS6 #945 — fixed-calendar cadence math. Pure functions, no Convex runtime.
 * Covers anchor math across year boundaries + month-end anchors (spec test list).
 */

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

describe("daysToNearestMonths", () => {
  test("rounds to the nearest month", () => {
    expect(daysToNearestMonths(180)).toBe(6);
    expect(daysToNearestMonths(365)).toBe(12);
    expect(daysToNearestMonths(90)).toBe(3);
  });

  test("floors at 1 month (never 0)", () => {
    expect(daysToNearestMonths(1)).toBe(1);
    expect(daysToNearestMonths(0)).toBe(1);
  });
});

describe("addMonthsClamped", () => {
  test("simple month addition with no clamping", () => {
    expect(iso(addMonthsClamped(utc(2026, 2, 1), 6))).toBe("2026-08-01");
  });

  test("Jan 31 + 1 month clamps to Feb 28 (non-leap year)", () => {
    expect(iso(addMonthsClamped(utc(2026, 1, 31), 1))).toBe("2026-02-28");
  });

  test("Jan 31 + 1 month clamps to Feb 29 on a leap year", () => {
    expect(iso(addMonthsClamped(utc(2028, 1, 31), 1))).toBe("2028-02-29");
  });

  test("computed FROM THE ORIGINAL anchor each cycle, not the previous clamped result — Mar 31 stays 31, not drift to 28", () => {
    const anchor = utc(2026, 1, 31);
    // Cycle 2 (k=2, +2 months) must be Mar 31 — NOT addMonthsClamped(Feb 28, 1) = Mar 28.
    expect(iso(dueDateForCycle(anchor, 1, 2))).toBe("2026-03-31");
  });

  test("crosses a year boundary", () => {
    expect(iso(addMonthsClamped(utc(2026, 11, 15), 3))).toBe("2027-02-15");
  });

  test("preserves time-of-day", () => {
    const anchor = utc(2026, 1, 15) + 3 * 60 * 60 * 1000 + 30 * 60 * 1000; // 03:30 UTC
    const next = addMonthsClamped(anchor, 1);
    const d = new Date(next);
    expect(d.getUTCHours()).toBe(3);
    expect(d.getUTCMinutes()).toBe(30);
  });
});

describe("dueDateForCycle", () => {
  test("cycle 0 is the anchor itself", () => {
    const anchor = utc(2026, 2, 1);
    expect(dueDateForCycle(anchor, 6, 0)).toBe(anchor);
  });

  test("every 6 months from 1 Feb — the spec's own example", () => {
    const anchor = utc(2026, 2, 1);
    expect(iso(dueDateForCycle(anchor, 6, 1))).toBe("2026-08-01");
    expect(iso(dueDateForCycle(anchor, 6, 2))).toBe("2027-02-01");
    expect(iso(dueDateForCycle(anchor, 6, 3))).toBe("2027-08-01");
  });
});

describe("currentCycleIndex / resolveCurrentDueDate", () => {
  const anchor = utc(2026, 2, 1);

  test("null before the anchor date", () => {
    expect(currentCycleIndex(anchor, 6, anchor - 1)).toBeNull();
    expect(resolveCurrentDueDate(anchor, 6, anchor - 1)).toBeNull();
  });

  test("cycle 0 exactly at the anchor", () => {
    expect(currentCycleIndex(anchor, 6, anchor)).toBe(0);
    expect(resolveCurrentDueDate(anchor, 6, anchor)).toBe(anchor);
  });

  test("stays on the current cycle until the next due date arrives", () => {
    const justBeforeNext = utc(2026, 7, 31);
    expect(currentCycleIndex(anchor, 6, justBeforeNext)).toBe(0);
    expect(iso(resolveCurrentDueDate(anchor, 6, justBeforeNext)!)).toBe("2026-02-01");
  });

  test("advances the moment the next due date arrives", () => {
    const nextDue = utc(2026, 8, 1);
    expect(currentCycleIndex(anchor, 6, nextDue)).toBe(1);
    expect(iso(resolveCurrentDueDate(anchor, 6, nextDue)!)).toBe("2026-08-01");
  });

  test("correctly resolves many cycles ahead (anchor set years in the past)", () => {
    const farFuture = utc(2031, 3, 15); // ~5 years and change after anchor
    const k = currentCycleIndex(anchor, 6, farFuture)!;
    // Verify the resolved cycle's due date is <= now and the NEXT one is > now.
    expect(dueDateForCycle(anchor, 6, k)).toBeLessThanOrEqual(farFuture);
    expect(dueDateForCycle(anchor, 6, k + 1)).toBeGreaterThan(farFuture);
  });

  test("1-month cadence across a Jan-31 anchor stays stable at each month's last valid day", () => {
    const janAnchor = utc(2026, 1, 31);
    expect(iso(resolveCurrentDueDate(janAnchor, 1, utc(2026, 2, 28))!)).toBe("2026-02-28");
    expect(iso(resolveCurrentDueDate(janAnchor, 1, utc(2026, 3, 31))!)).toBe("2026-03-31");
  });
});
