import { describe, expect, it } from "vitest";
import { dateInputValue, kitSheetInitialOf, type KitSheetSource } from "@/lib/kit-sheet-initial";

const KIT: KitSheetSource = { id: "k1", name: "Rack", assetTag: "K-1", condition: "GOOD" };

describe("kitSheetInitialOf", () => {
  it("a stored 0 stays 0 (weight and price), so an unchanged save cannot read it as cleared", () => {
    const i = kitSheetInitialOf({ ...KIT, weight: 0, purchasePrice: 0 });
    expect(i.weight).toBe(0);
    expect(i.purchasePrice).toBe(0);
  });

  it("absent, null and empty are blank (undefined), and a numeric string is read as a number", () => {
    expect(kitSheetInitialOf(KIT).weight).toBeUndefined();
    expect(kitSheetInitialOf({ ...KIT, weight: null, purchasePrice: null }).purchasePrice).toBeUndefined();
    expect(kitSheetInitialOf({ ...KIT, weight: "" }).weight).toBeUndefined();
    expect(kitSheetInitialOf({ ...KIT, weight: "12.5" }).weight).toBe(12.5);
  });

  it("the purchase date reads as yyyy-mm-dd, and is absent when none was stored", () => {
    expect(kitSheetInitialOf({ ...KIT, purchaseDate: Date.UTC(2026, 2, 5, 13) }).purchaseDate).toBe("2026-03-05");
    expect(kitSheetInitialOf(KIT).purchaseDate).toBeUndefined();
    expect(dateInputValue(0)).toBe("1970-01-01");
  });

  it("text fields blank to undefined; tags and check mode default", () => {
    const i = kitSheetInitialOf({ ...KIT, description: "", notes: null, checkMode: null });
    expect(i.description).toBeUndefined();
    expect(i.notes).toBeUndefined();
    expect(i.tags).toEqual([]);
    expect(i.checkMode).toBe("KIT_LEVEL");
  });
});
