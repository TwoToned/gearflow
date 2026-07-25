/**
 * Model ROI — shared vocabulary for the allocation reports.
 *
 * Plain module (not "use server"): imported by server actions, Convex-facing code,
 * and client components alike.
 */

/** Statuses where the money is real: the gear went out and the job is closed. */
export const EARNED_STATUSES = ["COMPLETED", "INVOICED"] as const;

/**
 * Committed work that hasn't closed yet. Opt-in, because counting it answers a
 * different question ("what will this gear have earned?") than the default.
 */
export const BOOKED_STATUSES = [
  "CONFIRMED",
  "PREPPING",
  "CHECKED_OUT",
  "ON_SITE",
  "RETURNED",
] as const;

/**
 * Never counted. A quote is not revenue — without this, every speculative quote the
 * sales team ever typed would inflate the fleet's earnings.
 */
export const NEVER_COUNTED_STATUSES = [
  "ENQUIRY",
  "QUOTING",
  "QUOTED",
  "CANCELLED",
] as const;

export type RoiScope = "earned" | "booked";

export const statusesForScope = (scope: RoiScope): string[] =>
  scope === "booked" ? [...EARNED_STATUSES, ...BOOKED_STATUSES] : [...EARNED_STATUSES];

export const ROI_SCOPE_LABELS: Record<RoiScope, string> = {
  earned: "Completed & invoiced",
  booked: "Including booked work",
};

/**
 * Trailing-12-months window, the default the reports open on.
 *
 * `to` is left open (undefined) for `booked` scope: that scope exists specifically
 * to surface committed FUTURE work (a CONFIRMED shoot next month), and capping `to`
 * at `now` would hide exactly the rows it's for — a user would have to also switch
 * to "All time" to see next week's booking, which reads as "the number is wrong"
 * rather than "the window is wrong". `earned` scope is inherently historical
 * (COMPLETED/INVOICED), so it keeps the `to: now` cap.
 */
export function defaultRoiWindow(
  scope: RoiScope,
  now: number = Date.now(),
): { from: number; to?: number } {
  const d = new Date(now);
  d.setFullYear(d.getFullYear() - 1);
  return scope === "booked" ? { from: d.getTime() } : { from: d.getTime(), to: now };
}

export interface RoiMetrics {
  revenue: number;
  unitsOwned: number;
  /** What it cost to acquire the units owned. Null when we can't know it. */
  fleetCost: number | null;
  /** revenue ÷ fleetCost. Null when there's no capital to measure against. */
  payback: number | null;
  /** revenue ÷ unitsOwned. Comparable across fleet sizes. */
  revenuePerUnit: number | null;
  /** Clamped 0–1, for a progress bar. */
  costRecovered: number | null;
  stillToRecover: number | null;
}

/**
 * ROI is measured against the capital actually deployed, not the cost of one unit
 * times a count: `fleetCost` arrives here PRE-SUMMED by the caller (`convex/roi.ts`
 * `fleetCapitalFor` / `fleetInventory`), one asset's real purchase price at a time
 * for serialised gear — falling back to the model's general purchase price, then its
 * replacement cost, per asset — with bulk stock still `replacementCost ×
 * totalQuantity` (see gearflow#798 / FEATUREDOCS/57-revenue-allocation-roi.md for
 * why the chain, not a single scalar). This function has no opinion on any of
 * that — it's pure division over whatever total it's handed.
 *
 * A model with no fleet cost, or none left in the fleet, has no ROI. Say so with
 * null — not 0 (looks like a dud) and not Infinity (looks like a triumph). A
 * pre-summed total of exactly $0 is indistinguishable from "nothing priced it", so
 * it's treated the same as null here — the caller already resolved that ambiguity
 * per-asset; this is just the last line of defence.
 */
export function computeRoi(
  revenue: number,
  unitsOwned: number,
  fleetCost: number | null | undefined,
): RoiMetrics {
  const cost = fleetCost != null && fleetCost > 0 && unitsOwned > 0 ? fleetCost : null;

  return {
    revenue,
    unitsOwned,
    fleetCost: cost,
    payback: cost ? revenue / cost : null,
    revenuePerUnit: unitsOwned > 0 ? revenue / unitsOwned : null,
    costRecovered: cost ? Math.min(1, Math.max(0, revenue / cost)) : null,
    stillToRecover: cost ? Math.max(0, cost - revenue) : null,
  };
}

/** "1.4×" — how many times over the gear has paid for itself. */
export function formatPayback(payback: number | null): string {
  if (payback == null) return "—";
  return `${payback.toFixed(payback < 10 ? 2 : 1)}×`;
}
