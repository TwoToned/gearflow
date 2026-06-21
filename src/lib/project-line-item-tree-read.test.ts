import { describe, it, expect } from "vitest";
import {
  indexChildren,
  indexUnits,
  reconstructScope,
  reconstructCategories,
  type FlatLineItem,
} from "@/lib/project-line-item-tree-read";

type LI = FlatLineItem & { title?: string };

// id, parent, cat, grp, status, sortOrder
function li(id: string, o: Partial<LI> = {}): LI {
  return { id, status: "QUOTED", sortOrder: 0, ...o };
}

describe("indexChildren", () => {
  it("buckets non-cancelled children by parent, sorted by sortOrder", () => {
    const rows = [
      li("p"),
      li("c2", { parentLineItemId: "p", sortOrder: 2 }),
      li("c1", { parentLineItemId: "p", sortOrder: 1 }),
      li("cX", { parentLineItemId: "p", sortOrder: 0, status: "CANCELLED" }),
    ];
    const idx = indexChildren(rows);
    expect(idx.get("p")!.map((r) => r.id)).toEqual(["c1", "c2"]); // cancelled dropped, sorted
    expect(idx.has("cX")).toBe(false);
  });
});

describe("indexUnits", () => {
  it("buckets non-cancelled units by lineItemId, sorted by ordinal", () => {
    const units = [
      { id: "u2", lineItemId: "a", ordinal: 2 },
      { id: "u1", lineItemId: "a", ordinal: 1 },
      { id: "uX", lineItemId: "a", ordinal: 0, status: "CANCELLED" },
      { id: "u3", lineItemId: "b", ordinal: 0 },
    ];
    const idx = indexUnits(units);
    expect(idx.get("a")!.map((u) => u.id)).toEqual(["u1", "u2"]);
    expect(idx.get("b")!.map((u) => u.id)).toEqual(["u3"]);
  });
});

describe("reconstructScope", () => {
  const rows = [
    li("p1", { sortOrder: 1 }),
    li("p0", { sortOrder: 0 }),
    li("pCancel", { sortOrder: 5, status: "CANCELLED" }),
    li("c1", { parentLineItemId: "p0", sortOrder: 0 }),
    li("gc1", { parentLineItemId: "c1", sortOrder: 0 }),
  ];
  const byParent = indexChildren(rows);
  const unitsByLineItem = indexUnits([{ id: "u", lineItemId: "p0", ordinal: 0 }]);

  it("filters CANCELLED, sorts by sortOrder, attaches units", () => {
    const out = reconstructScope(rows.filter((r) => !r.parentLineItemId), byParent, { unitsByLineItem, depth: 0 });
    expect(out.map((r) => r.id)).toEqual(["p0", "p1"]); // cancelled dropped + sorted
    expect((out[0] as { units: unknown[] }).units).toHaveLength(1);
    expect((out[1] as { units: unknown[] }).units).toHaveLength(0);
  });

  it("depth 0 omits the childLineItems key entirely (matches a stopped include)", () => {
    const out = reconstructScope(rows.filter((r) => !r.parentLineItemId), byParent, { unitsByLineItem, depth: 0 });
    expect("childLineItems" in out[0]).toBe(false);
  });

  it("depth 1 nests one level; grandchildren omitted", () => {
    const out = reconstructScope([li("p0", { sortOrder: 0 })], byParent, { unitsByLineItem, depth: 1 });
    const kids = (out[0] as { childLineItems: Array<{ id: string }> }).childLineItems;
    expect(kids.map((k) => k.id)).toEqual(["c1"]);
    expect("childLineItems" in kids[0]).toBe(false); // depth exhausted
  });

  it("depth 2 nests two levels (grandchildren present)", () => {
    const out = reconstructScope([li("p0", { sortOrder: 0 })], byParent, { unitsByLineItem, depth: 2 });
    const c1 = (out[0] as { childLineItems: Array<{ id: string; childLineItems: Array<{ id: string }> }> }).childLineItems[0];
    expect(c1.childLineItems.map((g) => g.id)).toEqual(["gc1"]);
  });
});

describe("reconstructCategories", () => {
  // Mirror the seeded shape: 2 categories, a group under each, grouped + ungrouped items.
  const categories = [
    { id: "catA", sortOrder: 1 },
    { id: "catB", sortOrder: 0 },
  ];
  const groups = [
    { id: "gA", categoryId: "catA", sortOrder: 0 },
    { id: "gB", categoryId: "catB", sortOrder: 0 },
  ];
  const lineItems = [
    li("inGA", { categoryId: "catA", groupId: "gA", sortOrder: 0 }),
    li("inGAchild", { parentLineItemId: "inGA", sortOrder: 0 }),
    li("catAdirect", { categoryId: "catA", groupId: null, sortOrder: 1 }),
    li("inGB", { categoryId: "catB", groupId: "gB", sortOrder: 0 }),
    li("noCat", { categoryId: null, groupId: null, sortOrder: 0 }),
  ];
  const byParent = indexChildren(lineItems);

  it("orders categories, nests groups with their items, and category-direct (groupId null) items", () => {
    const out = reconstructCategories(categories, groups, lineItems, byParent, indexUnits([]), 1);
    expect(out.map((c) => c.id)).toEqual(["catB", "catA"]); // sorted by sortOrder
    const catA = out.find((c) => c.id === "catA")!;
    expect(catA.groups.map((g) => g.id)).toEqual(["gA"]);
    expect(catA.groups[0].lineItems.map((l) => l.id)).toEqual(["inGA"]);
    // grouped item carries its child nested (depth 1)
    expect((catA.groups[0].lineItems[0] as { childLineItems: Array<{ id: string }> }).childLineItems.map((c) => c.id)).toEqual(["inGAchild"]);
    // category-direct items: groupId null only
    expect(catA.lineItems.map((l) => l.id)).toEqual(["catAdirect"]);
  });

  it("does not place no-category items into any category", () => {
    const out = reconstructCategories(categories, groups, lineItems, byParent, indexUnits([]), 1);
    const allCatItemIds = out.flatMap((c) => [...c.lineItems.map((l) => l.id), ...c.groups.flatMap((g) => g.lineItems.map((l) => l.id))]);
    expect(allCatItemIds).not.toContain("noCat");
  });
});
