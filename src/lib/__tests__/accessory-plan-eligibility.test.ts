import { describe, it, expect } from "vitest";
import { canEditAccessoryPlan } from "@/lib/accessory-plan-eligibility";

describe("canEditAccessoryPlan", () => {
  it("allows a top-level model-based line with no deployed units", () => {
    expect(canEditAccessoryPlan({ modelId: "m1" })).toBe(true);
  });

  it("allows a top-level asset-based line", () => {
    expect(canEditAccessoryPlan({ assetId: "a1" })).toBe(true);
  });

  it("rejects a kit child", () => {
    expect(canEditAccessoryPlan({ modelId: "m1", isKitChild: true })).toBe(false);
  });

  it("rejects an accessory child", () => {
    expect(canEditAccessoryPlan({ modelId: "m1", childKind: "ACCESSORY" })).toBe(false);
  });

  it("rejects a line with neither model nor asset", () => {
    expect(canEditAccessoryPlan({})).toBe(false);
  });

  it("rejects a sub-hire line", () => {
    expect(canEditAccessoryPlan({ modelId: "m1", subHireId: "sh1" })).toBe(false);
  });

  it("rejects a line with any deployed unit", () => {
    expect(canEditAccessoryPlan({ modelId: "m1", checkedOutQuantity: 1 })).toBe(false);
  });

  it("rejects a line whose status is CHECKED_OUT even if checkedOutQuantity is 0", () => {
    expect(canEditAccessoryPlan({ modelId: "m1", checkedOutQuantity: 0, status: "CHECKED_OUT" })).toBe(false);
  });
});
