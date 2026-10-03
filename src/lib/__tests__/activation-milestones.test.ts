import { describe, it, expect } from "vitest";
import { milestoneDone, activeMilestoneKey, MILESTONE_ORDER, type ActivationMilestonesState } from "@/lib/activation-milestones";

const EMPTY: ActivationMilestonesState = {
  firstModelId: null,
  firstModelName: null,
  hasModel: false,
  hasAssetOnFirstModel: false,
  firstProjectId: null,
  firstProjectName: null,
  hasProject: false,
  hasModelLineItemOnFirstProject: false,
};

describe("activation-milestones", () => {
  it("MILESTONE_ORDER is model -> asset -> project -> lineItem", () => {
    expect(MILESTONE_ORDER).toEqual(["model", "asset", "project", "lineItem"]);
  });

  it("milestoneDone reads the matching flag for each key", () => {
    const state: ActivationMilestonesState = {
      ...EMPTY,
      hasModel: true,
      hasAssetOnFirstModel: false,
      hasProject: true,
      hasModelLineItemOnFirstProject: false,
    };
    expect(milestoneDone(state, "model")).toBe(true);
    expect(milestoneDone(state, "asset")).toBe(false);
    expect(milestoneDone(state, "project")).toBe(true);
    expect(milestoneDone(state, "lineItem")).toBe(false);
  });

  it("activeMilestoneKey returns the first not-done milestone in order", () => {
    expect(activeMilestoneKey(EMPTY)).toBe("model");
    expect(activeMilestoneKey({ ...EMPTY, hasModel: true })).toBe("asset");
    expect(activeMilestoneKey({ ...EMPTY, hasModel: true, hasAssetOnFirstModel: true })).toBe("project");
    expect(
      activeMilestoneKey({ ...EMPTY, hasModel: true, hasAssetOnFirstModel: true, hasProject: true }),
    ).toBe("lineItem");
  });

  it("activeMilestoneKey returns null once every milestone is done", () => {
    const complete: ActivationMilestonesState = {
      ...EMPTY,
      hasModel: true,
      hasAssetOnFirstModel: true,
      hasProject: true,
      hasModelLineItemOnFirstProject: true,
    };
    expect(activeMilestoneKey(complete)).toBeNull();
  });
});
