import { describe, it, expect } from "vitest";
import { keysForRowIds, prepSelectionInfo } from "./warehouse-job-keys";
import type { LineItem } from "@/components/warehouse/warehouse-types";

const li = (over: Partial<LineItem>): LineItem => ({
  id: "l1", type: "EQUIPMENT", status: "CONFIRMED", quantity: 1, checkedOutQuantity: 0, returnedQuantity: 0, description: null,
  modelId: "m", assetId: "a", bulkAssetId: null, kitId: null, isKitChild: false, parentLineItemId: null,
  model: { name: "SM58" }, asset: null, bulkAsset: null, kit: null, prepStatus: null, prepContainer: null,
  isContainerLineItem: false, isCustomItem: false, subHireId: null, supplier: null, ...over,
}) as LineItem;

describe("keysForRowIds", () => {
  it("a serialised line keeps its bare id", () => {
    expect(keysForRowIds([li({})], ["l1"], "pick")).toEqual(["l1"]);
  });
  it("a bulk line expands to id:i per unit still in the stage", () => {
    const unit = { id: "u", ordinal: 0, assetId: null, bulkAssetId: "b", quantity: 4, status: "CONFIRMED", prepStatus: "PACKED", containerId: null, asset: null, bulkAsset: null };
    const bulk = li({ id: "b1", assetId: null, quantity: 10, bulkAssetId: "b", units: [unit] });
    expect(keysForRowIds([bulk], ["b1"], "pick")).toEqual(["b1:0", "b1:1", "b1:2", "b1:3", "b1:4", "b1:5"]);
    expect(keysForRowIds([bulk], ["b1"], "prepped")).toHaveLength(4);
  });
  it("an unknown id passes through", () => {
    expect(keysForRowIds([], ["x"], "pick")).toEqual(["x"]);
  });
});

describe("prepSelectionInfo", () => {
  const acc = li({ id: "acc", childKind: "ACCESSORY", isKitChild: true, parentLineItemId: "p" });
  it("counts parent units and accessories still to pack", () => {
    const parent = li({ id: "p", childLineItems: [acc] });
    expect(prepSelectionInfo([parent], ["p"])).toEqual({ count: 1, parentUnits: 1, packedParents: 0, accessoryLines: 1 });
  });
  it("a packed parent leaves only its accessories", () => {
    const parent = li({ id: "p", prepStatus: "PACKED", childLineItems: [acc] });
    expect(prepSelectionInfo([parent], ["p"])).toEqual({ count: 1, parentUnits: 0, packedParents: 1, accessoryLines: 1 });
  });
});
