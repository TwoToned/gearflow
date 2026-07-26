import { describe, it, expect } from "vitest";
import {
  itemGroupKey,
  aggregateCheckInTotals,
  distributeReturn,
  scopedGroupKey,
  type CheckInItem,
} from "./bulkCheckin";

/**
 * Parity suite for the Convex copy of the bulk-check-in engine (issue #944 WS5) —
 * mirrors src/lib/bulk-checkin.test.ts's fixtures/cases so both copies (Convex
 * can't import from src/, see the file-header note in bulkCheckin.ts) stay
 * behaviourally identical. `scopedGroupKey` is new here — it doesn't exist in the
 * src/ copy since only the returns station's org-wide (multi-project) resolution
 * needs project-scoped keys.
 */

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

describe("bulkCheckin.itemGroupKey (Convex copy parity)", () => {
  it("groups owned bulk items by bulkAssetId", () => {
    const item = ownedBulkItem({ lineItemId: "l1", bulkAssetId: "truss-1" });
    expect(itemGroupKey(item)).toBe("bulk:truss-1");
  });

  it("groups owned serialised items by assetId", () => {
    const item = ownedSerialisedItem({ lineItemId: "l2", assetId: "asset-1" });
    expect(itemGroupKey(item)).toBe("asset:asset-1");
  });
});

describe("bulkCheckin.aggregateCheckInTotals (Convex copy parity — port of src/lib/bulk-checkin.ts)", () => {
  it("sums owned bulk items sharing a bulkAssetId into one total", () => {
    const items = [
      ownedBulkItem({ lineItemId: "l1", bulkAssetId: "truss-1", outstanding: 3 }),
      ownedBulkItem({ lineItemId: "l2", bulkAssetId: "truss-1", outstanding: 2 }),
    ];
    const totals = aggregateCheckInTotals(items);
    expect(totals).toHaveLength(1);
    expect(totals[0]).toMatchObject({ key: "bulk:truss-1", totalDue: 5, childCount: 2, kind: "BULK" });
  });

  it("keeps owned-serialised items separate (one total per assetId)", () => {
    const items = [
      ownedSerialisedItem({ lineItemId: "l1", assetId: "a1" }),
      ownedSerialisedItem({ lineItemId: "l2", assetId: "a2" }),
    ];
    const totals = aggregateCheckInTotals(items);
    expect(totals).toHaveLength(2);
    expect(totals.map((t) => t.key).sort()).toEqual(["asset:a1", "asset:a2"]);
  });

  it("excludes fully-returned children (outstanding: 0)", () => {
    const items = [
      ownedBulkItem({ lineItemId: "l1", bulkAssetId: "truss-1", outstanding: 0 }),
      ownedBulkItem({ lineItemId: "l2", bulkAssetId: "truss-1", outstanding: 4 }),
    ];
    const totals = aggregateCheckInTotals(items);
    expect(totals).toHaveLength(1);
    expect(totals[0].totalDue).toBe(4);
  });

  it("sorts deterministically by kind then label then key", () => {
    const items = [
      ownedBulkItem({ lineItemId: "l1", bulkAssetId: "zclamp", modelName: "Z Clamp" }),
      ownedBulkItem({ lineItemId: "l2", bulkAssetId: "aclamp", modelName: "A Clamp" }),
      ownedSerialisedItem({ lineItemId: "l3", assetId: "tc" }),
    ];
    const totals = aggregateCheckInTotals(items);
    expect(totals.map((t) => t.key)).toEqual(["bulk:aclamp", "bulk:zclamp", "asset:tc"]);
  });
});

describe("bulkCheckin.distributeReturn (Convex copy parity)", () => {
  const children: CheckInItem[] = [
    ownedBulkItem({ lineItemId: "c1", bulkAssetId: "clamp", outstanding: 2, sortOrder: 0 }),
    ownedBulkItem({ lineItemId: "c2", bulkAssetId: "clamp", outstanding: 2, sortOrder: 1 }),
    ownedBulkItem({ lineItemId: "c3", bulkAssetId: "clamp", outstanding: 2, sortOrder: 2 }),
  ];

  it("fills children in sortOrder, splitting across the boundary", () => {
    const result = distributeReturn(children, 3);
    expect(result.distributed).toBe(3);
    expect(result.allocations).toEqual([
      { lineItemId: "c1", assetId: null, bulkAssetId: "clamp", itemType: "OWNED_BULK", quantity: 2 },
      { lineItemId: "c2", assetId: null, bulkAssetId: "clamp", itemType: "OWNED_BULK", quantity: 1 },
    ]);
  });

  it("caps distribution at the outstanding total when over-requested", () => {
    const result = distributeReturn(children, 10);
    expect(result.requested).toBe(10);
    expect(result.distributed).toBe(6);
  });

  it("is a no-op for zero/negative quantity", () => {
    expect(distributeReturn(children, 0)).toEqual({ allocations: [], distributed: 0, requested: 0 });
    expect(distributeReturn(children, -5)).toEqual({ allocations: [], distributed: 0, requested: 0 });
  });
});

describe("bulkCheckin.scopedGroupKey (new — org-wide multi-project resolution)", () => {
  it("prefixes the bare group key with the owning project id", () => {
    const item = ownedBulkItem({ lineItemId: "l1", bulkAssetId: "truss-1" });
    expect(scopedGroupKey("proj-a", item)).toBe("proj-a::bulk:truss-1");
    expect(scopedGroupKey("proj-b", item)).toBe("proj-b::bulk:truss-1");
  });

  it("keeps two projects' identical bare keys distinct (no cross-project merge)", () => {
    const item = ownedBulkItem({ lineItemId: "l1", bulkAssetId: "truss-1" });
    expect(scopedGroupKey("proj-a", item)).not.toBe(scopedGroupKey("proj-b", item));
  });

  it("returns null when the underlying itemGroupKey is ungroupable", () => {
    const ungroupable: CheckInItem = {
      lineItemId: "l1", modelId: null, modelName: null, modelNumber: null,
      assetId: null, bulkAssetId: null, subHireId: null, isCustomItem: false,
      childKind: null, sortOrder: 0, outstanding: 1, itemType: "OWNED_SERIALISED",
    };
    expect(scopedGroupKey("proj-a", ungroupable)).toBeNull();
  });
});
