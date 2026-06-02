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
  type CategoryForStructuring,
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
    billingWeeks: null,
    billingDays: null,
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
        makeGroup("grp-1", "Lighting Package", 0, { quantity: 1, price: 500, billingDays: 3 }),
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

  it("preserves billingDays / rentalQuantity fallback chain for duration", () => {
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Test", 0, [
        makeGroup("g-bd", "Has billingDays", 0, { quantity: 1, price: 10, billingDays: 5, rentalQuantity: 99 }),
        makeGroup("g-rq", "Has rentalQuantity only", 1, { quantity: 1, price: 10, rentalQuantity: 7 }),
        makeGroup("g-fb", "Fallback to 1", 2, { quantity: 1, price: 10 }),
      ]),
    ];
    const result = structureLineItems([], categories);
    expect(result[0].duration).toBe(5); // billingDays wins
    expect(result[0].lineTotal).toBe(50);
    expect(result[1].duration).toBe(7); // rentalQuantity falls back
    expect(result[1].lineTotal).toBe(70);
    expect(result[2].duration).toBe(1); // default 1
    expect(result[2].lineTotal).toBe(10);
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

  it("expandProjectGroups=true emits group header + each child line item", () => {
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Lighting", 0, [
        makeGroup("grp-1", "Lighting Package", 0, { quantity: 1, price: 500, billingDays: 3 }),
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
    expect(summarize(result)).toMatchInlineSnapshot(`
      [
        "[GROUP] cat=Lighting | group=Lighting Package | Lighting Package x1",
        "[ITEM] cat=Lighting | group=Lighting Package | Source 4 Leko x12",
        "[ITEM] cat=Lighting | group=Lighting Package | Iris kit x2",
      ]
    `);
    // All three rows share the same groupName so the table plugin
    // buckets them under one "Lighting Package" header.
    const bucketNames = result.map(r => r.groupName);
    expect(new Set(bucketNames).size).toBe(1);
    expect(bucketNames[0]).toBe("Lighting Package");
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
    // Empty Group has no children to render, so its header is suppressed
    expect(summarize(result)).toEqual([
      "[GROUP] cat=Lighting | group=Full Group | Full Group x1",
      "[ITEM] cat=Lighting | group=Full Group | Lamp x4",
    ]);
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
    expect(summarize(result)).toMatchInlineSnapshot(`
      [
        "[GROUP] cat=Lighting | group=Lighting Package | Lighting Package x1",
        "[ITEM] cat=Lighting | group=Lighting Package | In group x1",
        "[ITEM] cat=Lighting | group=— | Loose lamp x3",
      ]
    `);
    // Ungrouped item gets the category as its bucket
    expect(result[2].groupName).toBe("Lighting");
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
    // Kit parent renders under the group; kit child is filtered (it
    // renders via parent's childLineItems[] in the plugin).
    expect(summarize(result)).toEqual([
      "[GROUP] cat=Lighting | group=Kit Group | Kit Group x1",
      "[ITEM] cat=Lighting | group=Kit Group | FOH Kit x1",
    ]);
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
      "[ITEM] cat=Lighting | group=Has items | Lamp x1",
    ]);
  });

  it("expandProjectGroups=false (collapse) is identical to legacy default behaviour", () => {
    // Regression guard: passing { expandProjectGroups: false } explicitly
    // matches the legacy default path. Quote/invoice rendering must not
    // change in Phase 1.
    const categories: CategoryForStructuring[] = [
      makeCategory("cat-1", "Lighting", 0, [
        makeGroup("grp-1", "Lighting Package", 0, { quantity: 1, price: 500, billingDays: 3 }),
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
