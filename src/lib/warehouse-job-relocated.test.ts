import { describe, it, expect } from "vitest";
import { buildJobSections } from "./warehouse-job-rows";
import { keysForRowIds } from "./warehouse-job-keys";
import { relocateAccessories, takeAccessorySelection } from "@/components/warehouse/relocate-accessories";
import type { LineItem } from "@/components/warehouse/warehouse-types";

type Unit = NonNullable<LineItem["units"]>[number];

const line = (over: Partial<LineItem>): LineItem => ({
  id: "l", type: "EQUIPMENT", status: "CONFIRMED", quantity: 1, checkedOutQuantity: 0, returnedQuantity: 0, description: null,
  modelId: "m", assetId: null, bulkAssetId: null, kitId: null, isKitChild: false, childKind: null, parentLineItemId: null,
  model: { name: "X" }, asset: null, bulkAsset: null, kit: null, prepStatus: "PACKED", prepContainer: null,
  isContainerLineItem: false, isCustomItem: false, subHireId: null, supplier: null, ...over,
}) as LineItem;
const unit = (over: Partial<Unit>): Unit => ({
  id: "u", ordinal: 1, assetId: null, bulkAssetId: null, quantity: 1, status: "CONFIRMED", prepStatus: "PACKED",
  containerId: null, asset: null, bulkAsset: null, ...over,
}) as Unit;

/** Two handhelds in PELICAN; both batteries packed into BATT (relocated, one group of two units). */
const job = () => {
  const batteries = line({
    id: "batt", isKitChild: true, childKind: "ACCESSORY", parentLineItemId: "hh", quantity: 2, model: { name: "AA" },
    units: [
      unit({ id: "bu1", bulkAssetId: "AA", parentUnitAssetId: "a1", containerId: "BATT" }),
      unit({ id: "bu2", bulkAssetId: "AA", parentUnitAssetId: "a2", containerId: "BATT" }),
    ],
  });
  return line({
    id: "hh", quantity: 2, model: { name: "Handheld" }, childLineItems: [batteries],
    units: [unit({ id: "hu1", assetId: "a1", containerId: "PELICAN" }), unit({ id: "hu2", assetId: "a2", containerId: "PELICAN" })],
  });
};

describe("relocated accessory selection by unit key (Prepped)", () => {
  const placed = relocateAccessories([job()]);
  const sections = buildJobSections(placed.items, {
    stage: "prepped", containerLabelById: new Map([["BATT", "Battery Box"], ["PELICAN", "Pelican"]]), categoryOf: () => "",
  });
  const rows = sections.flatMap((s) => s.rows);

  it("lists a multi-unit relocated group as one row per unit, under its own case", () => {
    const batt = sections.find((s) => s.section.title === "Battery Box");
    expect(batt?.rows.map((r) => r.id.split("~").pop())).toEqual(["waiting:0", "waiting:1"]);
  });

  it("a ticked unit row reaches the accessory unit path, and only that unit", () => {
    const ticked = rows.find((r) => r.id.endsWith(":1"))!.id;
    const keys = keysForRowIds(placed.items, [ticked], "prepped");
    const { rest, unitIds } = takeAccessorySelection(keys, placed, () => true);
    expect(unitIds).toEqual(["bu2"]);
    expect(rest).toEqual([]);
  });
});
