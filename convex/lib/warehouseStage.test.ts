// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  floorCounts,
  warehouseStage,
  isLate,
  EMPTY_FLOOR_COUNTS,
  FLOOR_STAGE_KEYS,
  type FloorLine,
} from "./warehouseStage";

const line = (over: Partial<FloorLine> & { id: string }): FloorLine => ({
  type: "EQUIPMENT", status: "CONFIRMED", quantity: 1, ...over,
});

describe("floorCounts", () => {
  it("counts leaf gear only: no services, containers, accessories, cancelled or empty rows", () => {
    const c = floorCounts([
      line({ id: "a", quantity: 4 }),
      line({ id: "svc", type: "SERVICE", quantity: 1 }),
      line({ id: "box", isContainerLineItem: true }),
      line({ id: "acc", isKitChild: true, childKind: "ACCESSORY", parentLineItemId: "a", quantity: 4 }),
      line({ id: "x", status: "CANCELLED", quantity: 2 }),
      line({ id: "z", quantity: 0 }),
    ]);
    expect(c).toMatchObject({ lines: 1, items: 4, linesToPick: 1 });
  });

  it("counts kit members, not the kit parent; and a sub-hire group's children, not the wrapper", () => {
    const c = floorCounts([
      line({ id: "kit", kitId: "k1", quantity: 1 }),
      line({ id: "m1", isKitChild: true, childKind: "KIT", parentLineItemId: "kit", quantity: 2 }),
      line({ id: "m2", isKitChild: true, childKind: "KIT", parentLineItemId: "kit", quantity: 1 }),
      line({ id: "sh", subHireId: "s1", quantity: 1 }),
      line({ id: "shc", isKitChild: true, parentLineItemId: "sh", subHireId: "s1", quantity: 3 }),
    ]);
    expect(c).toMatchObject({ lines: 3, items: 6 });
  });

  it("reads units from the rollup counters, and falls back to status without them", () => {
    const c = floorCounts([
      line({ id: "a", quantity: 10, packedQuantity: 4, checkedOutQuantity: 0, returnedQuantity: 0 }),
      line({ id: "b", quantity: 2, status: "PREPPED" }),
    ]);
    expect(c).toMatchObject({ items: 12, packed: 6, out: 0, back: 0, linesToPick: 1 });
  });

  it("does not double-count packed units that have left the building", () => {
    const c = floorCounts([
      line({ id: "a", status: "CHECKED_OUT", quantity: 5, packedQuantity: 5, checkedOutQuantity: 3, returnedQuantity: 0 }),
    ]);
    expect(c).toMatchObject({ packed: 2, out: 3, linesToPick: 0 });
  });

  it("tallies damaged and missing", () => {
    const c = floorCounts([
      line({ id: "a", status: "CHECKED_OUT", quantity: 3, checkedOutQuantity: 1, returnedQuantity: 2, damagedQuantity: 1, lostQuantity: 1 }),
    ]);
    expect(c).toMatchObject({ out: 1, back: 2, damaged: 1, missing: 1 });
  });
});

describe("warehouseStage", () => {
  it("a half-returned line is Returning (the live bug read it as Out)", () => {
    const c = floorCounts([
      line({ id: "a", status: "CHECKED_OUT", quantity: 4, checkedOutQuantity: 2, returnedQuantity: 2 }),
    ]);
    expect(warehouseStage(c)).toBe("returning");
  });

  it("follows the §9c.2 order", () => {
    expect(warehouseStage({ ...EMPTY_FLOOR_COUNTS, out: 1, linesToPick: 3 })).toBe("out");
    expect(warehouseStage({ ...EMPTY_FLOOR_COUNTS, lines: 2, items: 2, packed: 2 })).toBe("ready");
    expect(warehouseStage({ ...EMPTY_FLOOR_COUNTS, lines: 2, items: 2, packed: 1, linesToPick: 1 })).toBe("prepping");
    expect(warehouseStage({ ...EMPTY_FLOOR_COUNTS, lines: 2, items: 2, linesToPick: 2 })).toBe("topick");
  });

  it("an empty job has nothing to pick, so it is Ready", () => {
    expect(warehouseStage(floorCounts([]))).toBe("ready");
  });

  it("keys are the five columns in board order", () => {
    expect(FLOOR_STAGE_KEYS).toEqual(["topick", "prepping", "ready", "out", "returning"]);
  });
});

describe("isLate (D29)", () => {
  const END = Date.UTC(2026, 10, 14);
  const DAY = 86_400_000;
  it("a unit still out is late only after the end day", () => {
    expect(isLate({ status: "CHECKED_OUT" }, END, END + DAY / 2)).toBe(false);
    expect(isLate({ status: "CHECKED_OUT" }, END, END + DAY + 1)).toBe(true);
  });
  it("a returned unit is late when it came back after the end day", () => {
    expect(isLate({ status: "RETURNED", returnedAt: END + 3600_000 }, END, END + 10 * DAY)).toBe(false);
    expect(isLate({ status: "RETURNED", returnedAt: END + 2 * DAY }, END, END + 10 * DAY)).toBe(true);
    expect(isLate({ status: "RETURNED" }, END, END + 10 * DAY)).toBe(false);
  });
  it("a job with no end is never late", () => {
    expect(isLate({ status: "CHECKED_OUT" }, null, END)).toBe(false);
  });
});
