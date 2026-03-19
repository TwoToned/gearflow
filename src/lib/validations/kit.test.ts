import { describe, it, expect } from "vitest";
import { kitSchema, kitSerializedItemSchema, kitBulkItemSchema } from "./kit";

const validMinimalKit = { name: "Audio Kit", assetTag: "KIT-001" };

const validCompleteKit = {
  name: "Lighting Rig A",
  assetTag: "KIT-LR-001",
  description: "Full lighting rig with truss and fixtures",
  categoryId: "cat-456",
  status: "AVAILABLE" as const,
  condition: "GOOD" as const,
  locationId: "loc-789",
  weight: 150.5,
  caseType: "Road Case",
  caseDimensions: "120x60x80cm",
  notes: "Handle with care",
  purchaseDate: new Date("2024-01-15"),
  purchasePrice: 12000,
  image: "https://example.com/kit.jpg",
  images: ["https://example.com/a.jpg"],
  isActive: true,
  tags: ["lighting", "rig"],
};

describe("kitSchema", () => {
  describe("valid data", () => {
    it("accepts minimal valid data", () => {
      const result = kitSchema.safeParse(validMinimalKit);
      expect(result.success).toBe(true);
    });

    it("accepts complete valid data", () => {
      const result = kitSchema.safeParse(validCompleteKit);
      expect(result.success).toBe(true);
    });
  });

  describe("name (required, max 200)", () => {
    it("rejects missing name", () => {
      const result = kitSchema.safeParse({ assetTag: "KIT-001" });
      expect(result.success).toBe(false);
    });

    it("rejects empty string name", () => {
      const result = kitSchema.safeParse({ name: "", assetTag: "KIT-001" });
      expect(result.success).toBe(false);
    });

    it("accepts name at max length (200)", () => {
      const result = kitSchema.safeParse({ name: "a".repeat(200), assetTag: "KIT-001" });
      expect(result.success).toBe(true);
    });

    it("rejects name exceeding max length", () => {
      const result = kitSchema.safeParse({ name: "a".repeat(201), assetTag: "KIT-001" });
      expect(result.success).toBe(false);
    });
  });

  describe("assetTag (required, max 50)", () => {
    it("rejects missing assetTag", () => {
      const result = kitSchema.safeParse({ name: "Kit" });
      expect(result.success).toBe(false);
    });

    it("rejects empty string assetTag", () => {
      const result = kitSchema.safeParse({ name: "Kit", assetTag: "" });
      expect(result.success).toBe(false);
    });

    it("accepts assetTag at max length (50)", () => {
      const result = kitSchema.safeParse({ name: "Kit", assetTag: "a".repeat(50) });
      expect(result.success).toBe(true);
    });

    it("rejects assetTag exceeding max length", () => {
      const result = kitSchema.safeParse({ name: "Kit", assetTag: "a".repeat(51) });
      expect(result.success).toBe(false);
    });
  });

  describe("description (optional, max 2000)", () => {
    it("accepts at max length", () => {
      const result = kitSchema.safeParse({ ...validMinimalKit, description: "d".repeat(2000) });
      expect(result.success).toBe(true);
    });

    it("rejects exceeding max length", () => {
      const result = kitSchema.safeParse({ ...validMinimalKit, description: "d".repeat(2001) });
      expect(result.success).toBe(false);
    });
  });

  describe("caseType and caseDimensions (optional, max 200)", () => {
    it("accepts caseType at max length", () => {
      const result = kitSchema.safeParse({ ...validMinimalKit, caseType: "c".repeat(200) });
      expect(result.success).toBe(true);
    });

    it("rejects caseType exceeding max length", () => {
      const result = kitSchema.safeParse({ ...validMinimalKit, caseType: "c".repeat(201) });
      expect(result.success).toBe(false);
    });

    it("accepts caseDimensions at max length", () => {
      const result = kitSchema.safeParse({ ...validMinimalKit, caseDimensions: "d".repeat(200) });
      expect(result.success).toBe(true);
    });

    it("rejects caseDimensions exceeding max length", () => {
      const result = kitSchema.safeParse({ ...validMinimalKit, caseDimensions: "d".repeat(201) });
      expect(result.success).toBe(false);
    });
  });

  describe("notes (optional, max 2000)", () => {
    it("accepts at max length", () => {
      const result = kitSchema.safeParse({ ...validMinimalKit, notes: "n".repeat(2000) });
      expect(result.success).toBe(true);
    });

    it("rejects exceeding max length", () => {
      const result = kitSchema.safeParse({ ...validMinimalKit, notes: "n".repeat(2001) });
      expect(result.success).toBe(false);
    });
  });

  describe("enum fields", () => {
    it("rejects invalid status", () => {
      const result = kitSchema.safeParse({ ...validMinimalKit, status: "BROKEN" });
      expect(result.success).toBe(false);
    });

    it("accepts all valid status values", () => {
      for (const val of ["AVAILABLE", "CHECKED_OUT", "IN_MAINTENANCE", "RETIRED", "INCOMPLETE"]) {
        const result = kitSchema.safeParse({ ...validMinimalKit, status: val });
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid condition", () => {
      const result = kitSchema.safeParse({ ...validMinimalKit, condition: "DESTROYED" });
      expect(result.success).toBe(false);
    });

    it("accepts all valid condition values", () => {
      for (const val of ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"]) {
        const result = kitSchema.safeParse({ ...validMinimalKit, condition: val });
        expect(result.success).toBe(true);
      }
    });
  });

  describe("default values", () => {
    it("defaults status to AVAILABLE", () => {
      const result = kitSchema.safeParse(validMinimalKit);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.status).toBe("AVAILABLE");
    });

    it("defaults condition to NEW", () => {
      const result = kitSchema.safeParse(validMinimalKit);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.condition).toBe("NEW");
    });

    it("defaults images to empty array", () => {
      const result = kitSchema.safeParse(validMinimalKit);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.images).toEqual([]);
    });

    it("defaults isActive to true", () => {
      const result = kitSchema.safeParse(validMinimalKit);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.isActive).toBe(true);
    });

    it("defaults tags to empty array", () => {
      const result = kitSchema.safeParse(validMinimalKit);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.tags).toEqual([]);
    });
  });

  describe("weight (coerce, min 0)", () => {
    it("coerces string to number", () => {
      const result = kitSchema.safeParse({ ...validMinimalKit, weight: "25.5" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.weight).toBe(25.5);
    });

    it("rejects negative weight", () => {
      const result = kitSchema.safeParse({ ...validMinimalKit, weight: -1 });
      expect(result.success).toBe(false);
    });

    it("accepts zero weight", () => {
      const result = kitSchema.safeParse({ ...validMinimalKit, weight: 0 });
      expect(result.success).toBe(true);
    });
  });

  describe("purchasePrice (coerce, min 0)", () => {
    it("rejects negative purchasePrice", () => {
      const result = kitSchema.safeParse({ ...validMinimalKit, purchasePrice: -100 });
      expect(result.success).toBe(false);
    });

    it("coerces string to number", () => {
      const result = kitSchema.safeParse({ ...validMinimalKit, purchasePrice: "500" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.purchasePrice).toBe(500);
    });
  });

  describe("purchaseDate (transform: empty string → undefined)", () => {
    it("transforms empty string to undefined", () => {
      const result = kitSchema.safeParse({ ...validMinimalKit, purchaseDate: "" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.purchaseDate).toBeUndefined();
    });

    it("accepts valid date object", () => {
      const date = new Date("2024-06-15");
      const result = kitSchema.safeParse({ ...validMinimalKit, purchaseDate: date });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.purchaseDate).toEqual(date);
    });

    it("coerces date string to Date", () => {
      const result = kitSchema.safeParse({ ...validMinimalKit, purchaseDate: "2024-06-15" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.purchaseDate).toBeInstanceOf(Date);
    });

    it("accepts undefined (field is optional)", () => {
      const result = kitSchema.safeParse(validMinimalKit);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.purchaseDate).toBeUndefined();
    });
  });
});

describe("kitSerializedItemSchema", () => {
  describe("valid data", () => {
    it("accepts minimal valid data", () => {
      const result = kitSerializedItemSchema.safeParse({ assetId: "asset-123" });
      expect(result.success).toBe(true);
    });

    it("accepts complete valid data", () => {
      const result = kitSerializedItemSchema.safeParse({
        assetId: "asset-123",
        position: "Slot A1",
        notes: "Primary unit",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("assetId (required)", () => {
    it("rejects missing assetId", () => {
      const result = kitSerializedItemSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects empty string assetId", () => {
      const result = kitSerializedItemSchema.safeParse({ assetId: "" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Asset is required");
      }
    });
  });

  describe("position (optional, max 200)", () => {
    it("accepts at max length", () => {
      const result = kitSerializedItemSchema.safeParse({ assetId: "a", position: "p".repeat(200) });
      expect(result.success).toBe(true);
    });

    it("rejects exceeding max length", () => {
      const result = kitSerializedItemSchema.safeParse({ assetId: "a", position: "p".repeat(201) });
      expect(result.success).toBe(false);
    });
  });

  describe("notes (optional, max 500)", () => {
    it("accepts at max length", () => {
      const result = kitSerializedItemSchema.safeParse({ assetId: "a", notes: "n".repeat(500) });
      expect(result.success).toBe(true);
    });

    it("rejects exceeding max length", () => {
      const result = kitSerializedItemSchema.safeParse({ assetId: "a", notes: "n".repeat(501) });
      expect(result.success).toBe(false);
    });
  });
});

describe("kitBulkItemSchema", () => {
  const validBulkItem = { bulkAssetId: "bulk-123", quantity: 5 };

  describe("valid data", () => {
    it("accepts minimal valid data", () => {
      const result = kitBulkItemSchema.safeParse(validBulkItem);
      expect(result.success).toBe(true);
    });

    it("accepts complete valid data", () => {
      const result = kitBulkItemSchema.safeParse({
        ...validBulkItem,
        position: "Drawer 1",
        notes: "Extra cables",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("bulkAssetId (required)", () => {
    it("rejects missing bulkAssetId", () => {
      const result = kitBulkItemSchema.safeParse({ quantity: 1 });
      expect(result.success).toBe(false);
    });

    it("rejects empty string bulkAssetId", () => {
      const result = kitBulkItemSchema.safeParse({ bulkAssetId: "", quantity: 1 });
      expect(result.success).toBe(false);
    });
  });

  describe("quantity (required, int, min 1)", () => {
    it("rejects zero quantity", () => {
      const result = kitBulkItemSchema.safeParse({ bulkAssetId: "b", quantity: 0 });
      expect(result.success).toBe(false);
    });

    it("rejects negative quantity", () => {
      const result = kitBulkItemSchema.safeParse({ bulkAssetId: "b", quantity: -1 });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer quantity", () => {
      const result = kitBulkItemSchema.safeParse({ bulkAssetId: "b", quantity: 1.5 });
      expect(result.success).toBe(false);
    });

    it("accepts quantity of 1 (minimum)", () => {
      const result = kitBulkItemSchema.safeParse({ bulkAssetId: "b", quantity: 1 });
      expect(result.success).toBe(true);
    });

    it("coerces string to number", () => {
      const result = kitBulkItemSchema.safeParse({ bulkAssetId: "b", quantity: "10" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.quantity).toBe(10);
    });
  });

  describe("position (optional, max 200)", () => {
    it("accepts at max length", () => {
      const result = kitBulkItemSchema.safeParse({ ...validBulkItem, position: "p".repeat(200) });
      expect(result.success).toBe(true);
    });

    it("rejects exceeding max length", () => {
      const result = kitBulkItemSchema.safeParse({ ...validBulkItem, position: "p".repeat(201) });
      expect(result.success).toBe(false);
    });
  });

  describe("notes (optional, max 500)", () => {
    it("accepts at max length", () => {
      const result = kitBulkItemSchema.safeParse({ ...validBulkItem, notes: "n".repeat(500) });
      expect(result.success).toBe(true);
    });

    it("rejects exceeding max length", () => {
      const result = kitBulkItemSchema.safeParse({ ...validBulkItem, notes: "n".repeat(501) });
      expect(result.success).toBe(false);
    });
  });
});
