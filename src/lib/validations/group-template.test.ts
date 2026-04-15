import { describe, it, expect } from "vitest";
import { groupTemplateSchema, applyGroupTemplateSchema } from "./group-template";

const validMinimal = {
  name: "Basic RF Package",
  items: [{ modelId: "model-1", quantity: 4 }],
};

const validComplete = {
  name: "Full Wireless Package",
  description: "Standard wireless mic package for corporate events",
  items: [
    { modelId: "model-1", quantity: 8 },
    { modelId: "model-2", quantity: 8 },
    { modelId: "model-3", quantity: 2 },
  ],
};

describe("groupTemplateSchema", () => {
  describe("valid data", () => {
    it("accepts minimal valid data", () => {
      const result = groupTemplateSchema.safeParse(validMinimal);
      expect(result.success).toBe(true);
    });

    it("accepts complete valid data", () => {
      const result = groupTemplateSchema.safeParse(validComplete);
      expect(result.success).toBe(true);
    });
  });

  describe("name (required, max 200)", () => {
    it("rejects missing name", () => {
      const result = groupTemplateSchema.safeParse({
        items: [{ modelId: "m-1", quantity: 1 }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty string name", () => {
      const result = groupTemplateSchema.safeParse({
        name: "",
        items: [{ modelId: "m-1", quantity: 1 }],
      });
      expect(result.success).toBe(false);
    });

    it("accepts name at max length (200)", () => {
      const result = groupTemplateSchema.safeParse({
        name: "a".repeat(200),
        items: [{ modelId: "m-1", quantity: 1 }],
      });
      expect(result.success).toBe(true);
    });

    it("rejects name exceeding max length", () => {
      const result = groupTemplateSchema.safeParse({
        name: "a".repeat(201),
        items: [{ modelId: "m-1", quantity: 1 }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("description (optional, max 2000)", () => {
    it("accepts at max length", () => {
      const result = groupTemplateSchema.safeParse({
        ...validMinimal,
        description: "d".repeat(2000),
      });
      expect(result.success).toBe(true);
    });

    it("rejects exceeding max length", () => {
      const result = groupTemplateSchema.safeParse({
        ...validMinimal,
        description: "d".repeat(2001),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("items (required, min 1)", () => {
    it("rejects empty items array", () => {
      const result = groupTemplateSchema.safeParse({ name: "Test", items: [] });
      expect(result.success).toBe(false);
    });

    it("rejects missing items", () => {
      const result = groupTemplateSchema.safeParse({ name: "Test" });
      expect(result.success).toBe(false);
    });

    it("accepts single item", () => {
      const result = groupTemplateSchema.safeParse(validMinimal);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.items).toHaveLength(1);
    });

    it("accepts multiple items", () => {
      const result = groupTemplateSchema.safeParse(validComplete);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.items).toHaveLength(3);
    });
  });

  describe("items[] model/kit XOR refine", () => {
    it("rejects empty modelId with no kitId", () => {
      const result = groupTemplateSchema.safeParse({
        name: "Test",
        items: [{ modelId: "", quantity: 1 }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects item with neither modelId nor kitId", () => {
      const result = groupTemplateSchema.safeParse({
        name: "Test",
        items: [{ quantity: 1 }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects item with both modelId and kitId", () => {
      const result = groupTemplateSchema.safeParse({
        name: "Test",
        items: [{ modelId: "m-1", kitId: "k-1", quantity: 1 }],
      });
      expect(result.success).toBe(false);
    });

    it("accepts a kit-only item", () => {
      const result = groupTemplateSchema.safeParse({
        name: "Test",
        items: [{ kitId: "kit-1", quantity: 1 }],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items[0].kitId).toBe("kit-1");
        expect(result.data.items[0].modelId).toBeUndefined();
      }
    });

    it("accepts a mixed array of model and kit items", () => {
      const result = groupTemplateSchema.safeParse({
        name: "FOH Package",
        items: [
          { modelId: "m-1", quantity: 2 },
          { kitId: "kit-rack-1", quantity: 1 },
        ],
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.items).toHaveLength(2);
    });
  });

  describe("items[].quantity (int, min 1, default 1)", () => {
    it("defaults to 1", () => {
      const result = groupTemplateSchema.safeParse({
        name: "Test",
        items: [{ modelId: "m-1" }],
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.items[0].quantity).toBe(1);
    });

    it("rejects zero", () => {
      const result = groupTemplateSchema.safeParse({
        name: "Test",
        items: [{ modelId: "m-1", quantity: 0 }],
      });
      expect(result.success).toBe(false);
    });

    it("coerces string to number", () => {
      const result = groupTemplateSchema.safeParse({
        name: "Test",
        items: [{ modelId: "m-1", quantity: "4" }],
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.items[0].quantity).toBe(4);
    });
  });
});

describe("applyGroupTemplateSchema", () => {
  it("accepts valid data", () => {
    const result = applyGroupTemplateSchema.safeParse({
      templateId: "tmpl-1",
      categoryId: "cat-1",
      title: "Wireless Mics",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty templateId", () => {
    const result = applyGroupTemplateSchema.safeParse({
      templateId: "",
      categoryId: "cat-1",
      title: "Test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty categoryId", () => {
    const result = applyGroupTemplateSchema.safeParse({
      templateId: "tmpl-1",
      categoryId: "",
      title: "Test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty title", () => {
    const result = applyGroupTemplateSchema.safeParse({
      templateId: "tmpl-1",
      categoryId: "cat-1",
      title: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects title exceeding max length (200)", () => {
    const result = applyGroupTemplateSchema.safeParse({
      templateId: "tmpl-1",
      categoryId: "cat-1",
      title: "t".repeat(201),
    });
    expect(result.success).toBe(false);
  });
});
