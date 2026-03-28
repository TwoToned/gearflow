import { describe, it, expect } from "vitest";
import { projectCategorySchema } from "./project-category";

describe("projectCategorySchema", () => {
  describe("valid data", () => {
    it("accepts minimal valid data", () => {
      const result = projectCategorySchema.safeParse({ name: "RF" });
      expect(result.success).toBe(true);
    });

    it("accepts complete valid data", () => {
      const result = projectCategorySchema.safeParse({
        name: "PA System",
        sortOrder: 2,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("name (required, max 100)", () => {
    it("rejects missing name", () => {
      const result = projectCategorySchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects empty string name", () => {
      const result = projectCategorySchema.safeParse({ name: "" });
      expect(result.success).toBe(false);
    });

    it("accepts name at max length (100)", () => {
      const result = projectCategorySchema.safeParse({ name: "a".repeat(100) });
      expect(result.success).toBe(true);
    });

    it("rejects name exceeding max length", () => {
      const result = projectCategorySchema.safeParse({ name: "a".repeat(101) });
      expect(result.success).toBe(false);
    });

    it("accepts single character name", () => {
      const result = projectCategorySchema.safeParse({ name: "X" });
      expect(result.success).toBe(true);
    });
  });

  describe("sortOrder (optional, int, min 0, default 0)", () => {
    it("defaults to 0", () => {
      const result = projectCategorySchema.safeParse({ name: "RF" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.sortOrder).toBe(0);
    });

    it("accepts zero", () => {
      const result = projectCategorySchema.safeParse({ name: "RF", sortOrder: 0 });
      expect(result.success).toBe(true);
    });

    it("accepts positive integer", () => {
      const result = projectCategorySchema.safeParse({ name: "RF", sortOrder: 5 });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.sortOrder).toBe(5);
    });

    it("rejects negative value", () => {
      const result = projectCategorySchema.safeParse({ name: "RF", sortOrder: -1 });
      expect(result.success).toBe(false);
    });

    it("coerces string to number", () => {
      const result = projectCategorySchema.safeParse({ name: "RF", sortOrder: "3" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.sortOrder).toBe(3);
    });
  });
});
