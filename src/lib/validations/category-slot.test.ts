import { describe, it, expect } from "vitest";
import {
  moveProjectGroupToCategorySchema,
  moveSubHireGroupToCategorySchema,
  createCategoryAndPlaceGroupSchema,
  reorderMixedGroupsInCategorySchema,
  parseSlotId,
  SLOT_ID_PREFIX,
} from "./category-slot";

/**
 * Schema is the trust boundary between the move/reorder dialogs and the
 * server actions. Bugs in the schema let bad client payloads reach the
 * DB; bugs in the parser confuse the upsert layer about which kind of
 * group it is reading. Both pass through here.
 */

describe("moveProjectGroupToCategorySchema", () => {
  it("accepts a valid groupId + categoryId pair", () => {
    const result = moveProjectGroupToCategorySchema.safeParse({
      groupId: "g-1",
      categoryId: "c-1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty groupId", () => {
    const result = moveProjectGroupToCategorySchema.safeParse({
      groupId: "",
      categoryId: "c-1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty categoryId", () => {
    const result = moveProjectGroupToCategorySchema.safeParse({
      groupId: "g-1",
      categoryId: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a null categoryId — project groups MUST land in a category", () => {
    // Distinct from sub-hire groups, which CAN go to uncategorised.
    // Schema-level guard catches a client that accidentally tries to
    // route a project group through the "Uncategorised" picker option.
    const result = moveProjectGroupToCategorySchema.safeParse({
      groupId: "g-1",
      categoryId: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing fields entirely", () => {
    expect(moveProjectGroupToCategorySchema.safeParse({}).success).toBe(false);
    expect(moveProjectGroupToCategorySchema.safeParse({ groupId: "g-1" }).success).toBe(false);
    expect(moveProjectGroupToCategorySchema.safeParse({ categoryId: "c-1" }).success).toBe(false);
  });
});

describe("moveSubHireGroupToCategorySchema — accepts null for uncategorised", () => {
  it("accepts a null categoryId (move to uncategorised)", () => {
    // Contrast with the project-group schema above — sub-hire groups
    // can live in the Uncategorized zone, project groups can't.
    const result = moveSubHireGroupToCategorySchema.safeParse({
      groupId: "shg-1",
      categoryId: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("createCategoryAndPlaceGroupSchema — XOR on slot identifier", () => {
  const baseFields = { projectId: "p-1", name: "Audio" };

  it("accepts slot with only projectGroupId set", () => {
    const result = createCategoryAndPlaceGroupSchema.safeParse({
      ...baseFields,
      slot: { projectGroupId: "g-1" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts slot with only subHireGroupId set", () => {
    const result = createCategoryAndPlaceGroupSchema.safeParse({
      ...baseFields,
      slot: { subHireGroupId: "shg-1" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects slot with BOTH ids set (XOR violation)", () => {
    const result = createCategoryAndPlaceGroupSchema.safeParse({
      ...baseFields,
      slot: { projectGroupId: "g-1", subHireGroupId: "shg-1" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects slot with NEITHER id set (XOR violation)", () => {
    const result = createCategoryAndPlaceGroupSchema.safeParse({
      ...baseFields,
      slot: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty category name", () => {
    const result = createCategoryAndPlaceGroupSchema.safeParse({
      ...baseFields,
      name: "",
      slot: { projectGroupId: "g-1" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a name over 100 chars", () => {
    const result = createCategoryAndPlaceGroupSchema.safeParse({
      ...baseFields,
      name: "x".repeat(101),
      slot: { projectGroupId: "g-1" },
    });
    expect(result.success).toBe(false);
  });
});

describe("reorderMixedGroupsInCategorySchema — slot ID prefix guard", () => {
  it("accepts a mix of pg- and shg- ids", () => {
    const result = reorderMixedGroupsInCategorySchema.safeParse({
      categoryId: "c-1",
      orderedIds: ["pg-1", "shg-2", "pg-3"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a bare id without prefix (defends against typo-driven cross-table writes)", () => {
    const result = reorderMixedGroupsInCategorySchema.safeParse({
      categoryId: "c-1",
      orderedIds: ["pg-1", "bare-id-no-prefix"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty orderedIds array", () => {
    const result = reorderMixedGroupsInCategorySchema.safeParse({
      categoryId: "c-1",
      orderedIds: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("parseSlotId — splits prefix from bare id", () => {
  it("recognises a project-group prefix", () => {
    expect(parseSlotId(`${SLOT_ID_PREFIX.projectGroup}abc123`)).toEqual({
      kind: "projectGroup",
      id: "abc123",
    });
  });

  it("recognises a sub-hire-group prefix", () => {
    expect(parseSlotId(`${SLOT_ID_PREFIX.subHireGroup}xyz789`)).toEqual({
      kind: "subHireGroup",
      id: "xyz789",
    });
  });

  it("returns null for an unrecognised prefix", () => {
    expect(parseSlotId("bare-id-no-prefix")).toBeNull();
    expect(parseSlotId("xx-abc123")).toBeNull();
  });
});
