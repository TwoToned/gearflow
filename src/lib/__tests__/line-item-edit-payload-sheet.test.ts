import { describe, it, expect } from "vitest";

import { computeRowSheetPayload, reverseRowSheetPatch } from "../line-item-edit-payload";
import type { LineItemData } from "@/components/projects/equipment-row-types";

const item = (over: Record<string, unknown> = {}) =>
  ({ id: "l1", type: "EQUIPMENT", description: "SM58", quantity: 4, unitPrice: 50, duration: 2, discount: 30, discountMode: "%", pricingType: "PER_DAY", ...over }) as unknown as LineItemData;

describe("computeRowSheetPayload (the phone sheet's one patchNative payload)", () => {
  it("passes the resolved dollar discount through untouched, with its mode, never re-derived from a percentage", () => {
    // 30 is the STORED dollar amount of a 15% entry on a 200 gross; a quantity-only save must not rewrite it
    const p = computeRowSheetPayload(item(), { quantity: 5 });
    expect(p).toMatchObject({ quantity: 5, unitPrice: 50, discount: 30, discountMode: "%" });
  });

  it("a cleared price is undefined (cleared server-side), a cleared discount drops its mode, blank is never 0", () => {
    const p = computeRowSheetPayload(item(), { unitPrice: null, discount: null });
    expect(p.unitPrice).toBeUndefined();
    expect(p.discount).toBeUndefined();
    expect(p.discountMode).toBeUndefined();
  });

  it("a new discount carries the mode the operator chose", () => {
    expect(computeRowSheetPayload(item({ discount: null, discountMode: null }), { discount: 12.5, discountMode: "$" })).toMatchObject({ discount: 12.5, discountMode: "$" });
  });

  it("the Undo patch puts back exactly the fields the save changed", () => {
    expect(reverseRowSheetPatch(item(), { quantity: 9 })).toEqual({ quantity: 4 });
    expect(reverseRowSheetPatch(item(), { unitPrice: 80, discount: 10, discountMode: "$" })).toEqual({ unitPrice: 50, discount: 30, discountMode: "%" });
    expect(reverseRowSheetPatch(item({ unitPrice: null, discount: null, discountMode: null }), { unitPrice: 5, discount: 1 })).toEqual({ unitPrice: null, discount: null, discountMode: "$" });
  });
});
