/**
 * Pure helpers for the line-item fulfillment model — Convex copy of
 * `src/lib/line-item-units.ts` (Convex functions can't import from `src/`).
 * Keep in sync with the source; statuses are typed as plain strings here since
 * the comparisons are against string literals.
 *
 * See docs/designs/line-item-fulfillment-model.md.
 */

/** The subset of a `projectLineItemUnit` the rollups need. */
export interface UnitLike {
  /** 1 for a serialised unit; the ordered count for a bulk unit row. */
  quantity: number;
  /** Of `quantity`, how many have come back (bulk partial returns). */
  returnedQuantity: number;
  status: string;
  prepStatus: string | null | undefined;
  returnCondition: string | null | undefined;
  returnStatus: string | null | undefined;
}

/** Rollup counters denormalised onto `projectLineItem`. */
export interface RollupCounters {
  assignedQuantity: number;
  packedQuantity: number;
  checkedOutQuantity: number;
  returnedQuantity: number;
  damagedQuantity: number;
  lostQuantity: number;
}

/** Roll the per-unit rows up into the counters stored on the order line. */
export function computeRollupCounters(units: readonly UnitLike[]): RollupCounters {
  const counters: RollupCounters = {
    assignedQuantity: 0,
    packedQuantity: 0,
    checkedOutQuantity: 0,
    returnedQuantity: 0,
    damagedQuantity: 0,
    lostQuantity: 0,
  };

  for (const u of units) {
    const qty = u.quantity;
    counters.assignedQuantity += qty;
    const returned = u.status === "RETURNED" ? qty : u.returnedQuantity;
    counters.returnedQuantity += returned;
    counters.checkedOutQuantity += u.status === "CHECKED_OUT" ? qty - u.returnedQuantity : 0;
    if (u.prepStatus === "PACKED") counters.packedQuantity += qty;
    if (u.returnCondition === "DAMAGED") counters.damagedQuantity += qty;
    if (u.returnStatus === "LOST") counters.lostQuantity += qty;
  }

  return counters;
}

/** Derive the order line's coarse display status from its units. */
export function deriveOrderLineStatus(
  baseStatus: string,
  units: readonly UnitLike[],
): string {
  if (baseStatus === "CANCELLED") return "CANCELLED";
  if (units.length === 0) return baseStatus;
  if (units.some((u) => u.status === "CHECKED_OUT")) return "CHECKED_OUT";
  if (units.every((u) => u.status === "RETURNED")) return "RETURNED";
  if (units.some((u) => u.status === "PREPPED" || u.prepStatus === "PACKED")) return "PREPPED";
  return baseStatus === "QUOTED" ? "QUOTED" : "CONFIRMED";
}

/** Derive the order line's `prepStatus` from its units. */
export function deriveOrderLinePrepStatus(
  currentPrepStatus: string | null | undefined,
  units: readonly UnitLike[],
): string | null | undefined {
  if (currentPrepStatus === "FLAGGED_FAULTY" || currentPrepStatus === "FLAGGED_TT_OVERDUE") {
    return currentPrepStatus;
  }
  // RETURNED/CANCELLED units keep their prepStatus as return-time history (return
  // never clears it) — they must not re-promote the line to PACKED after a deprep
  // has just reset it, or Returned→De-prepped can never complete (gearflow#797).
  if (units.some((u) => u.prepStatus === "PACKED" && u.status !== "RETURNED" && u.status !== "CANCELLED")) return "PACKED";
  return currentPrepStatus;
}

/** Derive the order line's `returnCondition` from its units — return only ever
 *  writes `returnCondition` onto the unit row, never the line, so without this
 *  the line's own field stays permanently null for any per-unit-tracked item
 *  and downstream readers (close-out summary/tally) can't see it. "Worst
 *  condition wins" across units that have a recorded condition — DAMAGED beats
 *  MISSING beats GOOD, so a single damaged unit on a multi-unit line still
 *  surfaces as an exception. Units not yet returned (no recorded condition)
 *  are ignored, not treated as missing data. */
export function deriveOrderLineReturnCondition(
  currentReturnCondition: string | null | undefined,
  units: readonly UnitLike[],
): string | null | undefined {
  const withCondition = units.filter((u) => u.returnCondition != null);
  if (withCondition.length === 0) return currentReturnCondition;
  if (withCondition.some((u) => u.returnCondition === "DAMAGED")) return "DAMAGED";
  if (withCondition.some((u) => u.returnCondition === "MISSING")) return "MISSING";
  return "GOOD";
}

/** Next free `ordinal` for a new unit on an order line (1..N, never reuses gaps). */
export function nextOrdinal(units: readonly { ordinal: number }[]): number {
  if (units.length === 0) return 1;
  return Math.max(...units.map((u) => u.ordinal)) + 1;
}

/** True when every ordered unit of the line has a fulfillment row. */
export function isFullyAssigned(orderedQuantity: number, units: readonly UnitLike[]): boolean {
  const assigned = units.reduce((n, u) => n + u.quantity, 0);
  return assigned >= orderedQuantity;
}
