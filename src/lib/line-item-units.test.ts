import { describe, it, expect } from "vitest";
import {
  computeRollupCounters,
  deriveOrderLineStatus,
  nextOrdinal,
  isFullyAssigned,
  type UnitLike,
} from "./line-item-units";

/** Build a UnitLike with sensible defaults; override what the test cares about. */
function unit(over: Partial<UnitLike> = {}): UnitLike {
  return {
    quantity: 1,
    returnedQuantity: 0,
    status: "CONFIRMED",
    prepStatus: null,
    returnCondition: null,
    returnStatus: null,
    ...over,
  };
}

describe("computeRollupCounters", () => {
  it("returns all zeros for no units", () => {
    expect(computeRollupCounters([])).toEqual({
      assignedQuantity: 0,
      packedQuantity: 0,
      checkedOutQuantity: 0,
      returnedQuantity: 0,
      damagedQuantity: 0,
      lostQuantity: 0,
    });
  });

  it("counts serialised units that are checked out", () => {
    const units = [
      unit({ status: "CHECKED_OUT" }),
      unit({ status: "CHECKED_OUT" }),
      unit({ status: "CONFIRMED" }),
    ];
    const c = computeRollupCounters(units);
    expect(c.assignedQuantity).toBe(3);
    expect(c.checkedOutQuantity).toBe(2);
    expect(c.returnedQuantity).toBe(0);
  });

  it("counts a fully-returned serialised unit's whole quantity", () => {
    const c = computeRollupCounters([unit({ status: "RETURNED" })]);
    expect(c.returnedQuantity).toBe(1);
    expect(c.checkedOutQuantity).toBe(0);
  });

  it("handles a bulk unit with a partial return", () => {
    // A bulk row: 10 ordered, 4 already back, still checked out.
    const c = computeRollupCounters([
      unit({ quantity: 10, returnedQuantity: 4, status: "CHECKED_OUT" }),
    ]);
    expect(c.assignedQuantity).toBe(10);
    expect(c.checkedOutQuantity).toBe(6);
    expect(c.returnedQuantity).toBe(4);
  });

  it("counts packed, damaged and lost units", () => {
    const c = computeRollupCounters([
      unit({ prepStatus: "PACKED" }),
      unit({ prepStatus: "PACKED", status: "RETURNED", returnCondition: "DAMAGED" }),
      unit({ status: "RETURNED", returnStatus: "LOST" }),
    ]);
    expect(c.packedQuantity).toBe(2);
    expect(c.damagedQuantity).toBe(1);
    expect(c.lostQuantity).toBe(1);
  });
});

describe("deriveOrderLineStatus", () => {
  it("keeps a cancelled line cancelled regardless of units", () => {
    expect(deriveOrderLineStatus("CANCELLED", [unit({ status: "CHECKED_OUT" })])).toBe(
      "CANCELLED",
    );
  });

  it("falls back to the base status when there are no units", () => {
    expect(deriveOrderLineStatus("QUOTED", [])).toBe("QUOTED");
    expect(deriveOrderLineStatus("CONFIRMED", [])).toBe("CONFIRMED");
  });

  it("reports CHECKED_OUT when any unit is still out", () => {
    const units = [unit({ status: "RETURNED" }), unit({ status: "CHECKED_OUT" })];
    expect(deriveOrderLineStatus("CONFIRMED", units)).toBe("CHECKED_OUT");
  });

  it("reports RETURNED only when every unit is back", () => {
    expect(
      deriveOrderLineStatus("CONFIRMED", [
        unit({ status: "RETURNED" }),
        unit({ status: "RETURNED" }),
      ]),
    ).toBe("RETURNED");
  });

  it("reports PREPPED when units are packed but none are out", () => {
    expect(
      deriveOrderLineStatus("CONFIRMED", [unit({ prepStatus: "PACKED" })]),
    ).toBe("PREPPED");
  });
});

describe("nextOrdinal", () => {
  it("starts at 1 for an empty line", () => {
    expect(nextOrdinal([])).toBe(1);
  });

  it("is one past the highest existing ordinal, never reusing gaps", () => {
    expect(nextOrdinal([{ ordinal: 1 }, { ordinal: 3 }])).toBe(4);
  });
});

describe("isFullyAssigned", () => {
  it("is false when fewer units are assigned than ordered", () => {
    expect(isFullyAssigned(10, [unit(), unit()])).toBe(false);
  });

  it("is true once assigned units meet the ordered quantity", () => {
    expect(isFullyAssigned(2, [unit(), unit()])).toBe(true);
    expect(isFullyAssigned(10, [unit({ quantity: 10 })])).toBe(true);
  });
});
