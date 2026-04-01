import { describe, it, expect } from "vitest";
import {
  subHireSchema,
  subHireItemSchema,
  subHireGroupSchema,
  subHireOrderPricingSchema,
  subHirePlacementSchema,
} from "./sub-hire";

const validMinimalSubHire = { supplierId: "supplier-123" };

const validCompleteSubHire = {
  supplierId: "supplier-123",
  projectId: "project-456",
  supplierReference: "REF-001",
  status: "CONFIRMED" as const,
  hireStart: new Date("2024-06-01"),
  hireEnd: new Date("2024-06-15"),
  showOnDocs: true,
  notes: "Handle with care",
  defaultTargetCategoryId: "cat-789",
  defaultTargetGroupId: "group-001",
};

describe("subHireSchema", () => {
  describe("valid data", () => {
    it("accepts minimal valid data", () => {
      const result = subHireSchema.safeParse(validMinimalSubHire);
      expect(result.success).toBe(true);
    });

    it("accepts complete valid data", () => {
      const result = subHireSchema.safeParse(validCompleteSubHire);
      expect(result.success).toBe(true);
    });
  });

  describe("supplierId (required)", () => {
    it("rejects missing supplierId", () => {
      const result = subHireSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects empty string supplierId", () => {
      const result = subHireSchema.safeParse({ supplierId: "" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Supplier is required");
      }
    });
  });

  describe("status (enum, default DRAFT)", () => {
    it("defaults status to DRAFT", () => {
      const result = subHireSchema.safeParse(validMinimalSubHire);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.status).toBe("DRAFT");
    });

    it("accepts all valid status values", () => {
      for (const val of ["DRAFT", "CONFIRMED", "ON_HIRE", "RETURNED", "CANCELLED"]) {
        const result = subHireSchema.safeParse({ ...validMinimalSubHire, status: val });
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid status", () => {
      const result = subHireSchema.safeParse({ ...validMinimalSubHire, status: "PENDING" });
      expect(result.success).toBe(false);
    });
  });

  describe("hireStart and hireEnd (empty string transforms to undefined)", () => {
    it("transforms empty string hireStart to undefined", () => {
      const result = subHireSchema.safeParse({ ...validMinimalSubHire, hireStart: "" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.hireStart).toBeUndefined();
    });

    it("transforms empty string hireEnd to undefined", () => {
      const result = subHireSchema.safeParse({ ...validMinimalSubHire, hireEnd: "" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.hireEnd).toBeUndefined();
    });

    it("accepts valid date objects", () => {
      const date = new Date("2024-06-01");
      const result = subHireSchema.safeParse({ ...validMinimalSubHire, hireStart: date });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.hireStart).toEqual(date);
    });

    it("coerces date strings to Date", () => {
      const result = subHireSchema.safeParse({ ...validMinimalSubHire, hireStart: "2024-06-01" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.hireStart).toBeInstanceOf(Date);
    });

    it("accepts undefined dates (fields are optional)", () => {
      const result = subHireSchema.safeParse(validMinimalSubHire);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hireStart).toBeUndefined();
        expect(result.data.hireEnd).toBeUndefined();
      }
    });
  });

  describe("showOnDocs (boolean, default false)", () => {
    it("defaults showOnDocs to false", () => {
      const result = subHireSchema.safeParse(validMinimalSubHire);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.showOnDocs).toBe(false);
    });
  });

  describe("notes (optional, max 2000)", () => {
    it("accepts at max length", () => {
      const result = subHireSchema.safeParse({ ...validMinimalSubHire, notes: "n".repeat(2000) });
      expect(result.success).toBe(true);
    });

    it("rejects exceeding max length", () => {
      const result = subHireSchema.safeParse({ ...validMinimalSubHire, notes: "n".repeat(2001) });
      expect(result.success).toBe(false);
    });
  });

  describe("supplierReference (optional, max 200)", () => {
    it("accepts at max length", () => {
      const result = subHireSchema.safeParse({ ...validMinimalSubHire, supplierReference: "r".repeat(200) });
      expect(result.success).toBe(true);
    });

    it("rejects exceeding max length", () => {
      const result = subHireSchema.safeParse({ ...validMinimalSubHire, supplierReference: "r".repeat(201) });
      expect(result.success).toBe(false);
    });
  });

  describe("optional nullable fields", () => {
    it("accepts null defaultTargetCategoryId", () => {
      const result = subHireSchema.safeParse({ ...validMinimalSubHire, defaultTargetCategoryId: null });
      expect(result.success).toBe(true);
    });

    it("accepts null defaultTargetGroupId", () => {
      const result = subHireSchema.safeParse({ ...validMinimalSubHire, defaultTargetGroupId: null });
      expect(result.success).toBe(true);
    });
  });
});

const validMinimalItem = { description: "Audio cable 5m" };

const validCompleteItem = {
  description: "Audio cable 5m",
  modelId: "model-abc",
  groupId: "group-xyz",
  quantity: 4,
  unitCost: 25.5,
  unitCharge: 35,
  pricingType: "PER_DAY" as const,
  duration: 3,
  discount: 10,
  showOnQuote: false,
  showOnDocs: true,
  targetCategoryId: "cat-123",
  targetGroupId: "group-456",
};

describe("subHireItemSchema", () => {
  describe("valid data", () => {
    it("accepts minimal valid data", () => {
      const result = subHireItemSchema.safeParse(validMinimalItem);
      expect(result.success).toBe(true);
    });

    it("accepts complete valid data", () => {
      const result = subHireItemSchema.safeParse(validCompleteItem);
      expect(result.success).toBe(true);
    });
  });

  describe("description (required, max 500)", () => {
    it("rejects missing description", () => {
      const result = subHireItemSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects empty string description", () => {
      const result = subHireItemSchema.safeParse({ description: "" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Description is required");
      }
    });

    it("accepts at max length (500)", () => {
      const result = subHireItemSchema.safeParse({ description: "d".repeat(500) });
      expect(result.success).toBe(true);
    });

    it("rejects exceeding max length", () => {
      const result = subHireItemSchema.safeParse({ description: "d".repeat(501) });
      expect(result.success).toBe(false);
    });
  });

  describe("quantity (coerce, int, min 1, default 1)", () => {
    it("defaults quantity to 1", () => {
      const result = subHireItemSchema.safeParse(validMinimalItem);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.quantity).toBe(1);
    });

    it("rejects zero quantity", () => {
      const result = subHireItemSchema.safeParse({ ...validMinimalItem, quantity: 0 });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Quantity must be at least 1");
      }
    });

    it("rejects negative quantity", () => {
      const result = subHireItemSchema.safeParse({ ...validMinimalItem, quantity: -5 });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer quantity", () => {
      const result = subHireItemSchema.safeParse({ ...validMinimalItem, quantity: 1.5 });
      expect(result.success).toBe(false);
    });

    it("accepts quantity of 1 (minimum)", () => {
      const result = subHireItemSchema.safeParse({ ...validMinimalItem, quantity: 1 });
      expect(result.success).toBe(true);
    });

    it("coerces string quantity to number", () => {
      const result = subHireItemSchema.safeParse({ ...validMinimalItem, quantity: "3" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.quantity).toBe(3);
    });
  });

  describe("unitCost (coerce, min 0, default 0)", () => {
    it("defaults unitCost to 0", () => {
      const result = subHireItemSchema.safeParse(validMinimalItem);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.unitCost).toBe(0);
    });

    it("rejects negative unitCost", () => {
      const result = subHireItemSchema.safeParse({ ...validMinimalItem, unitCost: -1 });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Cost cannot be negative");
      }
    });

    it("accepts zero unitCost", () => {
      const result = subHireItemSchema.safeParse({ ...validMinimalItem, unitCost: 0 });
      expect(result.success).toBe(true);
    });

    it("coerces string to number", () => {
      const result = subHireItemSchema.safeParse({ ...validMinimalItem, unitCost: "50.5" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.unitCost).toBe(50.5);
    });
  });

  describe("unitCharge (coerce, min 0, default 0)", () => {
    it("defaults unitCharge to 0", () => {
      const result = subHireItemSchema.safeParse(validMinimalItem);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.unitCharge).toBe(0);
    });

    it("rejects negative unitCharge", () => {
      const result = subHireItemSchema.safeParse({ ...validMinimalItem, unitCharge: -0.01 });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Charge cannot be negative");
      }
    });
  });

  describe("discount (coerce, min 0, max 100, default 0)", () => {
    it("defaults discount to 0", () => {
      const result = subHireItemSchema.safeParse(validMinimalItem);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.discount).toBe(0);
    });

    it("rejects negative discount", () => {
      const result = subHireItemSchema.safeParse({ ...validMinimalItem, discount: -1 });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Discount cannot be negative");
      }
    });

    it("rejects discount above 100", () => {
      const result = subHireItemSchema.safeParse({ ...validMinimalItem, discount: 100.01 });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Discount cannot exceed 100%");
      }
    });

    it("accepts discount at 0 (lower bound)", () => {
      const result = subHireItemSchema.safeParse({ ...validMinimalItem, discount: 0 });
      expect(result.success).toBe(true);
    });

    it("accepts discount at 100 (upper bound)", () => {
      const result = subHireItemSchema.safeParse({ ...validMinimalItem, discount: 100 });
      expect(result.success).toBe(true);
    });

    it("accepts discount between 0 and 100", () => {
      const result = subHireItemSchema.safeParse({ ...validMinimalItem, discount: 15.5 });
      expect(result.success).toBe(true);
    });
  });

  describe("pricingType (enum, default FLAT)", () => {
    it("defaults pricingType to FLAT", () => {
      const result = subHireItemSchema.safeParse(validMinimalItem);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.pricingType).toBe("FLAT");
    });

    it("accepts all valid pricingType values", () => {
      for (const val of ["FLAT", "PER_DAY", "PER_WEEK", "PER_HOUR"]) {
        const result = subHireItemSchema.safeParse({ ...validMinimalItem, pricingType: val });
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid pricingType", () => {
      const result = subHireItemSchema.safeParse({ ...validMinimalItem, pricingType: "MONTHLY" });
      expect(result.success).toBe(false);
    });
  });

  describe("duration (coerce, int, min 1, default 1)", () => {
    it("defaults duration to 1", () => {
      const result = subHireItemSchema.safeParse(validMinimalItem);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.duration).toBe(1);
    });

    it("rejects zero duration", () => {
      const result = subHireItemSchema.safeParse({ ...validMinimalItem, duration: 0 });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Duration must be at least 1");
      }
    });

    it("rejects non-integer duration", () => {
      const result = subHireItemSchema.safeParse({ ...validMinimalItem, duration: 1.5 });
      expect(result.success).toBe(false);
    });
  });

  describe("boolean defaults", () => {
    it("defaults showOnQuote to true", () => {
      const result = subHireItemSchema.safeParse(validMinimalItem);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.showOnQuote).toBe(true);
    });

    it("defaults showOnDocs to false", () => {
      const result = subHireItemSchema.safeParse(validMinimalItem);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.showOnDocs).toBe(false);
    });
  });

  describe("optional nullable fields", () => {
    it("accepts null targetCategoryId", () => {
      const result = subHireItemSchema.safeParse({ ...validMinimalItem, targetCategoryId: null });
      expect(result.success).toBe(true);
    });

    it("accepts null targetGroupId", () => {
      const result = subHireItemSchema.safeParse({ ...validMinimalItem, targetGroupId: null });
      expect(result.success).toBe(true);
    });
  });
});

const validMinimalGroup = { title: "Lighting Package" };

const validCompleteGroup = {
  title: "Lighting Package",
  quantity: 2,
  cost: 500,
  charge: 750,
  showOnQuote: false,
  showOnDocs: true,
  sortOrder: 3,
  targetCategoryId: "cat-123",
  targetGroupId: "group-456",
};

describe("subHireGroupSchema", () => {
  describe("valid data", () => {
    it("accepts minimal valid data", () => {
      const result = subHireGroupSchema.safeParse(validMinimalGroup);
      expect(result.success).toBe(true);
    });

    it("accepts complete valid data", () => {
      const result = subHireGroupSchema.safeParse(validCompleteGroup);
      expect(result.success).toBe(true);
    });
  });

  describe("title (required, max 200)", () => {
    it("rejects missing title", () => {
      const result = subHireGroupSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects empty string title", () => {
      const result = subHireGroupSchema.safeParse({ title: "" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Group title is required");
      }
    });

    it("accepts title at max length (200)", () => {
      const result = subHireGroupSchema.safeParse({ title: "t".repeat(200) });
      expect(result.success).toBe(true);
    });

    it("rejects title exceeding max length", () => {
      const result = subHireGroupSchema.safeParse({ title: "t".repeat(201) });
      expect(result.success).toBe(false);
    });
  });

  describe("quantity (coerce, int, min 1, default 1)", () => {
    it("defaults quantity to 1", () => {
      const result = subHireGroupSchema.safeParse(validMinimalGroup);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.quantity).toBe(1);
    });

    it("rejects zero quantity", () => {
      const result = subHireGroupSchema.safeParse({ ...validMinimalGroup, quantity: 0 });
      expect(result.success).toBe(false);
    });

    it("rejects negative quantity", () => {
      const result = subHireGroupSchema.safeParse({ ...validMinimalGroup, quantity: -1 });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer quantity", () => {
      const result = subHireGroupSchema.safeParse({ ...validMinimalGroup, quantity: 1.5 });
      expect(result.success).toBe(false);
    });

    it("accepts quantity of 1 (minimum)", () => {
      const result = subHireGroupSchema.safeParse({ ...validMinimalGroup, quantity: 1 });
      expect(result.success).toBe(true);
    });

    it("coerces string quantity to number", () => {
      const result = subHireGroupSchema.safeParse({ ...validMinimalGroup, quantity: "5" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.quantity).toBe(5);
    });
  });

  describe("cost and charge (optional, nullable, min 0)", () => {
    it("accepts null cost", () => {
      const result = subHireGroupSchema.safeParse({ ...validMinimalGroup, cost: null });
      expect(result.success).toBe(true);
    });

    it("accepts null charge", () => {
      const result = subHireGroupSchema.safeParse({ ...validMinimalGroup, charge: null });
      expect(result.success).toBe(true);
    });

    it("accepts zero cost", () => {
      const result = subHireGroupSchema.safeParse({ ...validMinimalGroup, cost: 0 });
      expect(result.success).toBe(true);
    });

    it("rejects negative cost", () => {
      const result = subHireGroupSchema.safeParse({ ...validMinimalGroup, cost: -1 });
      expect(result.success).toBe(false);
    });

    it("rejects negative charge", () => {
      const result = subHireGroupSchema.safeParse({ ...validMinimalGroup, charge: -1 });
      expect(result.success).toBe(false);
    });
  });

  describe("boolean defaults", () => {
    it("defaults showOnQuote to true", () => {
      const result = subHireGroupSchema.safeParse(validMinimalGroup);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.showOnQuote).toBe(true);
    });

    it("defaults showOnDocs to false", () => {
      const result = subHireGroupSchema.safeParse(validMinimalGroup);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.showOnDocs).toBe(false);
    });
  });

  describe("optional nullable fields", () => {
    it("accepts null targetCategoryId", () => {
      const result = subHireGroupSchema.safeParse({ ...validMinimalGroup, targetCategoryId: null });
      expect(result.success).toBe(true);
    });

    it("accepts null targetGroupId", () => {
      const result = subHireGroupSchema.safeParse({ ...validMinimalGroup, targetGroupId: null });
      expect(result.success).toBe(true);
    });
  });
});

describe("subHireOrderPricingSchema", () => {
  describe("valid data", () => {
    it("accepts ITEMIZED pricingMode", () => {
      const result = subHireOrderPricingSchema.safeParse({ pricingMode: "ITEMIZED" });
      expect(result.success).toBe(true);
    });

    it("accepts ORDER_TOTAL pricingMode", () => {
      const result = subHireOrderPricingSchema.safeParse({ pricingMode: "ORDER_TOTAL" });
      expect(result.success).toBe(true);
    });

    it("accepts complete valid data", () => {
      const result = subHireOrderPricingSchema.safeParse({
        pricingMode: "ORDER_TOTAL",
        orderTotalCost: 1200,
        orderTotalCharge: 1800,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("pricingMode (enum, required)", () => {
    it("rejects missing pricingMode", () => {
      const result = subHireOrderPricingSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects invalid pricingMode", () => {
      const result = subHireOrderPricingSchema.safeParse({ pricingMode: "FLAT" });
      expect(result.success).toBe(false);
    });

    it("accepts all valid pricingMode values", () => {
      for (const val of ["ITEMIZED", "ORDER_TOTAL"]) {
        const result = subHireOrderPricingSchema.safeParse({ pricingMode: val });
        expect(result.success).toBe(true);
      }
    });
  });

  describe("orderTotalCost and orderTotalCharge (optional, nullable, min 0)", () => {
    it("accepts null orderTotalCost", () => {
      const result = subHireOrderPricingSchema.safeParse({ pricingMode: "ORDER_TOTAL", orderTotalCost: null });
      expect(result.success).toBe(true);
    });

    it("accepts null orderTotalCharge", () => {
      const result = subHireOrderPricingSchema.safeParse({ pricingMode: "ORDER_TOTAL", orderTotalCharge: null });
      expect(result.success).toBe(true);
    });

    it("rejects negative orderTotalCost", () => {
      const result = subHireOrderPricingSchema.safeParse({ pricingMode: "ORDER_TOTAL", orderTotalCost: -1 });
      expect(result.success).toBe(false);
    });

    it("rejects negative orderTotalCharge", () => {
      const result = subHireOrderPricingSchema.safeParse({ pricingMode: "ORDER_TOTAL", orderTotalCharge: -0.01 });
      expect(result.success).toBe(false);
    });

    it("accepts zero orderTotalCost", () => {
      const result = subHireOrderPricingSchema.safeParse({ pricingMode: "ORDER_TOTAL", orderTotalCost: 0 });
      expect(result.success).toBe(true);
    });

    it("coerces string to number", () => {
      const result = subHireOrderPricingSchema.safeParse({ pricingMode: "ORDER_TOTAL", orderTotalCost: "500" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.orderTotalCost).toBe(500);
    });
  });
});

describe("subHirePlacementSchema", () => {
  describe("valid data", () => {
    it("accepts empty object (all fields optional)", () => {
      const result = subHirePlacementSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts complete valid data", () => {
      const result = subHirePlacementSchema.safeParse({
        targetCategoryId: "cat-123",
        targetGroupId: "group-456",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("targetCategoryId (optional, nullable)", () => {
    it("accepts undefined targetCategoryId", () => {
      const result = subHirePlacementSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.targetCategoryId).toBeUndefined();
    });

    it("accepts null targetCategoryId", () => {
      const result = subHirePlacementSchema.safeParse({ targetCategoryId: null });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.targetCategoryId).toBeNull();
    });

    it("accepts string targetCategoryId", () => {
      const result = subHirePlacementSchema.safeParse({ targetCategoryId: "cat-123" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.targetCategoryId).toBe("cat-123");
    });
  });

  describe("targetGroupId (optional, nullable)", () => {
    it("accepts undefined targetGroupId", () => {
      const result = subHirePlacementSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.targetGroupId).toBeUndefined();
    });

    it("accepts null targetGroupId", () => {
      const result = subHirePlacementSchema.safeParse({ targetGroupId: null });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.targetGroupId).toBeNull();
    });

    it("accepts string targetGroupId", () => {
      const result = subHirePlacementSchema.safeParse({ targetGroupId: "group-789" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.targetGroupId).toBe("group-789");
    });
  });
});
