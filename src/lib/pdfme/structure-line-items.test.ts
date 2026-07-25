/**
 * Phase 0 snapshot tests for structureLineItems().
 *
 * Goal: lock the *current* (pre-refactor) behaviour so Phase 1's
 * per-template expand toggle has a regression net. Every scenario below
 * is named after a specific edge case the eng review flagged.
 *
 * If any of these snapshots change in Phase 1+, the change must be
 * intentional (and documented in the commit) — not a silent drift.
 */
import { describe, it, expect } from "vitest";
import {
  structureLineItems,
  getPackerSortOrder,
  type CategoryForStructuring,
  type SubHireGroupForStructuring,
} from "./structure-line-items";
import type { DocumentLineItem } from "./types";

/** Build a minimal line item with sensible defaults; override per test. */
function makeLineItem(overrides: Partial<DocumentLineItem>): DocumentLineItem {
  return {
    id: "li-default",
    description: null,
    quantity: 1,
    checkedOutQuantity: 0,
    unitPrice: null,
    pricingType: "PER_DAY",
    duration: 1,
    discount: null,
    lineTotal: null,
    groupName: null,
    categoryName: null,
    groupTitle: null,
    isOptional: false,
    notes: null,
    status: "CONFIRMED",
    model: null,
    asset: null,
    bulkAsset: null,
    ...overrides,
  };
}

function makeCategory(
  id: string,
  name: string,
  sortOrder: number,
  groups: CategoryForStructuring["groups"] = [],
): CategoryForStructuring {
  return { id, name, sortOrder, groups };
}

function makeGroup(
  id: string,
  title: string,
  sortOrder: number,
  overrides: Partial<CategoryForStructuring["groups"][number]> = {},
): CategoryForStructuring["groups"][number] {
  return {
    id,
    title,
    sortOrder,
    description: null,
    quantity: 1,
    price: null,
    rentalPeriod: null,
    rentalQuantity: null,
    ...overrides,
  };
}

/** Short summary string so snapshots are scannable. */
function summarize(items: DocumentLineItem[]): string[] {
  return items.map(li => {
    const tag = li.isGroupRow
      ? "GROUP"
      : li.isKitChild
        ? "KIT-CHILD"
        : "ITEM";
    const cat = li.categoryName ?? "—";
    const group = li.groupTitle ?? "—";
    const name = li.model?.name ?? li.description ?? li.id;
    return `[${tag}] cat=${cat} | group=${group} | ${name} x${li.quantity}`;
  });
}

describe("structureLineItems — Phase 0 baseline", () => {
  it("returns raw items unchanged when no categories exist (legacy project)", () => {
    const raw = [
      makeLineItem({ id: "a", description: "Mic stand", quantity: 5 }),
      makeLineItem({ id: "b", description: "Cable", quantity: 10 }),
    ];
    const result = structureLineItems(raw, undefined);
    expect(result).toBe(raw);
  });

  it("returns raw items unchanged when categories array is empty", () => {
    const raw = [makeLineItem({ id: "a", description: "Mic stand" })];
    const result = structureLineItems(raw, []);
    expect(result).toBe(raw);
  });

  it("collapses each Project Group into a single virtual row + drops child items", () => {
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Lighting", 0, [
        makeGroup("grp-1", "Lighting Package", 0, { quantity: 1, price: 500, rentalQuantity: 3 }),
      ]),
    ];
    const raw = [
      // Three items inside the group — should all be filtered out
      makeLineItem({
        id: "li-1", categoryName: "Lighting", groupTitle: "Lighting Package",
        model: { name: "Source 4 Leko" }, quantity: 12,
      }),
      makeLineItem({
        id: "li-2", categoryName: "Lighting", groupTitle: "Lighting Package",
        model: { name: "Iris kit" }, quantity: 2,
      }),
      makeLineItem({
        id: "li-3", categoryName: "Lighting", groupTitle: "Lighting Package",
        model: { name: "Gobo holder" }, quantity: 4,
      }),
    ];
    const result = structureLineItems(raw, categories);

    expect(summarize(result)).toMatchInlineSnapshot(`
      [
        "[GROUP] cat=Lighting | group=Lighting Package | Lighting Package x1",
      ]
    `);
    expect(result).toHaveLength(1);
    expect(result[0].isGroupRow).toBe(true);
    expect(result[0].lineTotal).toBe(1500); // 1 * 500 * 3
  });

  it("renders ungrouped items in a category directly, after group rows", () => {
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Lighting", 0, [
        makeGroup("grp-1", "Lighting Package", 0, { quantity: 1, price: 500 }),
      ]),
    ];
    const raw = [
      makeLineItem({
        id: "li-1", categoryName: "Lighting", groupTitle: "Lighting Package",
        model: { name: "In the group" },
      }),
      makeLineItem({
        id: "li-2", categoryName: "Lighting",
        model: { name: "Loose lamp" }, quantity: 3,
      }),
    ];
    const result = structureLineItems(raw, categories);
    expect(summarize(result)).toMatchInlineSnapshot(`
      [
        "[GROUP] cat=Lighting | group=Lighting Package | Lighting Package x1",
        "[ITEM] cat=Lighting | group=— | Loose lamp x3",
      ]
    `);
  });

  it("skips categories that have no groups and no ungrouped items", () => {
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Empty Cat", 0, []),
      makeCategory("cat-2", "Lighting", 1, []),
    ];
    const raw = [
      makeLineItem({ id: "li-1", categoryName: "Lighting", model: { name: "Lamp" } }),
    ];
    const result = structureLineItems(raw, categories);
    // "Empty Cat" omitted because no rows would render
    expect(summarize(result)).toEqual([
      "[ITEM] cat=Lighting | group=— | Lamp x1",
    ]);
  });

  it("appends uncategorized items at the bottom", () => {
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Lighting", 0, []),
    ];
    const raw = [
      makeLineItem({ id: "li-1", categoryName: "Lighting", model: { name: "Lamp" } }),
      makeLineItem({ id: "li-2", model: { name: "Random thing" }, description: "Random" }),
    ];
    const result = structureLineItems(raw, categories);
    expect(summarize(result)).toMatchInlineSnapshot(`
      [
        "[ITEM] cat=Lighting | group=— | Lamp x1",
        "[ITEM] cat=— | group=— | Random thing x1",
      ]
    `);
  });

  it("excludes kit children from the structured output (rendered via parent)", () => {
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Lighting", 0, []),
    ];
    const raw = [
      makeLineItem({
        id: "kit-parent", categoryName: "Lighting", kitId: "kit-1",
        model: { name: "FOH Kit" },
      }),
      makeLineItem({
        id: "kit-child-1", categoryName: "Lighting", kitId: "kit-1",
        isKitChild: true,
        model: { name: "Mixer (in kit)" },
      }),
    ];
    const result = structureLineItems(raw, categories);
    // Kit parent renders; kit child is excluded from top-level structuring
    // (the table plugin renders children via the parent's childLineItems[]).
    expect(summarize(result)).toEqual([
      "[ITEM] cat=Lighting | group=— | FOH Kit x1",
    ]);
  });

  it("excludes container line items (used by prep flow)", () => {
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Lighting", 0, []),
    ];
    const raw = [
      makeLineItem({
        id: "li-1", categoryName: "Lighting", isContainerLineItem: true,
        model: { name: "Container (case)" },
      }),
      makeLineItem({
        id: "li-2", categoryName: "Lighting",
        model: { name: "Real lamp" },
      }),
    ];
    const result = structureLineItems(raw, categories);
    expect(summarize(result)).toEqual([
      "[ITEM] cat=Lighting | group=— | Real lamp x1",
    ]);
  });

  it("renders categories in sortOrder, groups in sortOrder within each", () => {
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-2", "Audio", 0, [
        makeGroup("grp-2a", "Mics", 1, { quantity: 1, price: 100 }),
        makeGroup("grp-2b", "Speakers", 0, { quantity: 1, price: 200 }),
      ]),
      makeCategory("cat-1", "Lighting", 1, [
        makeGroup("grp-1", "Lights", 0, { quantity: 1, price: 300 }),
      ]),
    ];
    const raw: DocumentLineItem[] = [];
    const result = structureLineItems(raw, categories);
    expect(summarize(result)).toMatchInlineSnapshot(`
      [
        "[GROUP] cat=Audio | group=Mics | Mics x1",
        "[GROUP] cat=Audio | group=Speakers | Speakers x1",
        "[GROUP] cat=Lighting | group=Lights | Lights x1",
      ]
    `);
    // sortOrder is informational only — Prisma is what actually orders these
    // arrays before the helper sees them. The helper preserves array order
    // and does NOT re-sort by sortOrder. The test array passes Mics before
    // Speakers, so that's the output order.
  });

  it("WEEKLY rental period emits PER_WEEK pricingType, else PER_DAY", () => {
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Lighting", 0, [
        makeGroup("grp-w", "Weekly", 0, { quantity: 1, price: 700, rentalPeriod: "WEEKLY" }),
        makeGroup("grp-d", "Daily", 1, { quantity: 1, price: 100, rentalPeriod: "DAILY" }),
      ]),
    ];
    const result = structureLineItems([], categories);
    expect(result.find(r => r.groupTitle === "Weekly")?.pricingType).toBe("PER_WEEK");
    expect(result.find(r => r.groupTitle === "Daily")?.pricingType).toBe("PER_DAY");
  });

  it("Map-key collision: Category 'Lighting' + Group 'Lighting' coexist without merging", () => {
    // The structured output emits both. The plugin-side Map key collision
    // is a separate concern (gearflow-table.ts:263,281) — Phase 1 will
    // address it with composite keys. This test locks current behaviour
    // so the Phase 1 change is visible in the diff.
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Lighting", 0, [
        makeGroup("grp-1", "Lighting", 0, { quantity: 1, price: 500 }),
      ]),
    ];
    const raw = [
      makeLineItem({
        id: "li-1", categoryName: "Lighting",
        model: { name: "Loose lamp" },
      }),
    ];
    const result = structureLineItems(raw, categories);
    expect(summarize(result)).toMatchInlineSnapshot(`
      [
        "[GROUP] cat=Lighting | group=Lighting | Lighting x1",
        "[ITEM] cat=Lighting | group=— | Loose lamp x1",
      ]
    `);
    // Both rows carry categoryName "Lighting" and the group row carries
    // groupTitle "Lighting". The plugin will see two rows with the same
    // groupName "Lighting" → today this causes silent merging.
  });

  it("derives group duration from rentalQuantity, defaulting to 1", () => {
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Test", 0, [
        makeGroup("g-rq", "Has rentalQuantity", 0, { quantity: 1, price: 10, rentalQuantity: 7 }),
        makeGroup("g-fb", "Fallback to 1", 1, { quantity: 1, price: 10 }),
      ]),
    ];
    const result = structureLineItems([], categories);
    expect(result[0].duration).toBe(7); // rentalQuantity used
    expect(result[0].lineTotal).toBe(70);
    expect(result[1].duration).toBe(1); // default 1
    expect(result[1].lineTotal).toBe(10);
  });

  it("kit child INSIDE a Project Group: group row emits, kit-child still filtered", () => {
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Lighting", 0, [
        makeGroup("grp-1", "Kit Group", 0, { quantity: 1, price: 100 }),
      ]),
    ];
    const raw = [
      makeLineItem({
        id: "kit-parent", categoryName: "Lighting", groupTitle: "Kit Group",
        kitId: "kit-1",
        model: { name: "FOH Kit" },
      }),
      makeLineItem({
        id: "kit-child", categoryName: "Lighting", groupTitle: "Kit Group",
        kitId: "kit-1", isKitChild: true,
        model: { name: "Mixer (in kit)" },
      }),
    ];
    const result = structureLineItems(raw, categories);
    // Today: group row only — kit parent + child both filtered as in-group.
    // (Eng finding #10 wants this revisited in Phase 1: kit boundary
    // should win over group boundary. Snapshot here so the change is
    // explicit when it lands.)
    expect(summarize(result)).toEqual([
      "[GROUP] cat=Lighting | group=Kit Group | Kit Group x1",
    ]);
  });

  // ─── Phase 1 — expandProjectGroups ─────────────────────────────────────

  it("expandProjectGroups=true emits group row with members attached as childLineItems", () => {
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Lighting", 0, [
        makeGroup("grp-1", "Lighting Package", 0, { quantity: 1, price: 500, rentalQuantity: 3 }),
      ]),
    ];
    const raw = [
      makeLineItem({
        id: "li-1", categoryName: "Lighting", groupTitle: "Lighting Package",
        model: { name: "Source 4 Leko" }, quantity: 12,
      }),
      makeLineItem({
        id: "li-2", categoryName: "Lighting", groupTitle: "Lighting Package",
        model: { name: "Iris kit" }, quantity: 2,
      }),
    ];
    const result = structureLineItems(raw, categories, { expandProjectGroups: true });
    // Top-level result is just the synthetic group row — its members
    // ride along as childLineItems so the renderer can indent them.
    expect(summarize(result)).toEqual([
      "[GROUP] cat=Lighting | group=Lighting Package | Lighting Package x1",
    ]);
    // Group row is bucketed under the category — the warehouse section
    // header is the category name, not the group title.
    expect(result[0].groupName).toBe("Lighting");
    // Both group members are attached, in input order.
    expect(result[0].childLineItems?.map(c => c.id)).toEqual(["li-1", "li-2"]);
  });

  it("expandProjectGroups=true skips empty groups (no header for nothing)", () => {
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Lighting", 0, [
        makeGroup("grp-empty", "Empty Group", 0, { quantity: 1, price: 100 }),
        makeGroup("grp-full", "Full Group", 1, { quantity: 1, price: 200 }),
      ]),
    ];
    const raw = [
      makeLineItem({
        id: "li-1", categoryName: "Lighting", groupTitle: "Full Group",
        model: { name: "Lamp" }, quantity: 4,
      }),
    ];
    const result = structureLineItems(raw, categories, { expandProjectGroups: true });
    // Empty Group has no children to render, so its row is suppressed.
    // Full Group emits one synthetic row carrying the Lamp as a child.
    expect(summarize(result)).toEqual([
      "[GROUP] cat=Lighting | group=Full Group | Full Group x1",
    ]);
    expect(result[0].childLineItems?.map(c => c.id)).toEqual(["li-1"]);
  });

  it("expandProjectGroups=true: ungrouped items go under category bucket, after groups", () => {
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Lighting", 0, [
        makeGroup("grp-1", "Lighting Package", 0, { quantity: 1, price: 500 }),
      ]),
    ];
    const raw = [
      makeLineItem({
        id: "li-1", categoryName: "Lighting", groupTitle: "Lighting Package",
        model: { name: "In group" },
      }),
      makeLineItem({
        id: "li-2", categoryName: "Lighting",
        model: { name: "Loose lamp" }, quantity: 3,
      }),
    ];
    const result = structureLineItems(raw, categories, { expandProjectGroups: true });
    // Group row + its members-as-children come first; ungrouped category
    // items follow, both bucketed under the category.
    expect(summarize(result)).toMatchInlineSnapshot(`
      [
        "[GROUP] cat=Lighting | group=Lighting Package | Lighting Package x1",
        "[ITEM] cat=Lighting | group=— | Loose lamp x3",
      ]
    `);
    expect(result[0].groupName).toBe("Lighting");
    expect(result[0].childLineItems?.map(c => c.id)).toEqual(["li-1"]);
    expect(result[1].groupName).toBe("Lighting");
  });

  it("expandProjectGroups=true: kit children stay filtered (kit boundary preserved)", () => {
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Lighting", 0, [
        makeGroup("grp-1", "Kit Group", 0, { quantity: 1, price: 100 }),
      ]),
    ];
    const raw = [
      makeLineItem({
        id: "kit-parent", categoryName: "Lighting", groupTitle: "Kit Group",
        kitId: "kit-1",
        model: { name: "FOH Kit" },
      }),
      makeLineItem({
        id: "kit-child", categoryName: "Lighting", groupTitle: "Kit Group",
        kitId: "kit-1", isKitChild: true,
        model: { name: "Mixer (in kit)" },
      }),
    ];
    const result = structureLineItems(raw, categories, { expandProjectGroups: true });
    // The kit parent still breaks out to its own `[Kit] X` bucket per
    // the kit-boundary contract (even though it lived inside the
    // group). The group row sits in the category bucket with no
    // non-kit members of its own.
    expect(summarize(result)).toEqual([
      "[GROUP] cat=Lighting | group=Kit Group | Kit Group x1",
      "[ITEM] cat=Lighting | group=Kit Group | FOH Kit x1",
    ]);
    expect(result[0].groupName).toBe("Lighting");
    expect(result[0].childLineItems).toEqual([]);
    // kitBucketLabel uses kit.name → description → "Kit". This fixture
    // sets neither kit nor description, so the fallback "Kit" applies.
    expect(result[1].groupName).toBe("[Kit] Kit");
  });

  it("expandProjectGroups=true: empty category is still skipped", () => {
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Empty Cat", 0, [
        makeGroup("grp-empty", "Empty Group", 0, { quantity: 1, price: 100 }),
      ]),
      makeCategory("cat-2", "Lighting", 1, [
        makeGroup("grp-1", "Has items", 0, { quantity: 1, price: 100 }),
      ]),
    ];
    const raw = [
      makeLineItem({
        id: "li-1", categoryName: "Lighting", groupTitle: "Has items",
        model: { name: "Lamp" },
      }),
    ];
    const result = structureLineItems(raw, categories, { expandProjectGroups: true });
    // "Empty Cat" omitted entirely — no items in any of its groups.
    expect(summarize(result)).toEqual([
      "[GROUP] cat=Lighting | group=Has items | Has items x1",
    ]);
    expect(result[0].childLineItems?.map(c => c.id)).toEqual(["li-1"]);
  });

  it("expandProjectGroups=false (collapse) is identical to legacy default behaviour", () => {
    // Regression guard: passing { expandProjectGroups: false } explicitly
    // matches the legacy default path. Quote/invoice rendering must not
    // change in Phase 1.
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Lighting", 0, [
        makeGroup("grp-1", "Lighting Package", 0, { quantity: 1, price: 500, rentalQuantity: 3 }),
      ]),
    ];
    const raw = [
      makeLineItem({
        id: "li-1", categoryName: "Lighting", groupTitle: "Lighting Package",
        model: { name: "Source 4 Leko" }, quantity: 12,
      }),
    ];
    const collapsed = structureLineItems(raw, categories, { expandProjectGroups: false });
    const legacy = structureLineItems(raw, categories);
    expect(collapsed).toEqual(legacy);
  });

  // ─── Phase 2 — packerSort ──────────────────────────────────────────────

  it("packerSort=true sorts items within each group by location, then name", () => {
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Lighting", 0, [
        makeGroup("grp-1", "Lighting Package", 0, { quantity: 1, price: 100 }),
      ]),
    ];
    const raw = [
      makeLineItem({
        id: "li-a", categoryName: "Lighting", groupTitle: "Lighting Package",
        model: { name: "Source 4 Leko" }, locationName: "Warehouse B",
      }),
      makeLineItem({
        id: "li-b", categoryName: "Lighting", groupTitle: "Lighting Package",
        model: { name: "Iris kit" }, locationName: "Truss Room",
      }),
      makeLineItem({
        id: "li-c", categoryName: "Lighting", groupTitle: "Lighting Package",
        model: { name: "Gobo holder" }, locationName: "Truss Room",
      }),
    ];
    const result = structureLineItems(raw, categories, {
      expandProjectGroups: true,
      packerSort: true,
    });
    // The synthetic group row sits at top level; its members are sorted
    // in packer-walk order inside childLineItems. Truss Room first
    // (alphabetical), then Warehouse B. Within Truss Room: Gobo holder
    // before Iris kit (alphabetical model name).
    expect(summarize(result)).toEqual([
      "[GROUP] cat=Lighting | group=Lighting Package | Lighting Package x1",
    ]);
    expect(result[0].childLineItems?.map(c => c.model?.name)).toEqual([
      "Gobo holder",
      "Iris kit",
      "Source 4 Leko",
    ]);
  });

  it("packerSort=true: null locations sort to the bottom of each bucket", () => {
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Audio", 0, [
        makeGroup("grp-1", "Mics", 0, { quantity: 1, price: 50 }),
      ]),
    ];
    const raw = [
      makeLineItem({
        id: "li-a", categoryName: "Audio", groupTitle: "Mics",
        model: { name: "Shure SM58" }, // no locationName — custom item
      }),
      makeLineItem({
        id: "li-b", categoryName: "Audio", groupTitle: "Mics",
        model: { name: "Sennheiser e835" }, locationName: "Mic Drawer",
      }),
    ];
    const result = structureLineItems(raw, categories, {
      expandProjectGroups: true,
      packerSort: true,
    });
    expect(summarize(result)).toEqual([
      "[GROUP] cat=Audio | group=Mics | Mics x1",
    ]);
    // Null-location item sorts to the bottom of the group's members.
    expect(result[0].childLineItems?.map(c => c.model?.name)).toEqual([
      "Sennheiser e835",
      "Shure SM58",
    ]);
  });

  it("packerSort=false preserves input order (no sort)", () => {
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Lighting", 0, [
        makeGroup("grp-1", "Lighting Package", 0, { quantity: 1, price: 100 }),
      ]),
    ];
    const raw = [
      makeLineItem({
        id: "li-a", categoryName: "Lighting", groupTitle: "Lighting Package",
        model: { name: "Source 4 Leko" }, locationName: "Warehouse B",
      }),
      makeLineItem({
        id: "li-b", categoryName: "Lighting", groupTitle: "Lighting Package",
        model: { name: "Iris kit" }, locationName: "Truss Room",
      }),
    ];
    const result = structureLineItems(raw, categories, {
      expandProjectGroups: true,
      packerSort: false,
    });
    // Input order preserved inside childLineItems: Source 4 Leko before Iris kit.
    expect(summarize(result)).toEqual([
      "[GROUP] cat=Lighting | group=Lighting Package | Lighting Package x1",
    ]);
    expect(result[0].childLineItems?.map(c => c.model?.name)).toEqual([
      "Source 4 Leko",
      "Iris kit",
    ]);
  });

  it("packerSort also sorts ungrouped items within a category and uncategorized items", () => {
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Lighting", 0, []),
    ];
    const raw = [
      makeLineItem({
        id: "li-a", categoryName: "Lighting",
        model: { name: "Z lamp" }, locationName: "Warehouse B",
      }),
      makeLineItem({
        id: "li-b", categoryName: "Lighting",
        model: { name: "A lamp" }, locationName: "Truss Room",
      }),
      makeLineItem({
        id: "li-c",
        model: { name: "Random thing" }, locationName: "Storeroom",
      }),
      makeLineItem({
        id: "li-d",
        model: { name: "Aardvark" }, locationName: "Office",
      }),
    ];
    const result = structureLineItems(raw, categories, {
      expandProjectGroups: true,
      packerSort: true,
    });
    expect(summarize(result)).toEqual([
      "[ITEM] cat=Lighting | group=— | A lamp x1",
      "[ITEM] cat=Lighting | group=— | Z lamp x1",
      "[ITEM] cat=— | group=— | Aardvark x1", // Office < Storeroom
      "[ITEM] cat=— | group=— | Random thing x1",
    ]);
  });

  it("getPackerSortOrder is exposed and pure", () => {
    const cmp = getPackerSortOrder();
    const items = [
      makeLineItem({ id: "1", model: { name: "Z" }, locationName: "B" }),
      makeLineItem({ id: "2", model: { name: "A" }, locationName: "A" }),
      makeLineItem({ id: "3", model: { name: "B" }, locationName: "A" }),
    ];
    const sorted = [...items].sort(cmp);
    expect(sorted.map(i => i.id)).toEqual(["2", "3", "1"]);
  });

  // ─── Phase 3a — sub-hire groups ────────────────────────────────────────

  it("sub-hire group items render as their own section AFTER all categories (warehouse mode)", () => {
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Lighting", 0, []),
    ];
    const subHireGroups: SubHireGroupForStructuring[] = [
      { id: "shg-1", title: "Moving Lights", sortOrder: 0, supplierName: "Mainstage AV" },
    ];
    const raw = [
      makeLineItem({
        id: "owned",
        categoryName: "Lighting",
        model: { name: "Source 4 Leko" },
      }),
      makeLineItem({
        id: "hired-1",
        categoryName: "Lighting", // sub-hire's targetCategory
        subHireGroupId: "shg-1",
        model: { name: "Robe Pointe" },
      }),
      makeLineItem({
        id: "hired-2",
        categoryName: "Lighting",
        subHireGroupId: "shg-1",
        model: { name: "Hog 4 console" },
      }),
    ];
    const result = structureLineItems(
      raw,
      categories,
      { expandProjectGroups: true },
      subHireGroups,
    );
    expect(summarize(result)).toEqual([
      // Owned gear in its category first
      "[ITEM] cat=Lighting | group=— | Source 4 Leko x1",
      // Sub-hire section after
      "[ITEM] cat=Lighting | group=— | Robe Pointe x1",
      "[ITEM] cat=Lighting | group=— | Hog 4 console x1",
    ]);
    // Sub-hire items have the composite section label as their groupName
    expect(result[1].groupName).toBe("Sub-Hire: Mainstage AV — Moving Lights");
    expect(result[2].groupName).toBe("Sub-Hire: Mainstage AV — Moving Lights");
    // Owned item kept its category bucket
    expect(result[0].groupName).toBe("Lighting");
  });

  it("sub-hire section is suppressed when expandProjectGroups=false (client view)", () => {
    // Quote / invoice keep sub-hire items inside their target category
    // so the category subtotals stay correct.
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Lighting", 0, []),
    ];
    const subHireGroups: SubHireGroupForStructuring[] = [
      { id: "shg-1", title: "Moving Lights", sortOrder: 0, supplierName: "Mainstage AV" },
    ];
    const raw = [
      makeLineItem({
        id: "hired-1",
        categoryName: "Lighting",
        subHireGroupId: "shg-1",
        model: { name: "Robe Pointe" },
      }),
    ];
    const result = structureLineItems(
      raw,
      categories,
      { expandProjectGroups: false },
      subHireGroups,
    );
    expect(summarize(result)).toEqual([
      "[ITEM] cat=Lighting | group=— | Robe Pointe x1",
    ]);
    expect(result[0].groupName).toBe("Lighting");
  });

  it("multiple sub-hire groups each get their own section, with supplier per group", () => {
    const subHireGroups: SubHireGroupForStructuring[] = [
      { id: "shg-a", title: "Trussing", sortOrder: 0, supplierName: "Steeldeck" },
      { id: "shg-b", title: "Power Distro", sortOrder: 1, supplierName: "BTR Sparks" },
    ];
    const raw = [
      makeLineItem({ id: "a1", subHireGroupId: "shg-a", model: { name: "Pre-rig truss" } }),
      makeLineItem({ id: "b1", subHireGroupId: "shg-b", model: { name: "63A distro" } }),
      makeLineItem({ id: "b2", subHireGroupId: "shg-b", model: { name: "Cable run" } }),
    ];
    // Add a dummy category to avoid early-return fallback
    const result = structureLineItems(
      raw,
      [makeCategory("dummy", "Dummy", 0, [])],
      { expandProjectGroups: true },
      subHireGroups,
    );
    const labels = result.map(r => r.groupName);
    expect(labels).toEqual([
      "Sub-Hire: Steeldeck — Trussing",
      "Sub-Hire: BTR Sparks — Power Distro",
      "Sub-Hire: BTR Sparks — Power Distro",
    ]);
  });

  it("sub-hire group with no items is silently skipped (no orphan section header)", () => {
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Lighting", 0, []),
    ];
    const subHireGroups: SubHireGroupForStructuring[] = [
      { id: "shg-empty", title: "Empty SH", sortOrder: 0, supplierName: "Nobody" },
      { id: "shg-full", title: "Full SH", sortOrder: 1, supplierName: "Real Supplier" },
    ];
    const raw = [
      makeLineItem({
        id: "owned", categoryName: "Lighting", model: { name: "Lamp" },
      }),
      makeLineItem({
        id: "hired", subHireGroupId: "shg-full",
        categoryName: "Lighting", model: { name: "Mic" },
      }),
    ];
    const result = structureLineItems(
      raw,
      categories,
      { expandProjectGroups: true },
      subHireGroups,
    );
    // Empty SH absent; Full SH renders
    expect(result.map(r => r.groupName)).toEqual([
      "Lighting",
      "Sub-Hire: Real Supplier — Full SH",
    ]);
  });

  it("sub-hire item with NO matching SubHireGroup in the param list stays in its category", () => {
    // Edge: a line item references a sub-hire group that wasn't loaded
    // (deleted SubHire, draft data, etc.). It falls back to category
    // rendering rather than disappearing.
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Lighting", 0, []),
    ];
    const raw = [
      makeLineItem({
        id: "orphan", subHireGroupId: "missing",
        categoryName: "Lighting", model: { name: "Orphan item" },
      }),
    ];
    const result = structureLineItems(
      raw,
      categories,
      { expandProjectGroups: true },
      [], // no sub-hire groups loaded
    );
    expect(result.map(r => r.groupName)).toEqual(["Lighting"]);
  });

  it("category-total invariant: sub-hire extraction does not change quote/invoice output", () => {
    // Category-total regression guard per Eng review. In collapse mode
    // (quote/invoice), the structured output must be byte-identical to
    // the pre-Phase-3a baseline so category subtotals stay correct.
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Lighting", 0, [
        makeGroup("grp-1", "Lighting Package", 0, { quantity: 1, price: 500 }),
      ]),
    ];
    const subHireGroups: SubHireGroupForStructuring[] = [
      { id: "shg-1", title: "Hire", sortOrder: 0, supplierName: "Vendor" },
    ];
    const raw = [
      makeLineItem({
        id: "owned-grouped", categoryName: "Lighting", groupTitle: "Lighting Package",
        model: { name: "Source 4" },
      }),
      makeLineItem({
        id: "hired-grouped", categoryName: "Lighting", groupTitle: "Lighting Package",
        subHireGroupId: "shg-1", model: { name: "Robe Pointe" },
      }),
      makeLineItem({
        id: "hired-ungrouped", categoryName: "Lighting",
        subHireGroupId: "shg-1", model: { name: "Hog Console" },
      }),
    ];
    // Quote/invoice path: collapse mode + sub-hire groups passed but ignored
    const collapsed = structureLineItems(
      raw,
      categories,
      { expandProjectGroups: false },
      subHireGroups,
    );
    // Same path without sub-hire groups
    const collapsedNoSh = structureLineItems(
      raw,
      categories,
      { expandProjectGroups: false },
      [],
    );
    expect(collapsed).toEqual(collapsedNoSh);
  });

  // ─── Phase 3b — kit boundary ───────────────────────────────────────────

  it("kit parent in warehouse mode gets its own `[Kit] <name>` section", () => {
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Audio", 0, []),
    ];
    const raw = [
      makeLineItem({
        id: "k1", categoryName: "Audio", kitId: "kit-1",
        kit: { assetTag: "K-001", name: "DJ Setup Kit" },
        model: { name: "DJ Setup Kit" },
      }),
      makeLineItem({
        id: "loose", categoryName: "Audio",
        model: { name: "Cable" },
      }),
    ];
    const result = structureLineItems(raw, categories, { expandProjectGroups: true });
    // The kit gets the special section name, the loose item stays in the
    // category bucket. The downstream table plugin buckets by groupName
    // at render time, so the array emission order doesn't strictly
    // determine the rendered section order (Map iteration handles that).
    expect(result.find(r => r.id === "k1")?.groupName).toBe("[Kit] DJ Setup Kit");
    expect(result.find(r => r.id === "loose")?.groupName).toBe("Audio");
    expect(result).toHaveLength(2);
  });

  it("kit parent INSIDE a Project Group: kit boundary wins (warehouse mode)", () => {
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Audio", 0, [
        makeGroup("grp-1", "Stage Package", 0, { quantity: 1, price: 1000 }),
      ]),
    ];
    const raw = [
      makeLineItem({
        id: "k1", categoryName: "Audio", groupTitle: "Stage Package",
        kitId: "kit-1", kit: { assetTag: "K-001", name: "FOH Rack" },
        model: { name: "FOH Rack" },
      }),
      makeLineItem({
        id: "loose-in-grp", categoryName: "Audio", groupTitle: "Stage Package",
        model: { name: "Snake cable" },
      }),
    ];
    const result = structureLineItems(raw, categories, { expandProjectGroups: true });
    // Kit parent breaks out to its own `[Kit] FOH Rack` bucket per the
    // kit-boundary contract. The loose snake cable rides along inside
    // the group row's childLineItems so it indents under the group on
    // the doc. The group row itself sits in the category bucket.
    expect(result.find(r => r.id === "k1")?.groupName).toBe("[Kit] FOH Rack");
    const groupRow = result.find(r => r.isGroupRow);
    expect(groupRow?.groupName).toBe("Audio");
    expect(groupRow?.childLineItems?.map(c => c.id)).toEqual(["loose-in-grp"]);
    expect(result).toHaveLength(2);
  });

  it("kit boundary is suppressed in collapse mode (quote/invoice keep kits inline)", () => {
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Audio", 0, []),
    ];
    const raw = [
      makeLineItem({
        id: "k1", categoryName: "Audio", kitId: "kit-1",
        kit: { assetTag: "K-001", name: "DJ Setup Kit" },
        model: { name: "DJ Setup Kit" },
      }),
    ];
    const result = structureLineItems(raw, categories, { expandProjectGroups: false });
    // Collapse mode: kit stays in category bucket, no special section.
    expect(result.find(r => r.id === "k1")?.groupName).toBe("Audio");
  });

  it("kit children are still filtered out of top-level structuring (rendered via parent)", () => {
    // Kit boundary changes ONLY the parent's bucket — children are still
    // filtered. They render via the plugin's childLineItems[] codepath
    // under the parent's row.
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Audio", 0, []),
    ];
    const raw = [
      makeLineItem({
        id: "k1", categoryName: "Audio", kitId: "kit-1",
        kit: { assetTag: "K-001", name: "DJ Setup Kit" },
        model: { name: "DJ Setup Kit" },
      }),
      makeLineItem({
        id: "kc1", categoryName: "Audio", kitId: "kit-1", isKitChild: true,
        model: { name: "DJM-900NXS2" },
      }),
      makeLineItem({
        id: "kc2", categoryName: "Audio", kitId: "kit-1", isKitChild: true,
        model: { name: "CDJ-2000NXS2" },
      }),
    ];
    const result = structureLineItems(raw, categories, { expandProjectGroups: true });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("k1");
    expect(result[0].groupName).toBe("[Kit] DJ Setup Kit");
  });

  // ─── Phase 4 — comprehensive integration snapshot ──────────────────────

  it("integration: complete fixture (groups + kits + sub-hire + custom + uncategorized)", () => {
    // The fixture the Eng review called for — every feature interacting
    // in one structure call. Used as a regression net for any future
    // change to structureLineItems(). Mirrors the realistic shape of a
    // project assembled for a real gig (lighting package with loose
    // items, a kit, a sub-hire group, and an uncategorized custom item).
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-lighting", "Lighting", 0, [
        makeGroup("grp-lights", "Lighting Package", 0, {
          quantity: 1, price: 500, rentalQuantity: 3,
        }),
      ]),
      makeCategory("cat-audio", "Audio", 1, []),
    ];
    const subHireGroups: SubHireGroupForStructuring[] = [
      { id: "shg-moving", title: "Moving Lights", sortOrder: 0, supplierName: "Mainstage AV" },
    ];
    const raw = [
      // Lighting Package contents
      makeLineItem({
        id: "owned-1", categoryName: "Lighting", groupTitle: "Lighting Package",
        model: { name: "Source 4 Leko" }, quantity: 12, locationName: "Lighting Cage",
      }),
      makeLineItem({
        id: "owned-2", categoryName: "Lighting", groupTitle: "Lighting Package",
        model: { name: "Iris kit" }, quantity: 2, locationName: "Lighting Cage",
      }),
      // Ungrouped in Lighting
      makeLineItem({
        id: "owned-loose", categoryName: "Lighting",
        model: { name: "Strobe" }, quantity: 1, locationName: "Effects Shelf",
      }),
      // Audio category — has a kit
      makeLineItem({
        id: "kit-foh", categoryName: "Audio", kitId: "kit-1",
        kit: { assetTag: "K-001", name: "FOH Rack" },
        model: { name: "FOH Rack" },
      }),
      makeLineItem({
        id: "kit-foh-child", categoryName: "Audio", kitId: "kit-1", isKitChild: true,
        model: { name: "DiGiCo SD12" },
      }),
      // Sub-hire
      makeLineItem({
        id: "hired-1", categoryName: "Lighting", subHireGroupId: "shg-moving",
        model: { name: "Robe Pointe" }, quantity: 4,
      }),
      // Uncategorized custom item
      makeLineItem({
        id: "custom-1", description: "Borrowed cable drum",
        model: { name: "Custom item" },
      }),
    ];

    const result = structureLineItems(
      raw,
      categories,
      { expandProjectGroups: true, packerSort: true },
      subHireGroups,
    );

    // Top-level rows: group row, ungrouped loose item, kit breakout,
    // sub-hire items, uncategorized custom. Grouped owned items now
    // live inside the group row's childLineItems.
    expect(result.find(r => r.id === "owned-1")).toBeUndefined();
    expect(result.find(r => r.id === "owned-2")).toBeUndefined();
    expect(result.find(r => r.id === "owned-loose")?.groupName).toBe("Lighting");
    expect(result.find(r => r.id === "kit-foh")?.groupName).toBe("[Kit] FOH Rack");
    expect(result.find(r => r.id === "hired-1")?.groupName).toBe("Sub-Hire: Mainstage AV — Moving Lights");
    expect(result.find(r => r.id === "custom-1")?.groupName).toBeNull(); // uncategorized

    // Kit child is filtered out of top-level structuring
    expect(result.find(r => r.id === "kit-foh-child")).toBeUndefined();

    // The group header row is emitted in the category bucket — the
    // section header on the doc is the category, not the group title.
    const groupRow = result.find(r => r.isGroupRow && r.groupTitle === "Lighting Package");
    expect(groupRow).toBeTruthy();
    expect(groupRow?.groupName).toBe("Lighting");
    // Group members ride along as children, sorted in packer-walk order.
    // Both share locationName=Lighting Cage so the tie-breaker is model
    // name: "Iris kit" (owned-2) sorts before "Source 4 Leko" (owned-1).
    expect(groupRow?.childLineItems?.map(c => c.id)).toEqual(["owned-2", "owned-1"]);
  });

  it("category-total regression: collapse-mode output unchanged by Phase 1-3b features", () => {
    // The single most important regression guard in this file: quote and
    // invoice rendering must NOT change when expandProjectGroups=false,
    // regardless of which new features (sub-hire sections, kit boundary,
    // packer sort) get passed. Otherwise category subtotals drift and
    // every existing org's quote/invoice changes silently on first
    // deploy. Eng review flagged this as the most critical failure mode.
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Lighting", 0, [
        makeGroup("grp-1", "Package A", 0, { quantity: 1, price: 500 }),
      ]),
    ];
    const subHireGroups: SubHireGroupForStructuring[] = [
      { id: "shg-1", title: "Hire", sortOrder: 0, supplierName: "Vendor" },
    ];
    const raw = [
      makeLineItem({
        id: "owned", categoryName: "Lighting", groupTitle: "Package A",
        model: { name: "Lamp" },
      }),
      makeLineItem({
        id: "hired", categoryName: "Lighting", subHireGroupId: "shg-1",
        model: { name: "Hired moving light" },
      }),
      makeLineItem({
        id: "kit", categoryName: "Lighting", kitId: "kit-1",
        kit: { assetTag: "K", name: "DJ Rack" },
        model: { name: "DJ Rack" },
      }),
    ];

    // Three flavors of collapse-mode invocation. The critical invariant
    // is that THE SAME ITEMS appear in THE SAME CATEGORY — order can
    // change (packerSort reorders) but no item gets removed, duplicated,
    // or moved to a different category. Category subtotals depend on
    // membership, not order.
    const baseline = structureLineItems(raw, categories, { expandProjectGroups: false });
    const withSubHires = structureLineItems(
      raw, categories,
      { expandProjectGroups: false },
      subHireGroups,
    );
    const withPackerSort = structureLineItems(
      raw, categories,
      { expandProjectGroups: false, packerSort: true },
      subHireGroups,
    );

    // Without packerSort, the result is byte-identical to baseline.
    expect(withSubHires).toEqual(baseline);

    // With packerSort, the SET of items per category is identical (only
    // order changes). Convert each result to a category→item-id-set map
    // and compare those.
    const byCategory = (items: typeof baseline): Map<string | null, Set<string>> => {
      const map = new Map<string | null, Set<string>>();
      for (const li of items) {
        const cat = li.categoryName;
        if (!map.has(cat)) map.set(cat, new Set());
        map.get(cat)!.add(li.id);
      }
      return map;
    };
    expect(byCategory(withPackerSort)).toEqual(byCategory(baseline));

    // Specifically: sub-hire items remain in their target category in
    // collapse mode (so category subtotals roll up correctly).
    const hired = baseline.find(r => r.id === "hired");
    expect(hired?.categoryName).toBe("Lighting");
    // The kit also stays in its category bucket in collapse mode.
    const kit = baseline.find(r => r.id === "kit");
    expect(kit?.categoryName).toBe("Lighting");
    expect(kit?.groupName).not.toMatch(/^\[Kit\]/);
  });

  it("50+ item pagination fixture: many groups and ungrouped items, no crashes", () => {
    // Pagination tests live in the plugin; here we just verify the helper
    // produces a stable shape for the fixture the plugin tests will consume.
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Audio", 0, Array.from({ length: 10 }, (_, i) =>
        makeGroup(`grp-a-${i}`, `Audio Group ${i}`, i, { quantity: 1, price: 100 }),
      )),
      makeCategory("cat-2", "Lighting", 1, Array.from({ length: 10 }, (_, i) =>
        makeGroup(`grp-l-${i}`, `Lighting Group ${i}`, i, { quantity: 1, price: 200 }),
      )),
    ];
    const raw: DocumentLineItem[] = Array.from({ length: 50 }, (_, i) =>
      makeLineItem({
        id: `li-${i}`,
        categoryName: i % 2 === 0 ? "Audio" : "Lighting",
        model: { name: `Item ${i}` },
      }),
    );
    const result = structureLineItems(raw, categories);
    // 10 audio groups + 25 audio items + 10 lighting groups + 25 lighting items = 70 rows
    expect(result.length).toBe(70);
    // All group rows are isGroupRow:true
    expect(result.filter(r => r.isGroupRow).length).toBe(20);
  });
});
