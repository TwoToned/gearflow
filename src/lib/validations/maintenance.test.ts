import { describe, it, expect } from "vitest";
import { maintenanceSchema } from "./maintenance";

const validWithAssetId = {
  assetId: "asset-123",
  title: "Replace lamp",
};

const validWithAssetIds = {
  assetIds: ["asset-123", "asset-456"],
  title: "Batch inspection",
};

const validComplete = {
  assetId: "asset-123",
  assetIds: ["asset-123"],
  type: "REPAIR" as const,
  status: "SCHEDULED" as const,
  title: "Replace faulty DMX connector",
  description: "The DMX output connector on channel 2 is intermittent",
  reportedById: "user-001",
  assignedToId: "user-002",
  scheduledDate: new Date("2024-07-01"),
  completedDate: new Date("2024-07-03"),
  cost: 45.50,
  partsUsed: "1x 5-pin XLR female connector, solder",
  result: "PASS" as const,
  tags: ["dmx", "urgent"],
  nextDueDate: new Date("2025-01-01"),
};

describe("maintenanceSchema", () => {
  describe("valid data", () => {
    it("accepts minimal data with assetId", () => {
      const result = maintenanceSchema.safeParse(validWithAssetId);
      expect(result.success).toBe(true);
    });

    it("accepts minimal data with assetIds", () => {
      const result = maintenanceSchema.safeParse(validWithAssetIds);
      expect(result.success).toBe(true);
    });

    it("accepts complete valid data", () => {
      const result = maintenanceSchema.safeParse(validComplete);
      expect(result.success).toBe(true);
    });
  });

  describe("refine: at least one asset required", () => {
    it("rejects when neither assetId nor assetIds provided", () => {
      const result = maintenanceSchema.safeParse({ title: "Fix something" });
      expect(result.success).toBe(false);
      if (!result.success) {
        const assetIdsError = result.error.issues.find((i) => i.path.includes("assetIds"));
        expect(assetIdsError).toBeDefined();
        expect(assetIdsError?.message).toBe("At least one asset is required");
      }
    });

    it("rejects when assetId is empty string and assetIds is empty array", () => {
      const result = maintenanceSchema.safeParse({
        title: "Fix something",
        assetId: "",
        assetIds: [],
      });
      expect(result.success).toBe(false);
    });

    it("accepts when only assetId is provided", () => {
      const result = maintenanceSchema.safeParse({ title: "Fix", assetId: "a1" });
      expect(result.success).toBe(true);
    });

    it("accepts when only assetIds is provided with items", () => {
      const result = maintenanceSchema.safeParse({ title: "Fix", assetIds: ["a1"] });
      expect(result.success).toBe(true);
    });

    it("accepts when both assetId and assetIds are provided", () => {
      const result = maintenanceSchema.safeParse({
        title: "Fix",
        assetId: "a1",
        assetIds: ["a2"],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("title (required, max 200)", () => {
    it("rejects missing title", () => {
      const result = maintenanceSchema.safeParse({ assetId: "a1" });
      expect(result.success).toBe(false);
    });

    it("rejects empty string title", () => {
      const result = maintenanceSchema.safeParse({ assetId: "a1", title: "" });
      expect(result.success).toBe(false);
    });

    it("accepts title at max length (200)", () => {
      const result = maintenanceSchema.safeParse({ assetId: "a1", title: "t".repeat(200) });
      expect(result.success).toBe(true);
    });

    it("rejects title exceeding max length", () => {
      const result = maintenanceSchema.safeParse({ assetId: "a1", title: "t".repeat(201) });
      expect(result.success).toBe(false);
    });
  });

  describe("description (optional, max 5000)", () => {
    it("accepts at max length", () => {
      const result = maintenanceSchema.safeParse({
        ...validWithAssetId,
        description: "d".repeat(5000),
      });
      expect(result.success).toBe(true);
    });

    it("rejects exceeding max length", () => {
      const result = maintenanceSchema.safeParse({
        ...validWithAssetId,
        description: "d".repeat(5001),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("partsUsed (optional, max 2000)", () => {
    it("accepts at max length", () => {
      const result = maintenanceSchema.safeParse({
        ...validWithAssetId,
        partsUsed: "p".repeat(2000),
      });
      expect(result.success).toBe(true);
    });

    it("rejects exceeding max length", () => {
      const result = maintenanceSchema.safeParse({
        ...validWithAssetId,
        partsUsed: "p".repeat(2001),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("type enum", () => {
    it("rejects invalid type", () => {
      const result = maintenanceSchema.safeParse({ ...validWithAssetId, type: "UPGRADE" });
      expect(result.success).toBe(false);
    });

    it("accepts all valid type values", () => {
      for (const val of ["REPAIR", "PREVENTATIVE", "TEST_AND_TAG", "INSPECTION", "CLEANING", "FIRMWARE_UPDATE"]) {
        const result = maintenanceSchema.safeParse({ ...validWithAssetId, type: val });
        expect(result.success).toBe(true);
      }
    });
  });

  describe("status enum", () => {
    it("rejects invalid status", () => {
      const result = maintenanceSchema.safeParse({ ...validWithAssetId, status: "PENDING" });
      expect(result.success).toBe(false);
    });

    it("accepts all valid status values", () => {
      for (const val of ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]) {
        const result = maintenanceSchema.safeParse({ ...validWithAssetId, status: val });
        expect(result.success).toBe(true);
      }
    });
  });

  describe("result enum", () => {
    it("rejects invalid result", () => {
      const result = maintenanceSchema.safeParse({ ...validWithAssetId, result: "PARTIAL" });
      expect(result.success).toBe(false);
    });

    it("accepts all valid result values", () => {
      for (const val of ["PASS", "FAIL", "CONDITIONAL"]) {
        const result = maintenanceSchema.safeParse({ ...validWithAssetId, result: val });
        expect(result.success).toBe(true);
      }
    });

    it("accepts undefined result", () => {
      const result = maintenanceSchema.safeParse(validWithAssetId);
      expect(result.success).toBe(true);
    });
  });

  describe("default values", () => {
    it("defaults type to REPAIR", () => {
      const result = maintenanceSchema.safeParse(validWithAssetId);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.type).toBe("REPAIR");
    });

    it("defaults status to SCHEDULED", () => {
      const result = maintenanceSchema.safeParse(validWithAssetId);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.status).toBe("SCHEDULED");
    });

    it("defaults tags to empty array", () => {
      const result = maintenanceSchema.safeParse(validWithAssetId);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.tags).toEqual([]);
    });
  });

  describe("cost (coerce, min 0)", () => {
    it("rejects negative cost", () => {
      const result = maintenanceSchema.safeParse({ ...validWithAssetId, cost: -1 });
      expect(result.success).toBe(false);
    });

    it("accepts zero cost", () => {
      const result = maintenanceSchema.safeParse({ ...validWithAssetId, cost: 0 });
      expect(result.success).toBe(true);
    });

    it("coerces string to number", () => {
      const result = maintenanceSchema.safeParse({ ...validWithAssetId, cost: "99.50" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.cost).toBe(99.5);
    });
  });

  describe("date transforms (empty string → undefined)", () => {
    it("transforms empty string scheduledDate to undefined", () => {
      const result = maintenanceSchema.safeParse({ ...validWithAssetId, scheduledDate: "" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.scheduledDate).toBeUndefined();
    });

    it("transforms empty string completedDate to undefined", () => {
      const result = maintenanceSchema.safeParse({ ...validWithAssetId, completedDate: "" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.completedDate).toBeUndefined();
    });

    it("transforms empty string nextDueDate to undefined", () => {
      const result = maintenanceSchema.safeParse({ ...validWithAssetId, nextDueDate: "" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.nextDueDate).toBeUndefined();
    });

    it("accepts valid date objects", () => {
      const date = new Date("2024-08-01");
      const result = maintenanceSchema.safeParse({
        ...validWithAssetId,
        scheduledDate: date,
        completedDate: date,
        nextDueDate: date,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scheduledDate).toEqual(date);
        expect(result.data.completedDate).toEqual(date);
        expect(result.data.nextDueDate).toEqual(date);
      }
    });

    it("coerces date strings to Date objects", () => {
      const result = maintenanceSchema.safeParse({
        ...validWithAssetId,
        scheduledDate: "2024-08-01",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.scheduledDate).toBeInstanceOf(Date);
    });

    it("accepts undefined dates (fields are optional)", () => {
      const result = maintenanceSchema.safeParse(validWithAssetId);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scheduledDate).toBeUndefined();
        expect(result.data.completedDate).toBeUndefined();
        expect(result.data.nextDueDate).toBeUndefined();
      }
    });
  });

  describe("assetIds array validation", () => {
    it("rejects assetIds with empty strings", () => {
      const result = maintenanceSchema.safeParse({ title: "Fix", assetIds: [""] });
      expect(result.success).toBe(false);
    });

    it("accepts assetIds with valid strings", () => {
      const result = maintenanceSchema.safeParse({
        title: "Fix",
        assetIds: ["a1", "a2", "a3"],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("accepts title with exactly 1 character", () => {
      const result = maintenanceSchema.safeParse({ assetId: "a1", title: "X" });
      expect(result.success).toBe(true);
    });

    it("accepts large cost value", () => {
      const result = maintenanceSchema.safeParse({ ...validWithAssetId, cost: 999999.99 });
      expect(result.success).toBe(true);
    });
  });
});
