import { describe, it, expect } from "vitest";
import {
  itemGroupKey,
  aggregateCheckInTotals,
  distributeReturn,
  type CheckInItem,
  type CheckInItemType,
} from "@/lib/bulk-checkin";

function accessoryBulkChild(over: Partial<CheckInItem> & { lineItemId: string; bulkAssetId: string }): CheckInItem {
  return {
    modelId: "clamp-model",
    modelName: "Clamp",
    modelNumber: "C-1",
    assetId: null,
    subHireId: null,
    isCustomItem: false,
    childKind: "ACCESSORY",
    sortOrder: 0,
    outstanding: 1,
    itemType: "ACCESSORY",
    ...over,
  };
}

function accessorySerialChild(over: Partial<CheckInItem> & { lineItemId: string; assetId: string }): CheckInItem {
  return {
    modelId: "truecon-model",
    modelName: "TrueCon",
    modelNumber: "T-1",
    bulkAssetId: null,
    subHireId: null,
    isCustomItem: false,
    childKind: "ACCESSORY",
    sortOrder: 0,
    outstanding: 1,
    itemType: "ACCESSORY",
    ...over,
  };
}

function ownedSerialisedItem(over: Partial<CheckInItem> & { lineItemId: string; assetId: string }): CheckInItem {
  return {
    modelId: "fixture-model",
    modelName: "Moving Light",
    modelNumber: "ML-1",
    bulkAssetId: null,
    subHireId: null,
    isCustomItem: false,
    childKind: null,
    sortOrder: 0,
    outstanding: 1,
    itemType: "OWNED_SERIALISED",
    ...over,
  };
}

function ownedBulkItem(over: Partial<CheckInItem> & { lineItemId: string; bulkAssetId: string }): CheckInItem {
  return {
    modelId: "truss-model",
    modelName: "Truss Section",
    modelNumber: "TS-1",
    assetId: null,
    subHireId: null,
    isCustomItem: false,
    childKind: null,
    sortOrder: 0,
    outstanding: 5,
    itemType: "OWNED_BULK",
    ...over,
  };
}

function subHireItem(over: Partial<CheckInItem> & { lineItemId: string; subHireId: string }): CheckInItem {
  return {
    modelId: "gen-model",
    modelName: "Generator",
    modelNumber: "GEN-1",
    assetId: null,
    bulkAssetId: null,
    isCustomItem: false,
    childKind: null,
    sortOrder: 0,
    outstanding: 1,
    itemType: "SUBHIRE",
    ...over,
  };
}

function customItem(over: Partial<CheckInItem> & { lineItemId: string }): CheckInItem {
  return {
    modelId: null,
    modelName: "Custom Cable",
    modelNumber: null,
    assetId: null,
    bulkAssetId: null,
    subHireId: null,
    isCustomItem: true,
    childKind: null,
    sortOrder: 0,
    outstanding: 1,
    itemType: "CUSTOM",
    ...over,
  };
}

describe("itemGroupKey", () => {
  it("groups bulk accessories by bulkAssetId", () => {
    expect(itemGroupKey(accessoryBulkChild({ lineItemId: "a", bulkAssetId: "clamp" }))).toBe("bulk:clamp");
  });
  it("groups serialised accessories by modelId", () => {
    expect(itemGroupKey(accessorySerialChild({ lineItemId: "a", assetId: "tc1", modelId: "tc-model" }))).toBe("serial:tc-model");
  });
  it("groups owned serialised items by assetId", () => {
    expect(itemGroupKey(ownedSerialisedItem({ lineItemId: "s1", assetId: "asset-1" }))).toBe("asset:asset-1");
  });
  it("groups owned bulk items by bulkAssetId", () => {
    expect(itemGroupKey(ownedBulkItem({ lineItemId: "b1", bulkAssetId: "truss-1" }))).toBe("bulk:truss-1");
  });
  it("groups sub-hire items by lineItemId", () => {
    expect(itemGroupKey(subHireItem({ lineItemId: "sh1", subHireId: "sub-1" }))).toBe("subhire:sh1");
  });
  it("groups custom items by lineItemId", () => {
    expect(itemGroupKey(customItem({ lineItemId: "c1" }))).toBe("custom:c1");
  });
  it("returns null for an item that can't be aggregated", () => {
    const item: CheckInItem = {
      lineItemId: "x",
      modelId: null,
      modelName: null,
      modelNumber: null,
      assetId: null,
      bulkAssetId: null,
      subHireId: null,
      isCustomItem: false,
      childKind: null,
      sortOrder: 0,
      outstanding: 0,
      itemType: "OWNED_SERIALISED",
    };
    expect(itemGroupKey(item)).toBeNull();
  });
});

describe("aggregateCheckInTotals", () => {
  it("sums bulk accessories of the same identity across multiple parents", () => {
    const totals = aggregateCheckInTotals([
      accessoryBulkChild({ lineItemId: "c1", bulkAssetId: "clamp", outstanding: 2 }),
      accessoryBulkChild({ lineItemId: "c2", bulkAssetId: "clamp", outstanding: 2 }),
      accessoryBulkChild({ lineItemId: "c3", bulkAssetId: "clamp", outstanding: 1 }),
    ]);
    expect(totals).toHaveLength(1);
    expect(totals[0]).toMatchObject({ key: "bulk:clamp", kind: "BULK", itemType: "ACCESSORY", totalDue: 5, childCount: 3, label: "Clamp" });
  });

  it("aggregates serialised accessories by model into one total", () => {
    const totals = aggregateCheckInTotals([
      accessorySerialChild({ lineItemId: "s1", assetId: "tc1", modelId: "tc" }),
      accessorySerialChild({ lineItemId: "s2", assetId: "tc2", modelId: "tc" }),
      accessorySerialChild({ lineItemId: "s3", assetId: "tc3", modelId: "tc" }),
    ]);
    expect(totals).toHaveLength(1);
    expect(totals[0]).toMatchObject({ key: "serial:tc", kind: "SERIALIZED", itemType: "ACCESSORY", totalDue: 3, childCount: 3 });
  });

  it("aggregates owned bulk items of the same bulkAssetId into one total", () => {
    const totals = aggregateCheckInTotals([
      ownedBulkItem({ lineItemId: "b1", bulkAssetId: "truss", outstanding: 3 }),
      ownedBulkItem({ lineItemId: "b2", bulkAssetId: "truss", outstanding: 2 }),
    ]);
    expect(totals).toHaveLength(1);
    expect(totals[0]).toMatchObject({ key: "bulk:truss", kind: "BULK", itemType: "OWNED_BULK", totalDue: 5, childCount: 2 });
  });

  it("keeps owned serialised items as separate totals (unique per asset)", () => {
    const totals = aggregateCheckInTotals([
      ownedSerialisedItem({ lineItemId: "s1", assetId: "a1", modelName: "Light A" }),
      ownedSerialisedItem({ lineItemId: "s2", assetId: "a2", modelName: "Light B" }),
    ]);
    expect(totals).toHaveLength(2);
    expect(totals[0]).toMatchObject({ key: "asset:a1", kind: "SERIALIZED", itemType: "OWNED_SERIALISED", totalDue: 1, childCount: 1 });
    expect(totals[1]).toMatchObject({ key: "asset:a2", kind: "SERIALIZED", itemType: "OWNED_SERIALISED", totalDue: 1, childCount: 1 });
  });

  it("keeps sub-hire items as separate totals (unique per lineItemId)", () => {
    const totals = aggregateCheckInTotals([
      subHireItem({ lineItemId: "sh1", subHireId: "sub1" }),
      subHireItem({ lineItemId: "sh2", subHireId: "sub2" }),
    ]);
    expect(totals).toHaveLength(2);
    expect(totals[0]).toMatchObject({ key: "subhire:sh1", kind: "SERIALIZED", itemType: "SUBHIRE", totalDue: 1, childCount: 1 });
    expect(totals[1]).toMatchObject({ key: "subhire:sh2", kind: "SERIALIZED", itemType: "SUBHIRE", totalDue: 1, childCount: 1 });
  });

  it("keeps custom items as separate totals (unique per lineItemId)", () => {
    const totals = aggregateCheckInTotals([
      customItem({ lineItemId: "c2", modelName: "Custom Rig" }),
      customItem({ lineItemId: "c1", modelName: "Custom Stage" }),
    ]);
    expect(totals).toHaveLength(2);
    expect(totals[0]).toMatchObject({ key: "custom:c2", kind: "SERIALIZED", itemType: "CUSTOM", totalDue: 1, childCount: 1 });
    expect(totals[1]).toMatchObject({ key: "custom:c1", kind: "SERIALIZED", itemType: "CUSTOM", totalDue: 1, childCount: 1 });
  });

  it("excludes fully-returned children (outstanding 0)", () => {
    const totals = aggregateCheckInTotals([
      accessoryBulkChild({ lineItemId: "c1", bulkAssetId: "clamp", outstanding: 0 }),
      accessoryBulkChild({ lineItemId: "c2", bulkAssetId: "clamp", outstanding: 3 }),
    ]);
    expect(totals).toHaveLength(1);
    expect(totals[0].totalDue).toBe(3);
  });

  it("returns deterministic order across mixed identities", () => {
    const totals = aggregateCheckInTotals([
      accessoryBulkChild({ lineItemId: "c1", bulkAssetId: "zclamp", modelName: "Z-Clamp", outstanding: 1 }),
      accessoryBulkChild({ lineItemId: "c2", bulkAssetId: "aclamp", modelName: "A-Clamp", outstanding: 1 }),
      accessorySerialChild({ lineItemId: "s1", assetId: "tc1", modelId: "tc", modelName: "TrueCon" }),
    ]);
    expect(totals.map((t) => t.key)).toEqual(["bulk:aclamp", "bulk:zclamp", "serial:tc"]);
  });

  it("handles mixed item types in the same list", () => {
    const totals = aggregateCheckInTotals([
      accessoryBulkChild({ lineItemId: "c1", bulkAssetId: "clamp", outstanding: 2 }),
      ownedSerialisedItem({ lineItemId: "s1", assetId: "a1", outstanding: 1 }),
      subHireItem({ lineItemId: "sh1", subHireId: "sub1", outstanding: 1 }),
    ]);
    expect(totals).toHaveLength(3);
  });
});

describe("distributeReturn", () => {
  const children = [
    accessoryBulkChild({ lineItemId: "c1", bulkAssetId: "clamp", sortOrder: 0, outstanding: 2 }),
    accessoryBulkChild({ lineItemId: "c2", bulkAssetId: "clamp", sortOrder: 1, outstanding: 2 }),
    accessoryBulkChild({ lineItemId: "c3", bulkAssetId: "clamp", sortOrder: 2, outstanding: 2 }),
  ];

  it("fills children in order, partially returning across the boundary", () => {
    const { allocations, distributed } = distributeReturn(children, 3);
    expect(distributed).toBe(3);
    expect(allocations).toEqual([
      { lineItemId: "c1", assetId: null, bulkAssetId: "clamp", itemType: "ACCESSORY", quantity: 2 },
      { lineItemId: "c2", assetId: null, bulkAssetId: "clamp", itemType: "ACCESSORY", quantity: 1 },
    ]);
  });

  it("distributes the full outstanding when asked for exactly the total", () => {
    const { allocations, distributed } = distributeReturn(children, 6);
    expect(distributed).toBe(6);
    expect(allocations.map((a) => a.quantity)).toEqual([2, 2, 2]);
  });

  it("caps distribution at the outstanding total (over-return is detectable)", () => {
    const { distributed, requested } = distributeReturn(children, 10);
    expect(requested).toBe(10);
    expect(distributed).toBe(6);
  });

  it("is a no-op for zero / negative quantity", () => {
    expect(distributeReturn(children, 0)).toEqual({ allocations: [], distributed: 0, requested: 0 });
    expect(distributeReturn(children, -5)).toEqual({ allocations: [], distributed: 0, requested: 0 });
  });

  it("is deterministic regardless of input order (sorts by sortOrder, then id)", () => {
    const shuffled = [children[2], children[0], children[1]];
    expect(distributeReturn(shuffled, 3)).toEqual(distributeReturn(children, 3));
  });

  it("carries itemType through to allocations", () => {
    const items = [
      ownedSerialisedItem({ lineItemId: "s1", assetId: "a1", sortOrder: 0, outstanding: 1 }),
    ];
    const { allocations } = distributeReturn(items, 1);
    expect(allocations[0].itemType).toBe("OWNED_SERIALISED");
  });
});
