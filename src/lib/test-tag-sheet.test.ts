import { describe, expect, it } from "vitest";
import { buildTestTagEdit, testTagSheetError, testTagSheetInitialOf } from "@/lib/test-tag-sheet";

const SRC = { id: "t1", testTagId: "TT1", description: "Drill", equipmentClass: "CLASS_II", applianceType: "POWER_BOARD", make: "Acme", testIntervalMonths: 6, outletCount: 4 as number | null, assetId: "a1" };

describe("testTagSheetInitialOf", () => {
  it("defaults the required fields, blanks the optional ones, and keeps a stored value as typed", () => {
    const i = testTagSheetInitialOf({ id: "t", testTagId: "T", description: "d" });
    expect(i).toMatchObject({ equipmentClass: "CLASS_I", applianceType: "APPLIANCE", testIntervalMonths: "3", make: "", outletCount: "", assetId: "", bulkAssetId: "" });
    expect(testTagSheetInitialOf(SRC)).toMatchObject({ equipmentClass: "CLASS_II", testIntervalMonths: "6", make: "Acme", assetId: "a1", outletCount: "4" });
  });
});

describe("buildTestTagEdit", () => {
  const v = testTagSheetInitialOf(SRC);

  it("an untouched sheet sends NOTHING (so it can never revert someone else's newer edit)", () => {
    expect(buildTestTagEdit(v, v)).toEqual({ set: {}, clear: [] });
  });

  it("only the changed fields go: a changed value is SET, a changed-to-blank optional box is CLEARED, never status, the tag id or next due", () => {
    const { set, clear } = buildTestTagEdit({ ...v, description: " Hammer drill ", make: "", location: "Bay 2", testIntervalMonths: "12", outletCount: "" }, v);
    expect(set).toEqual({ description: "Hammer drill", location: "Bay 2", testIntervalMonths: 12 });
    expect(clear.sort()).toEqual(["make", "outletCount"]);
    for (const k of ["status", "testTagId", "nextDueDate", "id"]) expect(set).not.toHaveProperty(k);
  });

  it("a field blank before AND now is not cleared; whitespace is blank; a re-typed same value is unchanged", () => {
    const r = buildTestTagEdit({ ...v, notes: "   ", make: " Acme " }, v);
    expect(r).toEqual({ set: {}, clear: [] });
  });

  it("another user's newer edit is not reverted: the sheet that opened with the OLD value and changed only the notes sends only the notes", () => {
    const opened = { ...v, location: "Bay 1" }; // what this sheet opened with; the server now holds "Bay 9"
    const r = buildTestTagEdit({ ...opened, notes: "mine" }, opened);
    expect(r.set).toEqual({ notes: "mine" });
    expect(r.set).not.toHaveProperty("location");
  });
});

describe("testTagSheetError", () => {
  const v = testTagSheetInitialOf(SRC);
  it("mirrors the server's bounds", () => {
    expect(testTagSheetError(v)).toBeNull();
    expect(testTagSheetError({ ...v, description: " " })).toMatch(/description/);
    expect(testTagSheetError({ ...v, testIntervalMonths: "0" })).toMatch(/interval/);
    expect(testTagSheetError({ ...v, testIntervalMonths: "121" })).toMatch(/interval/);
    expect(testTagSheetError({ ...v, testIntervalMonths: "1.5" })).toMatch(/interval/);
    expect(testTagSheetError({ ...v, outletCount: "51" })).toMatch(/Outlets/);
    expect(testTagSheetError({ ...v, outletCount: "" })).toBeNull();
    expect(testTagSheetError({ ...v, assetId: "a", bulkAssetId: "b" })).toMatch(/not both/);
  });
});
