/**
 * Unit tests for the pure category read-rewiring helpers (Phase A).
 *
 * These replace the Prisma list/tree/count/case-walk reads in
 * server/categories.ts. The safety property for each: identical output shape +
 * ordering to the Prisma query it replaces — parent/children hierarchy rebuilt
 * from the flat Convex list, model/kit counts aggregated in JS, dates as Date.
 */
import { describe, it, expect } from "vitest";
import {
  mapCategory,
  sortCategories,
  buildChildCountMap,
  buildModelKitCounts,
  buildCategoriesWithCounts,
  buildCategoryTree,
  collectDescendantCategoryIds,
  type MappedCategory,
} from "@/lib/categories-read";
import type { Doc } from "../../convex/_generated/dataModel";

type CatDoc = Doc<"categories">;

function doc(over: Partial<CatDoc>): CatDoc {
  return {
    _id: "x" as CatDoc["_id"],
    _creationTime: 1,
    id: "c1",
    organizationId: "org1",
    name: "Cat",
    ...over,
  } as CatDoc;
}

describe("mapCategory", () => {
  it("converts epoch-ms → Date, coerces defaults, strips _id/_creationTime", () => {
    const m = mapCategory(
      doc({ id: "c1", name: "Audio", createdAt: 1000, updatedAt: 2000 }),
    );
    expect(m).toEqual<MappedCategory>({
      id: "c1",
      organizationId: "org1",
      name: "Audio",
      parentId: null,
      description: null,
      icon: null,
      sortOrder: 0,
      tags: [],
      suggestedCrewRoles: [],
      createdAt: new Date(1000),
      updatedAt: new Date(2000),
    });
    expect((m as unknown as Record<string, unknown>)._id).toBeUndefined();
    expect((m as unknown as Record<string, unknown>)._creationTime).toBeUndefined();
  });

  it("preserves provided optional fields", () => {
    const m = mapCategory(
      doc({
        parentId: "p1",
        description: "d",
        icon: "🎛",
        sortOrder: 5,
        tags: ["t"],
        suggestedCrewRoles: ["r"],
      }),
    );
    expect(m.parentId).toBe("p1");
    expect(m.description).toBe("d");
    expect(m.icon).toBe("🎛");
    expect(m.sortOrder).toBe(5);
    expect(m.tags).toEqual(["t"]);
    expect(m.suggestedCrewRoles).toEqual(["r"]);
  });
});

const cat = (over: Partial<MappedCategory>): MappedCategory => ({
  id: "c",
  organizationId: "org1",
  name: "n",
  parentId: null,
  description: null,
  icon: null,
  sortOrder: 0,
  tags: [],
  suggestedCrewRoles: [],
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

describe("sortCategories", () => {
  it("orders by sortOrder asc, then name asc", () => {
    const rows = [
      cat({ id: "a", name: "Zebra", sortOrder: 1 }),
      cat({ id: "b", name: "Apple", sortOrder: 1 }),
      cat({ id: "c", name: "Mid", sortOrder: 0 }),
    ];
    expect(sortCategories(rows).map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("does not mutate the input", () => {
    const rows = [cat({ id: "a", sortOrder: 2 }), cat({ id: "b", sortOrder: 1 })];
    const copy = [...rows];
    sortCategories(rows);
    expect(rows).toEqual(copy);
  });
});

describe("buildChildCountMap", () => {
  it("counts categories per parentId", () => {
    const m = buildChildCountMap([
      { id: "p", parentId: null },
      { id: "a", parentId: "p" },
      { id: "b", parentId: "p" },
      { id: "c", parentId: "a" },
    ]);
    expect(m.get("p")).toBe(2);
    expect(m.get("a")).toBe(1);
    expect(m.get("b")).toBeUndefined();
  });
});

describe("buildModelKitCounts", () => {
  it("aggregates model + kit counts per categoryId, ignoring null", () => {
    const m = buildModelKitCounts(
      [{ categoryId: "c1" }, { categoryId: "c1" }, { categoryId: null }, {}],
      [{ categoryId: "c1" }, { categoryId: "c2" }],
    );
    expect(m.get("c1")).toEqual({ models: 2, kits: 1 });
    expect(m.get("c2")).toEqual({ models: 0, kits: 1 });
    expect(m.has("null")).toBe(false);
  });
});

describe("buildCategoriesWithCounts", () => {
  it("attaches parent row + _count{models,kits,children}, sorted", () => {
    const cats = [
      cat({ id: "child", name: "Child", parentId: "root", sortOrder: 0 }),
      cat({ id: "root", name: "Root", sortOrder: 0 }),
    ];
    const counts = new Map([["root", { models: 3, kits: 1 }]]);
    const out = buildCategoriesWithCounts(cats, counts);
    // sorted by sortOrder then name: "Child" < "Root"
    expect(out.map((c) => c.id)).toEqual(["child", "root"]);
    const child = out.find((c) => c.id === "child")!;
    expect(child.parent?.name).toBe("Root");
    expect(child._count).toEqual({ models: 0, kits: 0, children: 0 });
    const root = out.find((c) => c.id === "root")!;
    expect(root.parent).toBeNull();
    expect(root._count).toEqual({ models: 3, kits: 1, children: 1 });
  });

  it("parent is null when the parent row is absent (e.g. cross-org/deleted)", () => {
    const out = buildCategoriesWithCounts([cat({ id: "x", parentId: "missing" })], new Map());
    expect(out[0].parent).toBeNull();
  });
});

describe("buildCategoryTree", () => {
  it("builds a roots-first forest with nested sorted children + _count.models", () => {
    const cats = [
      cat({ id: "root", name: "Root", sortOrder: 0 }),
      cat({ id: "b", name: "Beta", parentId: "root", sortOrder: 1 }),
      cat({ id: "a", name: "Alpha", parentId: "root", sortOrder: 1 }),
      cat({ id: "orphan", name: "Orphan", parentId: "gone" }),
    ];
    const modelCounts = new Map([["root", 4]]);
    const tree = buildCategoryTree(cats, modelCounts);
    // roots: "Orphan" (parent missing → root) and "Root", sorted by name
    expect(tree.map((n) => n.id)).toEqual(["orphan", "root"]);
    const root = tree.find((n) => n.id === "root")!;
    expect(root._count.models).toBe(4);
    // children sorted by sortOrder then name → Alpha before Beta
    expect(root.children.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("collectDescendantCategoryIds", () => {
  const cats = [
    { id: "root", parentId: null },
    { id: "a", parentId: "root" },
    { id: "b", parentId: "root" },
    { id: "a1", parentId: "a" },
    { id: "other", parentId: null },
  ];

  it("BFS-collects the root and all descendants", () => {
    expect(collectDescendantCategoryIds(cats, "root").sort()).toEqual(
      ["a", "a1", "b", "root"].sort(),
    );
  });

  it("returns just the leaf when it has no children", () => {
    expect(collectDescendantCategoryIds(cats, "a1")).toEqual(["a1"]);
  });

  it("returns [] for a falsy root", () => {
    expect(collectDescendantCategoryIds(cats, null)).toEqual([]);
    expect(collectDescendantCategoryIds(cats, undefined)).toEqual([]);
    expect(collectDescendantCategoryIds(cats, "")).toEqual([]);
  });
});
