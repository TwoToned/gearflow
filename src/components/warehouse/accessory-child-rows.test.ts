/**
 * Unit tests for getAccessoryChildren — the mode-aware filter that decides
 * which permanent accessories show under a parent line in the deploy/return
 * tabs. Deploy shows what's still going out; return shows what's deployed.
 */

import { describe, it, expect } from "vitest";
import { getAccessoryChildren } from "./accessory-child-rows";
import type { LineItem } from "./warehouse-types";

function li(overrides: Partial<LineItem>): LineItem {
  return {
    id: "x",
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

function parentWith(children: LineItem[]): LineItem {
  return li({ id: "parent", assetId: "a1", childLineItems: children });
}

describe("getAccessoryChildren", () => {
  it("returns only ACCESSORY children, ignoring kit members", () => {
    const parent = parentWith([
      li({ id: "acc", childKind: "ACCESSORY", isKitChild: true, status: "CONFIRMED" }),
      li({ id: "kit", childKind: "KIT", isKitChild: true, status: "CONFIRMED" }),
    ]);
    const out = getAccessoryChildren(parent, "deploy");
    expect(out.map((c) => c.id)).toEqual(["acc"]);
  });

  it("deploy mode excludes already checked-out and cancelled accessories", () => {
    const parent = parentWith([
      li({ id: "todo", childKind: "ACCESSORY", isKitChild: true, status: "CONFIRMED" }),
      li({ id: "gone", childKind: "ACCESSORY", isKitChild: true, status: "CHECKED_OUT" }),
      li({ id: "cancelled", childKind: "ACCESSORY", isKitChild: true, status: "CANCELLED" }),
    ]);
    expect(getAccessoryChildren(parent, "deploy").map((c) => c.id)).toEqual(["todo"]);
  });

  it("return mode includes only checked-out accessories", () => {
    const parent = parentWith([
      li({ id: "out", childKind: "ACCESSORY", isKitChild: true, status: "CHECKED_OUT" }),
      li({ id: "notout", childKind: "ACCESSORY", isKitChild: true, status: "CONFIRMED" }),
    ]);
    expect(getAccessoryChildren(parent, "return").map((c) => c.id)).toEqual(["out"]);
  });

  it("returns [] when the parent has no children", () => {
    expect(getAccessoryChildren(li({ id: "lone" }), "deploy")).toEqual([]);
  });
});
