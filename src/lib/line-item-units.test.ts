import { describe, it, expect } from "vitest";
import {
  computeRollupCounters,
  deriveOrderLineStatus,
  deriveOrderLinePrepStatus,
  deriveOrderLineReturnCondition,
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

describe("deriveOrderLinePrepStatus", () => {
  it("returns the current prepStatus when no units are packed", () => {
    expect(deriveOrderLinePrepStatus("PULLED", [])).toBe("PULLED");
    expect(deriveOrderLinePrepStatus("PENDING", [unit()])).toBe("PENDING");
    expect(deriveOrderLinePrepStatus(null, [unit()])).toBeNull();
  });

  it("promotes to PACKED the moment any unit is PACKED", () => {
    // Regression: a serialised prep packs one unit; the line was stuck
    // at PULLED so the deploy tab never showed it.
    expect(
      deriveOrderLinePrepStatus("PULLED", [unit({ prepStatus: "PACKED" })]),
    ).toBe("PACKED");
  });

  it("promotes from null/PENDING to PACKED on any packed unit", () => {
    expect(
      deriveOrderLinePrepStatus(null, [unit({ prepStatus: "PACKED" })]),
    ).toBe("PACKED");
    expect(
      deriveOrderLinePrepStatus("PENDING", [unit({ prepStatus: "PACKED" })]),
    ).toBe("PACKED");
  });

  it("partial pack on a 10x line: one PACKED unit → line PACKED", () => {
    // Operator's mental model: as soon as the first unit is prepped,
    // the line shows up in the deploy tab. Quantity-aware UX handles
    // "1 of 10 ready" separately via the rollup counters.
    const units = [
      unit({ prepStatus: "PACKED" }),
      ...Array.from({ length: 9 }, () => unit({ prepStatus: null })),
    ];
    expect(deriveOrderLinePrepStatus("PULLED", units)).toBe("PACKED");
  });

  it("preserves FLAGGED_FAULTY override even when units are packed", () => {
    // completeCheckAndFlag is a manual operator override — a later
    // unit-rollup must not silently wipe it.
    expect(
      deriveOrderLinePrepStatus("FLAGGED_FAULTY", [
        unit({ prepStatus: "PACKED" }),
      ]),
    ).toBe("FLAGGED_FAULTY");
  });

  it("preserves FLAGGED_TT_OVERDUE override even when units are packed", () => {
    expect(
      deriveOrderLinePrepStatus("FLAGGED_TT_OVERDUE", [
        unit({ prepStatus: "PACKED" }),
      ]),
    ).toBe("FLAGGED_TT_OVERDUE");
  });

  it("gearflow#797: a RETURNED unit's stale PACKED prepStatus does not re-promote the line", () => {
    // Return never clears a unit's prepStatus (kept as history), so after
    // deprep resets the line to PENDING, the still-PACKED RETURNED unit must
    // not immediately flip it back to PACKED — else the item never leaves
    // the Return tab for De-prepped.
    const units = [unit({ status: "RETURNED", prepStatus: "PACKED" })];
    expect(deriveOrderLinePrepStatus("PENDING", units)).toBe("PENDING");
  });

  it("gearflow#797: a CANCELLED unit's stale PACKED prepStatus does not re-promote the line", () => {
    const units = [unit({ status: "CANCELLED", prepStatus: "PACKED" })];
    expect(deriveOrderLinePrepStatus("PENDING", units)).toBe("PENDING");
  });

  it("gearflow#797: a live PACKED unit still promotes the line even alongside a returned one", () => {
    const units = [
      unit({ status: "RETURNED", prepStatus: "PACKED" }),
      unit({ status: "CONFIRMED", prepStatus: "PACKED" }),
    ];
    expect(deriveOrderLinePrepStatus("PENDING", units)).toBe("PACKED");
  });
});

describe("deriveOrderLineReturnCondition", () => {
  it("returns the current value when no unit has a recorded condition", () => {
    expect(deriveOrderLineReturnCondition(null, [unit()])).toBeNull();
    expect(deriveOrderLineReturnCondition("GOOD", [unit({ status: "CHECKED_OUT" })])).toBe(
      "GOOD",
    );
  });

  it("gearflow#797 follow-up: a returned unit's condition promotes the line, which return itself never does", () => {
    // Regression: returnLineUnits only ever patches the UNIT's returnCondition,
    // never the line's — so the close-out summary (which reads the line field)
    // saw every per-unit-tracked return as null and flagged it "still pending"
    // even though the item was correctly returned GOOD.
    const units = [unit({ status: "RETURNED", returnCondition: "GOOD" })];
    expect(deriveOrderLineReturnCondition(null, units)).toBe("GOOD");
  });

  it("worst condition wins: DAMAGED beats MISSING beats GOOD", () => {
    expect(
      deriveOrderLineReturnCondition(null, [
        unit({ status: "RETURNED", returnCondition: "GOOD" }),
        unit({ status: "RETURNED", returnCondition: "DAMAGED" }),
        unit({ status: "RETURNED", returnCondition: "MISSING" }),
      ]),
    ).toBe("DAMAGED");
    expect(
      deriveOrderLineReturnCondition(null, [
        unit({ status: "RETURNED", returnCondition: "GOOD" }),
        unit({ status: "RETURNED", returnCondition: "MISSING" }),
      ]),
    ).toBe("MISSING");
  });

  it("ignores units that haven't been returned yet (no recorded condition)", () => {
    const units = [
      unit({ status: "RETURNED", returnCondition: "GOOD" }),
      unit({ status: "CHECKED_OUT", returnCondition: null }),
    ];
    expect(deriveOrderLineReturnCondition(null, units)).toBe("GOOD");
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
