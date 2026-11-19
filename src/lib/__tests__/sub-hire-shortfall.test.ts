import { describe, it, expect } from "vitest";
import { defaultHireDuration, previewShortfall } from "../sub-hire-shortfall";

describe("defaultHireDuration", () => {
  it("is 1 for flat/hourly or a missing window", () => {
    expect(defaultHireDuration("FLAT", "2026-06-01", "2026-06-05")).toBe(1);
    expect(defaultHireDuration("PER_DAY", null, null)).toBe(1);
  });
  it("counts days and weeks, rounding up", () => {
    expect(defaultHireDuration("PER_DAY", "2026-06-01T00:00:00Z", "2026-06-04T00:00:00Z")).toBe(3);
    expect(defaultHireDuration("PER_WEEK", "2026-06-01T00:00:00Z", "2026-06-09T00:00:00Z")).toBe(2);
  });
});

describe("previewShortfall", () => {
  it("derives cost, charge and margin from the draft", () => {
    expect(previewShortfall({ quantity: 2, unitCost: 30, unitCharge: 50, duration: 3 })).toEqual({
      cost: 180,
      charge: 300,
      margin: 120,
      marginPct: 40,
    });
  });
  it("keeps blank as null, never 0", () => {
    const p = previewShortfall({ quantity: 2, unitCost: 30, unitCharge: null, duration: 1 });
    expect(p.charge).toBeNull();
    expect(p.margin).toBeNull();
    expect(p.marginPct).toBeNull();
    expect(p.cost).toBe(60);
  });
});
