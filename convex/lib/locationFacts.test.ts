// @vitest-environment node
import { describe, expect, test } from "vitest";
import { binLabelState, locationFill, locationInSegment, parseLocationSegment, subtreeTotals } from "./locationFacts";

describe("locationFill", () => {
  test.each([
    [412, 600, 69],
    [0, 600, 0],
    [700, 600, 117],
  ])("%i of %i is %i%%", (stored, cap, pct) => expect(locationFill(stored, cap)).toBe(pct));
  test("no capacity (absent, 0, negative, NaN) is null, never 0%", () => {
    for (const cap of [undefined, null, 0, -4, NaN]) expect(locationFill(10, cap)).toBeNull();
  });
});

describe("bin label state", () => {
  test("printed only once stamped", () => {
    expect(binLabelState(undefined)).toBe("not-printed");
    expect(binLabelState(1700000000000)).toBe("printed");
  });
});

describe("strip segments", () => {
  test("Sites is Venue + Offsite; an unset type reads Offsite", () => {
    expect(locationInSegment({ type: "VENUE" }, "sites", 5)).toBe(true);
    expect(locationInSegment({ type: "OFFSITE" }, "sites", 5)).toBe(true);
    expect(locationInSegment({}, "sites", 5)).toBe(true);
    expect(locationInSegment({ type: "VEHICLE" }, "sites", 5)).toBe(false);
    expect(locationInSegment({ type: "WAREHOUSE" }, "warehouses", 5)).toBe(true);
    expect(locationInSegment({ type: "VEHICLE" }, "vehicles", 0)).toBe(true);
  });
  test("Empty means nothing in the place or any bin under it", () => {
    expect(locationInSegment({ type: "WAREHOUSE" }, "empty", 0)).toBe(true);
    expect(locationInSegment({ type: "WAREHOUSE" }, "empty", 3)).toBe(false);
  });
  test("unknown keys read as All", () => expect(parseLocationSegment("nope")).toBe("all"));
});

describe("subtreeTotals", () => {
  test("a parent counts its bins; a cycle cannot loop", () => {
    const locs = [{ id: "w" }, { id: "b1", parentId: "w" }, { id: "b2", parentId: "b1" }, { id: "x", parentId: "y" }, { id: "y", parentId: "x" }];
    const t = subtreeTotals(locs, new Map([["w", 1], ["b1", 2], ["b2", 4], ["x", 8], ["y", 16]]));
    expect(t.get("w")).toBe(7);
    expect(t.get("b1")).toBe(6);
    expect(t.get("x")).toBe(24);
  });
});
