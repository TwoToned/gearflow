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

  it("sets the filled fields, clears the blank optional ones, and never carries status, the tag id or next due", () => {
    const { set, clear } = buildTestTagEdit(v);
    expect(set).toMatchObject({ description: "Drill", equipmentClass: "CLASS_II", applianceType: "POWER_BOARD", testIntervalMonths: 6, make: "Acme", assetId: "a1", outletCount: 4 });
    expect(clear.sort()).toEqual(["bulkAssetId", "location", "modelName", "notes", "serialNumber", "testProfileId"]);
    for (const k of ["status", "testTagId", "nextDueDate", "id"]) expect(set).not.toHaveProperty(k);
  });

  it("a blank box clears; whitespace is blank; a blank outlet count clears it", () => {
    const { set, clear } = buildTestTagEdit({ ...v, make: "  ", outletCount: "", description: " Drill " });
    expect(clear).toEqual(expect.arrayContaining(["make", "outletCount"]));
    expect(set.description).toBe("Drill");
    expect(set).not.toHaveProperty("make");
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
