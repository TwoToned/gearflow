/**
 * A maintenance record's COST and PARTS facts: DERIVED, never stored (UX Phase 14, D76).
 *
 *   cost = parts + labour
 *   parts  = Σ quantity × unitPrice over the PRICED part rows (an unpriced part contributes nothing, and is counted)
 *   labour = `maintenanceRecords.cost`, the one stored number (blank is "not entered", never $0)
 *
 * `total` is `null` when there is nothing to add up (no labour and no priced part): the page prints a dash, never $0,
 * the same "blank is not zero" rule as every other optional money field. A part is ON ORDER until `arrivedAt` is set.
 * Pure: the browser reads it too (the record page, the Complete dialog, the list's Cost column).
 */
import { overdueCutoff } from "./maintenanceOpen";

/** The ceiling on any ONE maintenance money entry (a part's unit price, a record's labour): the server and the forms share it. */
export const MAX_MAINTENANCE_MONEY = 10_000_000;

export interface PartLike {
  quantity: number;
  unitPrice?: number | null;
  arrivedAt?: number | null;
  etaDate?: number | null;
}

export interface MaintenanceCostFacts {
  /** Σ quantity × unitPrice over the priced parts (0 when none are priced). */
  parts: number;
  /** The record's stored labour, or `null` when none was entered. */
  labour: number | null;
  /** parts + labour, or `null` when there is neither labour nor a priced part. */
  total: number | null;
  /** How many parts have no price (their cost is unknown, not zero). */
  unpricedParts: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function maintenanceCost(labour: number | null | undefined, parts: readonly PartLike[]): MaintenanceCostFacts {
  let partsTotal = 0;
  let priced = 0;
  for (const p of parts) {
    if (p.unitPrice == null) continue;
    partsTotal += p.quantity * p.unitPrice;
    priced += 1;
  }
  const labourN = labour == null ? null : labour;
  return {
    parts: cents(partsTotal),
    labour: labourN,
    total: labourN == null && priced === 0 ? null : cents(partsTotal + (labourN ?? 0)),
    unpricedParts: parts.length - priced,
  };
}

export interface PartsSummary {
  count: number;
  onOrder: number;
  arrived: number;
  /** The earliest ETA among parts still on order, or `null`. */
  nextEta: number | null;
  /** Parts on order whose ETA day is before today (the same day rule as an overdue job). */
  late: number;
}

export function partsSummary(parts: readonly PartLike[], now: number): PartsSummary {
  let onOrder = 0;
  let late = 0;
  let nextEta: number | null = null;
  const cutoff = overdueCutoff(now);
  for (const p of parts) {
    if (p.arrivedAt != null) continue;
    onOrder += 1;
    if (p.etaDate == null) continue;
    if (p.etaDate < cutoff) late += 1;
    if (nextEta == null || p.etaDate < nextEta) nextEta = p.etaDate;
  }
  return { count: parts.length, onOrder, arrived: parts.length - onOrder, nextEta, late };
}
