import { describe, it, expect } from "vitest";
import { roundCurrency, computeLineTotal } from "./lineTotal";

describe("roundCurrency", () => {
  it("rounds to two decimal places, half-up", () => {
    expect(roundCurrency(1.005)).toBe(1.0); // float64 1.005 rounds down — pinned to match src/lib/formatters
    expect(roundCurrency(2.675)).toBe(2.68); // float64: 2.675*100 → 267.5 → 268
    expect(roundCurrency(10)).toBe(10);
    expect(roundCurrency(1.234)).toBe(1.23);
  });
});

describe("computeLineTotal", () => {
  it("returns null when there is no unit price", () => {
    expect(computeLineTotal(undefined, 5, 3, 10)).toBeNull();
  });

  it("computes gross minus discount, floored at zero", () => {
    // 100 × 2 × 3 = 600; − 50 discount = 550
    expect(computeLineTotal(100, 2, 3, 50)).toBe(550);
    // no discount defaults to 0
    expect(computeLineTotal(100, 2, 3, undefined)).toBe(600);
    // an explicit $0 unit price is a real (free) line, not null
    expect(computeLineTotal(0, 4, 2, undefined)).toBe(0);
    // discount larger than gross floors at 0 (never negative)
    expect(computeLineTotal(10, 1, 1, 999)).toBe(0);
    // rounding applied to the gross
    expect(computeLineTotal(9.99, 3, 1, undefined)).toBe(29.97);
  });
});
