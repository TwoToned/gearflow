/**
 * THE margin formula (UX Phase 10): EX GST, the taxable amount less every cost bucket.
 * `total` includes tax, which is the client's money to remit, not margin. A pure,
 * dependency-free module so `recalcProjectTotals` (which writes `projects.margin`), the
 * one-off margin backfill, and the client-side snapshot reader (the quote revision
 * viewer, which re-derives a HISTORICAL version's margin from that snapshot's own
 * stored buckets) all share ONE definition.
 */
const round = (v: number): number => Math.round(v * 100) / 100;

/** The taxable amount: subtotal less the discount. */
export const taxableFrom = (subtotal: number, discountAmount: number): number => round(subtotal - discountAmount);

export interface CostBuckets {
  serviceCostTotal: number;
  labourCostTotal: number;
  subHireCostTotal: number;
  saleCostTotal: number;
}

export function marginExGst(taxableAmount: number, costs: CostBuckets): number {
  return round(taxableAmount - (costs.serviceCostTotal + costs.labourCostTotal + costs.subHireCostTotal + costs.saleCostTotal));
}

/**
 * A margin from a stored row's own fields (a project row or a snapshot's project entry),
 * or `null` when the row does not carry the buckets to derive it (so a caller shows
 * "absent", never a guess). Never reads the stored `margin`: historical rows keep the
 * old GST-inclusive figure.
 */
export function marginFromStored(row: {
  subtotal?: unknown;
  discountAmount?: unknown;
  serviceCostTotal?: unknown;
  labourCostTotal?: unknown;
  subHireCostTotal?: unknown;
  saleCostTotal?: unknown;
}): number | null {
  const num = (x: unknown): number | null => (x == null || x === "" || Number.isNaN(Number(x)) ? null : Number(x));
  const subtotal = num(row.subtotal);
  const service = num(row.serviceCostTotal);
  const labour = num(row.labourCostTotal);
  if (subtotal === null || service === null || labour === null) return null;
  return marginExGst(taxableFrom(subtotal, num(row.discountAmount) ?? 0), {
    serviceCostTotal: service,
    labourCostTotal: labour,
    subHireCostTotal: num(row.subHireCostTotal) ?? 0,
    saleCostTotal: num(row.saleCostTotal) ?? 0,
  });
}
