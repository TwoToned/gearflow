import { describe, it, expect } from "vitest";
import { mapSupplierOrder, mapSupplierOrderItem } from "@/lib/supplier-order-read";

describe("supplier-order-read mappers", () => {
  it("mapSupplierOrder converts dates + Decimals and normalises absent optionals", () => {
    const m = mapSupplierOrder({
      id: "o", organizationId: "org", supplierId: "s", orderNumber: "PO-1",
      type: "PURCHASE", status: "ORDERED", orderDate: 1_700_000_000_000, total: 99.5,
      // expected/received/subtotal/tax/projectId/notes/createdById absent
    } as never);
    expect(m.orderDate).toBeInstanceOf(Date);
    expect(m.orderDate?.getTime()).toBe(1_700_000_000_000);
    expect(m.total).toBe(99.5);
    expect(m.expectedDate).toBeNull();
    expect(m.subtotal).toBeNull();
    expect(m.projectId).toBeNull();
    expect(m.createdById).toBeNull();
    expect(m.type).toBe("PURCHASE");
  });

  it("mapSupplierOrderItem keeps Decimal prices as number; null when absent", () => {
    const withPrice = mapSupplierOrderItem({
      id: "i", orderId: "o", description: "XLR", quantity: 10, unitPrice: 25, lineTotal: 250, sortOrder: 0, modelId: "m",
    } as never);
    expect(withPrice.unitPrice).toBe(25);
    expect(withPrice.lineTotal).toBe(250);
    expect(withPrice.modelId).toBe("m");
    expect(withPrice.assetId).toBeNull();

    const noPrice = mapSupplierOrderItem({ id: "i2", orderId: "o", description: "Tape", quantity: 5, sortOrder: 1 } as never);
    expect(noPrice.unitPrice).toBeNull();
    expect(noPrice.lineTotal).toBeNull();
  });
});
