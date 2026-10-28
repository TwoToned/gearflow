import { describe, expect, it } from "vitest";
import { canConvertToCustomUnit, canConvertBackToInventory, freeUnitSlots, type CustomUnitLine } from "./off-inventory";

const line = (over: Partial<CustomUnitLine> = {}): CustomUnitLine => ({
  id: "L1",
  type: "EQUIPMENT",
  status: "CONFIRMED",
  modelId: "mdl",
  quantity: 3,
  isKitChild: false,
  kitId: null,
  subHireId: null,
  isContainerLineItem: false,
  isCustomItem: false,
  bulkAssetId: null,
  assetId: null,
  model: { assetType: "SERIALIZED" },
  units: [],
  offInventoryQuantity: 0,
  ...over,
});
const over = { overBy: 1, totalStock: 2, effectiveStock: 2, totalBooked: 3 };

describe("freeUnitSlots", () => {
  it("is quantity minus non-cancelled unit quantity", () => {
    expect(freeUnitSlots(line())).toBe(3);
    expect(freeUnitSlots(line({ units: [{ quantity: 1, status: "CONFIRMED" }, { quantity: 1, status: "CANCELLED" }] }))).toBe(2);
  });
  it("never goes negative", () => {
    expect(freeUnitSlots(line({ quantity: 1, units: [{ quantity: 1, status: "CONFIRMED" }, { quantity: 1, status: "CONFIRMED" }] }))).toBe(0);
  });
});

describe("canConvertToCustomUnit", () => {
  it("offers the action for an overbooked plain serialised line with a free slot", () => {
    expect(canConvertToCustomUnit(line(), over)).toBe(true);
  });
  it("needs an overbooked model", () => {
    expect(canConvertToCustomUnit(line(), null)).toBe(false);
    expect(canConvertToCustomUnit(line(), undefined)).toBe(false);
  });
  it("a pencilled-only collision also qualifies", () => {
    expect(canConvertToCustomUnit(line(), { ...over, overBy: 0, hardOverBy: 0, pencilledOverBy: 1 })).toBe(true);
  });
  it("an inherited (kit-child-driven) badge does not", () => {
    expect(canConvertToCustomUnit(line(), { ...over, inherited: true })).toBe(false);
  });
  it("needs a free slot", () => {
    const full = line({ quantity: 1, units: [{ quantity: 1, status: "CONFIRMED" }] });
    expect(canConvertToCustomUnit(full, over)).toBe(false);
  });
  it.each([
    ["kit child", { isKitChild: true }],
    ["kit", { kitId: "K1" }],
    ["sale", { type: "SALE" }],
    ["sub-hire", { subHireId: "SH1" }],
    ["container", { isContainerLineItem: true }],
    ["custom item", { isCustomItem: true }],
    ["cancelled", { status: "CANCELLED" }],
    ["no model", { modelId: null }],
    ["bulk model", { model: { assetType: "BULK" } }],
    ["bulk-backed", { bulkAssetId: "B1" }],
    ["pinned to a specific asset", { assetId: "A1" }],
  ])("is not offered on a %s line", (_n, o) => {
    expect(canConvertToCustomUnit(line(o as Partial<CustomUnitLine>), over)).toBe(false);
  });
});

describe("canConvertBackToInventory", () => {
  it("is offered while the line has a custom unit that has not gone out", () => {
    const l = line({ offInventoryQuantity: 1, units: [{ quantity: 1, status: "CONFIRMED", assetId: null, bulkAssetId: null }] });
    expect(canConvertBackToInventory(l)).toBe(true);
  });
  it("is not offered with no custom units", () => {
    expect(canConvertBackToInventory(line())).toBe(false);
  });
  it("is not offered once every custom unit is deployed or returned", () => {
    const l = line({ offInventoryQuantity: 1, units: [{ quantity: 1, status: "CHECKED_OUT", assetId: null, bulkAssetId: null }] });
    expect(canConvertBackToInventory(l)).toBe(false);
  });
});
