import { describe, it, expect } from "vitest";
import {
  accessoryGroupKey,
  aggregateAccessoryTotals,
  distributeReturn,
  type AccessoryChildInput,
} from "@/lib/bulk-checkin";

function bulkChild(over: Partial<AccessoryChildInput> & { lineItemId: string; bulkAssetId: string }): AccessoryChildInput {
  return {
    modelId: "clamp-model",
    modelName: "Clamp",
    modelNumber: "C-1",
    assetId: null,
    sortOrder: 0,
    outstanding: 1,
    ...over,
  };
}

function serialChild(over: Partial<AccessoryChildInput> & { lineItemId: string; assetId: string }): AccessoryChildInput {
  return {
    modelId: "truecon-model",
    modelName: "TrueCon",
    modelNumber: "T-1",
    bulkAssetId: null,
    sortOrder: 0,
    outstanding: 1,
    ...over,
  };
}

describe("accessoryGroupKey", () => {
  it("groups bulk accessories by bulkAssetId", () => {
    expect(accessoryGroupKey(bulkChild({ lineItemId: "a", bulkAssetId: "clamp" }))).toBe("bulk:clamp");
  });
  it("groups serialised accessories by modelId", () => {
    expect(accessoryGroupKey(serialChild({ lineItemId: "a", assetId: "tc1", modelId: "tc-model" }))).toBe("serial:tc-model");
  });
  it("returns null for an unaggregatable child", () => {
    expect(accessoryGroupKey({ ...serialChild({ lineItemId: "a", assetId: "x" }), assetId: null, modelId: null })).toBeNull();
  });
});

describe("aggregateAccessoryTotals", () => {
  it("sums bulk accessories of the same identity across multiple parents", () => {
    // Two lights, each shipping a bulk clamp child of qty 2 → 100-style total.
    const totals = aggregateAccessoryTotals([
      bulkChild({ lineItemId: "c1", bulkAssetId: "clamp", outstanding: 2 }),
      bulkChild({ lineItemId: "c2", bulkAssetId: "clamp", outstanding: 2 }),
      bulkChild({ lineItemId: "c3", bulkAssetId: "clamp", outstanding: 1 }),
    ]);
    expect(totals).toHaveLength(1);
    expect(totals[0]).toMatchObject({ key: "bulk:clamp", kind: "BULK", totalDue: 5, childCount: 3, label: "Clamp" });
  });

  it("aggregates serialised accessories by model into one total", () => {
    const totals = aggregateAccessoryTotals([
      serialChild({ lineItemId: "s1", assetId: "tc1", modelId: "tc" }),
      serialChild({ lineItemId: "s2", assetId: "tc2", modelId: "tc" }),
      serialChild({ lineItemId: "s3", assetId: "tc3", modelId: "tc" }),
    ]);
    expect(totals).toHaveLength(1);
    expect(totals[0]).toMatchObject({ key: "serial:tc", kind: "SERIALIZED", totalDue: 3, childCount: 3 });
  });

  it("excludes fully-returned children (outstanding 0)", () => {
    const totals = aggregateAccessoryTotals([
      bulkChild({ lineItemId: "c1", bulkAssetId: "clamp", outstanding: 0 }),
      bulkChild({ lineItemId: "c2", bulkAssetId: "clamp", outstanding: 3 }),
    ]);
    expect(totals).toHaveLength(1);
    expect(totals[0].totalDue).toBe(3);
  });

  it("returns deterministic order across mixed identities", () => {
    const totals = aggregateAccessoryTotals([
      bulkChild({ lineItemId: "c1", bulkAssetId: "zclamp", modelName: "Z-Clamp", outstanding: 1 }),
      bulkChild({ lineItemId: "c2", bulkAssetId: "aclamp", modelName: "A-Clamp", outstanding: 1 }),
      serialChild({ lineItemId: "s1", assetId: "tc1", modelId: "tc", modelName: "TrueCon" }),
    ]);
    // BULK rows (sorted by label) before SERIALIZED.
    expect(totals.map((t) => t.key)).toEqual(["bulk:aclamp", "bulk:zclamp", "serial:tc"]);
  });
});

describe("distributeReturn", () => {
  const children = [
    bulkChild({ lineItemId: "c1", bulkAssetId: "clamp", sortOrder: 0, outstanding: 2 }),
    bulkChild({ lineItemId: "c2", bulkAssetId: "clamp", sortOrder: 1, outstanding: 2 }),
    bulkChild({ lineItemId: "c3", bulkAssetId: "clamp", sortOrder: 2, outstanding: 2 }),
  ];

  it("fills children in order, partially returning across the boundary", () => {
    const { allocations, distributed } = distributeReturn(children, 3);
    expect(distributed).toBe(3);
    expect(allocations).toEqual([
      { lineItemId: "c1", assetId: null, bulkAssetId: "clamp", quantity: 2 },
      { lineItemId: "c2", assetId: null, bulkAssetId: "clamp", quantity: 1 },
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
    expect(distributed).toBe(6); // distributed < requested ⇒ caller rejects
  });

  it("is a no-op for zero / negative quantity", () => {
    expect(distributeReturn(children, 0)).toEqual({ allocations: [], distributed: 0, requested: 0 });
    expect(distributeReturn(children, -5)).toEqual({ allocations: [], distributed: 0, requested: 0 });
  });

  it("is deterministic regardless of input order (sorts by sortOrder, then id)", () => {
    const shuffled = [children[2], children[0], children[1]];
    expect(distributeReturn(shuffled, 3)).toEqual(distributeReturn(children, 3));
  });
});
