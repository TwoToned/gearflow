import { describe, expect, it } from "vitest";
import {
  isMoveableAtDeployStage,
  isMoveableAtDeprepStage,
  isMoveableAtReturnStage,
  isMoveableAtUndeprepStage,
} from "../warehouse-types";

type U = Parameters<typeof isMoveableAtUndeprepStage>[0];
const unit = (status: string, prepStatus: string): U => ({ status, prepStatus }) as unknown as U;

describe("stage predicates are disjoint per unit state", () => {
  it("only a de-prepped (RETURNED, not PACKED) unit is un-deprep-able", () => {
    expect(isMoveableAtUndeprepStage(unit("RETURNED", "PENDING"))).toBe(true);
    expect(isMoveableAtUndeprepStage(unit("RETURNED", "PACKED"))).toBe(false); // still waiting to be de-prepped
    expect(isMoveableAtUndeprepStage(unit("CHECKED_OUT", "PACKED"))).toBe(false);
    expect(isMoveableAtUndeprepStage(unit("CONFIRMED", "PACKED"))).toBe(false);
  });
  it("a unit matches exactly one of prepped / out / returned / de-prepped", () => {
    for (const u of [unit("CONFIRMED", "PACKED"), unit("CHECKED_OUT", "PACKED"), unit("RETURNED", "PACKED"), unit("RETURNED", "PENDING")]) {
      const hits = [isMoveableAtDeployStage, isMoveableAtReturnStage, isMoveableAtDeprepStage, isMoveableAtUndeprepStage].filter((f) => f(u));
      expect(hits).toHaveLength(1);
    }
  });
});
