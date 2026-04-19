import { describe, it, expect } from "vitest";
import { lineItemSchema, customLineItemSchema } from "./line-item";

const validMinimal = {};

const validComplete = {
  type: "EQUIPMENT" as const,
  modelId: "model-123",
  assetId: "asset-456",
  bulkAssetId: "bulk-789",
  description: "4-channel DMX dimmer pack",
  quantity: 2,
  unitPrice: 50,
  pricingType: "PER_DAY" as const,
  duration: 3,
  discount: 10,
  groupName: "Lighting",
  notes: "Include spare fuses",
  isOptional: false,
  isSubhire: true,
  showSubhireOnDocs: true,
  supplierId: "sup-001",
  subhireOrderNumber: "PO-2024-001",
};

describe("lineItemSchema", () => {
  describe("valid data", () => {
    it("accepts minimal data (all defaults applied)", () => {
      const result = lineItemSchema.safeParse(validMinimal);
      expect(result.success).toBe(true);
    });

    it("accepts complete valid data", () => {
      const result = lineItemSchema.safeParse(validComplete);
      expect(result.success).toBe(true);
    });
  });

  describe("type enum", () => {
    it("rejects invalid type", () => {
      const result = lineItemSchema.safeParse({ type: "RENTAL" });
      expect(result.success).toBe(false);
    });

    it("accepts all valid type values", () => {
      for (const val of ["EQUIPMENT", "SERVICE", "LABOUR", "TRANSPORT", "MISC"]) {
        const result = lineItemSchema.safeParse({ type: val });
        expect(result.success).toBe(true);
      }
    });
  });

  describe("description (optional, max 500)", () => {
    it("accepts at max length", () => {
      const result = lineItemSchema.safeParse({ description: "d".repeat(500) });
      expect(result.success).toBe(true);
    });

    it("rejects exceeding max length", () => {
      const result = lineItemSchema.safeParse({ description: "d".repeat(501) });
      expect(result.success).toBe(false);
    });
  });

  describe("quantity (coerce, int, min 1, max 99999)", () => {
    it("rejects zero quantity", () => {
      const result = lineItemSchema.safeParse({ quantity: 0 });
      expect(result.success).toBe(false);
    });

    it("rejects negative quantity", () => {
      const result = lineItemSchema.safeParse({ quantity: -1 });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer quantity", () => {
      const result = lineItemSchema.safeParse({ quantity: 1.5 });
      expect(result.success).toBe(false);
    });

    it("accepts minimum quantity (1)", () => {
      const result = lineItemSchema.safeParse({ quantity: 1 });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.quantity).toBe(1);
    });

    it("accepts maximum quantity (99999)", () => {
      const result = lineItemSchema.safeParse({ quantity: 99999 });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.quantity).toBe(99999);
    });

    it("rejects quantity exceeding max (100000)", () => {
      const result = lineItemSchema.safeParse({ quantity: 100000 });
      expect(result.success).toBe(false);
    });

    it("coerces string to number", () => {
      const result = lineItemSchema.safeParse({ quantity: "5" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.quantity).toBe(5);
    });
  });

  describe("unitPrice (coerce, min 0, max 999999.99)", () => {
    it("accepts zero", () => {
      const result = lineItemSchema.safeParse({ unitPrice: 0 });
      expect(result.success).toBe(true);
    });

    it("rejects negative", () => {
      const result = lineItemSchema.safeParse({ unitPrice: -1 });
      expect(result.success).toBe(false);
    });

    it("accepts maximum value", () => {
      const result = lineItemSchema.safeParse({ unitPrice: 999999.99 });
      expect(result.success).toBe(true);
    });

    it("rejects exceeding maximum", () => {
      const result = lineItemSchema.safeParse({ unitPrice: 1000000 });
      expect(result.success).toBe(false);
    });

    it("coerces string to number", () => {
      const result = lineItemSchema.safeParse({ unitPrice: "75.50" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.unitPrice).toBe(75.5);
    });

    // Regression: empty unitPrice coerces to 0 via z.coerce.number().
    // Server-side optimizer gate uses !parsed.unitPrice to catch 0/null/undefined.
    // Found by /qa on 2026-03-28
    it("coerces empty string to 0 (server handles this case)", () => {
      const result = lineItemSchema.safeParse({ unitPrice: "" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.unitPrice).toBe(0);
    });

    it("treats undefined as undefined", () => {
      const result = lineItemSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.unitPrice).toBeUndefined();
    });
  });

  describe("pricingType enum", () => {
    it("rejects invalid pricingType", () => {
      const result = lineItemSchema.safeParse({ pricingType: "PER_MONTH" });
      expect(result.success).toBe(false);
    });

    it("accepts all valid pricingType values", () => {
      for (const val of ["PER_DAY", "PER_WEEK", "FLAT", "PER_HOUR"]) {
        const result = lineItemSchema.safeParse({ pricingType: val });
        expect(result.success).toBe(true);
      }
    });
  });

  describe("duration (coerce, int, min 1, max 3650)", () => {
    it("rejects zero duration", () => {
      const result = lineItemSchema.safeParse({ duration: 0 });
      expect(result.success).toBe(false);
    });

    it("accepts minimum duration (1)", () => {
      const result = lineItemSchema.safeParse({ duration: 1 });
      expect(result.success).toBe(true);
    });

    it("accepts maximum duration (3650)", () => {
      const result = lineItemSchema.safeParse({ duration: 3650 });
      expect(result.success).toBe(true);
    });

    it("rejects exceeding maximum duration", () => {
      const result = lineItemSchema.safeParse({ duration: 3651 });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer duration", () => {
      const result = lineItemSchema.safeParse({ duration: 1.5 });
      expect(result.success).toBe(false);
    });
  });

  describe("discount (coerce, min 0, max 999999.99)", () => {
    it("accepts zero", () => {
      const result = lineItemSchema.safeParse({ discount: 0 });
      expect(result.success).toBe(true);
    });

    it("rejects negative", () => {
      const result = lineItemSchema.safeParse({ discount: -1 });
      expect(result.success).toBe(false);
    });

    it("accepts maximum value", () => {
      const result = lineItemSchema.safeParse({ discount: 999999.99 });
      expect(result.success).toBe(true);
    });

    it("rejects exceeding maximum", () => {
      const result = lineItemSchema.safeParse({ discount: 1000000 });
      expect(result.success).toBe(false);
    });
  });

  describe("subhireOrderNumber (optional, max 100)", () => {
    it("accepts at max length", () => {
      const result = lineItemSchema.safeParse({ subhireOrderNumber: "x".repeat(100) });
      expect(result.success).toBe(true);
    });

    it("rejects exceeding max length", () => {
      const result = lineItemSchema.safeParse({ subhireOrderNumber: "x".repeat(101) });
      expect(result.success).toBe(false);
    });
  });

  describe("default values", () => {
    it("defaults type to EQUIPMENT", () => {
      const result = lineItemSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.type).toBe("EQUIPMENT");
    });

    it("defaults quantity to 1", () => {
      const result = lineItemSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.quantity).toBe(1);
    });

    it("defaults pricingType to PER_DAY", () => {
      const result = lineItemSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.pricingType).toBe("PER_DAY");
    });

    it("defaults duration to 1", () => {
      const result = lineItemSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.duration).toBe(1);
    });

    it("defaults isOptional to false", () => {
      const result = lineItemSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.isOptional).toBe(false);
    });

    it("defaults isSubhire to false", () => {
      const result = lineItemSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.isSubhire).toBe(false);
    });

    it("defaults showSubhireOnDocs to false", () => {
      const result = lineItemSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.showSubhireOnDocs).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("accepts all optional string fields as undefined", () => {
      const result = lineItemSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.modelId).toBeUndefined();
        expect(result.data.assetId).toBeUndefined();
        expect(result.data.bulkAssetId).toBeUndefined();
        expect(result.data.description).toBeUndefined();
        expect(result.data.groupName).toBeUndefined();
        expect(result.data.notes).toBeUndefined();
        expect(result.data.supplierId).toBeUndefined();
        expect(result.data.subhireOrderNumber).toBeUndefined();
      }
    });

    it("accepts unitPrice with decimal precision", () => {
      const result = lineItemSchema.safeParse({ unitPrice: 99.99 });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.unitPrice).toBe(99.99);
    });

    it("coerces string quantities", () => {
      const result = lineItemSchema.safeParse({ quantity: "10", duration: "7" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.quantity).toBe(10);
        expect(result.data.duration).toBe(7);
      }
    });
  });

  describe("categoryId and groupId (optional)", () => {
    it("accepts categoryId", () => {
      const result = lineItemSchema.safeParse({ categoryId: "cat-1" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.categoryId).toBe("cat-1");
    });

    it("accepts groupId", () => {
      const result = lineItemSchema.safeParse({ groupId: "grp-1" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.groupId).toBe("grp-1");
    });

    it("accepts both categoryId and groupId", () => {
      const result = lineItemSchema.safeParse({
        categoryId: "cat-1",
        groupId: "grp-1",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.categoryId).toBe("cat-1");
        expect(result.data.groupId).toBe("grp-1");
      }
    });

    it("defaults categoryId and groupId to undefined", () => {
      const result = lineItemSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.categoryId).toBeUndefined();
        expect(result.data.groupId).toBeUndefined();
      }
    });
  });
});

describe("customLineItemSchema", () => {
  describe("description (required, min 1, max 200)", () => {
    it("rejects missing description", () => {
      const result = customLineItemSchema.safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes("description"))).toBe(true);
      }
    });

    it("rejects empty string description", () => {
      const result = customLineItemSchema.safeParse({ description: "" });
      expect(result.success).toBe(false);
    });

    it("accepts a valid description", () => {
      const result = customLineItemSchema.safeParse({ description: "Borrowed PA cabinet" });
      expect(result.success).toBe(true);
    });

    it("accepts description at max length (200)", () => {
      const result = customLineItemSchema.safeParse({ description: "d".repeat(200) });
      expect(result.success).toBe(true);
    });

    it("rejects description exceeding max length (201)", () => {
      const result = customLineItemSchema.safeParse({ description: "d".repeat(201) });
      expect(result.success).toBe(false);
    });
  });

  describe("quantity (coerce, int, min 1, max 99999, default 1)", () => {
    it("defaults quantity to 1", () => {
      const result = customLineItemSchema.safeParse({ description: "Item" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.quantity).toBe(1);
    });

    it("rejects zero quantity", () => {
      const result = customLineItemSchema.safeParse({ description: "Item", quantity: 0 });
      expect(result.success).toBe(false);
    });

    it("accepts maximum quantity (99999)", () => {
      const result = customLineItemSchema.safeParse({ description: "Item", quantity: 99999 });
      expect(result.success).toBe(true);
    });

    it("rejects quantity exceeding max (100000)", () => {
      const result = customLineItemSchema.safeParse({ description: "Item", quantity: 100000 });
      expect(result.success).toBe(false);
    });
  });

  describe("pricingType (enum, default FLAT)", () => {
    it("defaults pricingType to FLAT", () => {
      const result = customLineItemSchema.safeParse({ description: "Item" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.pricingType).toBe("FLAT");
    });

    it("accepts OPTIMIZED pricingType", () => {
      const result = customLineItemSchema.safeParse({ description: "Item", pricingType: "OPTIMIZED" });
      expect(result.success).toBe(true);
    });

    it("accepts all valid pricingType values", () => {
      for (const val of ["PER_DAY", "PER_WEEK", "FLAT", "PER_HOUR", "OPTIMIZED"]) {
        const result = customLineItemSchema.safeParse({ description: "Item", pricingType: val });
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid pricingType", () => {
      const result = customLineItemSchema.safeParse({ description: "Item", pricingType: "PER_MONTH" });
      expect(result.success).toBe(false);
    });
  });

  describe("unitPrice (optional, coerce, min 0, max 999999.99)", () => {
    it("accepts undefined unitPrice", () => {
      const result = customLineItemSchema.safeParse({ description: "Item" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.unitPrice).toBeUndefined();
    });

    it("accepts zero unitPrice", () => {
      const result = customLineItemSchema.safeParse({ description: "Item", unitPrice: 0 });
      expect(result.success).toBe(true);
    });

    it("rejects negative unitPrice", () => {
      const result = customLineItemSchema.safeParse({ description: "Item", unitPrice: -1 });
      expect(result.success).toBe(false);
    });

    it("rejects unitPrice exceeding max", () => {
      const result = customLineItemSchema.safeParse({ description: "Item", unitPrice: 1000000 });
      expect(result.success).toBe(false);
    });
  });

  describe("notes (optional, max 500)", () => {
    it("accepts undefined notes", () => {
      const result = customLineItemSchema.safeParse({ description: "Item" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.notes).toBeUndefined();
    });

    it("accepts notes at max length (500)", () => {
      const result = customLineItemSchema.safeParse({ description: "Item", notes: "n".repeat(500) });
      expect(result.success).toBe(true);
    });

    it("rejects notes exceeding max length (501)", () => {
      const result = customLineItemSchema.safeParse({ description: "Item", notes: "n".repeat(501) });
      expect(result.success).toBe(false);
    });
  });

  describe("defaults", () => {
    it("defaults isOptional to false", () => {
      const result = customLineItemSchema.safeParse({ description: "Item" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.isOptional).toBe(false);
    });

    it("defaults duration to 1", () => {
      const result = customLineItemSchema.safeParse({ description: "Item" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.duration).toBe(1);
    });
  });

  describe("groupId (optional)", () => {
    it("accepts groupId", () => {
      const result = customLineItemSchema.safeParse({ description: "Item", groupId: "grp-1" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.groupId).toBe("grp-1");
    });

    it("accepts undefined groupId", () => {
      const result = customLineItemSchema.safeParse({ description: "Item" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.groupId).toBeUndefined();
    });
  });
});
