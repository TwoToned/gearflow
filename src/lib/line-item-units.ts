/**
 * Pure helpers for the line-item fulfillment model.
 *
 * A `ProjectLineItem` is the ORDER line (what was ordered, at a rate). Its
 * `ProjectLineItemUnit` rows are the FULFILLMENT — one row per assigned
 * physical unit (serialised: one each, quantity 1; bulk: one row carrying a
 * quantity). Per-unit deploy/return state lives on the unit; the order line
 * carries derived rollup counters and a derived display status.
 *
 * These functions are pure so they can be unit-tested without a database and
 * reused by both server actions and read paths. See
 * docs/designs/line-item-fulfillment-model.md.
 */

import type {
  LineItemStatus,
  PrepStatus,
  ReturnCondition,
  ReturnStatus,
} from "@/generated/prisma/client";

/** The subset of a `ProjectLineItemUnit` the rollups need. */
export interface UnitLike {
  /** 1 for a serialised unit; the ordered count for a bulk unit row. */
  quantity: number;
  /** Of `quantity`, how many have come back (bulk partial returns). */
  returnedQuantity: number;
  status: LineItemStatus;
  prepStatus: PrepStatus | null;
  returnCondition: ReturnCondition | null;
  returnStatus: ReturnStatus | null;
}

/** Rollup counters denormalised onto `ProjectLineItem`. */
export interface RollupCounters {
  /** Total physical units assigned to the order line. */
  assignedQuantity: number;
  /** Units prepped/packed and ready to go. */
  packedQuantity: number;
  /** Units currently deployed (not yet returned). */
  checkedOutQuantity: number;
  /** Units that have come back. */
  returnedQuantity: number;
  /** Units returned in damaged condition. */
  damagedQuantity: number;
  /** Units that never came back. */
  lostQuantity: number;
}

/**
 * Roll the per-unit rows up into the counters stored on the order line.
 * Truth lives in the unit rows; these counters are a denormalised cache kept
 * in sync transactionally on every unit write.
 */
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

    // A unit fully RETURNED contributes its whole quantity; a unit still out
    // contributes whatever partial quantity has come back so far.
    const returned = u.status === "RETURNED" ? qty : u.returnedQuantity;
    counters.returnedQuantity += returned;
    counters.checkedOutQuantity +=
      u.status === "CHECKED_OUT" ? qty - u.returnedQuantity : 0;

    if (u.prepStatus === "PACKED") counters.packedQuantity += qty;
    if (u.returnCondition === "DAMAGED") counters.damagedQuantity += qty;
    if (u.returnStatus === "LOST") counters.lostQuantity += qty;
  }

  return counters;
}

/**
 * Derive the order line's coarse display status from its units.
 *
 * This is a summary badge only — a qty-10 line that is part deployed, part
 * returned cannot be captured by one enum, so the precise picture is in the
 * rollup counters. Priority: a cancelled line stays cancelled; gear still out
 * shows CHECKED_OUT; everything back shows RETURNED; otherwise the prep /
 * base state.
 *
 * @param baseStatus the order line's own status when no units exist yet
 *   (typically QUOTED or CONFIRMED)
 */
export function deriveOrderLineStatus(
  baseStatus: LineItemStatus,
  units: readonly UnitLike[],
): LineItemStatus {
  if (baseStatus === "CANCELLED") return "CANCELLED";
  if (units.length === 0) return baseStatus;

  if (units.some((u) => u.status === "CHECKED_OUT")) return "CHECKED_OUT";
  if (units.every((u) => u.status === "RETURNED")) return "RETURNED";
  if (
    units.some((u) => u.status === "PREPPED" || u.prepStatus === "PACKED")
  ) {
    return "PREPPED";
  }
  return baseStatus === "QUOTED" ? "QUOTED" : "CONFIRMED";
}

/**
 * Next free `ordinal` for a new unit on an order line. Ordinals are a stable
 * 1..N identity within the line; they never reuse a gap, so a unit keeps its
 * number even after siblings are removed.
 */
export function nextOrdinal(units: readonly { ordinal: number }[]): number {
  if (units.length === 0) return 1;
  return Math.max(...units.map((u) => u.ordinal)) + 1;
}

/**
 * True when every ordered unit of the line has a fulfillment row. Useful for
 * "is this line fully picked / assigned" checks.
 */
export function isFullyAssigned(
  orderedQuantity: number,
  units: readonly UnitLike[],
): boolean {
  const assigned = units.reduce((n, u) => n + u.quantity, 0);
  return assigned >= orderedQuantity;
}
