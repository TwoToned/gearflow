// @vitest-environment node
import { describe, expect, test } from "vitest";
import { isReservedSaleLine, saleStockFacts, saleStockInSegment, parseSaleStockSegment } from "./saleStockFacts";

const line = { type: "SALE", saleMode: "NEW_STOCK", status: "CONFIRMED", quantity: 12, modelId: "m1" };

describe("saleStockFacts: On hand - Reserved = Available, never double-counted", () => {
  test.each([
    { pool: 0, reserved: 12 },
    { pool: 5, reserved: 0 },
    { pool: -3, reserved: 3 },
    { pool: 40, reserved: 12 },
    { pool: undefined, reserved: 0 },
  ])("pool $pool reserved $reserved", ({ pool, reserved }) => {
    const f = saleStockFacts({ pool, reserved });
    expect(f.onHand - f.reserved).toBe(f.available);
    expect(f.available).toBe(pool ?? 0);
  });

  test("the story row: out of stock with 12 reserved", () => {
    const f = saleStockFacts({ pool: 0, reserved: 12, reorderLevel: 20 });
    expect(f).toMatchObject({ onHand: 12, reserved: 12, available: 0, state: "OUT" });
  });

  test("LOW only with a set level; a missing level is never read as 0", () => {
    expect(saleStockFacts({ pool: 3, reserved: 0, reorderLevel: 5 }).state).toBe("LOW");
    expect(saleStockFacts({ pool: 5, reserved: 0, reorderLevel: 5 }).state).toBe("LOW");
    expect(saleStockFacts({ pool: 6, reserved: 0, reorderLevel: 5 }).state).toBe("OK");
    expect(saleStockFacts({ pool: 3, reserved: 0 }).state).toBe("OK");
    expect(saleStockFacts({ pool: 3, reserved: 0, reorderLevel: null }).state).toBe("OK");
    expect(saleStockFacts({ pool: 3, reserved: 0, reorderLevel: 0 }).state).toBe("OK");
  });

  test("a negative pool (oversold) is OUT", () => {
    expect(saleStockFacts({ pool: -2, reserved: 2 }).state).toBe("OUT");
  });
});

// The write-path-driven cases (cancelled job, draft version, unset saleMode, CHECKED_OUT, lineage copies)
// live in convex/saleStockReserved.test.ts; these pin the pure predicate.
describe("isReservedSaleLine", () => {
  test("an explicit NEW_STOCK line with a model reserves, whatever its job or version", () => {
    expect(isReservedSaleLine(line)).toBe(true);
    expect(isReservedSaleLine({ ...line, status: "CANCELLED" })).toBe(true);
  });
  test.each([
    ["line already out", { ...line, status: "CHECKED_OUT" }],
    ["line returned", { ...line, status: "RETURNED" }],
    ["not a sale line", { ...line, type: "EQUIPMENT" }],
    ["from rental stock", { ...line, saleMode: "FROM_RENTAL_STOCK" }],
    ["unset saleMode (the write path does not decrement it)", { ...line, saleMode: undefined }],
    ["no model", { ...line, modelId: undefined }],
  ])("%s does not reserve", (_n, l) => {
    expect(isReservedSaleLine(l)).toBe(false);
  });
});

describe("segments", () => {
  test("keys", () => {
    expect(parseSaleStockSegment("nope")).toBe("all");
    expect(saleStockInSegment("LOW", "low")).toBe(true);
    expect(saleStockInSegment("OUT", "low")).toBe(false);
    expect(saleStockInSegment("OUT", "out")).toBe(true);
    expect(saleStockInSegment("OK", "all")).toBe(true);
  });
});
