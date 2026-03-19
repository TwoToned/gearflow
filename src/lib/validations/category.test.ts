import { describe, it, expect } from "vitest";
import { categorySchema } from "./category";

describe("categorySchema", () => {
  const validMinimal = { name: "Lighting" };

  const validComplete = {
    name: "Audio Equipment",
    parentId: "cat-parent-1",
    description: "All audio-related gear",
    icon: "🔊",
    sortOrder: 5,
    tags: ["audio", "sound"],
  };

  // --- valid data ---
  it("accepts valid minimal data and applies defaults", () => {
    const result = categorySchema.parse(validMinimal);
    expect(result.name).toBe("Lighting");
    expect(result.sortOrder).toBe(0);
    expect(result.tags).toEqual([]);
  });

  it("accepts valid complete data", () => {
    const result = categorySchema.parse(validComplete);
    expect(result.name).toBe("Audio Equipment");
    expect(result.parentId).toBe("cat-parent-1");
    expect(result.description).toBe("All audio-related gear");
    expect(result.icon).toBe("🔊");
    expect(result.sortOrder).toBe(5);
    expect(result.tags).toEqual(["audio", "sound"]);
  });

  // --- required fields ---
  it("rejects missing name", () => {
    const result = categorySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = categorySchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  // --- max length ---
  it("rejects name over 100 characters", () => {
    const result = categorySchema.safeParse({ name: "N".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("accepts name exactly 100 characters", () => {
    const result = categorySchema.safeParse({ name: "N".repeat(100) });
    expect(result.success).toBe(true);
  });

  it("rejects description over 500 characters", () => {
    const result = categorySchema.safeParse({ name: "Cat", description: "D".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("accepts description exactly 500 characters", () => {
    const result = categorySchema.safeParse({ name: "Cat", description: "D".repeat(500) });
    expect(result.success).toBe(true);
  });

  it("rejects icon over 10 characters", () => {
    const result = categorySchema.safeParse({ name: "Cat", icon: "I".repeat(11) });
    expect(result.success).toBe(false);
  });

  it("accepts icon exactly 10 characters", () => {
    const result = categorySchema.safeParse({ name: "Cat", icon: "I".repeat(10) });
    expect(result.success).toBe(true);
  });

  // --- coercion & constraints ---
  it("coerces string sortOrder to number", () => {
    const result = categorySchema.parse({ name: "Cat", sortOrder: "3" });
    expect(result.sortOrder).toBe(3);
  });

  it("rejects negative sortOrder", () => {
    const result = categorySchema.safeParse({ name: "Cat", sortOrder: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer sortOrder", () => {
    const result = categorySchema.safeParse({ name: "Cat", sortOrder: 2.5 });
    expect(result.success).toBe(false);
  });

  it("accepts sortOrder of 0", () => {
    const result = categorySchema.parse({ name: "Cat", sortOrder: 0 });
    expect(result.sortOrder).toBe(0);
  });

  // --- defaults ---
  it("defaults sortOrder to 0", () => {
    const result = categorySchema.parse(validMinimal);
    expect(result.sortOrder).toBe(0);
  });

  it("defaults tags to empty array", () => {
    const result = categorySchema.parse(validMinimal);
    expect(result.tags).toEqual([]);
  });

  // --- nullable / optional ---
  it("accepts parentId as null", () => {
    const result = categorySchema.parse({ name: "Cat", parentId: null });
    expect(result.parentId).toBeNull();
  });

  it("accepts parentId as string", () => {
    const result = categorySchema.parse({ name: "Cat", parentId: "parent-1" });
    expect(result.parentId).toBe("parent-1");
  });

  it("accepts omitted optional fields", () => {
    const result = categorySchema.parse(validMinimal);
    expect(result.parentId).toBeUndefined();
    expect(result.description).toBeUndefined();
    expect(result.icon).toBeUndefined();
  });

  // --- edge cases ---
  it("accepts single-character name", () => {
    const result = categorySchema.parse({ name: "X" });
    expect(result.name).toBe("X");
  });

  it("accepts emoji as icon", () => {
    const result = categorySchema.parse({ name: "Cat", icon: "🎵" });
    expect(result.icon).toBe("🎵");
  });

  it("accepts empty tags array explicitly", () => {
    const result = categorySchema.parse({ name: "Cat", tags: [] });
    expect(result.tags).toEqual([]);
  });

  it("accepts tags with multiple entries", () => {
    const result = categorySchema.parse({ name: "Cat", tags: ["a", "b", "c"] });
    expect(result.tags).toEqual(["a", "b", "c"]);
  });
});
