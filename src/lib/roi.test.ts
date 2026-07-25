import { describe, test, expect } from "vitest";
import {
  computeRoi,
  formatPayback,
  statusesForScope,
  defaultRoiWindow,
  NEVER_COUNTED_STATUSES,
} from "./roi";

describe("computeRoi", () => {
  test("measures against the whole fleet's capital, not one unit's", () => {
    // The bug this exists to prevent: 8 receivers at $2,000 is $16,000 deployed.
    // Dividing by a single unit's cost would report 12× instead of 1.5×.
    const roi = computeRoi(24_000, 8, 2_000);
    expect(roi.fleetCost).toBe(16_000);
    expect(roi.payback).toBe(1.5);
    expect(roi.revenuePerUnit).toBe(3_000);
  });

  test("no replacement cost means no ROI — not zero, not infinity", () => {
    const roi = computeRoi(5_000, 4, null);
    expect(roi.revenue).toBe(5_000);
    expect(roi.fleetCost).toBeNull();
    expect(roi.payback).toBeNull();
    expect(roi.costRecovered).toBeNull();
  });

  test("a model we no longer own keeps its revenue but reports no ROI", () => {
    const roi = computeRoi(9_000, 0, 500);
    expect(roi.revenue).toBe(9_000);
    expect(roi.payback).toBeNull();
    expect(roi.revenuePerUnit).toBeNull();
  });

  test("a zero replacement cost is treated as unknown, not as free capital", () => {
    expect(computeRoi(100, 2, 0).payback).toBeNull();
  });

  test("cost recovered clamps at 100% but payback keeps counting", () => {
    const roi = computeRoi(30_000, 1, 10_000);
    expect(roi.costRecovered).toBe(1);
    expect(roi.payback).toBe(3);
    expect(roi.stillToRecover).toBe(0);
  });

  test("gear that hasn't paid for itself reports what's left to recover", () => {
    const roi = computeRoi(2_500, 1, 10_000);
    expect(roi.costRecovered).toBe(0.25);
    expect(roi.stillToRecover).toBe(7_500);
  });
});

describe("formatPayback", () => {
  test("renders an em dash when there is no ratio to show", () => {
    expect(formatPayback(null)).toBe("—");
  });

  test("drops a decimal once the number is large enough not to need it", () => {
    expect(formatPayback(1.4)).toBe("1.40×");
    expect(formatPayback(12.345)).toBe("12.3×");
  });
});

describe("statusesForScope", () => {
  test("a quote is never revenue, under any scope", () => {
    for (const scope of ["earned", "booked"] as const) {
      const counted = statusesForScope(scope);
      for (const never of NEVER_COUNTED_STATUSES) {
        expect(counted).not.toContain(never);
      }
    }
  });

  test("earned is completed and invoiced only", () => {
    expect(statusesForScope("earned").sort()).toEqual(["COMPLETED", "INVOICED"]);
  });

  test("booked is a superset of earned", () => {
    const booked = statusesForScope("booked");
    for (const s of statusesForScope("earned")) expect(booked).toContain(s);
    expect(booked).toContain("CHECKED_OUT");
  });
});

describe("defaultRoiWindow", () => {
  test("earned scope is the trailing twelve months, capped at now", () => {
    const now = new Date("2026-07-10T00:00:00Z").getTime();
    const { from, to } = defaultRoiWindow("earned", now);
    expect(to).toBe(now);
    expect(new Date(from).toISOString()).toBe("2025-07-10T00:00:00.000Z");
  });

  test("booked scope leaves `to` open so future bookings aren't hidden", () => {
    const now = new Date("2026-07-10T00:00:00Z").getTime();
    const { from, to } = defaultRoiWindow("booked", now);
    expect(to).toBeUndefined();
    expect(new Date(from).toISOString()).toBe("2025-07-10T00:00:00.000Z");
  });
});
