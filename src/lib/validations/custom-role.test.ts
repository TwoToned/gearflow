import { describe, it, expect } from "vitest";
import { customRoleSchema } from "./custom-role";

describe("customRoleSchema", () => {
  const validMinimal = {
    name: "Technician",
    permissions: {},
  };

  const validComplete = {
    name: "Warehouse Lead",
    description: "Manages warehouse operations and inventory",
    color: "#3B82F6",
    permissions: {
      assets: ["read", "create", "update"],
      projects: ["read"],
      warehouse: ["read", "create", "update", "delete"],
    },
  };

  // --- valid data ---
  it("accepts valid minimal data", () => {
    const result = customRoleSchema.parse(validMinimal);
    expect(result.name).toBe("Technician");
    expect(result.permissions).toEqual({});
  });

  it("accepts valid complete data", () => {
    const result = customRoleSchema.parse(validComplete);
    expect(result.name).toBe("Warehouse Lead");
    expect(result.description).toBe("Manages warehouse operations and inventory");
    expect(result.color).toBe("#3B82F6");
    expect(result.permissions.assets).toEqual(["read", "create", "update"]);
    expect(result.permissions.warehouse).toHaveLength(4);
  });

  // --- required fields ---
  it("rejects missing name", () => {
    const result = customRoleSchema.safeParse({ permissions: {} });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = customRoleSchema.safeParse({ name: "", permissions: {} });
    expect(result.success).toBe(false);
  });

  it("rejects missing permissions", () => {
    const result = customRoleSchema.safeParse({ name: "Role" });
    expect(result.success).toBe(false);
  });

  // --- max length ---
  it("rejects name over 50 characters", () => {
    const result = customRoleSchema.safeParse({ name: "R".repeat(51), permissions: {} });
    expect(result.success).toBe(false);
  });

  it("accepts name exactly 50 characters", () => {
    const result = customRoleSchema.safeParse({ name: "R".repeat(50), permissions: {} });
    expect(result.success).toBe(true);
  });

  it("rejects description over 200 characters", () => {
    const result = customRoleSchema.safeParse({
      name: "Role",
      description: "D".repeat(201),
      permissions: {},
    });
    expect(result.success).toBe(false);
  });

  it("accepts description exactly 200 characters", () => {
    const result = customRoleSchema.safeParse({
      name: "Role",
      description: "D".repeat(200),
      permissions: {},
    });
    expect(result.success).toBe(true);
  });

  // --- permissions structure ---
  it("accepts permissions with empty arrays", () => {
    const result = customRoleSchema.parse({
      name: "Role",
      permissions: { assets: [], projects: [] },
    });
    expect(result.permissions.assets).toEqual([]);
  });

  it("accepts permissions with multiple resources", () => {
    const result = customRoleSchema.parse({
      name: "Role",
      permissions: {
        assets: ["read"],
        models: ["read", "create"],
        categories: ["read", "create", "update", "delete"],
      },
    });
    expect(Object.keys(result.permissions)).toHaveLength(3);
  });

  it("rejects permissions with non-array values", () => {
    const result = customRoleSchema.safeParse({
      name: "Role",
      permissions: { assets: "read" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects permissions with non-string array elements", () => {
    const result = customRoleSchema.safeParse({
      name: "Role",
      permissions: { assets: [123] },
    });
    expect(result.success).toBe(false);
  });

  // --- optional fields ---
  it("accepts omitted description", () => {
    const result = customRoleSchema.parse(validMinimal);
    expect(result.description).toBeUndefined();
  });

  it("accepts omitted color", () => {
    const result = customRoleSchema.parse(validMinimal);
    expect(result.color).toBeUndefined();
  });

  // --- edge cases ---
  it("accepts single-character name", () => {
    const result = customRoleSchema.parse({ name: "A", permissions: {} });
    expect(result.name).toBe("A");
  });

  it("accepts color as any string (no format validation)", () => {
    const result = customRoleSchema.parse({ name: "Role", color: "blue", permissions: {} });
    expect(result.color).toBe("blue");
  });

  it("accepts empty string color", () => {
    const result = customRoleSchema.parse({ name: "Role", color: "", permissions: {} });
    expect(result.color).toBe("");
  });

  it("rejects non-object permissions", () => {
    const result = customRoleSchema.safeParse({ name: "Role", permissions: "all" });
    expect(result.success).toBe(false);
  });

  it("rejects permissions as array", () => {
    const result = customRoleSchema.safeParse({ name: "Role", permissions: ["read"] });
    expect(result.success).toBe(false);
  });
});
