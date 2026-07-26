import { describe, test, expect } from "vitest";
import {
  isAccessoryParent,
  accessoryChildrenOf,
  isExpandableParent,
  expandableChildrenOf,
  isKitParent,
  type LineItem,
} from "./warehouse-types";

// Issue #794 follow-up — warehouse must render accessories like a kit's
// children, not hide them behind the prep asset-picker. These helpers are the
// grouping/filter logic's single source of truth for "is this an accessory
// parent" and "which of its children count".

function line(overrides: Partial<LineItem>): LineItem {
  return {
    id: "li",
    type: "EQUIPMENT",
    status: "CONFIRMED",
    quantity: 1,
    checkedOutQuantity: 0,
    returnedQuantity: 0,
    description: null,
    modelId: null,
    assetId: null,
    bulkAssetId: null,
    kitId: null,
    isKitChild: false,
    childKind: null,
    parentLineItemId: null,
    model: null,
    asset: null,
    bulkAsset: null,
    kit: null,
    prepStatus: null,
    prepContainer: null,
    isContainerLineItem: false,
    isCustomItem: false,
    subHireId: null,
    supplier: null,
    ...overrides,
  };
}

describe("isAccessoryParent", () => {
  test("true for a top-level line with an ACCESSORY child", () => {
    const parent = line({
      id: "p1",
      childLineItems: [line({ id: "c1", isKitChild: true, childKind: "ACCESSORY", parentLineItemId: "p1" })],
    });
    expect(isAccessoryParent(parent)).toBe(true);
  });

  test("false when the line has a kitId (it's a kit parent, not an accessory parent)", () => {
    const parent = line({
      id: "p1",
      kitId: "k1",
      childLineItems: [line({ id: "c1", isKitChild: true, childKind: "ACCESSORY", parentLineItemId: "p1" })],
    });
    expect(isAccessoryParent(parent)).toBe(false);
  });

  test("false when the line is itself a child (isKitChild)", () => {
    const child = line({ id: "c1", isKitChild: true, childKind: "ACCESSORY" });
    expect(isAccessoryParent(child)).toBe(false);
  });

  test("false when no children carry childKind ACCESSORY", () => {
    const parent = line({
      id: "p1",
      childLineItems: [line({ id: "c1", isKitChild: true, childKind: "KIT", parentLineItemId: "p1" })],
    });
    expect(isAccessoryParent(parent)).toBe(false);
  });

  test("false with no children at all", () => {
    expect(isAccessoryParent(line({ id: "p1" }))).toBe(false);
  });
});

describe("accessoryChildrenOf", () => {
  test("filters to only ACCESSORY children, dropping any KIT-kind siblings", () => {
    const parent = line({
      id: "p1",
      childLineItems: [
        line({ id: "c1", isKitChild: true, childKind: "ACCESSORY", parentLineItemId: "p1" }),
        line({ id: "c2", isKitChild: true, childKind: "KIT", parentLineItemId: "p1" }),
      ],
    });
    expect(accessoryChildrenOf(parent).map((c) => c.id)).toEqual(["c1"]);
  });

  test("empty array when there are no children", () => {
    expect(accessoryChildrenOf(line({ id: "p1" }))).toEqual([]);
  });
});

describe("isExpandableParent / expandableChildrenOf", () => {
  test("kit parent: expandableChildrenOf returns ALL children (unfiltered by kind)", () => {
    const parent = line({
      id: "p1",
      kitId: "k1",
      childLineItems: [line({ id: "c1", isKitChild: true, childKind: "KIT", parentLineItemId: "p1" })],
    });
    expect(isExpandableParent(parent)).toBe(true);
    expect(isKitParent(parent)).toBe(true);
    expect(expandableChildrenOf(parent).map((c) => c.id)).toEqual(["c1"]);
  });

  test("accessory parent: expandableChildrenOf narrows to ACCESSORY children only", () => {
    const parent = line({
      id: "p1",
      childLineItems: [
        line({ id: "c1", isKitChild: true, childKind: "ACCESSORY", parentLineItemId: "p1" }),
      ],
    });
    expect(isExpandableParent(parent)).toBe(true);
    expect(expandableChildrenOf(parent).map((c) => c.id)).toEqual(["c1"]);
  });

  test("plain line: not expandable, no children", () => {
    const plain = line({ id: "p1" });
    expect(isExpandableParent(plain)).toBe(false);
    expect(expandableChildrenOf(plain)).toEqual([]);
  });
});
