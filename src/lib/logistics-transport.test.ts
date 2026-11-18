import { describe, expect, it } from "vitest";

import { mergeStops, subHireStops } from "./logistics-transport";

const order = (o: Partial<Parameters<typeof subHireStops>[0][number]> = {}) => ({
  id: "sh1", supplierId: "s1", orderNumber: "SH-1", status: "CONFIRMED",
  hireStart: Date.UTC(2026, 10, 10), hireEnd: Date.UTC(2026, 10, 14), ...o,
});
const name = (id: string) => (id === "s1" ? "Acme Hire" : "");

describe("subHireStops", () => {
  it("derives a collect on hireStart and a return on hireEnd", () => {
    expect(subHireStops([order()], name).map((s) => [s.day, s.title])).toEqual([
      ["2026-11-10", "Collect from Acme Hire"],
      ["2026-11-14", "Return to Acme Hire"],
    ]);
  });

  it("skips cancelled orders and undated ends, and falls back when the supplier is unknown", () => {
    expect(subHireStops([order({ status: "CANCELLED" })], name)).toEqual([]);
    const only = subHireStops([order({ hireEnd: undefined, supplierId: "gone" })], name);
    expect(only).toHaveLength(1);
    expect(only[0].title).toBe("Collect from supplier");
  });
});

describe("mergeStops", () => {
  it("adds a day where only a stop falls and keeps days ascending", () => {
    const groups = [{ key: "2026-11-12", services: [] }];
    const merged = mergeStops(groups, subHireStops([order()], name));
    expect(merged.map((g) => g.key)).toEqual(["2026-11-10", "2026-11-12", "2026-11-14"]);
    expect(merged[1].stops).toEqual([]);
  });

  it("returns the groups untouched when there are no stops", () => {
    const groups = [{ key: "2026-11-12", services: [] }];
    expect(mergeStops(groups, [])).toBe(groups);
  });
});
