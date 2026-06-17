import { describe, it, expect } from "vitest";
import { assetSchema, bulkAssetSchema, locationSchema } from "./asset";

// ---------------------------------------------------------------------------
// assetSchema
// ---------------------------------------------------------------------------
describe("assetSchema", () => {
  const validMinimal = {
    modelId: "model-1",
    assetTag: "A001",
  };

  const validComplete = {
    modelId: "model-1",
    assetTag: "A001",
    serialNumber: "SN-123456",
    customName: "Main Speaker",
    status: "CHECKED_OUT" as const,
    condition: "GOOD" as const,
    purchaseDate: "2024-01-15",
    purchasePrice: 999.99,
    purchaseSupplier: "Acme Corp",
    supplierId: "supplier-1",
    purchaseOrderNumber: "PO-2024-001",
    warrantyExpiry: "2026-01-15",
    notes: "Handle with care",
    locationId: "loc-1",
    customFieldValues: { color: "black", weight: "5kg" },
    barcode: "1234567890",
    images: ["https://example.com/img1.jpg", "https://example.com/img2.jpg"],
    isActive: false,
    tags: ["audio", "premium"],
  };

  // --- valid data ---
  it("accepts valid minimal data and applies defaults", () => {
    const result = assetSchema.parse(validMinimal);
    expect(result.modelId).toBe("model-1");
    expect(result.assetTag).toBe("A001");
    expect(result.status).toBe("AVAILABLE");
    expect(result.condition).toBe("NEW");
    expect(result.images).toEqual([]);
    expect(result.isActive).toBe(true);
    expect(result.tags).toEqual([]);
  });

  it("accepts valid complete data", () => {
    const result = assetSchema.parse(validComplete);
    expect(result.modelId).toBe("model-1");
    expect(result.status).toBe("CHECKED_OUT");
    expect(result.condition).toBe("GOOD");
    expect(result.purchasePrice).toBe(999.99);
    expect(result.images).toHaveLength(2);
    expect(result.tags).toEqual(["audio", "premium"]);
  });

  // --- required fields ---
  it("rejects missing modelId", () => {
    const result = assetSchema.safeParse({ assetTag: "A001" });
    expect(result.success).toBe(false);
  });

  it("rejects empty modelId", () => {
    const result = assetSchema.safeParse({ modelId: "", assetTag: "A001" });
    expect(result.success).toBe(false);
  });

  it("rejects missing assetTag", () => {
    const result = assetSchema.safeParse({ modelId: "model-1" });
    expect(result.success).toBe(false);
  });

  it("rejects empty assetTag", () => {
    const result = assetSchema.safeParse({ modelId: "model-1", assetTag: "" });
    expect(result.success).toBe(false);
  });

  // --- max length ---
  it("rejects assetTag over 50 characters", () => {
    const result = assetSchema.safeParse({ ...validMinimal, assetTag: "A".repeat(51) });
    expect(result.success).toBe(false);
  });

  it("accepts assetTag exactly 50 characters", () => {
    const result = assetSchema.safeParse({ ...validMinimal, assetTag: "A".repeat(50) });
    expect(result.success).toBe(true);
  });

  it("rejects serialNumber over 100 characters", () => {
    const result = assetSchema.safeParse({ ...validMinimal, serialNumber: "S".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("rejects customName over 200 characters", () => {
    const result = assetSchema.safeParse({ ...validMinimal, customName: "N".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("rejects purchaseSupplier over 200 characters", () => {
    const result = assetSchema.safeParse({ ...validMinimal, purchaseSupplier: "S".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("rejects purchaseOrderNumber over 100 characters", () => {
    const result = assetSchema.safeParse({ ...validMinimal, purchaseOrderNumber: "P".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("rejects notes over 2000 characters", () => {
    const result = assetSchema.safeParse({ ...validMinimal, notes: "N".repeat(2001) });
    expect(result.success).toBe(false);
  });

  it("rejects barcode over 100 characters", () => {
    const result = assetSchema.safeParse({ ...validMinimal, barcode: "B".repeat(101) });
    expect(result.success).toBe(false);
  });

  // --- enum validation ---
  it("rejects invalid status", () => {
    const result = assetSchema.safeParse({ ...validMinimal, status: "BROKEN" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid status values", () => {
    const statuses = ["AVAILABLE", "CHECKED_OUT", "IN_MAINTENANCE", "RETIRED", "LOST", "RESERVED"];
    for (const status of statuses) {
      const result = assetSchema.safeParse({ ...validMinimal, status });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid condition", () => {
    const result = assetSchema.safeParse({ ...validMinimal, condition: "BROKEN" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid condition values", () => {
    const conditions = ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"];
    for (const condition of conditions) {
      const result = assetSchema.safeParse({ ...validMinimal, condition });
      expect(result.success).toBe(true);
    }
  });

  // --- transforms (empty string → undefined) ---
  it("transforms empty string purchaseDate to undefined", () => {
    const result = assetSchema.parse({ ...validMinimal, purchaseDate: "" });
    expect(result.purchaseDate).toBeUndefined();
  });

  it("transforms valid date string to Date object", () => {
    const result = assetSchema.parse({ ...validMinimal, purchaseDate: "2024-06-01" });
    expect(result.purchaseDate).toBeInstanceOf(Date);
  });

  it("transforms empty string purchasePrice to undefined", () => {
    const result = assetSchema.parse({ ...validMinimal, purchasePrice: "" });
    expect(result.purchasePrice).toBeUndefined();
  });

  it("transforms numeric string purchasePrice to number", () => {
    const result = assetSchema.parse({ ...validMinimal, purchasePrice: "49.99" });
    expect(result.purchasePrice).toBe(49.99);
  });

  it("rejects negative purchasePrice", () => {
    const result = assetSchema.safeParse({ ...validMinimal, purchasePrice: -1 });
    expect(result.success).toBe(false);
  });

  it("transforms empty string warrantyExpiry to undefined", () => {
    const result = assetSchema.parse({ ...validMinimal, warrantyExpiry: "" });
    expect(result.warrantyExpiry).toBeUndefined();
  });

  it("transforms valid warrantyExpiry string to Date", () => {
    const result = assetSchema.parse({ ...validMinimal, warrantyExpiry: "2027-12-31" });
    expect(result.warrantyExpiry).toBeInstanceOf(Date);
  });

  // --- defaults ---
  it("defaults status to AVAILABLE", () => {
    const result = assetSchema.parse(validMinimal);
    expect(result.status).toBe("AVAILABLE");
  });

  it("defaults condition to NEW", () => {
    const result = assetSchema.parse(validMinimal);
    expect(result.condition).toBe("NEW");
  });

  it("defaults images to empty array", () => {
    const result = assetSchema.parse(validMinimal);
    expect(result.images).toEqual([]);
  });

  it("defaults isActive to true", () => {
    const result = assetSchema.parse(validMinimal);
    expect(result.isActive).toBe(true);
  });

  it("defaults tags to empty array", () => {
    const result = assetSchema.parse(validMinimal);
    expect(result.tags).toEqual([]);
  });

  // --- edge cases ---
  it("accepts purchasePrice of 0", () => {
    const result = assetSchema.parse({ ...validMinimal, purchasePrice: 0 });
    expect(result.purchasePrice).toBe(0);
  });

  it("accepts customFieldValues as empty record", () => {
    const result = assetSchema.parse({ ...validMinimal, customFieldValues: {} });
    expect(result.customFieldValues).toEqual({});
  });

  it("accepts empty images array", () => {
    const result = assetSchema.parse({ ...validMinimal, images: [] });
    expect(result.images).toEqual([]);
  });

  it("accepts omitted optional fields", () => {
    const result = assetSchema.parse(validMinimal);
    expect(result.serialNumber).toBeUndefined();
    expect(result.customName).toBeUndefined();
    expect(result.locationId).toBeUndefined();
    expect(result.notes).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// bulkAssetSchema
// ---------------------------------------------------------------------------
describe("bulkAssetSchema", () => {
  const validMinimal = {
    modelId: "model-1",
    assetTag: "BULK-001",
  };

  const validComplete = {
    modelId: "model-1",
    assetTag: "BULK-001",
    totalQuantity: 100,
    purchasePricePerUnit: 12.5,
    locationId: "loc-1",
    status: "LOW_STOCK" as const,
    notes: "Gaffer tape stock",
    isActive: true,
    tags: ["consumable"],
  };

  // --- valid data ---
  it("accepts valid minimal data and applies defaults", () => {
    const result = bulkAssetSchema.parse(validMinimal);
    expect(result.modelId).toBe("model-1");
    expect(result.assetTag).toBe("BULK-001");
    expect(result.totalQuantity).toBe(0);
    expect(result.status).toBe("ACTIVE");
    expect(result.isActive).toBe(true);
    expect(result.tags).toEqual([]);
  });

  it("accepts valid complete data", () => {
    const result = bulkAssetSchema.parse(validComplete);
    expect(result.totalQuantity).toBe(100);
    expect(result.purchasePricePerUnit).toBe(12.5);
    expect(result.status).toBe("LOW_STOCK");
  });

  // --- required fields ---
  it("rejects missing modelId", () => {
    const result = bulkAssetSchema.safeParse({ assetTag: "BULK-001" });
    expect(result.success).toBe(false);
  });

  it("rejects empty modelId", () => {
    const result = bulkAssetSchema.safeParse({ modelId: "", assetTag: "BULK-001" });
    expect(result.success).toBe(false);
  });

  it("rejects missing assetTag", () => {
    const result = bulkAssetSchema.safeParse({ modelId: "model-1" });
    expect(result.success).toBe(false);
  });

  it("rejects empty assetTag", () => {
    const result = bulkAssetSchema.safeParse({ modelId: "model-1", assetTag: "" });
    expect(result.success).toBe(false);
  });

  // --- max length ---
  it("rejects assetTag over 50 characters", () => {
    const result = bulkAssetSchema.safeParse({ ...validMinimal, assetTag: "B".repeat(51) });
    expect(result.success).toBe(false);
  });

  it("rejects notes over 2000 characters", () => {
    const result = bulkAssetSchema.safeParse({ ...validMinimal, notes: "N".repeat(2001) });
    expect(result.success).toBe(false);
  });

  // --- enum validation ---
  it("rejects invalid status", () => {
    const result = bulkAssetSchema.safeParse({ ...validMinimal, status: "AVAILABLE" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid status values", () => {
    const statuses = ["ACTIVE", "LOW_STOCK", "OUT_OF_STOCK", "RETIRED"];
    for (const status of statuses) {
      const result = bulkAssetSchema.safeParse({ ...validMinimal, status });
      expect(result.success).toBe(true);
    }
  });

  // --- coercion ---
  it("coerces string totalQuantity to number", () => {
    const result = bulkAssetSchema.parse({ ...validMinimal, totalQuantity: "50" });
    expect(result.totalQuantity).toBe(50);
  });

  it("rejects negative totalQuantity", () => {
    const result = bulkAssetSchema.safeParse({ ...validMinimal, totalQuantity: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer totalQuantity", () => {
    const result = bulkAssetSchema.safeParse({ ...validMinimal, totalQuantity: 5.5 });
    expect(result.success).toBe(false);
  });

  it("accepts totalQuantity of 0", () => {
    const result = bulkAssetSchema.parse({ ...validMinimal, totalQuantity: 0 });
    expect(result.totalQuantity).toBe(0);
  });

  it("coerces string purchasePricePerUnit to number", () => {
    const result = bulkAssetSchema.parse({ ...validMinimal, purchasePricePerUnit: "9.99" });
    expect(result.purchasePricePerUnit).toBe(9.99);
  });

  it("rejects negative purchasePricePerUnit", () => {
    const result = bulkAssetSchema.safeParse({ ...validMinimal, purchasePricePerUnit: -1 });
    expect(result.success).toBe(false);
  });

  // --- defaults ---
  it("defaults totalQuantity to 0", () => {
    const result = bulkAssetSchema.parse(validMinimal);
    expect(result.totalQuantity).toBe(0);
  });

  it("defaults status to ACTIVE", () => {
    const result = bulkAssetSchema.parse(validMinimal);
    expect(result.status).toBe("ACTIVE");
  });

  it("defaults isActive to true", () => {
    const result = bulkAssetSchema.parse(validMinimal);
    expect(result.isActive).toBe(true);
  });

  it("defaults tags to empty array", () => {
    const result = bulkAssetSchema.parse(validMinimal);
    expect(result.tags).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// locationSchema
// ---------------------------------------------------------------------------
describe("locationSchema", () => {
  const validMinimal = { name: "Main Warehouse" };

  const validComplete = {
    name: "Studio A",
    address: "123 Sound St, Nashville, TN",
    latitude: 36.1627,
    longitude: -86.7816,
    type: "VENUE" as const,
    isDefault: true,
    parentId: "loc-parent",
    notes: "Loading dock on west side",
    tags: ["studio", "indoor"],
  };

  // --- valid data ---
  it("accepts valid minimal data and applies defaults", () => {
    const result = locationSchema.parse(validMinimal);
    expect(result.name).toBe("Main Warehouse");
    expect(result.type).toBe("WAREHOUSE");
    expect(result.isDefault).toBe(false);
    expect(result.tags).toEqual([]);
  });

  it("accepts valid complete data", () => {
    const result = locationSchema.parse(validComplete);
    expect(result.latitude).toBeCloseTo(36.1627);
    expect(result.longitude).toBeCloseTo(-86.7816);
    expect(result.type).toBe("VENUE");
    expect(result.isDefault).toBe(true);
  });

  // --- required fields ---
  it("rejects missing name", () => {
    const result = locationSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = locationSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  // --- max length ---
  it("rejects name over 200 characters", () => {
    const result = locationSchema.safeParse({ name: "N".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("accepts name exactly 200 characters", () => {
    const result = locationSchema.safeParse({ name: "N".repeat(200) });
    expect(result.success).toBe(true);
  });

  it("rejects address over 500 characters", () => {
    const result = locationSchema.safeParse({ name: "Loc", address: "A".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("rejects notes over 1000 characters", () => {
    const result = locationSchema.safeParse({ name: "Loc", notes: "N".repeat(1001) });
    expect(result.success).toBe(false);
  });

  // --- enum validation ---
  it("rejects invalid type", () => {
    const result = locationSchema.safeParse({ name: "Loc", type: "OFFICE" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid type values", () => {
    const types = ["WAREHOUSE", "VENUE", "VEHICLE", "OFFSITE"];
    for (const type of types) {
      const result = locationSchema.safeParse({ name: "Loc", type });
      expect(result.success).toBe(true);
    }
  });

  // --- defaults ---
  it("defaults type to WAREHOUSE", () => {
    const result = locationSchema.parse(validMinimal);
    expect(result.type).toBe("WAREHOUSE");
  });

  it("defaults isDefault to false", () => {
    const result = locationSchema.parse(validMinimal);
    expect(result.isDefault).toBe(false);
  });

  it("defaults tags to empty array", () => {
    const result = locationSchema.parse(validMinimal);
    expect(result.tags).toEqual([]);
  });

  // --- refine: lat/lng must both be present or both absent ---
  it("accepts both latitude and longitude provided", () => {
    const result = locationSchema.safeParse({ name: "Loc", latitude: 40.0, longitude: -74.0 });
    expect(result.success).toBe(true);
  });

  it("accepts both latitude and longitude absent", () => {
    const result = locationSchema.safeParse({ name: "Loc" });
    expect(result.success).toBe(true);
  });

  it("rejects latitude without longitude", () => {
    const result = locationSchema.safeParse({ name: "Loc", latitude: 40.0 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Both latitude and longitude must be provided together");
    }
  });

  it("rejects longitude without latitude", () => {
    const result = locationSchema.safeParse({ name: "Loc", longitude: -74.0 });
    expect(result.success).toBe(false);
  });

  it("accepts both latitude and longitude as null", () => {
    const result = locationSchema.safeParse({ name: "Loc", latitude: null, longitude: null });
    expect(result.success).toBe(true);
  });

  it("rejects latitude as null with longitude present", () => {
    const result = locationSchema.safeParse({ name: "Loc", latitude: null, longitude: -74.0 });
    expect(result.success).toBe(false);
  });

  // --- edge cases ---
  it("accepts parentId as null", () => {
    const result = locationSchema.parse({ ...validMinimal, parentId: null });
    expect(result.parentId).toBeNull();
  });

  it("accepts parentId as string", () => {
    const result = locationSchema.parse({ ...validMinimal, parentId: "parent-1" });
    expect(result.parentId).toBe("parent-1");
  });

  it("coerces string latitude/longitude to numbers", () => {
    const result = locationSchema.parse({ name: "Loc", latitude: "51.5", longitude: "-0.12" });
    expect(result.latitude).toBe(51.5);
    expect(result.longitude).toBe(-0.12);
  });

  it("accepts negative latitude and longitude", () => {
    const result = locationSchema.parse({ name: "Loc", latitude: -33.86, longitude: 151.2 });
    expect(result.latitude).toBeCloseTo(-33.86);
    expect(result.longitude).toBeCloseTo(151.2);
  });
});
