import { describe, test, expect } from "vitest";
import {
  groupItems,
  groupCheckinItems,
  selectionKeysForEntries,
  accessoryAssetIds,
  accessoryChildrenForStage,
  isAccessoryParentPartiallyDeployed,
  bulkUnitKey,
  type LineItem,
} from "./warehouse-types";

function line(o: Partial<LineItem>): LineItem {
  return {
    id: "li", type: "EQUIPMENT", status: "CONFIRMED", quantity: 1, checkedOutQuantity: 0, returnedQuantity: 0,
    description: null, modelId: null, assetId: null, bulkAssetId: null, kitId: null, isKitChild: false,
    childKind: null, parentLineItemId: null, model: null, asset: null, bulkAsset: null, kit: null,
    prepStatus: null, prepContainer: null, isContainerLineItem: false, isCustomItem: false,
    subHireId: null, supplier: null, ...o,
  };
}
const acc = (id: string, o: Partial<LineItem> = {}) =>
  line({ id, isKitChild: true, childKind: "ACCESSORY", ...o });
const unit = (id: string, o: Partial<NonNullable<LineItem["units"]>[number]> = {}) => ({
  id, ordinal: 0, assetId: null, bulkAssetId: null, quantity: 1, status: "CONFIRMED", prepStatus: null,
  asset: null, bulkAsset: null, ...o,
});

describe("bulk accessory parent keeps per-unit selection", () => {
  const parent = line({ id: "p", quantity: 3, childLineItems: [acc("a1"), acc("a2", { prepStatus: "PACKED" })] });

  test("Pick: bulk-group with per-unit keys, carrying only unpacked accessories", () => {
    const entries = groupItems([parent], "prep", "prep");
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.kind).toBe("bulk-group");
    if (e.kind !== "bulk-group") return;
    expect(e.unitCount).toBe(3);
    expect(e.accessoryChildren?.map((c) => c.id)).toEqual(["a1"]);
    expect(selectionKeysForEntries(entries)).toEqual([bulkUnitKey("p", 0), bulkUnitKey("p", 1), bulkUnitKey("p", 2)]);
  });

  test("Deploy: unit count is the packed-waiting units", () => {
    const p = line({
      id: "p", quantity: 3,
      units: [unit("u1", { prepStatus: "PACKED" }), unit("u2", { prepStatus: "PACKED" })],
      childLineItems: [acc("a1", { prepStatus: "PACKED" })],
    });
    const entries = groupItems([p], "deploy", "prepped");
    expect(selectionKeysForEntries(entries)).toEqual([bulkUnitKey("p", 0), bulkUnitKey("p", 1)]);
  });

  test("falls back to the accessory-group (line-id key) when no units are actionable", () => {
    const p = line({ id: "p", quantity: 3, units: [unit("u1"), unit("u2"), unit("u3")], childLineItems: [acc("a1")] });
    const entries = groupItems([p], "prep", "prep");
    expect(entries[0].kind).toBe("accessory-group");
    expect(selectionKeysForEntries(entries)).toEqual(["p"]);
  });

  test("quantity 1 accessory parent stays an accessory-group", () => {
    const p = line({ id: "p", assetId: "x", childLineItems: [acc("a1")] });
    expect(groupItems([p], "prep", "prep")[0].kind).toBe("accessory-group");
  });

  test("Return: per-unit keys from checked-out remainder, carrying deployed accessories", () => {
    const p = line({
      id: "p", quantity: 4, status: "CHECKED_OUT", checkedOutQuantity: 3, returnedQuantity: 1,
      childLineItems: [acc("a1", { status: "CHECKED_OUT" }), acc("a2")],
    });
    const entries = groupCheckinItems([p]);
    const e = entries[0];
    expect(e.kind).toBe("bulk-group");
    if (e.kind !== "bulk-group") return;
    expect(e.unitCount).toBe(2);
    expect(e.accessoryChildren?.map((c) => c.id)).toEqual(["a1"]);
  });
});

describe("accessoryAssetIds", () => {
  test("reads line ids and unit ids, deduped", () => {
    const ids = accessoryAssetIds([
      acc("a1", { assetId: "A1" }),
      acc("a2", { units: [unit("u", { assetId: "A2" }), unit("v", { bulkAssetId: "B2" })] }),
      acc("a3", { bulkAssetId: "B2", units: [unit("w", { bulkAssetId: "B2" })] }),
      acc("a4"),
    ]);
    expect(ids.sort()).toEqual(["A1", "A2", "B2"]);
  });
});

describe("accessory badges and stage children", () => {
  test("Partial is computed from the unfiltered accessories", () => {
    const p = line({ childLineItems: [acc("a", { status: "CHECKED_OUT" }), acc("b")] });
    expect(isAccessoryParentPartiallyDeployed(p)).toBe(true);
    expect(isAccessoryParentPartiallyDeployed(line({ childLineItems: [acc("a", { status: "CHECKED_OUT" })] }))).toBe(false);
    expect(isAccessoryParentPartiallyDeployed(line({ childLineItems: [acc("a"), acc("b")] }))).toBe(false);
  });

  test("Pick hides packed accessories; Deploy keeps them", () => {
    const p = line({ childLineItems: [acc("a", { prepStatus: "PACKED" }), acc("b"), acc("c", { status: "CHECKED_OUT" })] });
    expect(accessoryChildrenForStage(p, "prep").map((c) => c.id)).toEqual(["b"]);
    expect(accessoryChildrenForStage(p, "prepped").map((c) => c.id)).toEqual(["a", "b"]);
  });
});
