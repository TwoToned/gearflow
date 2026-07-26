import { describe, test, expect } from "vitest";
import {
  isAccessoryParent,
  accessoryChildrenOf,
  isInPickPrepStage,
  isInPreppedStage,
  isInReturnedStage,
  isInDeprepedStage,
  isInCheckedOutStage,
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

// Regression coverage for a real production bug: an accessory parent's stage
// membership used to be gated PURELY on its accessory children's status,
// ignoring the parent asset's own status/prepStatus entirely. Unlike a kit
// parent (a synthetic rollup with no state of its own), an accessory parent is
// a real, independently-fulfilled asset — these tests pin "parent's own state
// OR any child's state" as the correct rule by exercising exactly the
// divergent-state cases that used to make the parent vanish.
function accessoryParent(overrides: Partial<LineItem>, childOverrides: Partial<LineItem>): LineItem {
  return line({
    id: "p1",
    assetId: "a1",
    childLineItems: [line({ id: "c1", isKitChild: true, childKind: "ACCESSORY", parentLineItemId: "p1", ...childOverrides })],
    ...overrides,
  });
}

describe("isInPickPrepStage", () => {
  test("plain line (no accessories): needs prep when not PACKED", () => {
    expect(isInPickPrepStage(line({ id: "p1", prepStatus: "PENDING" }))).toBe(true);
    expect(isInPickPrepStage(line({ id: "p1", prepStatus: "PACKED" }))).toBe(false);
  });

  test("accessory parent: shows when the PARENT needs prep even if its accessory is already packed", () => {
    const item = accessoryParent({ prepStatus: "PENDING" }, { prepStatus: "PACKED" });
    expect(isInPickPrepStage(item)).toBe(true);
  });

  test("accessory parent: shows when the ACCESSORY needs prep even if the parent is already packed", () => {
    const item = accessoryParent({ prepStatus: "PACKED" }, { prepStatus: "PENDING" });
    expect(isInPickPrepStage(item)).toBe(true);
  });

  test("accessory parent: hidden once both parent and accessory are packed", () => {
    const item = accessoryParent({ prepStatus: "PACKED" }, { prepStatus: "PACKED" });
    expect(isInPickPrepStage(item)).toBe(false);
  });

  test("kit parent unaffected: gated purely on children (no own prepStatus)", () => {
    const kit = line({
      id: "k1", kitId: "kit-1",
      childLineItems: [line({ id: "c1", isKitChild: true, prepStatus: "PACKED" })],
    });
    expect(isInPickPrepStage(kit)).toBe(false);
  });
});

describe("isInPreppedStage", () => {
  test("accessory parent: shows once EITHER the parent or the accessory is prepped-and-waiting", () => {
    expect(isInPreppedStage(accessoryParent({ prepStatus: "PACKED" }, { prepStatus: "PENDING" }))).toBe(true);
    expect(isInPreppedStage(accessoryParent({ prepStatus: "PENDING" }, { prepStatus: "PACKED" }))).toBe(true);
  });

  test("accessory parent: hidden when neither the parent nor the accessory is packed", () => {
    expect(isInPreppedStage(accessoryParent({ prepStatus: "PENDING" }, { prepStatus: "PENDING" }))).toBe(false);
  });
});

describe("isInReturnedStage (de-prep staging)", () => {
  test("accessory parent: shows once EITHER the parent or the accessory is RETURNED+PACKED", () => {
    expect(isInReturnedStage(accessoryParent({ status: "RETURNED", prepStatus: "PACKED" }, { status: "CONFIRMED", prepStatus: "PENDING" }))).toBe(true);
    expect(isInReturnedStage(accessoryParent({ status: "CONFIRMED", prepStatus: "PENDING" }, { status: "RETURNED", prepStatus: "PACKED" }))).toBe(true);
  });

  test("accessory parent: hidden when neither has returned+packed", () => {
    expect(isInReturnedStage(accessoryParent({ status: "CONFIRMED" }, { status: "CONFIRMED" }))).toBe(false);
  });
});

describe("isInDeprepedStage", () => {
  test("accessory parent: shows once EITHER the parent or the accessory is RETURNED but not packed", () => {
    expect(isInDeprepedStage(accessoryParent({ status: "RETURNED", prepStatus: "PENDING" }, { status: "CONFIRMED" }))).toBe(true);
    expect(isInDeprepedStage(accessoryParent({ status: "CONFIRMED" }, { status: "RETURNED", prepStatus: "PENDING" }))).toBe(true);
  });
});

describe("isInCheckedOutStage", () => {
  test("accessory parent: shows once EITHER the parent or the accessory is CHECKED_OUT", () => {
    expect(isInCheckedOutStage(accessoryParent({ status: "CHECKED_OUT" }, { status: "CONFIRMED" }))).toBe(true);
    expect(isInCheckedOutStage(accessoryParent({ status: "CONFIRMED" }, { status: "CHECKED_OUT" }))).toBe(true);
  });

  test("accessory parent: hidden when neither is checked out", () => {
    expect(isInCheckedOutStage(accessoryParent({ status: "CONFIRMED" }, { status: "CONFIRMED" }))).toBe(false);
  });
});
