/**
 * Pure maths for the shortfall → sub-hire sheet (spec §7.5). Mirrors the order
 * dialog's per-item totals (cost = unitCost × qty × duration; charge = unitCharge ×
 * qty × duration × (1 − discount%)); the server recomputes both on write, so this
 * is the live PREVIEW only, never a stored figure. A blank price is `null`, never 0.
 */

export type ShortfallPricingType = "FLAT" | "PER_DAY" | "PER_WEEK" | "PER_HOUR";

const DAY_MS = 86_400_000;

/** Hire duration in the unit of `pricingType`, from the job's hire window (>= 1). */
export function defaultHireDuration(
  pricingType: ShortfallPricingType,
  start?: Date | string | null,
  end?: Date | string | null,
): number {
  if (pricingType === "FLAT" || pricingType === "PER_HOUR" || !start || !end) return 1;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 1;
  const days = Math.max(1, Math.ceil(ms / DAY_MS));
  return pricingType === "PER_WEEK" ? Math.max(1, Math.ceil(days / 7)) : days;
}

export interface ShortfallDraft {
  quantity: number;
  unitCost: number | null;
  unitCharge: number | null;
  duration: number;
}

export interface ShortfallPreview {
  cost: number | null;
  charge: number | null;
  margin: number | null;
  /** Margin as a percentage of charge; `null` when there is no charge to divide by. */
  marginPct: number | null;
}

export function previewShortfall(d: ShortfallDraft): ShortfallPreview {
  const units = d.quantity * d.duration;
  const cost = d.unitCost == null ? null : d.unitCost * units;
  const charge = d.unitCharge == null ? null : d.unitCharge * units;
  const margin = cost == null || charge == null ? null : charge - cost;
  const marginPct = margin == null || !charge ? null : (margin / charge) * 100;
  return { cost, charge, margin, marginPct };
}
