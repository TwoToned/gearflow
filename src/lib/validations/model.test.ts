import { describe, it, expect } from "vitest";
import { modelSchema } from "./model";

const validMinimal = { name: "Test Model" };

const validComplete = {
  name: "Moving Head Wash",
  manufacturer: "Robe",
  modelNumber: "MH-600",
  sku: "ROBE-MH600",
  categoryId: "cat-123",
  description: "A professional moving head wash fixture",
  image: "https://example.com/image.jpg",
  images: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
  manuals: ["https://example.com/manual.pdf"],
  specifications: { wattage: "600W", beam_angle: "15-45°" },
  customFields: { color: "black" },
  defaultRentalPrice: 150,
  defaultPurchasePrice: 5000,
  replacementCost: 6000,
  weight: 23.5,
  powerDraw: 650,
  requiresTestAndTag: true,
  testAndTagIntervalDays: 90,
  defaultEquipmentClass: "CLASS_I" as const,
  defaultApplianceType: "APPLIANCE" as const,
  maintenanceIntervalDays: 180,
  assetType: "SERIALIZED" as const,
  barcodeLabelTemplate: "default",
  isActive: true,
  tags: ["lighting", "wash"],
};

describe("modelSchema", () => {
  describe("valid data", () => {
    it("accepts minimal valid data", () => {
      const result = modelSchema.safeParse(validMinimal);
      expect(result.success).toBe(true);
    });

    it("accepts complete valid data", () => {
      const result = modelSchema.safeParse(validComplete);
      expect(result.success).toBe(true);
    });
  });

  describe("name (required, max 200)", () => {
    it("rejects missing name", () => {
      const result = modelSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects empty string name", () => {
      const result = modelSchema.safeParse({ name: "" });
      expect(result.success).toBe(false);
    });

    it("accepts name at max length (200)", () => {
      const result = modelSchema.safeParse({ name: "a".repeat(200) });
      expect(result.success).toBe(true);
    });

    it("rejects name exceeding max length", () => {
      const result = modelSchema.safeParse({ name: "a".repeat(201) });
      expect(result.success).toBe(false);
    });
  });

  describe("manufacturer (optional, max 200)", () => {
    it("accepts undefined", () => {
      const result = modelSchema.safeParse(validMinimal);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.manufacturer).toBeUndefined();
    });

    it("accepts valid string", () => {
      const result = modelSchema.safeParse({ ...validMinimal, manufacturer: "Robe" });
      expect(result.success).toBe(true);
    });

    it("accepts at max length (200)", () => {
      const result = modelSchema.safeParse({ ...validMinimal, manufacturer: "a".repeat(200) });
      expect(result.success).toBe(true);
    });

    it("rejects exceeding max length", () => {
      const result = modelSchema.safeParse({ ...validMinimal, manufacturer: "a".repeat(201) });
      expect(result.success).toBe(false);
    });
  });

  describe("modelNumber (optional, max 100)", () => {
    it("accepts undefined", () => {
      const result = modelSchema.safeParse(validMinimal);
      expect(result.success).toBe(true);
    });

    it("accepts at max length (100)", () => {
      const result = modelSchema.safeParse({ ...validMinimal, modelNumber: "x".repeat(100) });
      expect(result.success).toBe(true);
    });

    it("rejects exceeding max length", () => {
      const result = modelSchema.safeParse({ ...validMinimal, modelNumber: "x".repeat(101) });
      expect(result.success).toBe(false);
    });
  });

  describe("sku (optional, max 100)", () => {
    it("accepts at max length (100)", () => {
      const result = modelSchema.safeParse({ ...validMinimal, sku: "s".repeat(100) });
      expect(result.success).toBe(true);
    });

    it("rejects exceeding max length", () => {
      const result = modelSchema.safeParse({ ...validMinimal, sku: "s".repeat(101) });
      expect(result.success).toBe(false);
    });
  });

  describe("description (optional, max 2000)", () => {
    it("accepts at max length (2000)", () => {
      const result = modelSchema.safeParse({ ...validMinimal, description: "d".repeat(2000) });
      expect(result.success).toBe(true);
    });

    it("rejects exceeding max length", () => {
      const result = modelSchema.safeParse({ ...validMinimal, description: "d".repeat(2001) });
      expect(result.success).toBe(false);
    });
  });

  describe("numeric fields with coerce", () => {
    it("coerces string to number for defaultRentalPrice", () => {
      const result = modelSchema.safeParse({ ...validMinimal, defaultRentalPrice: "100" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.defaultRentalPrice).toBe(100);
    });

    it("rejects negative defaultRentalPrice", () => {
      const result = modelSchema.safeParse({ ...validMinimal, defaultRentalPrice: -1 });
      expect(result.success).toBe(false);
    });

    it("accepts zero for defaultRentalPrice", () => {
      const result = modelSchema.safeParse({ ...validMinimal, defaultRentalPrice: 0 });
      expect(result.success).toBe(true);
    });

    it("rejects negative defaultPurchasePrice", () => {
      const result = modelSchema.safeParse({ ...validMinimal, defaultPurchasePrice: -5 });
      expect(result.success).toBe(false);
    });

    it("rejects negative replacementCost", () => {
      const result = modelSchema.safeParse({ ...validMinimal, replacementCost: -0.01 });
      expect(result.success).toBe(false);
    });

    it("rejects negative weight", () => {
      const result = modelSchema.safeParse({ ...validMinimal, weight: -1 });
      expect(result.success).toBe(false);
    });

    it("accepts decimal weight", () => {
      const result = modelSchema.safeParse({ ...validMinimal, weight: 12.5 });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.weight).toBe(12.5);
    });

    it("rejects negative powerDraw", () => {
      const result = modelSchema.safeParse({ ...validMinimal, powerDraw: -1 });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer powerDraw", () => {
      const result = modelSchema.safeParse({ ...validMinimal, powerDraw: 1.5 });
      expect(result.success).toBe(false);
    });

    it("accepts zero powerDraw", () => {
      const result = modelSchema.safeParse({ ...validMinimal, powerDraw: 0 });
      expect(result.success).toBe(true);
    });

    it("rejects negative maintenanceIntervalDays", () => {
      const result = modelSchema.safeParse({ ...validMinimal, maintenanceIntervalDays: -1 });
      expect(result.success).toBe(false);
    });

    it("accepts zero maintenanceIntervalDays", () => {
      const result = modelSchema.safeParse({ ...validMinimal, maintenanceIntervalDays: 0 });
      expect(result.success).toBe(true);
    });
  });

  describe("testAndTagIntervalDays (transform: empty string → undefined)", () => {
    it("transforms empty string to undefined", () => {
      const result = modelSchema.safeParse({ ...validMinimal, testAndTagIntervalDays: "" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.testAndTagIntervalDays).toBeUndefined();
    });

    it("accepts valid positive integer", () => {
      const result = modelSchema.safeParse({ ...validMinimal, testAndTagIntervalDays: 90 });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.testAndTagIntervalDays).toBe(90);
    });

    it("rejects zero (min 1 for number branch) and transforms to undefined", () => {
      // z.coerce.number().int().min(1) would fail for 0, but the transform maps 0 → undefined
      // The union tries literal("") first (fails for 0), then coerce.number().int().min(1) which fails for 0
      // Actually, coerce turns 0 to number 0, int passes, min(1) fails
      // But the schema has a transform that maps v === 0 to undefined
      // Since 0 doesn't match z.literal(""), it tries z.coerce.number().int().min(1)
      // min(1) should fail for 0... but the transform handles v === 0 → undefined
      // Let's test actual behavior:
      const result = modelSchema.safeParse({ ...validMinimal, testAndTagIntervalDays: 0 });
      // 0 fails the min(1) check on the number branch, so the union fails
      expect(result.success).toBe(false);
    });

    it("accepts undefined (field is optional)", () => {
      const result = modelSchema.safeParse(validMinimal);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.testAndTagIntervalDays).toBeUndefined();
    });

    it("coerces string number to number", () => {
      const result = modelSchema.safeParse({ ...validMinimal, testAndTagIntervalDays: "30" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.testAndTagIntervalDays).toBe(30);
    });
  });

  describe("enum fields", () => {
    it("rejects invalid defaultEquipmentClass", () => {
      const result = modelSchema.safeParse({ ...validMinimal, defaultEquipmentClass: "CLASS_III" });
      expect(result.success).toBe(false);
    });

    it("accepts all valid defaultEquipmentClass values", () => {
      for (const val of ["CLASS_I", "CLASS_II", "CLASS_II_DOUBLE_INSULATED", "LEAD_CORD_ASSEMBLY"]) {
        const result = modelSchema.safeParse({ ...validMinimal, defaultEquipmentClass: val });
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid defaultApplianceType", () => {
      const result = modelSchema.safeParse({ ...validMinimal, defaultApplianceType: "INVALID" });
      expect(result.success).toBe(false);
    });

    it("accepts all valid defaultApplianceType values", () => {
      for (const val of ["APPLIANCE", "CORD_SET", "EXTENSION_LEAD", "POWER_BOARD", "RCD_PORTABLE", "RCD_FIXED", "THREE_PHASE", "OTHER"]) {
        const result = modelSchema.safeParse({ ...validMinimal, defaultApplianceType: val });
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid assetType", () => {
      const result = modelSchema.safeParse({ ...validMinimal, assetType: "CONSUMABLE" });
      expect(result.success).toBe(false);
    });

    it("accepts SERIALIZED and BULK assetType", () => {
      for (const val of ["SERIALIZED", "BULK"]) {
        const result = modelSchema.safeParse({ ...validMinimal, assetType: val });
        expect(result.success).toBe(true);
      }
    });
  });

  describe("default values", () => {
    it("defaults images to empty array", () => {
      const result = modelSchema.safeParse(validMinimal);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.images).toEqual([]);
    });

    it("defaults manuals to empty array", () => {
      const result = modelSchema.safeParse(validMinimal);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.manuals).toEqual([]);
    });

    it("defaults requiresTestAndTag to false", () => {
      const result = modelSchema.safeParse(validMinimal);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.requiresTestAndTag).toBe(false);
    });

    it("defaults assetType to SERIALIZED", () => {
      const result = modelSchema.safeParse(validMinimal);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.assetType).toBe("SERIALIZED");
    });

    it("defaults isActive to true", () => {
      const result = modelSchema.safeParse(validMinimal);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.isActive).toBe(true);
    });

    it("defaults tags to empty array", () => {
      const result = modelSchema.safeParse(validMinimal);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.tags).toEqual([]);
    });
  });

  describe("record fields", () => {
    it("accepts valid specifications record", () => {
      const result = modelSchema.safeParse({
        ...validMinimal,
        specifications: { key1: "value1", key2: "value2" },
      });
      expect(result.success).toBe(true);
    });

    it("accepts empty specifications record", () => {
      const result = modelSchema.safeParse({ ...validMinimal, specifications: {} });
      expect(result.success).toBe(true);
    });

    it("accepts valid customFields record", () => {
      const result = modelSchema.safeParse({
        ...validMinimal,
        customFields: { field1: "val1" },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("accepts name with exactly 1 character", () => {
      const result = modelSchema.safeParse({ name: "A" });
      expect(result.success).toBe(true);
    });

    it("accepts name with special characters", () => {
      const result = modelSchema.safeParse({ name: "Model #1 — 'Special' (v2.0)" });
      expect(result.success).toBe(true);
    });

    it("coerces string prices to numbers", () => {
      const result = modelSchema.safeParse({
        ...validMinimal,
        defaultRentalPrice: "99.99",
        defaultPurchasePrice: "1000",
        replacementCost: "0",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.defaultRentalPrice).toBe(99.99);
        expect(result.data.defaultPurchasePrice).toBe(1000);
        expect(result.data.replacementCost).toBe(0);
      }
    });

    it("accepts arrays with string elements", () => {
      const result = modelSchema.safeParse({
        ...validMinimal,
        images: ["img1.jpg", "img2.png"],
        tags: ["tag1", "tag2", "tag3"],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.images).toEqual(["img1.jpg", "img2.png"]);
        expect(result.data.tags).toEqual(["tag1", "tag2", "tag3"]);
      }
    });
  });
});
