import { describe, test, expect } from "vitest";
import { kitAllocationSchema, kitAllocationRowSchema } from "./kit-allocation";

/**
 * The client-side guard on the allocation form. This is a UI affordance (the engine
 * independently re-checks a saved split before applying it), but it must still reject
 * the shapes the Convex mutation would throw on — sum ≠ 100, duplicate model — plus
 * the > 2-decimal precision the column can't store.
 */

const row = (modelId: string, allocationPercent: number) => ({ modelId, allocationPercent });

describe("kitAllocationSchema", () => {
  test("accepts a split that sums to 100, and empty rows (clearing) despite the sum rule", () => {
    expect(kitAllocationSchema.safeParse({ kitId: "k1", rows: [row("a", 60), row("b", 40)] }).success).toBe(true);
    expect(kitAllocationSchema.safeParse({ kitId: "k1", rows: [] }).success).toBe(true);
  });

  test("rejects a split that does not total 100", () => {
    const r = kitAllocationSchema.safeParse({ kitId: "k1", rows: [row("a", 60), row("b", 30)] });
    expect(r.success).toBe(false);
    expect(r.success ? "" : JSON.stringify(r.error.issues)).toMatch(/total 100/);
  });

  test("rejects a duplicate model", () => {
    const r = kitAllocationSchema.safeParse({ kitId: "k1", rows: [row("a", 50), row("a", 50)] });
    expect(r.success).toBe(false);
    expect(r.success ? "" : JSON.stringify(r.error.issues)).toMatch(/appear once/);
  });
});

describe("kitAllocationRowSchema", () => {
  test("rejects out-of-range and negative percents, and empty modelId", () => {
    expect(kitAllocationRowSchema.safeParse(row("a", 150)).success).toBe(false);
    expect(kitAllocationRowSchema.safeParse(row("a", -1)).success).toBe(false);
    expect(kitAllocationRowSchema.safeParse(row("a", 33.33)).success).toBe(true);
    expect(kitAllocationRowSchema.safeParse(row("", 50)).success).toBe(false);
  });

  // Regression: this refinement was once `Number.isInteger(Math.round(n * 100))`,
  // which is unconditionally true — Math.round always returns an integer — so the
  // guard never fired. 33.333 passed validation and was silently rounded on write,
  // the exact failure the guard exists to prevent.
  test("rejects more than 2 decimal places", () => {
    expect(kitAllocationRowSchema.safeParse(row("a", 33.333)).success).toBe(false);
    expect(kitAllocationRowSchema.safeParse(row("a", 12.9999)).success).toBe(false);
  });

  // 33.33 * 100 is 3332.9999999999995 in binary floating point. An exact-integer
  // check would reject a value the column stores perfectly well.
  test("accepts 2 decimal places despite float representation error", () => {
    expect(kitAllocationRowSchema.safeParse(row("a", 33.33)).success).toBe(true);
    expect(kitAllocationRowSchema.safeParse(row("a", 0.07)).success).toBe(true);
    expect(kitAllocationRowSchema.safeParse(row("a", 8.29)).success).toBe(true);
  });
});
