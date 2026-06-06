import { describe, it, expect } from "vitest";
import {
  normalizeKey,
  parseRateValue,
  parseRateRow,
  buildModelIndex,
  matchModel,
  hasRateColumn,
  hasIdentifierColumn,
  type ModelIndexEntry,
} from "./rate-import";

function cellsFrom(record: Record<string, string>): Map<string, string> {
  const m = new Map<string, string>();
  for (const [k, v] of Object.entries(record)) m.set(normalizeKey(k), v);
  return m;
}

describe("normalizeKey", () => {
  it("lowercases and strips spaces/underscores/dashes/hash", () => {
    expect(normalizeKey("Daily_Rate")).toBe("dailyrate");
    expect(normalizeKey("Model Number")).toBe("modelnumber");
    expect(normalizeKey("Model#")).toBe("model");
    expect(normalizeKey(" SKU ")).toBe("sku");
  });
});

describe("parseRateValue", () => {
  it("returns no value for blank", () => {
    expect(parseRateValue("")).toEqual({});
    expect(parseRateValue("   ")).toEqual({});
  });
  it("parses plain and currency-formatted numbers, rounding to cents", () => {
    expect(parseRateValue("50")).toEqual({ value: 50 });
    expect(parseRateValue("$1,250.5")).toEqual({ value: 1250.5 });
    expect(parseRateValue("99.999")).toEqual({ value: 100 });
  });
  it("rejects non-numbers and negatives", () => {
    expect(parseRateValue("abc").error).toBeTruthy();
    expect(parseRateValue("-5").error).toBeTruthy();
  });
});

describe("parseRateRow", () => {
  it("extracts identifier + rates with alias headers", () => {
    const parsed = parseRateRow(
      cellsFrom({ Name: "SM58", daily: "20", "Weekly Rate": "80", monthly: "" }),
    );
    expect(parsed.identifier.name).toBe("SM58");
    expect(parsed.rates).toEqual({ dailyRate: 20, weeklyRate: 80 });
    expect(parsed.hasRate).toBe(true);
    expect(parsed.errors).toHaveLength(0);
  });

  it("flags hasRate=false when no rate columns have values", () => {
    const parsed = parseRateRow(cellsFrom({ name: "SM58", dailyRate: "" }));
    expect(parsed.hasRate).toBe(false);
    expect(parsed.rates).toEqual({});
  });

  it("collects per-field parse errors", () => {
    const parsed = parseRateRow(cellsFrom({ name: "SM58", dailyRate: "-3", weeklyRate: "x" }));
    expect(parsed.hasRate).toBe(true);
    expect(parsed.errors).toHaveLength(2);
    expect(parsed.errors[0]).toContain("dailyRate");
    expect(parsed.errors[1]).toContain("weeklyRate");
  });
});

describe("buildModelIndex + matchModel", () => {
  const models: ModelIndexEntry[] = [
    { id: "m1", name: "SM58", sku: "SKU-1", modelNumber: "MN-1" },
    { id: "m2", name: "SM58", sku: "SKU-2", modelNumber: "MN-2" }, // duplicate name
    { id: "m3", name: "QSC K12", sku: null, modelNumber: null },
  ];
  const index = buildModelIndex(models);

  it("matches by id when present (highest priority)", () => {
    expect(matchModel({ id: "m1", name: "SM58" }, index)).toEqual({ modelId: "m1" });
  });

  it("errors on unknown id", () => {
    expect(matchModel({ id: "nope" }, index).error).toContain("not found");
  });

  it("matches by sku (case-insensitive) over a duplicate name", () => {
    expect(matchModel({ sku: "sku-2", name: "SM58" }, index)).toEqual({ modelId: "m2" });
  });

  it("matches by modelNumber", () => {
    expect(matchModel({ modelNumber: "MN-1" }, index)).toEqual({ modelId: "m1" });
  });

  it("matches by unique name", () => {
    expect(matchModel({ name: "QSC K12" }, index)).toEqual({ modelId: "m3" });
  });

  it("reports ambiguity when a name matches multiple models", () => {
    const m = matchModel({ name: "SM58" }, index);
    expect(m.modelId).toBeUndefined();
    expect(m.error).toContain("matches 2 models");
  });

  it("errors when no identifier is given", () => {
    expect(matchModel({}, index).error).toContain("No model identifier");
  });
});

describe("header guards", () => {
  it("hasRateColumn detects any rate alias", () => {
    expect(hasRateColumn(["name", "dailyrate"])).toBe(true);
    expect(hasRateColumn(["name", "weekly"])).toBe(true);
    expect(hasRateColumn(["name", "category"])).toBe(false);
  });
  it("hasIdentifierColumn detects any identifier alias", () => {
    expect(hasIdentifierColumn(["sku", "dailyrate"])).toBe(true);
    expect(hasIdentifierColumn(["name"])).toBe(true);
    expect(hasIdentifierColumn(["dailyrate", "weekly"])).toBe(false);
  });
});
