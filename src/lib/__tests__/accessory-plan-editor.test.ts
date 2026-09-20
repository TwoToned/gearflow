import { describe, it, expect } from "vitest";
import {
  seedAccessorySelection,
  derivePlanToSave,
  accessoryPlansEqual,
} from "@/lib/accessory-plan-editor";
import type { ModelAccessoryDetail } from "@/server/line-items";

const DEFAULT_ROW: ModelAccessoryDetail = {
  id: "row-default", bulkAssetId: "ba-default", quantity: 1, inclusion: "DEFAULT", assetTag: "BA-DEF", modelName: "XLR Cable",
};
const OPTIONAL_ROW: ModelAccessoryDetail = {
  id: "row-optional", bulkAssetId: "ba-optional", quantity: 2, inclusion: "OPTIONAL", assetTag: "BA-OPT", modelName: "Flight Case",
};
const ACCESSORIES = [DEFAULT_ROW, OPTIONAL_ROW];

describe("seedAccessorySelection", () => {
  it("with no stored plan: DEFAULT included, OPTIONAL excluded (template behaviour)", () => {
    const { selection, excludeReasons } = seedAccessorySelection(ACCESSORIES, undefined);
    expect(selection["row-default"]).toBe(true);
    expect(selection["row-optional"]).toBe(false);
    expect(excludeReasons).toEqual({});
  });

  it("seeds an excluded DEFAULT unchecked, carrying its recorded reason", () => {
    const { selection, excludeReasons } = seedAccessorySelection(ACCESSORIES, {
      excluded: ["ba-default"],
      added: [],
      excludedReasons: [{ bulkAssetId: "ba-default", reason: "Client supplying their own" }],
    });
    expect(selection["row-default"]).toBe(false);
    expect(excludeReasons["row-default"]).toBe("Client supplying their own");
  });

  it("seeds an opted-in OPTIONAL checked", () => {
    const { selection } = seedAccessorySelection(ACCESSORIES, {
      excluded: [],
      added: [{ bulkAssetId: "ba-optional" }],
    });
    expect(selection["row-optional"]).toBe(true);
  });
});

describe("derivePlanToSave", () => {
  it("returns the empty-override plan when the checkboxes match the template", () => {
    expect(derivePlanToSave(ACCESSORIES, { "row-default": true, "row-optional": false }, {})).toEqual({
      excluded: [],
      added: [],
      excludedReasons: [],
    });
  });

  it("records a deselected DEFAULT as an exclusion with its reason, and an opted-in OPTIONAL as added", () => {
    const plan = derivePlanToSave(
      ACCESSORIES,
      { "row-default": false, "row-optional": true },
      { "row-default": "Client supplying their own" },
    );
    expect(plan.excluded).toEqual(["ba-default"]);
    expect(plan.added).toEqual([{ bulkAssetId: "ba-optional" }]);
    expect(plan.excludedReasons).toEqual([{ bulkAssetId: "ba-default", reason: "Client supplying their own" }]);
  });

  it("round-trips through seed: seeding a saved plan and re-deriving gives the same plan", () => {
    const original = derivePlanToSave(
      ACCESSORIES,
      { "row-default": false, "row-optional": true },
      { "row-default": "no cable needed" },
    );
    const { selection, excludeReasons } = seedAccessorySelection(ACCESSORIES, original);
    expect(derivePlanToSave(ACCESSORIES, selection, excludeReasons)).toEqual(original);
  });
});

describe("accessoryPlansEqual", () => {
  it("treats an absent plan and the empty-override plan as equal (an untouched line is never dirty)", () => {
    expect(accessoryPlansEqual(undefined, { excluded: [], added: [], excludedReasons: [] })).toBe(true);
  });

  it("ignores ordering", () => {
    expect(
      accessoryPlansEqual(
        { excluded: ["b", "a"], added: [{ bulkAssetId: "y" }, { bulkAssetId: "x" }] },
        { excluded: ["a", "b"], added: [{ bulkAssetId: "x" }, { bulkAssetId: "y" }] },
      ),
    ).toBe(true);
  });

  it("ignores a reason-only change — nothing to reconcile, so it must not fire a write", () => {
    expect(
      accessoryPlansEqual(
        { excluded: ["a"], added: [], excludedReasons: [{ bulkAssetId: "a", reason: "old" }] },
        { excluded: ["a"], added: [], excludedReasons: [{ bulkAssetId: "a", reason: "new" }] },
      ),
    ).toBe(true);
  });

  it("detects an added exclusion and an added opt-in", () => {
    expect(accessoryPlansEqual({ excluded: [], added: [] }, { excluded: ["a"], added: [] })).toBe(false);
    expect(accessoryPlansEqual({ excluded: [], added: [] }, { excluded: [], added: [{ bulkAssetId: "x" }] })).toBe(false);
  });
});
