import { describe, expect, it } from "vitest";
import {
  defaultOrderNumberFor,
  buildOrderHeaderPrefill,
  mapSubHireItemsToOrderItems,
} from "./sub-hire-to-order";

describe("defaultOrderNumberFor", () => {
  it("prefixes the sub-hire order number with PO-", () => {
    expect(defaultOrderNumberFor("SH-0007")).toBe("PO-SH-0007");
  });
});

describe("buildOrderHeaderPrefill", () => {
  it("maps supplier/dates/project straight across and fixes type to SUBHIRE", () => {
    const prefill = buildOrderHeaderPrefill({
      orderNumber: "SH-0007",
      supplierId: "sup_1",
      hireStart: "2026-08-01",
      hireEnd: "2026-08-10",
      projectId: "proj_1",
    });
    expect(prefill).toEqual({
      supplierId: "sup_1",
      orderNumber: "PO-SH-0007",
      type: "SUBHIRE",
      orderDate: "2026-08-01",
      expectedDate: "2026-08-10",
      projectId: "proj_1",
    });
  });

  it("accepts an explicit (user-edited) order number override", () => {
    const prefill = buildOrderHeaderPrefill(
      { orderNumber: "SH-0007", supplierId: "sup_1", hireStart: null, hireEnd: null, projectId: null },
      "PO-CUSTOM-1",
    );
    expect(prefill.orderNumber).toBe("PO-CUSTOM-1");
    expect(prefill.projectId).toBeNull();
  });
});

describe("mapSubHireItemsToOrderItems", () => {
  it("carries description/quantity across and maps unitCost -> unitPrice", () => {
    const items = mapSubHireItemsToOrderItems([
      { description: "Shure ULXD Kit", quantity: 2, unitCost: 150 },
      { description: "XLR cable", quantity: 5, unitCost: 3.5 },
    ]);
    expect(items).toEqual([
      { description: "Shure ULXD Kit", quantity: 2, unitPrice: 150 },
      { description: "XLR cable", quantity: 5, unitPrice: 3.5 },
    ]);
  });

  it("returns an empty array for a sub-hire with no items", () => {
    expect(mapSubHireItemsToOrderItems([])).toEqual([]);
  });
});
