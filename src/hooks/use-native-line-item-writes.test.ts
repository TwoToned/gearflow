import { describe, test, expect } from "vitest";
import {
  computeLineTotal,
  applyOptimisticEdits,
  applyOrderOverlay,
  type OptimisticLineEdit,
  type OptimisticOrderEdit,
} from "./use-native-line-item-writes";

describe("computeLineTotal", () => {
  test("gross = unitPrice × qty × duration, minus discount, rounded, floored at 0", () => {
    expect(computeLineTotal(100, 2, 3, undefined)).toBe(600);
    expect(computeLineTotal(100, 2, 3, 50)).toBe(550);
    expect(computeLineTotal(10.005, 1, 1, undefined)).toBe(10.01); // currency rounding
    expect(computeLineTotal(100, 1, 1, 999)).toBe(0); // never negative
  });
  test("null unit price → null total (parity with server)", () => {
    expect(computeLineTotal(undefined, 2, 1, undefined)).toBeNull();
  });
});

describe("applyOptimisticEdits", () => {
  const lines = [
    { id: "l1", quantity: 1, unitPrice: 100, discount: null, description: "Old", notes: null, lineTotal: 100 },
    { id: "l2", quantity: 5, unitPrice: 20, discount: null, description: "Keep", notes: null, lineTotal: 100 },
  ];

  test("empty overlay is a no-op reference", () => {
    const out = applyOptimisticEdits(lines, new Map());
    expect(out).toBe(lines);
  });

  test("patches only the matching row; leaves others untouched", () => {
    const edit: OptimisticLineEdit = { quantity: 3, unitPrice: 100, discount: 25, description: "New", notes: "hi", lineTotal: 275 };
    const out = applyOptimisticEdits(lines, new Map([["l1", edit]]));
    expect(out[0]).toMatchObject({ id: "l1", quantity: 3, unitPrice: 100, discount: 25, description: "New", notes: "hi", lineTotal: 275 });
    expect(out[1]).toBe(lines[1]); // untouched row keeps its reference
  });

  test("undefined optional fields overlay as null (cleared)", () => {
    const edit: OptimisticLineEdit = { quantity: 2, unitPrice: undefined, discount: undefined, description: "X", notes: undefined, lineTotal: null };
    const out = applyOptimisticEdits(lines, new Map([["l1", edit]]));
    expect(out[0]).toMatchObject({ unitPrice: null, discount: null, notes: null, lineTotal: null });
  });
});

describe("applyOrderOverlay", () => {
  const rows = [
    { id: "l1", sortOrder: 0, groupId: "g1", categoryId: "c1" },
    { id: "l2", sortOrder: 1, groupId: "g1", categoryId: "c1" },
  ];

  test("empty overlay is a no-op reference", () => {
    const out = applyOrderOverlay(rows, new Map());
    expect(out).toBe(rows);
  });

  test("same-container reorder patches sortOrder only, leaves groupId/categoryId untouched", () => {
    const edit: OptimisticOrderEdit = { sortOrder: 5 };
    const out = applyOrderOverlay(rows, new Map([["l1", edit]]));
    expect(out[0]).toMatchObject({ id: "l1", sortOrder: 5, groupId: "g1", categoryId: "c1" });
    expect(out[1]).toBe(rows[1]); // untouched row keeps its reference
  });

  test("cross-container move patches sortOrder + groupId/categoryId, including a clear to null", () => {
    const edit: OptimisticOrderEdit = { sortOrder: 0, groupId: null, categoryId: null };
    const out = applyOrderOverlay(rows, new Map([["l1", edit]]));
    expect(out[0]).toMatchObject({ id: "l1", sortOrder: 0, groupId: null, categoryId: null });
  });
});
