import { describe, it, expect } from "vitest";
import { serialize } from "./serialize";

describe("serialize", () => {
  // ─── Primitives ──────────────────────────────────────────────────────────
  describe("primitives", () => {
    it("returns null as-is", () => {
      expect(serialize(null)).toBeNull();
    });

    it("returns undefined as-is", () => {
      expect(serialize(undefined)).toBeUndefined();
    });

    it("returns strings as-is", () => {
      expect(serialize("hello")).toBe("hello");
      expect(serialize("")).toBe("");
    });

    it("returns numbers as-is", () => {
      expect(serialize(42)).toBe(42);
      expect(serialize(0)).toBe(0);
      expect(serialize(-1)).toBe(-1);
      expect(serialize(3.14)).toBe(3.14);
    });

    it("returns booleans as-is", () => {
      expect(serialize(true)).toBe(true);
      expect(serialize(false)).toBe(false);
    });
  });

  // ─── Dates ───────────────────────────────────────────────────────────────
  describe("dates", () => {
    it("returns Date objects as-is", () => {
      const date = new Date("2026-01-15");
      const result = serialize(date);
      expect(result).toBeInstanceOf(Date);
      expect(result).toBe(date);
    });

    it("preserves Date identity (does not clone)", () => {
      const date = new Date();
      expect(serialize(date)).toBe(date);
    });
  });

  // ─── Decimal-like objects (Prisma Decimal) ───────────────────────────────
  describe("Decimal-like objects", () => {
    it("converts object with toNumber() to a number", () => {
      const decimal = { toNumber: () => 99.95 };
      expect(serialize(decimal)).toBe(99.95);
    });

    it("converts zero Decimal", () => {
      const decimal = { toNumber: () => 0 };
      expect(serialize(decimal)).toBe(0);
    });

    it("converts negative Decimal", () => {
      const decimal = { toNumber: () => -42.5 };
      expect(serialize(decimal)).toBe(-42.5);
    });

    it("converts Decimal with very large value", () => {
      const decimal = { toNumber: () => 999999999.999 };
      expect(serialize(decimal)).toBe(999999999.999);
    });

    it("does not treat objects with non-function toNumber as Decimal", () => {
      const obj = { toNumber: "not a function", name: "test" };
      const result = serialize(obj);
      expect(result).toEqual({ toNumber: "not a function", name: "test" });
    });
  });

  // ─── Arrays ──────────────────────────────────────────────────────────────
  describe("arrays", () => {
    it("returns empty array", () => {
      expect(serialize([])).toEqual([]);
    });

    it("passes through array of primitives", () => {
      expect(serialize([1, "two", true, null])).toEqual([1, "two", true, null]);
    });

    it("converts Decimals inside arrays", () => {
      const arr = [{ toNumber: () => 10 }, { toNumber: () => 20 }];
      expect(serialize(arr)).toEqual([10, 20]);
    });

    it("handles nested arrays", () => {
      const arr = [[1, 2], [{ toNumber: () => 3 }]];
      expect(serialize(arr)).toEqual([[1, 2], [3]]);
    });

    it("handles arrays of objects with Decimal fields", () => {
      const arr = [
        { name: "Item 1", price: { toNumber: () => 9.99 } },
        { name: "Item 2", price: { toNumber: () => 19.99 } },
      ];
      expect(serialize(arr)).toEqual([
        { name: "Item 1", price: 9.99 },
        { name: "Item 2", price: 19.99 },
      ]);
    });
  });

  // ─── Objects ─────────────────────────────────────────────────────────────
  describe("objects", () => {
    it("returns empty object", () => {
      expect(serialize({})).toEqual({});
    });

    it("passes through plain object with primitives", () => {
      const obj = { name: "Test", count: 5, active: true };
      expect(serialize(obj)).toEqual({ name: "Test", count: 5, active: true });
    });

    it("converts Decimal fields in objects", () => {
      const obj = {
        name: "Widget",
        price: { toNumber: () => 49.99 },
        quantity: 3,
      };
      expect(serialize(obj)).toEqual({
        name: "Widget",
        price: 49.99,
        quantity: 3,
      });
    });

    it("preserves Date fields inside objects", () => {
      const date = new Date("2026-03-19");
      const obj = { createdAt: date, name: "Test" };
      const result = serialize(obj);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.createdAt).toBe(date);
    });

    it("handles deeply nested objects", () => {
      const obj = {
        level1: {
          level2: {
            level3: {
              value: { toNumber: () => 42 },
            },
          },
        },
      };
      expect(serialize(obj)).toEqual({
        level1: { level2: { level3: { value: 42 } } },
      });
    });

    it("handles mixed nested structure", () => {
      const obj = {
        name: "Project",
        lineItems: [
          {
            description: "Item A",
            unitPrice: { toNumber: () => 100 },
            quantity: 2,
            total: { toNumber: () => 200 },
            createdAt: new Date("2026-01-01"),
          },
        ],
        metadata: null,
      };
      const result = serialize(obj);
      expect(result).toEqual({
        name: "Project",
        lineItems: [
          {
            description: "Item A",
            unitPrice: 100,
            quantity: 2,
            total: 200,
            createdAt: expect.any(Date),
          },
        ],
        metadata: null,
      });
    });
  });

  // ─── Real-world Prisma-like patterns ─────────────────────────────────────
  describe("Prisma-like patterns", () => {
    it("handles a typical asset record", () => {
      const record = {
        id: "abc123",
        name: "Speaker",
        replacementCost: { toNumber: () => 1500 },
        purchasePrice: { toNumber: () => 1200 },
        weight: null,
        createdAt: new Date("2026-01-10"),
        updatedAt: new Date("2026-03-19"),
      };
      const result = serialize(record);
      expect(result.replacementCost).toBe(1500);
      expect(result.purchasePrice).toBe(1200);
      expect(result.weight).toBeNull();
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it("handles array of records with mixed types", () => {
      const records = [
        { id: "1", amount: { toNumber: () => 0 }, status: "ACTIVE" },
        { id: "2", amount: { toNumber: () => 999.99 }, status: null },
      ];
      const result = serialize(records);
      expect(result[0].amount).toBe(0);
      expect(result[1].amount).toBe(999.99);
      expect(result[1].status).toBeNull();
    });
  });
});
