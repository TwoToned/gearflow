import { describe, test, expect } from "vitest";
import { matchesSearch, compareValues, paginateItems } from "./listQuery";

describe("matchesSearch", () => {
  test("matches case-insensitively across any haystack", () => {
    expect(matchesSearch(["MIC-001", "Shure QLXD"], "shure")).toBe(true);
    expect(matchesSearch(["MIC-001", "Shure QLXD"], "MIC")).toBe(true);
    expect(matchesSearch(["MIC-001", null, undefined], "nope")).toBe(false);
  });

  test("ignores null/undefined haystack entries", () => {
    expect(matchesSearch([null, undefined, "Front of house"], "front")).toBe(true);
  });
});

describe("compareValues", () => {
  test("null is treated as the maximum value (last ascending, first descending)", () => {
    expect(compareValues(null, "a", 1)).toBeGreaterThan(0); // null after "a" ascending
    expect(compareValues("a", null, 1)).toBeLessThan(0);
    expect(compareValues(null, "a", -1)).toBeLessThan(0); // null before "a" descending
    expect(compareValues("a", null, -1)).toBeGreaterThan(0);
    expect(compareValues(null, null, 1)).toBe(0);
  });

  test("end-to-end: null sorts last in an ascending .sort(), first in descending", () => {
    const rows: (string | null)[] = ["b", null, "a"];
    expect([...rows].sort((x, y) => compareValues(x, y, 1))).toEqual(["a", "b", null]);
    expect([...rows].sort((x, y) => compareValues(x, y, -1))).toEqual([null, "b", "a"]);
  });

  test("compares numbers numerically", () => {
    expect(compareValues(1, 2, 1)).toBeLessThan(0);
    expect(compareValues(2, 1, 1)).toBeGreaterThan(0);
    expect(compareValues(1, 2, -1)).toBeGreaterThan(0);
  });

  test("compares booleans (false < true)", () => {
    expect(compareValues(false, true, 1)).toBeLessThan(0);
    expect(compareValues(true, false, 1)).toBeGreaterThan(0);
  });

  test("compares strings case-insensitively", () => {
    expect(compareValues("apple", "Banana", 1)).toBeLessThan(0);
    expect(compareValues("Banana", "apple", 1)).toBeGreaterThan(0);
  });
});

describe("paginateItems", () => {
  const rows = Array.from({ length: 23 }, (_, i) => i);

  test("slices the requested page", () => {
    const p1 = paginateItems(rows, 1, 10);
    expect(p1.items).toEqual(rows.slice(0, 10));
    expect(p1.total).toBe(23);
    expect(p1.totalPages).toBe(3);
    expect(p1.page).toBe(1);
    expect(p1.pageSize).toBe(10);

    const p3 = paginateItems(rows, 3, 10);
    expect(p3.items).toEqual([20, 21, 22]);
  });

  test("an out-of-range page returns an empty slice, not an error", () => {
    const p = paginateItems(rows, 99, 10);
    expect(p.items).toEqual([]);
    expect(p.total).toBe(23);
  });

  test("empty input", () => {
    const p = paginateItems([], 1, 25);
    expect(p.items).toEqual([]);
    expect(p.total).toBe(0);
    expect(p.totalPages).toBe(0);
  });
});
