import { describe, it, expect, vi } from "vitest";
import {
  buildReturningBulkActions, buildReturningGroupActions, buildReturningLineActions, buildUnitActions,
  type ReturningCtx, type ReturningUnit, type UnitCtx,
} from "@/lib/row-actions/returning-line";
import { returningGroup, returningLine } from "@/lib/__tests__/returning-fixtures";

const ctx = (over: Partial<ReturningCtx> = {}): ReturningCtx => ({
  canReturn: true, canRepair: true, returnLines: vi.fn(), raiseRepair: vi.fn(), toggleUnits: vi.fn(), openJob: vi.fn(), ...over,
});
const keys = (items: Array<{ key: string }>) => items.map((i) => i.key);

describe("returning line ⋯ (absent, never disabled)", () => {
  it("an out line can be returned, damaged, shown and marked missing (missing last, red, confirmed)", () => {
    const spec = buildReturningLineActions(returningLine({ out: 2 }), ctx());
    expect(keys(spec.items)).toEqual(["return", "damaged", "units", "missing"]);
    const missing = spec.items.at(-1)!;
    expect(missing.danger).toBe(true);
    expect(missing.confirm).toBeTruthy();
  });
  it("nothing out, or no check_in: no return verbs; damaged serialised gear offers Raise repair", () => {
    expect(keys(buildReturningLineActions(returningLine({ out: 0, damaged: 1 }), ctx()).items)).toEqual(["units", "repair"]);
    expect(keys(buildReturningLineActions(returningLine({ out: 2 }), ctx({ canReturn: false, canRepair: false })).items)).toEqual(["units"]);
  });
  it("a kit says Return kit and has no unit chips", () => {
    const spec = buildReturningLineActions(returningLine({ kind: "kit", kitId: "k1" }), ctx());
    expect(spec.items[0].label).toBe("Return kit");
    expect(keys(spec.items)).not.toContain("units");
  });
});

describe("group ⋯ and bulk", () => {
  it("Return everything still out is absent when nothing is", () => {
    expect(keys(buildReturningGroupActions(returningGroup({}, [returningLine({ out: 0 })]), ctx()).items)).toEqual(["open"]);
  });
  it("bulk counts only lines a verb applies to", () => {
    const actions = buildReturningBulkActions([returningLine({ lineItemId: "a", out: 2 }), returningLine({ lineItemId: "b", out: 0, damaged: 1 })], ctx());
    expect(actions.map((a) => a.label(0))).toEqual(["Return 1", "Mark damaged 1", "Raise repair 1", "Mark missing 1"]);
  });
});

describe("unit chip menu", () => {
  const unitCtx: UnitCtx = { canReturn: true, canRepair: true, returnUnit: vi.fn(), correct: vi.fn(), raiseRepair: vi.fn() };
  const unit = (over: Partial<ReturningUnit>): ReturningUnit => ({
    unitId: "u1", assetId: "a1", assetTag: "SK-1", quantity: 1, returnedQuantity: 0, status: "CHECKED_OUT",
    returnCondition: null, returnStatus: null, returnedAt: null, lateBack: false, ...over,
  });
  it("an out unit returns; a returned one re-records its outcome (never its current one)", () => {
    expect(keys(buildUnitActions(unit({}), unitCtx).items)).toEqual(["return", "damaged", "missing"]);
    expect(keys(buildUnitActions(unit({ status: "RETURNED", returnCondition: "DAMAGED" }), unitCtx).items)).toEqual(["mark-GOOD", "mark-MISSING", "repair"]);
  });
  it("an asset-less unit has no menu", () => {
    expect(buildUnitActions(unit({ assetId: null }), unitCtx).items).toEqual([]);
  });
});
