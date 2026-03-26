import { describe, it, expect } from "vitest";
import {
  projectGroupSchema,
  updateGroupPriceSchema,
  moveLineItemSchema,
} from "./project-group";

const validMinimal = {
  categoryId: "cat-123",
  title: "Wireless Mics",
};

const validComplete = {
  categoryId: "cat-123",
  title: "Wireless Microphone Package",
  description: "Includes 8x EW-DX handheld, 8x belt pack, cabling and accessories",
  quantity: 1,
  price: 2500,
  rentalPeriod: "DAILY" as const,
  rentalQuantity: 3,
  sortOrder: 1,
};

describe("projectGroupSchema", () => {
  describe("valid data", () => {
    it("accepts minimal valid data", () => {
      const result = projectGroupSchema.safeParse(validMinimal);
      expect(result.success).toBe(true);
    });

    it("accepts complete valid data", () => {
      const result = projectGroupSchema.safeParse(validComplete);
      expect(result.success).toBe(true);
    });
  });

  describe("categoryId (required)", () => {
    it("rejects missing categoryId", () => {
      const result = projectGroupSchema.safeParse({ title: "Test" });
      expect(result.success).toBe(false);
    });

    it("rejects empty string categoryId", () => {
      const result = projectGroupSchema.safeParse({ categoryId: "", title: "Test" });
      expect(result.success).toBe(false);
    });
  });

  describe("title (required, max 200)", () => {
    it("rejects missing title", () => {
      const result = projectGroupSchema.safeParse({ categoryId: "cat-1" });
      expect(result.success).toBe(false);
    });

    it("rejects empty string title", () => {
      const result = projectGroupSchema.safeParse({ categoryId: "cat-1", title: "" });
      expect(result.success).toBe(false);
    });

    it("accepts title at max length (200)", () => {
      const result = projectGroupSchema.safeParse({
        categoryId: "cat-1",
        title: "t".repeat(200),
      });
      expect(result.success).toBe(true);
    });

    it("rejects title exceeding max length", () => {
      const result = projectGroupSchema.safeParse({
        categoryId: "cat-1",
        title: "t".repeat(201),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("description (optional, max 2000)", () => {
    it("accepts at max length", () => {
      const result = projectGroupSchema.safeParse({
        ...validMinimal,
        description: "d".repeat(2000),
      });
      expect(result.success).toBe(true);
    });

    it("rejects exceeding max length", () => {
      const result = projectGroupSchema.safeParse({
        ...validMinimal,
        description: "d".repeat(2001),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("quantity (int, min 1, default 1)", () => {
    it("defaults to 1", () => {
      const result = projectGroupSchema.safeParse(validMinimal);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.quantity).toBe(1);
    });

    it("rejects zero", () => {
      const result = projectGroupSchema.safeParse({ ...validMinimal, quantity: 0 });
      expect(result.success).toBe(false);
    });

    it("rejects negative", () => {
      const result = projectGroupSchema.safeParse({ ...validMinimal, quantity: -1 });
      expect(result.success).toBe(false);
    });

    it("coerces string to number", () => {
      const result = projectGroupSchema.safeParse({ ...validMinimal, quantity: "3" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.quantity).toBe(3);
    });
  });

  describe("price (optional, min 0)", () => {
    it("accepts zero", () => {
      const result = projectGroupSchema.safeParse({ ...validMinimal, price: 0 });
      expect(result.success).toBe(true);
    });

    it("rejects negative", () => {
      const result = projectGroupSchema.safeParse({ ...validMinimal, price: -1 });
      expect(result.success).toBe(false);
    });

    it("accepts decimal", () => {
      const result = projectGroupSchema.safeParse({ ...validMinimal, price: 1500.50 });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.price).toBe(1500.5);
    });

    it("coerces string to number", () => {
      const result = projectGroupSchema.safeParse({ ...validMinimal, price: "2500" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.price).toBe(2500);
    });
  });

  describe("rentalPeriod (optional enum)", () => {
    it("accepts DAILY", () => {
      const result = projectGroupSchema.safeParse({
        ...validMinimal,
        rentalPeriod: "DAILY",
      });
      expect(result.success).toBe(true);
    });

    it("accepts WEEKLY", () => {
      const result = projectGroupSchema.safeParse({
        ...validMinimal,
        rentalPeriod: "WEEKLY",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid value", () => {
      const result = projectGroupSchema.safeParse({
        ...validMinimal,
        rentalPeriod: "MONTHLY",
      });
      expect(result.success).toBe(false);
    });

    it("accepts undefined", () => {
      const result = projectGroupSchema.safeParse(validMinimal);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.rentalPeriod).toBeUndefined();
    });
  });

  describe("rentalQuantity (optional, int, min 1)", () => {
    it("accepts positive integer", () => {
      const result = projectGroupSchema.safeParse({
        ...validMinimal,
        rentalQuantity: 5,
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.rentalQuantity).toBe(5);
    });

    it("rejects zero", () => {
      const result = projectGroupSchema.safeParse({
        ...validMinimal,
        rentalQuantity: 0,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("sortOrder (optional, default 0)", () => {
    it("defaults to 0", () => {
      const result = projectGroupSchema.safeParse(validMinimal);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.sortOrder).toBe(0);
    });
  });
});

describe("updateGroupPriceSchema", () => {
  it("accepts valid price", () => {
    const result = updateGroupPriceSchema.safeParse({ price: 1500 });
    expect(result.success).toBe(true);
  });

  it("accepts zero", () => {
    const result = updateGroupPriceSchema.safeParse({ price: 0 });
    expect(result.success).toBe(true);
  });

  it("rejects negative", () => {
    const result = updateGroupPriceSchema.safeParse({ price: -100 });
    expect(result.success).toBe(false);
  });

  it("coerces string", () => {
    const result = updateGroupPriceSchema.safeParse({ price: "999.50" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.price).toBe(999.5);
  });
});

describe("moveLineItemSchema", () => {
  it("accepts valid move", () => {
    const result = moveLineItemSchema.safeParse({
      lineItemId: "li-1",
      targetGroupId: "grp-2",
      targetCategoryId: "cat-3",
    });
    expect(result.success).toBe(true);
  });

  it("accepts null targets (move to standalone)", () => {
    const result = moveLineItemSchema.safeParse({
      lineItemId: "li-1",
      targetGroupId: null,
      targetCategoryId: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty lineItemId", () => {
    const result = moveLineItemSchema.safeParse({
      lineItemId: "",
      targetGroupId: null,
      targetCategoryId: null,
    });
    expect(result.success).toBe(false);
  });
});
