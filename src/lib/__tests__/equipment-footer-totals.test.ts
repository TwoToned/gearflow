import { describe, it, expect } from "vitest";
import { buildEquipmentFooterTotals } from "../equipment-footer-totals";

describe("buildEquipmentFooterTotals", () => {
  it("passes the stored anchors through", () => {
    expect(buildEquipmentFooterTotals({ subtotal: 1000, taxAmount: 100, total: 1100 })).toEqual([
      { label: "Subtotal", amount: 1000 },
      { label: "Tax", amount: 100 },
      { label: "Total", amount: 1100 },
    ]);
  });
  it("adds a negative Discount line only when one is stored", () => {
    const l = buildEquipmentFooterTotals({ subtotal: 1000, discountAmount: 50, taxAmount: 95, total: 1045 });
    expect(l.map((x) => x.label)).toEqual(["Subtotal", "Discount", "Tax", "Total"]);
    expect(l[1].amount).toBe(-50);
  });
  it("renders a never-recalculated project as nothing, and missing tax/total as null not 0", () => {
    expect(buildEquipmentFooterTotals({})).toEqual([]);
    expect(buildEquipmentFooterTotals(null)).toEqual([]);
    const l = buildEquipmentFooterTotals({ subtotal: 10 });
    expect(l[1].amount).toBeNull();
    expect(l[2].amount).toBeNull();
  });
});
