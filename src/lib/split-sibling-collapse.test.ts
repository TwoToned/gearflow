/**
 * Pure-helper tests for the split-sibling collapse plan. No Prisma —
 * the script's DB side is covered by an integration test.
 */

import { describe, it, expect } from "vitest";
import {
  equivalenceKey,
  pickCanonical,
  planGroup,
  planAll,
  type CollapseRow,
} from "./split-sibling-collapse";

function row(over: Partial<CollapseRow>): CollapseRow {
  return {
    id: "li-1",
    organizationId: "org-1",
    projectId: "proj-1",
    type: "EQUIPMENT",
    modelId: "model-1",
    assetId: "asset-1",
    bulkAssetId: null,
    kitId: null,
    isKitChild: false,
    parentLineItemId: null,
    pricingMode: null,
    description: null,
    quantity: 1,
    unitPrice: "100.00",
    pricingType: "PER_DAY",
    duration: 1,
    discount: null,
    priceOverridden: false,
    overrideReason: null,
    sortOrder: 0,
    groupName: null,
    categoryId: null,
    groupId: null,
    notes: null,
    isOptional: false,
    isContainerLineItem: false,
    isCustomItem: false,
    showSubhireOnDocs: false,
    supplierId: null,
    subhireOrderNumber: null,
    supplierOrderId: null,
    subHireId: null,
    subHireItemId: null,
    subHireGroupId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

describe("equivalenceKey", () => {
  it("two split siblings (same line, different assets) share a key", () => {
    const a = row({ id: "a", assetId: "asset-A" });
    const b = row({ id: "b", assetId: "asset-B" });
    expect(equivalenceKey(a)).toBe(equivalenceKey(b));
  });

  it("normalises decimal precision — 100 == 100.00 == 100.000", () => {
    const a = row({ unitPrice: "100" });
    const b = row({ unitPrice: "100.00" });
    const c = row({ unitPrice: 100 });
    expect(equivalenceKey(a)).toBe(equivalenceKey(b));
    expect(equivalenceKey(b)).toBe(equivalenceKey(c));
  });

  it("different unitPrice ⇒ different key (don't merge)", () => {
    const a = row({ unitPrice: "100.00" });
    const b = row({ unitPrice: "150.00" });
    expect(equivalenceKey(a)).not.toBe(equivalenceKey(b));
  });

  it.each([
    ["description", "stage", "FOH"],
    ["notes", "matched pair", null],
    ["groupName", "Mics", "Backline"],
    ["groupId", "g-1", "g-2"],
    ["categoryId", "c-1", null],
    ["pricingType", "PER_DAY", "PER_WEEK"],
    ["duration", 1, 3],
    ["isOptional", true, false],
    ["isContainerLineItem", true, false],
    ["isCustomItem", true, false],
    ["supplierId", "s-1", null],
    ["subhireOrderNumber", "SO-1", null],
    ["subHireId", "sh-1", null],
    ["priceOverridden", true, false],
    ["overrideReason", "season discount", null],
    ["showSubhireOnDocs", true, false],
  ] as const)("differing %s splits the key", (field, a, b) => {
    const ra = row({ [field]: a } as Partial<CollapseRow>);
    const rb = row({ [field]: b } as Partial<CollapseRow>);
    expect(equivalenceKey(ra)).not.toBe(equivalenceKey(rb));
  });

  it("ignores fields that are EXPECTED to differ across siblings", () => {
    // assetId, quantity, sortOrder, createdAt — each sibling has its own.
    const a = row({
      id: "a",
      assetId: "X",
      quantity: 1,
      sortOrder: 0,
      createdAt: new Date("2026-01-01"),
    });
    const b = row({
      id: "b",
      assetId: "Y",
      quantity: 1,
      sortOrder: 5,
      createdAt: new Date("2026-02-01"),
    });
    expect(equivalenceKey(a)).toBe(equivalenceKey(b));
  });
});

describe("pickCanonical", () => {
  it("picks smallest sortOrder", () => {
    const a = row({ id: "a", sortOrder: 5 });
    const b = row({ id: "b", sortOrder: 1 });
    const c = row({ id: "c", sortOrder: 3 });
    expect(pickCanonical([a, b, c]).id).toBe("b");
  });

  it("breaks sortOrder ties with oldest createdAt", () => {
    const a = row({ id: "a", sortOrder: 0, createdAt: new Date("2026-02-01") });
    const b = row({ id: "b", sortOrder: 0, createdAt: new Date("2026-01-01") });
    expect(pickCanonical([a, b]).id).toBe("b");
  });

  it("breaks all ties with lexicographic id (stable)", () => {
    const ts = new Date("2026-01-01");
    const a = row({ id: "li-zzz", sortOrder: 0, createdAt: ts });
    const b = row({ id: "li-aaa", sortOrder: 0, createdAt: ts });
    expect(pickCanonical([a, b]).id).toBe("li-aaa");
  });
});

describe("planGroup", () => {
  it("plans a clean 3-way split — canonical + two moves", () => {
    const a = row({ id: "a", assetId: "X", sortOrder: 0 });
    const b = row({ id: "b", assetId: "Y", sortOrder: 1 });
    const c = row({ id: "c", assetId: "Z", sortOrder: 2 });
    const plan = planGroup([a, b, c]);
    expect(plan.flags).toEqual([]);
    expect(plan.canonicalId).toBe("a");
    expect(plan.moves.map((m) => m.siblingId).sort()).toEqual(["b", "c"]);
  });

  it("flags a row with no asset assigned (not a split sibling)", () => {
    const a = row({ id: "a", assetId: "X" });
    const b = row({ id: "b", assetId: null, bulkAssetId: null });
    const plan = planGroup([a, b]);
    expect(plan.flags).toContain("row-without-asset-or-bulk");
    expect(plan.moves).toEqual([]);
  });

  it("flags duplicate assetId across siblings (schema-impossible but defensive)", () => {
    const a = row({ id: "a", assetId: "X" });
    const b = row({ id: "b", assetId: "X" });
    const plan = planGroup([a, b]);
    expect(plan.flags.some((f) => f.startsWith("duplicate-asset-"))).toBe(true);
    expect(plan.moves).toEqual([]);
  });

  it("flags kit children — they're never merged", () => {
    const a = row({ id: "a", assetId: "X", isKitChild: true, kitId: "k-1" });
    const b = row({ id: "b", assetId: "Y", isKitChild: true, kitId: "k-1" });
    const plan = planGroup([a, b]);
    expect(plan.flags).toContain("kit-children-in-group");
    expect(plan.moves).toEqual([]);
  });

  it("supports bulk-asset siblings", () => {
    const a = row({
      id: "a",
      assetId: null,
      bulkAssetId: "bulk-1",
      quantity: 3,
      sortOrder: 0,
    });
    const b = row({
      id: "b",
      assetId: null,
      bulkAssetId: "bulk-2",
      quantity: 5,
      sortOrder: 1,
    });
    const plan = planGroup([a, b]);
    expect(plan.flags).toEqual([]);
    expect(plan.canonicalId).toBe("a");
    expect(plan.moves[0]).toMatchObject({
      siblingId: "b",
      bulkAssetId: "bulk-2",
      quantity: 5,
    });
  });
});

describe("planAll", () => {
  it("buckets by key, drops singletons, plans groups", () => {
    const mergeable1 = row({ id: "m1", assetId: "X", description: "stage" });
    const mergeable2 = row({ id: "m2", assetId: "Y", description: "stage" });
    const mergeable3 = row({ id: "m3", assetId: "Z", description: "stage" });
    const different = row({ id: "d1", assetId: "Q", description: "FOH" });
    const plans = planAll([mergeable1, mergeable2, mergeable3, different]);
    expect(plans).toHaveLength(1);
    expect(plans[0].moves).toHaveLength(2);
  });

  it("emits one plan per equivalence group when there are several", () => {
    const stageA = row({ id: "sa", assetId: "X", description: "stage" });
    const stageB = row({ id: "sb", assetId: "Y", description: "stage" });
    const fohA = row({ id: "fa", assetId: "P", description: "FOH" });
    const fohB = row({ id: "fb", assetId: "Q", description: "FOH" });
    const plans = planAll([stageA, stageB, fohA, fohB]);
    expect(plans).toHaveLength(2);
  });

  it("returns flagged groups too, with empty moves", () => {
    const a = row({ id: "a", assetId: "X" });
    const b = row({ id: "b", assetId: "X" }); // duplicate asset
    const plans = planAll([a, b]);
    expect(plans).toHaveLength(1);
    expect(plans[0].moves).toEqual([]);
    expect(plans[0].flags.length).toBeGreaterThan(0);
  });
});
