import { describe, test, expect } from "vitest";
import {
  groupItems,
  buildContainerGroups,
  isInPreppedStage,
  isInCheckedOutStage,
  isInReturnedStage,
  isInPickPrepStage,
  resolveSelectionToUnitIds,
  isMoveableAtDeployStage,
  type LineItem,
} from "./warehouse-types";
import { isRelocatedLineId, relocateAccessories, takeRelocatedSelection } from "./relocate-accessories";

type Unit = NonNullable<LineItem["units"]>[number];

function line(overrides: Partial<LineItem>): LineItem {
  return {
    id: "li", type: "EQUIPMENT", status: "CONFIRMED", quantity: 1, checkedOutQuantity: 0, returnedQuantity: 0,
    description: null, modelId: null, assetId: null, bulkAssetId: null, kitId: null, isKitChild: false,
    childKind: null, parentLineItemId: null, model: null, asset: null, bulkAsset: null, kit: null,
    prepStatus: null, prepContainer: null, isContainerLineItem: false, isCustomItem: false, subHireId: null,
    supplier: null, ...overrides,
  };
}
function unit(overrides: Partial<Unit>): Unit {
  return {
    id: "u", ordinal: 1, assetId: null, bulkAssetId: null, quantity: 1, status: "CONFIRMED", prepStatus: "PACKED",
    containerId: null, asset: null, bulkAsset: null, ...overrides,
  };
}

/** Two tagged handhelds in PELICAN, each with a battery unit; battery 2 moved to BATT. */
function job(batteryStatus = "CONFIRMED") {
  const batteries = line({
    id: "batt", isKitChild: true, childKind: "ACCESSORY", parentLineItemId: "hh", quantity: 2,
    status: batteryStatus, prepStatus: "PACKED", model: { name: "AA Battery" },
    units: [
      unit({ id: "bu1", bulkAssetId: "AA", parentUnitAssetId: "a1", containerId: "PELICAN", status: batteryStatus }),
      unit({ id: "bu2", bulkAssetId: "AA", parentUnitAssetId: "a2", containerId: "BATT", status: batteryStatus }),
    ],
  });
  const handhelds = line({
    id: "hh", quantity: 2, status: batteryStatus, prepStatus: "PACKED", model: { name: "Handheld" },
    units: [
      unit({ id: "hu1", assetId: "a1", containerId: "PELICAN", status: batteryStatus }),
      unit({ id: "hu2", assetId: "a2", containerId: "PELICAN", status: batteryStatus }),
    ],
    childLineItems: [batteries],
  });
  return { handhelds, batteries };
}

describe("relocateAccessories", () => {
  test("pulls only the units packed elsewhere out from under the parent", () => {
    const { handhelds } = job();
    const { items, relocatedById } = relocateAccessories([handhelds]);

    expect(items).toHaveLength(2);
    const [parent, moved] = items;
    expect(parent.childLineItems?.[0].units?.map((u) => u.id)).toEqual(["bu1"]); // stays under its parent
    expect(parent.childLineItems?.[0].quantity).toBe(1);
    expect(isRelocatedLineId(moved.id)).toBe(true);
    expect(moved.units?.map((u) => u.id)).toEqual(["bu2"]);
    expect(relocatedById.get(moved.id)).toBe(moved);
    expect(moved.model?.name).toBe("AA Battery (accessory of Handheld)");
    expect(moved.isKitChild).toBe(false);
  });

  test("leaves a job with nothing relocated untouched (same objects)", () => {
    const { handhelds } = job();
    const colocated = { ...handhelds, childLineItems: [{ ...handhelds.childLineItems![0], units: handhelds.childLineItems![0].units!.map((u) => ({ ...u, containerId: "PELICAN" })) }] };
    const { items, relocatedById } = relocateAccessories([colocated]);
    expect(items).toEqual([colocated]);
    expect(items[0]).toBe(colocated);
    expect(relocatedById.size).toBe(0);
  });

  test("an unpacked accessory (no container) is never relocated", () => {
    const { handhelds } = job();
    const loose = { ...handhelds, childLineItems: [{ ...handhelds.childLineItems![0], units: [unit({ id: "bu1", parentUnitAssetId: "a1", containerId: null })] }] };
    expect(relocateAccessories([loose]).relocatedById.size).toBe(0);
  });

  test("drops the nested accessory entirely when every unit was moved", () => {
    const { handhelds } = job();
    const all = { ...handhelds, childLineItems: [{ ...handhelds.childLineItems![0], units: handhelds.childLineItems![0].units!.map((u) => ({ ...u, containerId: "BATT" })) }] };
    const [parent, moved] = relocateAccessories([all]).items;
    expect(parent.childLineItems).toEqual([]);
    expect(moved.quantity).toBe(2);
  });

  test("splits by stage, so each group's line-level status is true (one out, one still waiting)", () => {
    const { handhelds } = job();
    const batt = handhelds.childLineItems![0];
    const mixed = {
      ...handhelds,
      childLineItems: [{ ...batt, units: [
        unit({ id: "x1", parentUnitAssetId: "a1", containerId: "BATT", status: "CHECKED_OUT" }),
        unit({ id: "x2", parentUnitAssetId: "a2", containerId: "BATT", status: "CONFIRMED" }),
      ] }],
    };
    const groups = relocateAccessories([mixed]).items.slice(1);
    expect(groups.map((g) => g.status).sort()).toEqual(["CHECKED_OUT", "CONFIRMED"]);
  });

  test("a relocated group lands in the right stage list and the right container section", () => {
    const waiting = relocateAccessories([job().handhelds]).items;
    const moved = waiting[1];
    expect(isInPreppedStage(moved)).toBe(true);
    expect(isInPickPrepStage(moved)).toBe(false); // packed ⇒ not back in Pick
    expect(isInCheckedOutStage(moved)).toBe(false);

    const sections = buildContainerGroups(groupItems(waiting.filter(isInPreppedStage), "deploy", "prepped"), (e) => (e.kind === "serialized-group" ? e.items[0] : e.item), new Map([["PELICAN", "Pelican"], ["BATT", "Battery Box"]]));
    const byLabel = Object.fromEntries(sections.map((s) => [s.container, s.entries.length]));
    expect(byLabel["Battery Box"]).toBe(1); // the battery shows in ITS box…
    expect(byLabel["Pelican"]).toBe(1); // …and the Pelican keeps the handhelds (+ the co-located battery nested)
  });

  test("a deployed relocated group shows on the Return tab, a returned one on De-prep", () => {
    const out = relocateAccessories([job("CHECKED_OUT").handhelds]).items[1];
    expect(isInCheckedOutStage(out)).toBe(true);
    expect(isInPreppedStage(out)).toBe(false);

    const ret = relocateAccessories([job("RETURNED").handhelds]).items[1];
    expect(isInReturnedStage(ret)).toBe(true);
    expect(isInCheckedOutStage(ret)).toBe(false);
  });
});

describe("takeRelocatedSelection", () => {
  const two = line({ id: "x", quantity: 1 });
  void two;
  const { handhelds } = job();
  const batt = handhelds.childLineItems![0];
  const many = { ...handhelds, childLineItems: [{ ...batt, units: [
    unit({ id: "x1", parentUnitAssetId: "a1", containerId: "BATT" }),
    unit({ id: "x2", parentUnitAssetId: "a2", containerId: "BATT" }),
  ] }] };
  const { items, relocatedById } = relocateAccessories([many]);
  const id = items[1].id;

  test("a bare key names every unit; a positional key names that one unit; other keys pass through", () => {
    expect(takeRelocatedSelection([id], relocatedById).unitIds).toEqual(["x1", "x2"]);
    expect(takeRelocatedSelection([`${id}:1`], relocatedById).unitIds).toEqual(["x2"]);
    expect(takeRelocatedSelection(["hh", `${id}:0`, "other:2"], relocatedById)).toEqual({ rest: ["hh", "other:2"], unitIds: ["x1"] });
  });

  test("Move-to… on the parent moves only what is still co-located; the relocated line moves on its own", () => {
    const parentOnly = resolveSelectionToUnitIds(new Set(["hh"]), items, isMoveableAtDeployStage);
    expect(parentOnly.sort()).toEqual(["hu1", "hu2"]); // no batteries — they're in the Battery Box
    expect(resolveSelectionToUnitIds(new Set([id]), items, isMoveableAtDeployStage).sort()).toEqual(["x1", "x2"]);
  });
});
