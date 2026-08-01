import { describe, it, expect } from "vitest";
import {
  reconstructProjectCategories,
  reconstructUncategorizedLineItems,
  reconstructUncategorizedSubHireGroups,
  reconstructUncategorizedProjectGroups,
  reconstructProjectSubHires,
  reconstructOverbookedRecord,
  type EquipmentTabBundleData,
} from "./equipment-tab-reconstruct";
import type { OverbookingBundleData } from "./overbooking-core";

/**
 * Parity coverage for the native equipment-tab reconstruction — the six views the
 * tab's server actions returned, rebuilt from one equipmentTab.bundle.
 */

const d = <T extends Record<string, unknown>>(o: T) =>
  ({ _id: `id_${o.id ?? "x"}`, _creationTime: 0, ...o }) as never;

const EMPTY: EquipmentTabBundleData = {
  lineItems: [], units: [], categories: [], groups: [], categorySlots: [], subHires: [],
  subHireGroups: [], subHireItems: [], assets: [], bulkAssets: [], kits: [],
  models: [], suppliers: [], orgCategories: [],
} as never;

function bundle(parts: Partial<Record<keyof EquipmentTabBundleData, unknown[]>>): EquipmentTabBundleData {
  return { ...EMPTY, ...parts } as never;
}

const ORG = "o1";
const PROJ = "p1";

function li(p: Record<string, unknown>) {
  return d({ organizationId: ORG, projectId: PROJ, quantity: 1, status: "QUOTED", ...p });
}

describe("reconstructUncategorizedLineItems", () => {
  it("returns top-level items with no category/group, attached with model + asset", () => {
    const b = bundle({
      lineItems: [
        li({ id: "li1", modelId: "m1", assetId: "a1", quantity: 2 }),
        li({ id: "li2", categoryId: "c1" }), // categorized → excluded
        li({ id: "li3", groupId: "g1" }), // grouped → excluded
        li({ id: "kc", parentLineItemId: "li1", isKitChild: true }), // child → excluded
      ],
      models: [d({ id: "m1", organizationId: ORG, name: "SM58", categoryId: "cat1" })],
      assets: [d({ id: "a1", organizationId: ORG, modelId: "m1", assetTag: "SM58-001", status: "AVAILABLE" })],
      orgCategories: [d({ id: "cat1", organizationId: ORG, name: "Audio" })],
    });
    const out = reconstructUncategorizedLineItems(b);
    expect(out.map((i) => i.id)).toEqual(["li1"]);
    expect(out[0].model?.name).toBe("SM58");
    expect(out[0].asset?.assetTag).toBe("SM58-001");
  });
});

describe("per-unit fulfillment (units flow into the tab)", () => {
  it("attaches per-unit rows with resolved asset tags + status to a multi-qty line", () => {
    const b = bundle({
      lineItems: [li({ id: "li1", modelId: "m1", quantity: 2 })],
      models: [d({ id: "m1", organizationId: ORG, name: "SM57", categoryId: "cat1" })],
      assets: [
        d({ id: "a1", organizationId: ORG, modelId: "m1", assetTag: "MIC-0042" }),
        d({ id: "a2", organizationId: ORG, modelId: "m1", assetTag: "MIC-0055" }),
      ],
      units: [
        // Deliberately out-of-order ordinals to prove ordinal sort.
        d({ id: "u2", organizationId: ORG, lineItemId: "li1", ordinal: 2, assetId: "a2", status: "RETURNED", returnCondition: "GOOD" }),
        d({ id: "u1", organizationId: ORG, lineItemId: "li1", ordinal: 1, assetId: "a1", status: "CHECKED_OUT" }),
      ],
    });
    const out = reconstructUncategorizedLineItems(b);
    expect(out.map((i) => i.id)).toEqual(["li1"]);
    const units = out[0].units ?? [];
    // ordinal-sorted, asset tags resolved, and the RETURNED unit is retained
    // (the "what went out" history survives even after check-in).
    expect(units.map((u) => u.asset?.assetTag)).toEqual(["MIC-0042", "MIC-0055"]);
    expect(units.map((u) => u.status)).toEqual(["CHECKED_OUT", "RETURNED"]);
  });

  it("only attaches a line's own units, keyed by lineItemId", () => {
    const b = bundle({
      lineItems: [li({ id: "li1", modelId: "m1" }), li({ id: "li2", modelId: "m1" })],
      models: [d({ id: "m1", organizationId: ORG, name: "SM57" })],
      assets: [d({ id: "a1", organizationId: ORG, modelId: "m1", assetTag: "MIC-0042" })],
      units: [d({ id: "u1", organizationId: ORG, lineItemId: "li1", ordinal: 1, assetId: "a1", status: "CHECKED_OUT" })],
    });
    const out = reconstructUncategorizedLineItems(b).sort((a, z) => a.id.localeCompare(z.id));
    expect(out[0].units?.map((u) => u.asset?.assetTag)).toEqual(["MIC-0042"]);
    expect(out[1].units ?? []).toEqual([]);
  });
});

describe("reconstructUncategorizedProjectGroups", () => {
  it("returns groups with no category, each with its line items", () => {
    const b = bundle({
      groups: [
        d({ id: "g1", organizationId: ORG, projectId: PROJ, title: "Mics", quantity: 1, sortOrder: 1 }),
        d({ id: "g2", organizationId: ORG, projectId: PROJ, categoryId: "c1", title: "InCat", sortOrder: 0 }),
      ],
      lineItems: [li({ id: "li1", groupId: "g1" })],
    });
    const out = reconstructUncategorizedProjectGroups(b);
    expect(out.map((g) => g.id)).toEqual(["g1"]);
    expect(out[0].title).toBe("Mics");
    expect(out[0].lineItems?.map((i) => i.id)).toEqual(["li1"]);
  });
});

describe("reconstructUncategorizedSubHireGroups", () => {
  it("returns uncategorized sub-hire groups with items, subHire + supplier, and line items", () => {
    const b = bundle({
      subHires: [d({ id: "sh1", organizationId: ORG, projectId: PROJ, supplierId: "sup1", createdById: "u1", orderNumber: "SH-1", status: "DRAFT" })],
      subHireGroups: [d({ id: "shg1", subHireId: "sh1", title: "Hired Lights", quantity: 2, cost: 100, charge: 150, sortOrder: 0 })],
      subHireItems: [d({ id: "it1", subHireId: "sh1", groupId: "shg1", description: "Mover", quantity: 4, unitCost: 25, unitCharge: 40 })],
      lineItems: [li({ id: "li1", subHireGroupId: "shg1" })],
      suppliers: [d({ id: "sup1", organizationId: ORG, name: "AVHire Co" })],
    });
    const out = reconstructUncategorizedSubHireGroups(b);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("shg1");
    expect(out[0].subHire.orderNumber).toBe("SH-1");
    expect(out[0].subHire.supplier?.name).toBe("AVHire Co");
    expect(out[0].items?.map((i) => i.id)).toEqual(["it1"]);
    expect(out[0].lineItems?.map((i) => i.id)).toEqual(["li1"]);
  });

  it("excludes categorized sub-hire groups", () => {
    const b = bundle({
      subHires: [d({ id: "sh1", organizationId: ORG, projectId: PROJ, supplierId: "sup1", createdById: "u1", orderNumber: "SH-1", status: "DRAFT" })],
      subHireGroups: [d({ id: "shg1", subHireId: "sh1", title: "Cat'd", sortOrder: 0, targetCategoryId: "c1" })],
    });
    expect(reconstructUncategorizedSubHireGroups(b)).toEqual([]);
  });
});

describe("reconstructProjectCategories", () => {
  it("builds categories with groups, sub-hire targets, direct items, and mixedGroups in slot order", () => {
    const b = bundle({
      categories: [d({ id: "c1", organizationId: ORG, projectId: PROJ, name: "Audio", sortOrder: 0 })],
      groups: [d({ id: "g1", organizationId: ORG, projectId: PROJ, categoryId: "c1", title: "Mics", quantity: 1, sortOrder: 5 })],
      subHires: [d({ id: "sh1", organizationId: ORG, projectId: PROJ, supplierId: "sup1", createdById: "u1", orderNumber: "SH-1", status: "ON_HIRE" })],
      subHireGroups: [d({ id: "shg1", subHireId: "sh1", title: "Hired", sortOrder: 9, targetCategoryId: "c1" })],
      // Slot order: sub-hire group BEFORE the project group despite higher group.sortOrder.
      categorySlots: [
        d({ id: "sl1", projectCategoryId: "c1", projectGroupId: "g1", sortOrder: 2 }),
        d({ id: "sl2", projectCategoryId: "c1", subHireGroupId: "shg1", sortOrder: 1 }),
      ],
      lineItems: [
        li({ id: "liDirect", categoryId: "c1" }),
        li({ id: "liInGroup", groupId: "g1" }),
        li({ id: "liInSHG", subHireGroupId: "shg1" }),
      ],
      suppliers: [d({ id: "sup1", organizationId: ORG, name: "AVHire Co" })],
    });
    const [cat] = reconstructProjectCategories(b);
    expect(cat.id).toBe("c1");
    expect(cat.groups.map((g) => g.id)).toEqual(["g1"]);
    expect(cat.groups[0].lineItems?.map((i) => i.id)).toEqual(["liInGroup"]);
    expect(cat.subHireGroupTargets?.map((s) => s.id)).toEqual(["shg1"]);
    expect(cat.subHireGroupTargets?.[0].lineItems?.map((i) => i.id)).toEqual(["liInSHG"]);
    expect(cat.lineItems?.map((i) => i.id)).toEqual(["liDirect"]);
    // mixedGroups ordered by slot.sortOrder (sub-hire 1, project 2) — the
    // standalone line item has no CategorySlot yet, so it falls back to the
    // large offset + its own sortOrder, landing after both groups.
    expect(cat.mixedGroups).toEqual([
      { kind: "subHire", sortOrder: 1, subHireGroupId: "shg1" },
      { kind: "project", sortOrder: 2, projectGroupId: "g1" },
      { kind: "lineItem", sortOrder: 1_000_000, lineItemId: "liDirect" },
    ]);
  });

  it("keeps a kit-parent line (kitId + groupId) inside its group, not in category-level lineItems", () => {
    // Migrated regression from the deleted project-categories-mixed.int.test: a top-level
    // kit parent (kitId set, NOT a kit child) placed in a group must render inside that
    // group and must NOT leak into the category's direct lineItems bucket.
    const b = bundle({
      categories: [d({ id: "c1", organizationId: ORG, projectId: PROJ, name: "Lighting", sortOrder: 0 })],
      groups: [d({ id: "g1", organizationId: ORG, projectId: PROJ, categoryId: "c1", title: "Rig", quantity: 1, sortOrder: 0 })],
      categorySlots: [d({ id: "sl1", projectCategoryId: "c1", projectGroupId: "g1", sortOrder: 0 })],
      lineItems: [
        li({ id: "kitParent", kitId: "k1", groupId: "g1" }), // kit parent, grouped
        li({ id: "kc", parentLineItemId: "kitParent", isKitChild: true, kitId: "k1", groupId: "g1" }), // its child — excluded
      ],
    });
    const [cat] = reconstructProjectCategories(b);
    expect(cat.groups[0].lineItems?.map((i) => i.id)).toEqual(["kitParent"]);
    expect(cat.lineItems?.map((i) => i.id) ?? []).not.toContain("kitParent");
  });

  it("places a sub-hire-group parent line (subHireGroupId + categoryId) in BOTH buckets, like the server's dual pass", () => {
    const b = bundle({
      categories: [d({ id: "c1", organizationId: ORG, projectId: PROJ, name: "Audio", sortOrder: 0 })],
      subHires: [d({ id: "sh1", organizationId: ORG, projectId: PROJ, supplierId: "sup1", createdById: "u1", orderNumber: "SH-1", status: "ON_HIRE" })],
      subHireGroups: [d({ id: "shg1", subHireId: "sh1", title: "Hired", sortOrder: 0, targetCategoryId: "c1" })],
      // The synthetic sub-hire-group parent carries BOTH subHireGroupId and categoryId.
      lineItems: [li({ id: "shgParent", subHireGroupId: "shg1", categoryId: "c1" })],
      suppliers: [d({ id: "sup1", organizationId: ORG, name: "AVHire Co" })],
    });
    const [cat] = reconstructProjectCategories(b);
    expect(cat.subHireGroupTargets?.[0].lineItems?.map((i) => i.id)).toEqual(["shgParent"]);
    expect(cat.lineItems?.map((i) => i.id)).toEqual(["shgParent"]); // also in the category bucket
  });

  // Migrated from the deleted project-categories-mixed.int.test.ts (Phase 5b): the
  // mixedGroups order falls back to each group's own sortOrder when there's no slot row.
  it("falls back to per-table sortOrder when a group has no CategorySlot row", () => {
    const b = bundle({
      categories: [d({ id: "c1", organizationId: ORG, projectId: PROJ, name: "Audio", sortOrder: 0 })],
      groups: [d({ id: "g1", organizationId: ORG, projectId: PROJ, categoryId: "c1", title: "Mics", quantity: 1, sortOrder: 5 })],
      subHires: [d({ id: "sh1", organizationId: ORG, projectId: PROJ, supplierId: "sup1", createdById: "u1", orderNumber: "SH-1", status: "ON_HIRE" })],
      subHireGroups: [d({ id: "shg1", subHireId: "sh1", title: "Hired", sortOrder: 2, targetCategoryId: "c1" })],
      // No categorySlots — both fall back to their own sortOrder (sub-hire 2, project 5).
      suppliers: [d({ id: "sup1", organizationId: ORG, name: "AVHire Co" })],
    });
    const [cat] = reconstructProjectCategories(b);
    expect(cat.mixedGroups).toEqual([
      { kind: "subHire", sortOrder: 2, subHireGroupId: "shg1" },
      { kind: "project", sortOrder: 5, projectGroupId: "g1" },
    ]);
  });

  // Migrated from the deleted project-categories-mixed.int.test.ts (Phase 5b): a
  // sub-hire group whose targetCategoryId points at another category isn't attached here.
  it("ignores sub-hire groups whose targetCategoryId points elsewhere", () => {
    const b = bundle({
      categories: [
        d({ id: "cA", organizationId: ORG, projectId: PROJ, name: "A", sortOrder: 0 }),
        d({ id: "cB", organizationId: ORG, projectId: PROJ, name: "B", sortOrder: 1 }),
      ],
      subHires: [d({ id: "sh1", organizationId: ORG, projectId: PROJ, supplierId: "sup1", createdById: "u1", orderNumber: "SH-1", status: "ON_HIRE" })],
      subHireGroups: [d({ id: "shg1", subHireId: "sh1", title: "Hired", sortOrder: 0, targetCategoryId: "cB" })],
      suppliers: [d({ id: "sup1", organizationId: ORG, name: "AVHire Co" })],
    });
    const cats = reconstructProjectCategories(b);
    const a = cats.find((c) => c.id === "cA");
    const bCat = cats.find((c) => c.id === "cB");
    expect(a!.subHireGroupTargets ?? []).toHaveLength(0);
    expect(a!.mixedGroups).toHaveLength(0);
    expect(bCat!.subHireGroupTargets?.map((s) => s.id)).toEqual(["shg1"]);
    expect(bCat!.mixedGroups).toEqual([{ kind: "subHire", sortOrder: 0, subHireGroupId: "shg1" }]);
  });
});

describe("reconstructProjectSubHires", () => {
  it("returns summaries with _count.items + supplier, newest first", () => {
    const b = bundle({
      subHires: [
        d({ id: "sh1", organizationId: ORG, projectId: PROJ, supplierId: "sup1", createdById: "u1", orderNumber: "SH-1", status: "DRAFT", totalCost: 10, totalCharge: 20, createdAt: 100 }),
        d({ id: "sh2", organizationId: ORG, projectId: PROJ, supplierId: "sup1", createdById: "u1", orderNumber: "SH-2", status: "ON_HIRE", createdAt: 200 }),
      ],
      subHireItems: [
        d({ id: "it1", subHireId: "sh1", description: "x", quantity: 1 }),
        d({ id: "it2", subHireId: "sh1", description: "y", quantity: 1 }),
      ],
      suppliers: [d({ id: "sup1", organizationId: ORG, name: "AVHire Co" })],
    });
    const out = reconstructProjectSubHires(b);
    expect(out.map((s) => s.id)).toEqual(["sh2", "sh1"]); // createdAt desc
    expect(out.find((s) => s.id === "sh1")?._count.items).toBe(2);
    expect(out[0].supplier?.name).toBe("AVHire Co");
  });
});

describe("reconstructOverbookedRecord", () => {
  const WIN_START = new Date("2026-01-01T00:00:00Z");
  const WIN_END = new Date("2026-01-10T00:00:00Z");

  it("returns {} with no overbooking bundle", () => {
    expect(reconstructOverbookedRecord(EMPTY, undefined, WIN_START, WIN_END, PROJ)).toEqual({});
  });

  it("flags an overbooked model (flat kit-child input — books 3 of stock 2)", () => {
    const b = bundle({ lineItems: [li({ id: "li1", modelId: "m1", quantity: 3 })] });
    const ob: OverbookingBundleData = {
      lineItems: [d({ id: "li1", organizationId: ORG, projectId: PROJ, modelId: "m1", quantity: 3, status: "QUOTED" })],
      assets: [d({ id: "a1", organizationId: ORG, modelId: "m1", status: "AVAILABLE", isActive: true }), d({ id: "a2", organizationId: ORG, modelId: "m1", status: "AVAILABLE", isActive: true })],
      bulkAssets: [],
      projects: [d({ id: PROJ, organizationId: ORG, projectNumber: "P-1", name: "Gig", status: "CONFIRMED", isTemplate: false, rentalStartDate: WIN_START.getTime(), rentalEndDate: WIN_END.getTime() })],
      models: [d({ id: "m1", organizationId: ORG, assetType: "SERIALIZED" })],
    } as never;
    const rec = reconstructOverbookedRecord(b, ob, WIN_START, WIN_END, PROJ);
    expect(rec["li1"]).toMatchObject({ overBy: 1 });
  });
});
