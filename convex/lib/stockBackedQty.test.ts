import { describe, expect, it } from "vitest";
import { stockBackedQty } from "./stockBackedQty";

describe("stockBackedQty", () => {
  it("returns the full quantity when no unit is off-inventory", () => {
    expect(stockBackedQty({ quantity: 3 })).toBe(3);
    expect(stockBackedQty({ quantity: 3, offInventoryQuantity: null })).toBe(3);
  });

  it("subtracts off-inventory units from stock demand", () => {
    expect(stockBackedQty({ quantity: 3, offInventoryQuantity: 1 })).toBe(2);
  });

  it("is zero when every unit is off-inventory", () => {
    expect(stockBackedQty({ quantity: 3, offInventoryQuantity: 3 })).toBe(0);
  });

  it("never goes negative", () => {
    expect(stockBackedQty({ quantity: 2, offInventoryQuantity: 5 })).toBe(0);
    expect(stockBackedQty({ quantity: null, offInventoryQuantity: 1 })).toBe(0);
  });
});
