import { describe, expect, it } from "vitest";
import { bulkDeprepKeys, planDeprepScan } from "../warehouse-deprep-scan";
import { classifyScan } from "../warehouse-scan-classify";

describe("planDeprepScan: one scan, one unit", () => {
  it("a serialised unit de-preps exactly ONE unit through a per-unit key", () => {
    expect(planDeprepScan({ kind: "unit", lineItemId: "L1", assetId: "a1", name: "Lamp" })).toMatchObject({ kind: "keys", keys: ["L1:0"] });
  });
  it("a kit goes whole, by its line id", () => {
    expect(planDeprepScan({ kind: "kit", lineItemId: "K1", kitId: "k", name: "Kit" })).toMatchObject({ kind: "keys", keys: ["K1"] });
  });
  it("an accessory tag de-preps that accessory unit (unit-level DEPREP)", () => {
    expect(planDeprepScan({ kind: "accessory", lineItemId: "A1", unitId: "u9", assetId: "x", name: "Battery" })).toMatchObject({ kind: "accessoryUnit", unitId: "u9" });
  });
  it("a bulk tag asks for the count at the bin (D8) and never de-preps by itself", () => {
    expect(planDeprepScan({ kind: "bulk", lineItemId: "B1", name: "XLR", remaining: 12 })).toMatchObject({ kind: "askCount", lineItemId: "B1", remaining: 12 });
  });
  it("not found warns; a refusal errors with the server's own words", () => {
    expect(planDeprepScan({ kind: "none" })).toMatchObject({ kind: "refuse", tone: "warning" });
    expect(planDeprepScan({ kind: "refuse", text: "Lamp: not waiting" })).toMatchObject({ kind: "refuse", tone: "error", text: "Lamp: not waiting" });
  });
  it("bulkDeprepKeys makes N per-unit keys and clamps nonsense", () => {
    expect(bulkDeprepKeys("B1", 3)).toEqual(["B1:0", "B1:1", "B1:2"]);
    expect(bulkDeprepKeys("B1", -2)).toEqual([]);
    expect(bulkDeprepKeys("B1", 2.9)).toEqual(["B1:0", "B1:1"]);
  });
  it("a refusal reaches the strip as the classifier's own error text", () => {
    const plan = classifyScan("T", { found: true, type: null, lineItemId: null, reason: "not_deprepable", detail: "Lamp: not waiting" }, "returned", { containersByTag: new Map() });
    expect(plan).toEqual({ kind: "refuse", tone: "error", text: "Lamp: not waiting" });
  });
});
