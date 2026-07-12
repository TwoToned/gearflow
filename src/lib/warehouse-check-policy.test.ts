import { describe, it, expect } from "vitest";
import {
  transitionNeedsCheck,
  lineHasModelChecks,
  kitHasChecks,
} from "./warehouse-check-policy";

describe("transitionNeedsCheck — cross-transition policy", () => {
  it("PREP fires a check when the model/kit has check items", () => {
    expect(transitionNeedsCheck("PREP", { hasCheckItems: true })).toBe(true);
    expect(transitionNeedsCheck("PREP", { hasCheckItems: true, fromDeprep: false })).toBe(true);
  });

  it("RETURN at DE-PREP (fromDeprep) fires a check when there are check items", () => {
    expect(transitionNeedsCheck("RETURN", { hasCheckItems: true, fromDeprep: true })).toBe(true);
  });

  it("RETURN at return-scan (truck-in) NEVER fires a check", () => {
    // Product decision: the return check runs only at de-prep, not at return-scan.
    expect(transitionNeedsCheck("RETURN", { hasCheckItems: true })).toBe(false);
    expect(transitionNeedsCheck("RETURN", { hasCheckItems: true, fromDeprep: false })).toBe(false);
  });

  it("never fires when the model/kit has no check items, regardless of transition", () => {
    expect(transitionNeedsCheck("PREP", { hasCheckItems: false })).toBe(false);
    expect(transitionNeedsCheck("RETURN", { hasCheckItems: false, fromDeprep: true })).toBe(false);
    expect(transitionNeedsCheck("RETURN", { hasCheckItems: false, fromDeprep: false })).toBe(false);
  });

  // A single table asserting every (context, fromDeprep) combination — the one place
  // a future transition change is visible.
  it.each([
    ["PREP", undefined, true],
    ["PREP", false, true],
    ["RETURN", true, true],
    ["RETURN", false, false],
    ["RETURN", undefined, false],
  ] as const)("context=%s fromDeprep=%s → %s (with check items)", (context, fromDeprep, expected) => {
    expect(transitionNeedsCheck(context, { hasCheckItems: true, fromDeprep })).toBe(expected);
  });
});

describe("lineHasModelChecks / kitHasChecks", () => {
  it("lineHasModelChecks is true only for a positive count", () => {
    expect(lineHasModelChecks({ model: { _count: { modelCheckItems: 2 } } })).toBe(true);
    expect(lineHasModelChecks({ model: { _count: { modelCheckItems: 0 } } })).toBe(false);
    expect(lineHasModelChecks({ model: { _count: null } })).toBe(false);
    expect(lineHasModelChecks({ model: null })).toBe(false);
    expect(lineHasModelChecks(null)).toBe(false);
    expect(lineHasModelChecks(undefined)).toBe(false);
  });

  it("kitHasChecks is true only for a positive count", () => {
    expect(kitHasChecks({ _count: { kitCheckItems: 1 } })).toBe(true);
    expect(kitHasChecks({ _count: { kitCheckItems: 0 } })).toBe(false);
    expect(kitHasChecks({ _count: null })).toBe(false);
    expect(kitHasChecks(null)).toBe(false);
  });
});
