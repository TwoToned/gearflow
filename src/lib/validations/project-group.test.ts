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

  // #943: rentalPeriod/rentalQuantity retired — a group's billing window is now
  // derived purely from the PROJECT's rentalStartDate/rentalEndDate.

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

  it("accepts an optional discount alongside price (#883)", () => {
    const result = updateGroupPriceSchema.safeParse({ price: 1500, discount: 200 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.discount).toBe(200);
  });

  it("succeeds without a discount — price alone is enough", () => {
    const result = updateGroupPriceSchema.safeParse({ price: 1500 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.discount).toBeUndefined();
  });

  it("rejects a discount above the 999999.99 bound", () => {
    const result = updateGroupPriceSchema.safeParse({ price: 1500, discount: 1_000_000 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative discount", () => {
    const result = updateGroupPriceSchema.safeParse({ price: 1500, discount: -1 });
    expect(result.success).toBe(false);
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

// #1012 — the discount ENTRY mode, shared with the line-item schema.
describe("discountMode (#1012)", () => {
  it("accepts the two modes on projectGroupSchema", () => {
    for (const mode of ["$", "%"] as const) {
      const result = projectGroupSchema.safeParse({ ...validMinimal, discount: 10, discountMode: mode });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.discountMode).toBe(mode);
    }
  });

  it("rejects any other string", () => {
    expect(projectGroupSchema.safeParse({ ...validMinimal, discount: 10, discountMode: "pct" }).success).toBe(false);
  });

  it("is carried through to updateGroupPriceSchema (derived, not re-declared)", () => {
    const result = updateGroupPriceSchema.safeParse({ price: 100, discount: 10, discountMode: "%" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.discountMode).toBe("%");
    // Still optional there — omitting it leaves the stored mode untouched.
    expect(updateGroupPriceSchema.safeParse({ price: 100 }).success).toBe(true);
  });
});
