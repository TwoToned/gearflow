/**
 * Unit tests for the category price-rollup module — the union's default
 * reading, the per-row hidden/revealed decision, and the subtotal arithmetic
 * every consumer shares (the document pipeline, the finance snapshot, the
 * equipment tab).
 */
import { describe, it, expect } from "vitest";
import {
  CATEGORY_PRICING_DISPLAYS,
  DEFAULT_CATEGORY_PRICING_DISPLAY,
  isCategoryPricingDisplay,
  toCategoryPricingDisplay,
  isRollupCategory,
  isLinePriceHidden,
  rollupSubtotal,
  canRevealPriceInRollup,
} from "./category-pricing-display";

describe("toCategoryPricingDisplay", () => {
  it("passes both literals through", () => {
    expect(toCategoryPricingDisplay("ITEMISED")).toBe("ITEMISED");
    expect(toCategoryPricingDisplay("ROLLUP")).toBe("ROLLUP");
  });

  // The whole no-backfill premise: every category row written before this
  // feature has no `pricingDisplay` at all and must keep printing per-line
  // prices exactly as it did.
  it("reads absent/unknown as ITEMISED, the pre-feature behaviour", () => {
    for (const value of [undefined, null, "", "rollup", "TRUE", 1, {}]) {
      expect(toCategoryPricingDisplay(value)).toBe("ITEMISED");
    }
    expect(DEFAULT_CATEGORY_PRICING_DISPLAY).toBe("ITEMISED");
  });

  it("guards the boundary without coercing", () => {
    expect(isCategoryPricingDisplay("ROLLUP")).toBe(true);
    expect(isCategoryPricingDisplay("rollup")).toBe(false);
    expect(isCategoryPricingDisplay(undefined)).toBe(false);
  });

  it("exposes exactly the two literals", () => {
    expect([...CATEGORY_PRICING_DISPLAYS]).toEqual(["ITEMISED", "ROLLUP"]);
  });
});

describe("isRollupCategory", () => {
  it("is true only for ROLLUP", () => {
    expect(isRollupCategory("ROLLUP")).toBe(true);
    expect(isRollupCategory("ITEMISED")).toBe(false);
    expect(isRollupCategory(undefined)).toBe(false);
  });
});

describe("isLinePriceHidden", () => {
  it("hides an unrevealed line inside a rolled-up category", () => {
    expect(isLinePriceHidden({ pricingDisplay: "ROLLUP" })).toBe(true);
    expect(isLinePriceHidden({ pricingDisplay: "ROLLUP", revealPriceInRollup: false })).toBe(true);
    expect(isLinePriceHidden({ pricingDisplay: "ROLLUP", revealPriceInRollup: null })).toBe(true);
  });

  it("shows a revealed line inside a rolled-up category", () => {
    expect(isLinePriceHidden({ pricingDisplay: "ROLLUP", revealPriceInRollup: true })).toBe(false);
  });

  // The reveal flag is display-only and scoped to a rollup. A row left with a
  // stale `true` after its category is switched back to itemised must change
  // nothing — every price already prints there.
  it("never hides in an ITEMISED category, revealed or not", () => {
    expect(isLinePriceHidden({ pricingDisplay: "ITEMISED" })).toBe(false);
    expect(isLinePriceHidden({ pricingDisplay: "ITEMISED", revealPriceInRollup: true })).toBe(false);
    expect(isLinePriceHidden({ pricingDisplay: undefined, revealPriceInRollup: false })).toBe(false);
  });

  it("treats a non-boolean reveal as not revealed (fails closed)", () => {
    expect(isLinePriceHidden({ pricingDisplay: "ROLLUP", revealPriceInRollup: "yes" as never })).toBe(true);
  });
});

describe("rollupSubtotal", () => {
  it("sums the section's line totals", () => {
    expect(rollupSubtotal([{ lineTotal: 1200 }, { lineTotal: 340.5 }, { lineTotal: 0 }])).toBe(1540.5);
  });

  // The answer to "does a revealed line double-count?": no — the subtotal is
  // the category's TOTAL, which is why the header prints it with a label.
  it("includes revealed rows — the subtotal is the total, not the remainder", () => {
    const hidden = { lineTotal: 800 };
    const revealed = { lineTotal: 450 };
    expect(rollupSubtotal([hidden, revealed])).toBe(1250);
  });

  it("counts absent/non-finite totals as zero", () => {
    expect(rollupSubtotal([{ lineTotal: null }, { lineTotal: undefined }, {}, { lineTotal: 100 }])).toBe(100);
    expect(rollupSubtotal([{ lineTotal: Number.NaN }, { lineTotal: 25 }])).toBe(25);
  });

  it("is zero for an empty section", () => {
    expect(rollupSubtotal([])).toBe(0);
  });
});

// The reveal prints a price on THIS row. A row the document never draws has no
// price to print, so the flag is inert there — see the module header. These are
// the three kinds of row collapse mode drops.
describe("canRevealPriceInRollup", () => {
  it("allows a plain top-level row", () => {
    expect(canRevealPriceInRollup({})).toBe(true);
    expect(
      canRevealPriceInRollup({ inProjectGroup: false, isSubHireGroupChild: false, isKitChild: false }),
    ).toBe(true);
  });

  it("refuses a member of a Project Group", () => {
    expect(canRevealPriceInRollup({ inProjectGroup: true })).toBe(false);
  });

  it("refuses a sub-hire group child", () => {
    expect(canRevealPriceInRollup({ isSubHireGroupChild: true })).toBe(false);
  });

  it("refuses a kit child", () => {
    expect(canRevealPriceInRollup({ isKitChild: true })).toBe(false);
  });

  it("treats absent/null flags as 'not a child'", () => {
    expect(
      canRevealPriceInRollup({ inProjectGroup: null, isSubHireGroupChild: null, isKitChild: null }),
    ).toBe(true);
  });
});
