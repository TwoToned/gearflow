import { describe, test, expect } from "vitest";
import {
  isAccessoryParent,
  accessoryChildrenOf,
  isInPickPrepStage,
  isInPreppedStage,
  isInReturnedStage,
  isInDeprepedStage,
  isInCheckedOutStage,
  resolveItemContainerId,
  buildContainerGroups,
  resolveSelectionToUnitIds,
  isMoveableAtDeployStage,
  isMoveableAtReturnStage,
  isMoveableAtDeprepStage,
  keysForGroupEntries,
  bulkUnitKey,
  type LineItem,
  type GroupEntry,
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

  // "Deploy Verified Only" deploys the parent asset while deliberately
  // leaving an unverified-but-packed accessory behind (issue #794's
  // partial-deploy criterion) — that accessory must stay visible in the
  // Deploy tab so it can be caught up later, not vanish because its parent's
  // own status raced ahead to CHECKED_OUT.
  test("left-behind accessory: still shown once the parent itself is already CHECKED_OUT", () => {
    const item = accessoryParent({ status: "CHECKED_OUT", prepStatus: "PACKED" }, { status: "CONFIRMED", prepStatus: "PACKED" });
    expect(isInPreppedStage(item)).toBe(true);
  });

  test("left-behind accessory: does NOT reappear in Pick/Prep (it's already packed, just not deployed)", () => {
    const item = accessoryParent({ status: "CHECKED_OUT", prepStatus: "PACKED" }, { status: "CONFIRMED", prepStatus: "PACKED" });
    expect(isInPickPrepStage(item)).toBe(false);
  });

  test("fully caught up: hidden from Deploy once parent AND accessory are both CHECKED_OUT", () => {
    const item = accessoryParent({ status: "CHECKED_OUT", prepStatus: "PACKED" }, { status: "CHECKED_OUT", prepStatus: "PACKED" });
    expect(isInPreppedStage(item)).toBe(false);
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

// #1296 phase 2 — Deploy/Return/De-prep sectioning by real containerId.
function unit(overrides: Partial<NonNullable<LineItem["units"]>[number]>): NonNullable<LineItem["units"]>[number] {
  return {
    id: "u",
    ordinal: 1,
    assetId: null,
    bulkAssetId: null,
    quantity: 1,
    status: "CONFIRMED",
    prepStatus: null,
    containerId: null,
    asset: null,
    bulkAsset: null,
    ...overrides,
  };
}

describe("resolveItemContainerId", () => {
  test("returns null when the item has no units", () => {
    expect(resolveItemContainerId(line({}))).toBeNull();
  });

  test("returns the shared containerId when every unit agrees", () => {
    const item = line({ units: [unit({ id: "u1", containerId: "c1" }), unit({ id: "u2", containerId: "c1" })] });
    expect(resolveItemContainerId(item)).toBe("c1");
  });

  test("returns the MAJORITY containerId when a bulk line's units split across containers", () => {
    const item = line({
      units: [unit({ id: "u1", containerId: "c1" }), unit({ id: "u2", containerId: "c1" }), unit({ id: "u3", containerId: "c2" })],
    });
    expect(resolveItemContainerId(item)).toBe("c1");
  });

  test("returns null when no unit carries a containerId yet (pre-migration / never prepped through the rail)", () => {
    const item = line({ units: [unit({ id: "u1", containerId: null })] });
    expect(resolveItemContainerId(item)).toBeNull();
  });
});

describe("buildContainerGroups", () => {
  const asEntry = (item: LineItem) => ({ kind: "single" as const, item });
  const representativeItem = (entry: ReturnType<typeof asEntry>) => entry.item;

  test("two items with the SAME real containerId land in one section, even with different (or missing) prepContainer labels", () => {
    const a = asEntry(line({ id: "a", prepContainer: "Case 12", units: [unit({ containerId: "c1" })] }));
    const b = asEntry(line({ id: "b", prepContainer: null, units: [unit({ containerId: "c1" })] }));
    const groups = buildContainerGroups([a, b], representativeItem, new Map([["c1", "Road Case 12"]]));

    expect(groups).toHaveLength(1);
    expect(groups[0].container).toBe("Road Case 12");
    expect(groups[0].entries.map((e) => e.item.id)).toEqual(["a", "b"]);
  });

  test("falls back to the legacy prepContainer label when no unit has a real containerId", () => {
    const a = asEntry(line({ id: "a", prepContainer: "Tub 3", units: [unit({ containerId: null })] }));
    const groups = buildContainerGroups([a], representativeItem, new Map());
    expect(groups[0].container).toBe("Tub 3");
  });

  test("items with no container at all sort last, after named containers (alphabetical)", () => {
    const loose = asEntry(line({ id: "loose", prepContainer: null }));
    const zTub = asEntry(line({ id: "z", units: [unit({ containerId: "c-z" })] }));
    const aCase = asEntry(line({ id: "a", units: [unit({ containerId: "c-a" })] }));
    const groups = buildContainerGroups(
      [loose, zTub, aCase],
      representativeItem,
      new Map([
        ["c-z", "Z Tub"],
        ["c-a", "A Case"],
      ]),
    );
    expect(groups.map((g) => g.container)).toEqual(["A Case", "Z Tub", null]);
  });
});

describe("stage predicates (isMoveableAt*Stage)", () => {
  test("deploy stage: PACKED and not yet deployed/returned", () => {
    expect(isMoveableAtDeployStage(unit({ status: "CONFIRMED", prepStatus: "PACKED" }))).toBe(true);
    expect(isMoveableAtDeployStage(unit({ status: "CHECKED_OUT", prepStatus: "PACKED" }))).toBe(false);
    expect(isMoveableAtDeployStage(unit({ status: "RETURNED", prepStatus: "PACKED" }))).toBe(false);
    expect(isMoveableAtDeployStage(unit({ status: "CONFIRMED", prepStatus: "PENDING" }))).toBe(false);
  });

  test("return stage: currently deployed", () => {
    expect(isMoveableAtReturnStage(unit({ status: "CHECKED_OUT" }))).toBe(true);
    expect(isMoveableAtReturnStage(unit({ status: "RETURNED" }))).toBe(false);
  });

  test("de-prep stage: back but still packed", () => {
    expect(isMoveableAtDeprepStage(unit({ status: "RETURNED", prepStatus: "PACKED" }))).toBe(true);
    expect(isMoveableAtDeprepStage(unit({ status: "RETURNED", prepStatus: "PENDING" }))).toBe(false);
    expect(isMoveableAtDeprepStage(unit({ status: "CHECKED_OUT", prepStatus: "PACKED" }))).toBe(false);
  });
});

describe("resolveSelectionToUnitIds (Move to…, #1296 phase 2)", () => {
  test("a plain line-item key resolves to that item's own relevant unit(s)", () => {
    const li = line({ id: "a", units: [unit({ id: "u1", status: "CONFIRMED", prepStatus: "PACKED" })] });
    const ids = resolveSelectionToUnitIds(new Set(["a"]), [li], isMoveableAtDeployStage);
    expect(ids).toEqual(["u1"]);
  });

  test("a kit/accessory parent's key pulls in every relevant descendant's units too (whole group moves together)", () => {
    const child = line({
      id: "child",
      isKitChild: true,
      status: "CONFIRMED",
      units: [unit({ id: "u-child", status: "CONFIRMED", prepStatus: "PACKED" })],
    });
    const kit = line({ id: "kit", kitId: "k1", childLineItems: [child], units: [unit({ id: "u-kit", status: "CONFIRMED", prepStatus: "PACKED" })] });
    const ids = resolveSelectionToUnitIds(new Set(["kit"]), [kit], isMoveableAtDeployStage);
    expect(ids.sort()).toEqual(["u-child", "u-kit"]);
  });

  test("a bulk positional key only ever carries a COUNT — N selected indices resolve to the first N relevant units in array order", () => {
    const li = line({
      id: "bulk",
      quantity: 3,
      units: [
        unit({ id: "u1", status: "CONFIRMED", prepStatus: "PACKED" }),
        unit({ id: "u2", status: "CONFIRMED", prepStatus: "PACKED" }),
        unit({ id: "u3", status: "CONFIRMED", prepStatus: "PACKED" }),
      ],
    });
    // Two distinct bulk keys selected (index doesn't matter — only the count).
    const ids = resolveSelectionToUnitIds(new Set(["bulk:0", "bulk:2"]), [li], isMoveableAtDeployStage);
    expect(ids).toEqual(["u1", "u2"]);
  });

  test("units not relevant to this stage are excluded even when their line is selected", () => {
    const li = line({
      id: "bulk",
      units: [
        unit({ id: "u1", status: "CONFIRMED", prepStatus: "PACKED" }),
        unit({ id: "u2", status: "CHECKED_OUT", prepStatus: "PACKED" }), // already deployed — not deploy-stage relevant
      ],
    });
    expect(resolveSelectionToUnitIds(new Set(["bulk:0"]), [li], isMoveableAtDeployStage)).toEqual(["u1"]);
  });

  test("a key with no matching line item is silently ignored (never throws)", () => {
    expect(resolveSelectionToUnitIds(new Set(["missing", "missing:0"]), [], isMoveableAtDeployStage)).toEqual([]);
  });
});

describe("keysForGroupEntries (Deploy container, #1296 D4)", () => {
  test("single/serialized-group/kit-group/accessory-group each contribute their line-item id(s)", () => {
    const entries: GroupEntry[] = [
      { kind: "single", item: line({ id: "a" }) },
      { kind: "serialized-group", groupKey: "s", modelName: "M", items: [line({ id: "b" }), line({ id: "c" })] },
      { kind: "kit-group", groupKey: "k", item: line({ id: "kit1" }), children: [line({ id: "child" })] },
      { kind: "accessory-group", groupKey: "acc", item: line({ id: "acc1" }), children: [] },
    ];
    expect(keysForGroupEntries(entries)).toEqual(["a", "b", "c", "kit1", "acc1"]);
  });

  test("a bulk-group contributes one positional key per unit", () => {
    const entries: GroupEntry[] = [{ kind: "bulk-group", groupKey: "bulk", item: line({ id: "bulk1" }), unitCount: 3 }];
    expect(keysForGroupEntries(entries)).toEqual([bulkUnitKey("bulk1", 0), bulkUnitKey("bulk1", 1), bulkUnitKey("bulk1", 2)]);
  });
});
