import { describe, test, expect } from "vitest";
import { resolveRate, resolveChargeRate, calculateEstimatedCost } from "./crewRate";

/**
 * Rate-cascade unit tests (WS10 #949 — labour charge rates & margin). Pure
 * functions, no Convex runtime needed. Covers:
 *  - the charge cascade (chargeRateOverride -> role.chargeRate -> null)
 *  - auto-charge parity with the cost twin across HOURLY/DAILY/FLAT + date spans
 *    (both sides reuse the SAME calculateEstimatedCost — this is the parity gate)
 */

const DAY = 86_400_000;

describe("resolveChargeRate", () => {
  test("chargeRateOverride wins when set and > 0", () => {
    const result = resolveChargeRate(120, { chargeRate: 80, rateType: "HOURLY" });
    expect(result).toEqual({ rate: 120, rateType: "HOURLY" });
  });

  test("chargeRateOverride of 0 or negative is ignored — falls through to role", () => {
    expect(resolveChargeRate(0, { chargeRate: 80, rateType: "DAILY" })).toEqual({ rate: 80, rateType: "DAILY" });
    expect(resolveChargeRate(-5, { chargeRate: 80, rateType: "DAILY" })).toEqual({ rate: 80, rateType: "DAILY" });
  });

  test("falls back to role.chargeRate when no override", () => {
    expect(resolveChargeRate(null, { chargeRate: 250, rateType: "DAILY" })).toEqual({ rate: 250, rateType: "DAILY" });
    expect(resolveChargeRate(undefined, { chargeRate: 250, rateType: "DAILY" })).toEqual({ rate: 250, rateType: "DAILY" });
  });

  test("role.chargeRate rateType defaults to DAILY when the role has none", () => {
    expect(resolveChargeRate(null, { chargeRate: 250, rateType: null })).toEqual({ rate: 250, rateType: "DAILY" });
  });

  test("override with no role still uses the override, defaulting rateType to DAILY", () => {
    expect(resolveChargeRate(100, null)).toEqual({ rate: 100, rateType: "DAILY" });
  });

  test("returns null when neither override nor role charge rate resolve — no auto-pricing, never a fake $0", () => {
    expect(resolveChargeRate(null, null)).toBeNull();
    expect(resolveChargeRate(null, { chargeRate: null, rateType: "DAILY" })).toBeNull();
    expect(resolveChargeRate(0, { chargeRate: 0, rateType: "DAILY" })).toBeNull();
  });

  test("NO member-level fallback exists (unlike resolveRate) — role-first by design", () => {
    // resolveChargeRate's signature has no crewMember param at all; this test
    // documents the intentional API asymmetry with resolveRate below.
    expect(resolveChargeRate.length).toBe(2);
    expect(resolveRate.length).toBe(4);
  });
});

describe("auto-charge parity with the cost twin (calculateEstimatedCost)", () => {
  const start = new Date("2026-08-01T00:00:00Z").getTime();
  const end = new Date("2026-08-03T00:00:00Z").getTime(); // 3 days inclusive

  test("HOURLY — same math for cost and charge rates", () => {
    const cost = calculateEstimatedCost(50, "HOURLY", start, end, 8);
    const charge = calculateEstimatedCost(90, "HOURLY", start, end, 8);
    expect(cost).toBe(400);
    expect(charge).toBe(720);
  });

  test("DAILY — same math for cost and charge rates across a date span", () => {
    const cost = calculateEstimatedCost(300, "DAILY", start, end, null);
    const charge = calculateEstimatedCost(500, "DAILY", start, end, null);
    expect(cost).toBe(900); // 3 days × 300
    expect(charge).toBe(1500); // 3 days × 500
  });

  test("FLAT — same math for cost and charge rates (ignores dates/hours)", () => {
    const cost = calculateEstimatedCost(200, "FLAT", start, end, 999);
    const charge = calculateEstimatedCost(350, "FLAT", start, end, 999);
    expect(cost).toBe(200);
    expect(charge).toBe(350);
  });

  test("DAILY single-day span (start === end) counts as 1 day for both sides", () => {
    expect(calculateEstimatedCost(100, "DAILY", start, start, null)).toBe(100);
    expect(calculateEstimatedCost(150, "DAILY", start, start, null)).toBe(150);
  });

  test("a null/zero resolved rate contributes $0 on both sides", () => {
    expect(calculateEstimatedCost(0, "DAILY", start, end, null)).toBe(0);
  });

  test("multi-day HOURLY still uses estimatedHours, not day count, on both sides", () => {
    const longEnd = start + 10 * DAY;
    expect(calculateEstimatedCost(40, "HOURLY", start, longEnd, 5)).toBe(200);
    expect(calculateEstimatedCost(60, "HOURLY", start, longEnd, 5)).toBe(300);
  });
});
