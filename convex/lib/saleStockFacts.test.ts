// @vitest-environment node
import { describe, expect, test } from "vitest";
import { isReservedSaleLine, saleStockFacts, saleStockInSegment, parseSaleStockSegment } from "./saleStockFacts";

const live = { status: "CONFIRMED", isTemplate: false, liveVersionId: "v1" };
const line = { type: "SALE", saleMode: "NEW_STOCK", status: "CONFIRMED", quantity: 12, versionId: "v1", projectId: "p1" };

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

describe("isReservedSaleLine", () => {
  test("a live NEW_STOCK line on a confirmed job reserves", () => {
    expect(isReservedSaleLine(line, live)).toBe(true);
  });
  test.each([
    ["no project", line, undefined],
    ["template", line, { ...live, isTemplate: true }],
    ["dead job", line, { ...live, status: "CANCELLED" }],
    ["completed job", line, { ...live, status: "COMPLETED" }],
    ["line already out", { ...line, status: "CHECKED_OUT" }, live],
    ["line cancelled", { ...line, status: "CANCELLED" }, live],
    ["not a sale line", { ...line, type: "EQUIPMENT" }, live],
    ["from rental stock", { ...line, saleMode: "FROM_RENTAL_STOCK" }, live],
    ["not the live version", { ...line, versionId: "v0" }, live],
    ["no version", { ...line, versionId: null }, live],
  ])("%s does not reserve", (_n, l, p) => {
    expect(isReservedSaleLine(l, p)).toBe(false);
  });
  test("an absent saleMode defaults to NEW_STOCK", () => {
    expect(isReservedSaleLine({ ...line, saleMode: undefined }, live)).toBe(true);
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
