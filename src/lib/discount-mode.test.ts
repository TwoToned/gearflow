/**
 * Unit tests for the discount entry-mode conversions (#1012).
 *
 * The property that matters: `resolveDiscountAmount` and `discountPercentOf`
 * are inverses over the values a form can produce, so a discount entered as
 * `15%` resolves to a dollar amount that renders back as `15%` — the printed
 * percentage and the printed line total never contradict each other.
 */
import { describe, it, expect } from "vitest";

import {
  DISCOUNT_MODES,
  discountEntryValue,
  discountPercentOf,
  isDiscountMode,
  lineGrossAmount,
  resolveDiscountAmount,
} from "./discount-mode";

describe("DISCOUNT_MODES / isDiscountMode", () => {
  it("is exactly the two literals the schema and Convex validator accept", () => {
    expect(DISCOUNT_MODES).toEqual(["$", "%"]);
  });

  it("narrows only the two literals", () => {
    expect(isDiscountMode("$")).toBe(true);
    expect(isDiscountMode("%")).toBe(true);
    for (const bad of ["", "pct", "USD", 0, null, undefined, {}]) {
      expect(isDiscountMode(bad)).toBe(false);
    }
  });
});

describe("resolveDiscountAmount", () => {
  it("passes a $ entry through unchanged", () => {
    expect(resolveDiscountAmount("$", 40, 1000)).toBe(40);
    expect(resolveDiscountAmount("$", "40.5", 1000)).toBe(40.5);
  });

  it("multiplies a % entry against the gross, rounded to cents", () => {
    expect(resolveDiscountAmount("%", 15, 1000)).toBe(150);
    expect(resolveDiscountAmount("%", 7.5, 333.33)).toBe(25);
  });

  it("distinguishes a blank field from a deliberate 0", () => {
    // Blank = "no discount" / "don't touch it"; a typed 0 CLEARS an existing one.
    expect(resolveDiscountAmount("$", "", 1000)).toBeUndefined();
    expect(resolveDiscountAmount("$", null, 1000)).toBeUndefined();
    expect(resolveDiscountAmount("$", undefined, 1000)).toBeUndefined();
    expect(resolveDiscountAmount("$", 0, 1000)).toBe(0);
    expect(resolveDiscountAmount("%", "0", 1000)).toBe(0);
  });

  it("rejects garbage and negatives rather than storing them", () => {
    expect(resolveDiscountAmount("$", "abc", 1000)).toBeUndefined();
    expect(resolveDiscountAmount("%", -5, 1000)).toBeUndefined();
  });
});

describe("discountPercentOf", () => {
  it("inverts resolveDiscountAmount's % branch", () => {
    for (const [pct, gross] of [
      [15, 1000],
      [7.5, 480],
      [33.33, 900],
      [100, 250],
    ] as const) {
      const amount = resolveDiscountAmount("%", pct, gross)!;
      expect(discountPercentOf(amount, gross)).toBe(pct);
    }
  });

  it("returns null when there is nothing to express as a percentage", () => {
    expect(discountPercentOf(null, 1000)).toBeNull();
    expect(discountPercentOf(0, 1000)).toBeNull();
    // A $0-gross row: a percentage would be Infinity/NaN, so callers fall back
    // to rendering the dollar amount instead.
    expect(discountPercentOf(50, 0)).toBeNull();
    expect(discountPercentOf(50, null)).toBeNull();
  });
});

describe("lineGrossAmount", () => {
  it("mirrors the lineTotal gross term (unitPrice × quantity × duration)", () => {
    expect(lineGrossAmount({ unitPrice: 20, quantity: 5, duration: 2 })).toBe(200);
  });

  it("treats an absent duration as 1 and an absent price/quantity as 0", () => {
    expect(lineGrossAmount({ unitPrice: 20, quantity: 5 })).toBe(100);
    expect(lineGrossAmount({ quantity: 5, duration: 2 })).toBe(0);
    // A synthetic Project Group row carries its bundle price as unitPrice.
    expect(lineGrossAmount({ unitPrice: 500, quantity: 2, duration: 1 })).toBe(1000);
  });
});

describe("discountEntryValue", () => {
  it("re-displays a % discount as the percentage that was entered", () => {
    const gross = 1000;
    const stored = resolveDiscountAmount("%", 15, gross)!;
    expect(discountEntryValue(stored, "%", gross)).toBe("15");
  });

  it("re-displays a $ discount as the dollar amount", () => {
    expect(discountEntryValue(150, "$", 1000)).toBe("150");
  });

  it("treats an absent mode as $ — every pre-#1012 row", () => {
    expect(discountEntryValue(150, null, 1000)).toBe("150");
    expect(discountEntryValue(150, undefined, 1000)).toBe("150");
  });

  it("falls back to the dollar amount when a % row has no gross", () => {
    expect(discountEntryValue(50, "%", 0)).toBe("50");
  });

  it("returns a blank string for no discount", () => {
    expect(discountEntryValue(null, "%", 1000)).toBe("");
    expect(discountEntryValue(0, "$", 1000)).toBe("");
  });
});
