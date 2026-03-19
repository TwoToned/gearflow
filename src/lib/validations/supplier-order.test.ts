import { describe, it, expect } from "vitest";
import { supplierOrderSchema, supplierOrderItemSchema } from "./supplier-order";

// ---------------------------------------------------------------------------
// supplierOrderSchema
// ---------------------------------------------------------------------------
describe("supplierOrderSchema", () => {
  const minimal = {
    supplierId: "sup-1",
    orderNumber: "PO-001",
    type: "PURCHASE" as const,
  };

  const complete = {
    supplierId: "sup-1",
    orderNumber: "PO-001",
    type: "SUBHIRE" as const,
    status: "ORDERED" as const,
    orderDate: "2024-06-01",
    expectedDate: "2024-06-15",
    receivedDate: "2024-06-14",
    projectId: "proj-1",
    notes: "Rush order for Friday show",
  };

  // Valid data
  it("accepts valid minimal data", () => {
    const result = supplierOrderSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.supplierId).toBe("sup-1");
      expect(result.data.orderNumber).toBe("PO-001");
      expect(result.data.type).toBe("PURCHASE");
    }
  });

  it("accepts valid complete data", () => {
    const result = supplierOrderSchema.safeParse(complete);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.orderDate).toBeInstanceOf(Date);
      expect(result.data.expectedDate).toBeInstanceOf(Date);
      expect(result.data.receivedDate).toBeInstanceOf(Date);
      expect(result.data.projectId).toBe("proj-1");
    }
  });

  // Defaults
  it("applies default status DRAFT", () => {
    const result = supplierOrderSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("DRAFT");
    }
  });

  // Required fields
  it("rejects missing supplierId", () => {
    const result = supplierOrderSchema.safeParse({ orderNumber: "PO-001", type: "PURCHASE" });
    expect(result.success).toBe(false);
  });

  it("rejects empty supplierId", () => {
    const result = supplierOrderSchema.safeParse({ ...minimal, supplierId: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing orderNumber", () => {
    const result = supplierOrderSchema.safeParse({ supplierId: "sup-1", type: "PURCHASE" });
    expect(result.success).toBe(false);
  });

  it("rejects empty orderNumber", () => {
    const result = supplierOrderSchema.safeParse({ ...minimal, orderNumber: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing type", () => {
    const result = supplierOrderSchema.safeParse({ supplierId: "sup-1", orderNumber: "PO-001" });
    expect(result.success).toBe(false);
  });

  // Max length enforcement
  it("rejects orderNumber exceeding 100 characters", () => {
    const result = supplierOrderSchema.safeParse({ ...minimal, orderNumber: "x".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("accepts orderNumber at exactly 100 characters", () => {
    const result = supplierOrderSchema.safeParse({ ...minimal, orderNumber: "x".repeat(100) });
    expect(result.success).toBe(true);
  });

  it("rejects notes exceeding 2000 characters", () => {
    const result = supplierOrderSchema.safeParse({ ...minimal, notes: "x".repeat(2001) });
    expect(result.success).toBe(false);
  });

  // Enum validation
  it("rejects invalid type enum", () => {
    const result = supplierOrderSchema.safeParse({ ...minimal, type: "RENTAL" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid type values", () => {
    for (const t of ["PURCHASE", "SUBHIRE", "REPAIR", "LABOUR", "OTHER"] as const) {
      const result = supplierOrderSchema.safeParse({ ...minimal, type: t });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid status enum", () => {
    const result = supplierOrderSchema.safeParse({ ...minimal, status: "SHIPPED" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid status values", () => {
    for (const s of ["DRAFT", "ORDERED", "PARTIAL", "RECEIVED", "CANCELLED"] as const) {
      const result = supplierOrderSchema.safeParse({ ...minimal, status: s });
      expect(result.success).toBe(true);
    }
  });

  // Date transforms: empty string → undefined
  it("transforms empty string orderDate to undefined", () => {
    const result = supplierOrderSchema.safeParse({ ...minimal, orderDate: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.orderDate).toBeUndefined();
    }
  });

  it("transforms empty string expectedDate to undefined", () => {
    const result = supplierOrderSchema.safeParse({ ...minimal, expectedDate: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expectedDate).toBeUndefined();
    }
  });

  it("transforms empty string receivedDate to undefined", () => {
    const result = supplierOrderSchema.safeParse({ ...minimal, receivedDate: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.receivedDate).toBeUndefined();
    }
  });

  it("coerces valid date string to Date for orderDate", () => {
    const result = supplierOrderSchema.safeParse({ ...minimal, orderDate: "2024-03-15" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.orderDate).toBeInstanceOf(Date);
    }
  });

  it("coerces valid date string to Date for expectedDate", () => {
    const result = supplierOrderSchema.safeParse({ ...minimal, expectedDate: "2024-03-20" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expectedDate).toBeInstanceOf(Date);
    }
  });

  it("coerces valid date string to Date for receivedDate", () => {
    const result = supplierOrderSchema.safeParse({ ...minimal, receivedDate: "2024-03-18" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.receivedDate).toBeInstanceOf(Date);
    }
  });

  // Optional fields
  it("accepts undefined projectId", () => {
    const result = supplierOrderSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.projectId).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// supplierOrderItemSchema
// ---------------------------------------------------------------------------
describe("supplierOrderItemSchema", () => {
  const minimal = { description: "XLR Cable 10m" };

  const complete = {
    description: "XLR Cable 10m",
    quantity: 5,
    unitPrice: 25.99,
    modelId: "model-1",
    assetId: "asset-1",
    notes: "Premium shielded cables",
  };

  // Valid data
  it("accepts valid minimal data", () => {
    const result = supplierOrderItemSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe("XLR Cable 10m");
    }
  });

  it("accepts valid complete data", () => {
    const result = supplierOrderItemSchema.safeParse(complete);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.quantity).toBe(5);
      expect(result.data.unitPrice).toBe(25.99);
      expect(result.data.modelId).toBe("model-1");
      expect(result.data.assetId).toBe("asset-1");
    }
  });

  // Defaults
  it("applies default quantity of 1", () => {
    const result = supplierOrderItemSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.quantity).toBe(1);
    }
  });

  // Required fields
  it("rejects missing description", () => {
    const result = supplierOrderItemSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty description", () => {
    const result = supplierOrderItemSchema.safeParse({ description: "" });
    expect(result.success).toBe(false);
  });

  // Max length enforcement
  it("rejects description exceeding 500 characters", () => {
    const result = supplierOrderItemSchema.safeParse({ description: "x".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("accepts description at exactly 500 characters", () => {
    const result = supplierOrderItemSchema.safeParse({ description: "x".repeat(500) });
    expect(result.success).toBe(true);
  });

  it("rejects notes exceeding 1000 characters", () => {
    const result = supplierOrderItemSchema.safeParse({ ...minimal, notes: "x".repeat(1001) });
    expect(result.success).toBe(false);
  });

  it("accepts notes at exactly 1000 characters", () => {
    const result = supplierOrderItemSchema.safeParse({ ...minimal, notes: "x".repeat(1000) });
    expect(result.success).toBe(true);
  });

  // Quantity validation
  it("rejects quantity less than 1", () => {
    const result = supplierOrderItemSchema.safeParse({ ...minimal, quantity: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects negative quantity", () => {
    const result = supplierOrderItemSchema.safeParse({ ...minimal, quantity: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer quantity", () => {
    const result = supplierOrderItemSchema.safeParse({ ...minimal, quantity: 2.5 });
    expect(result.success).toBe(false);
  });

  it("accepts quantity of exactly 1", () => {
    const result = supplierOrderItemSchema.safeParse({ ...minimal, quantity: 1 });
    expect(result.success).toBe(true);
  });

  it("coerces string to integer for quantity", () => {
    const result = supplierOrderItemSchema.safeParse({ ...minimal, quantity: "3" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.quantity).toBe(3);
    }
  });

  // unitPrice transforms
  it("transforms empty string unitPrice to undefined", () => {
    const result = supplierOrderItemSchema.safeParse({ ...minimal, unitPrice: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.unitPrice).toBeUndefined();
    }
  });

  it("coerces string to number for unitPrice", () => {
    const result = supplierOrderItemSchema.safeParse({ ...minimal, unitPrice: "49.99" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.unitPrice).toBe(49.99);
    }
  });

  it("rejects negative unitPrice", () => {
    const result = supplierOrderItemSchema.safeParse({ ...minimal, unitPrice: -5 });
    expect(result.success).toBe(false);
  });

  it("accepts zero unitPrice", () => {
    const result = supplierOrderItemSchema.safeParse({ ...minimal, unitPrice: 0 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.unitPrice).toBe(0);
    }
  });

  // Optional fields
  it("accepts undefined for all optional fields", () => {
    const result = supplierOrderItemSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.unitPrice).toBeUndefined();
      expect(result.data.modelId).toBeUndefined();
      expect(result.data.assetId).toBeUndefined();
      expect(result.data.notes).toBeUndefined();
    }
  });
});
