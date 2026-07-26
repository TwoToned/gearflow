import { describe, test, expect } from "vitest";
import { resolveWooDiscountPercent } from "./woocommerce-utils";

// QW-4 (#953) — the discount seed for WooCommerce-assembled projects (both the
// Convex `processOrder` action and the legacy `src/server/woocommerce.ts` path
// call this canonical definition; `convex/wooCommerceActions.ts` carries a
// verbatim copy since Convex can't import from src/ — keep them in sync).
describe("resolveWooDiscountPercent", () => {
  test("returns the client's defaultDiscount when set", () => {
    expect(resolveWooDiscountPercent({ defaultDiscount: 15 })).toBe(15);
  });

  test("returns an explicit 0% default (not falsy-coerced to undefined)", () => {
    expect(resolveWooDiscountPercent({ defaultDiscount: 0 })).toBe(0);
  });

  test("returns undefined when the client has no defaultDiscount set", () => {
    expect(resolveWooDiscountPercent({})).toBeUndefined();
    expect(resolveWooDiscountPercent({ defaultDiscount: undefined })).toBeUndefined();
  });

  test("returns undefined when defaultDiscount is explicitly null", () => {
    expect(resolveWooDiscountPercent({ defaultDiscount: null })).toBeUndefined();
  });
});
