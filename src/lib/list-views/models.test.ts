import { describe, expect, it } from "vitest";
import { defaultListState } from "@/lib/list-url-state";
import { MODELS_SPEC, MODEL_COLUMNS, modelRowOf, modelsQueryArgs, modelSegments, pricingState } from "./models";
import { SALES_STOCK_SPEC, saleStockFlags, saleStockRowOf, salesStockQueryArgs } from "./sales-stock";

const base = defaultListState(MODELS_SPEC);

describe("models list view", () => {
  it("the default query has no segment and no now", () => {
    expect(modelsQueryArgs(base, 123)).toMatchObject({ segment: undefined, now: undefined, page: 1, pageSize: 25, sortBy: "name", sortOrder: "asc" });
  });

  it("drops unknown type values and carries now only for the Due segment", () => {
    const s = { ...base, seg: "due", filters: { type: ["BULK", "NOPE"], cat: ["c1"], tag: [] } };
    expect(modelsQueryArgs(s, 123)).toMatchObject({ segment: "due", now: 123, assetTypeIn: ["BULK"], categoryIdIn: ["c1"], tagsHasSome: undefined });
  });

  it("the strip is the five words in order with counts", () => {
    expect(modelSegments({ all: 4, stock: 3 }).map((s) => [s.key, s.label, s.count])).toEqual([
      ["all", "All", 4],
      ["stock", "With stock", 3],
      ["nostock", "No stock", undefined],
      ["due", "Due for T&T", undefined],
      ["archived", "Archived", undefined],
    ]);
  });

  it("cost columns are opt-in; the client-facing Day rate is not", () => {
    const optional = MODEL_COLUMNS.filter((c) => c.optional).map((c) => c.id);
    expect(optional).toEqual(["value", "type", "tags"]);
    expect(MODEL_COLUMNS.find((c) => c.id === "dayRate")?.optional).toBeUndefined();
  });

  it("a blank rate stays blank (null), never 0", () => {
    const row = modelRowOf({ id: "m", name: "Truss", owned: 0, available: 0 });
    expect(row.facts.dayRate).toEqual({ kind: "money", amount: null });
    expect(row.facts.value).toEqual({ kind: "money", amount: null });
  });

  it("pricing state: all three, some, none", () => {
    expect(pricingState({ dailyRate: 1, weeklyRate: 2, monthlyRate: 3 })).toBe("complete");
    expect(pricingState({ dailyRate: 1 })).toBe("incomplete");
    expect(pricingState({})).toBe("none");
  });

  it("the row subtitle reads category, maker, model number and links to the model page", () => {
    const row = modelRowOf({ id: "m1", name: "Aura", manufacturer: "Martin", modelNumber: "XB", owned: 2, available: 1, category: { name: "Heads", parentName: "Lighting" } });
    expect(row.subtitle).toBe("Lighting → Heads · Martin · XB");
    expect(row.href).toBe("/assets/models/m1");
  });
});

describe("sales stock list view", () => {
  const sbase = defaultListState(SALES_STOCK_SPEC);
  it("Low and Out strip filter through one segment arg", () => {
    expect(salesStockQueryArgs({ ...sbase, seg: "low" })).toMatchObject({ segment: "low" });
    expect(salesStockQueryArgs(sbase).segment).toBeUndefined();
  });

  it("flags: out, oversold, low, ok", () => {
    expect(saleStockFlags({ state: "OUT", available: 0 })).toEqual([{ label: "Out of stock", tone: "error" }]);
    expect(saleStockFlags({ state: "OUT", available: -2 })).toEqual([{ label: "Oversold 2", tone: "error" }]);
    expect(saleStockFlags({ state: "LOW", available: 3 })).toEqual([{ label: "Low stock", tone: "warning" }]);
    expect(saleStockFlags({ state: "OK", available: 30 })).toEqual([]);
  });

  it("an unset reorder level prints a dash, never 0", () => {
    const row = saleStockRowOf({ id: "m", name: "Tape", onHand: 5, reserved: 0, available: 5, state: "OK" });
    expect(row.facts.reorderAt).toEqual({ kind: "text", label: "—" });
    expect(row.facts.price).toEqual({ kind: "money", amount: null });
  });
});
