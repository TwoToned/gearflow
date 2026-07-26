/**
 * Derived billing weeks/days + best-price capping (issue #943 / WS4).
 *
 * SINGLE SOURCE OF TRUTH for the pricing formula. Replaces the THREE
 * hand-duplicated "suggested group price" copies that existed before this
 * change (src/lib/project-groups-pricing.ts, convex/lib/suggestedPrice.ts,
 * the inline loop in convex/groupTemplatesWrites.ts `applyNative`) — all
 * three now call into this module (this file directly, or its byte-parity
 * Convex-side port `convex/lib/billing-derivation.ts` for code that runs
 * inside a Convex mutation, which can't import outside `convex/`).
 *
 * Decisions (locked, from issue #943):
 *  - Calendar days are INCLUSIVE (Fri→Mon = 4 days). Null/missing dates
 *    default to 1 day (matches the pre-existing `duration` default).
 *  - Best-price capping: if `weeks·weeklyRate + remainderDays·dailyRate`
 *    exceeds `(weeks+1)·weeklyRate`, cap to one additional whole week
 *    instead (e.g. 6 daily-priced days that would cost more than 1 week
 *    are billed as "1 wk (capped)").
 *  - Weekly + daily tiers only. `monthlyRate` stays display-only (no
 *    pricing path reads it — same as before this change).
 *
 * `convex/lib/billing-derivation.ts` is a byte-for-byte port of the pure
 * math (everything except `formatPriceBreakdown`/`parsePriceBreakdown`,
 * which are UI/PDF-only and never run inside a Convex mutation). A parity
 * test (`convex/lib/billing-derivation.test.ts`) pins the two copies to
 * identical output across the full derivation matrix.
 */
import { z } from "zod";

const MS_PER_DAY = 86_400_000;

/** Half-up rounding to cents — same convention as every other money helper
 *  in this codebase (src/lib/formatters.ts `roundCurrency`, convex/lib/lineTotal.ts). */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Inclusive calendar-day count between two epoch-ms timestamps (Fri→Mon = 4
 * days, same-day = 1 day). Either date missing → 1 day, matching the
 * pre-existing `duration` field's default. Never returns less than 1.
 */
export function inclusiveCalendarDays(
  startMs: number | null | undefined,
  endMs: number | null | undefined,
): number {
  if (startMs == null || endMs == null) return 1;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 1;
  const startDay = Math.floor(startMs / MS_PER_DAY);
  const endDay = Math.floor(endMs / MS_PER_DAY);
  const days = endDay - startDay + 1;
  return days > 0 ? days : 1;
}

export interface WeeksDays {
  weeks: number;
  days: number;
}

/** Split a total day count into whole weeks + remainder days (no capping —
 *  used for the plain project-level "billed as N wk M d" summary label). */
export function splitWeeksDays(totalDays: number): WeeksDays {
  const safe = Math.max(1, Math.floor(totalDays));
  return { weeks: Math.floor(safe / 7), days: safe % 7 };
}

/** Persisted shape of `projectLineItems.priceBreakdown` (JSON-stringified). */
export interface PriceBreakdown {
  weeks: number;
  days: number;
  weeklyRate: number | null;
  dailyRate: number | null;
  capped: boolean;
}

export const priceBreakdownSchema = z.object({
  weeks: z.number().int().min(0),
  days: z.number().int().min(0).max(6),
  weeklyRate: z.number().nullable(),
  dailyRate: z.number().nullable(),
  capped: z.boolean(),
});

export interface BlendedCharge {
  /** Per-unit charge for the whole chargeable window — stored as the auto-priced
   *  line's `unitPrice` (with `duration` pinned to 1, per the de-risked line
   *  pricing model in #943). */
  perUnitCharge: number;
  breakdown: PriceBreakdown;
}

/**
 * Best-price-capped blended charge for one unit over `chargeableDays`.
 *
 *  - No weekly rate (daily-only model): `days × dailyRate`.
 *  - Weekly rate present: `min(weeks·W + rem·D, (weeks+1)·W)` — the cheaper
 *    of "N whole weeks + remainder days at the daily rate" and "N+1 whole
 *    weeks" wins. A cap only ever applies when there's a remainder (0
 *    remainder days can never be cheaper as a whole extra week).
 */
export function computeBlendedCharge(params: {
  chargeableDays: number;
  dailyRate: number | null | undefined;
  weeklyRate: number | null | undefined;
}): BlendedCharge {
  const dailyRate =
    params.dailyRate != null && Number.isFinite(Number(params.dailyRate)) ? Number(params.dailyRate) : null;
  const weeklyRate =
    params.weeklyRate != null && Number.isFinite(Number(params.weeklyRate)) ? Number(params.weeklyRate) : null;
  const totalDays = Math.max(1, Math.floor(params.chargeableDays));

  if (weeklyRate == null) {
    const charge = roundMoney((dailyRate ?? 0) * totalDays);
    return {
      perUnitCharge: charge,
      breakdown: { weeks: 0, days: totalDays, weeklyRate: null, dailyRate, capped: false },
    };
  }

  const { weeks, days } = splitWeeksDays(totalDays);
  const dailyForCap = dailyRate ?? 0;
  const uncapped = weeks * weeklyRate + days * dailyForCap;
  const cappedTotal = (weeks + 1) * weeklyRate;
  const useCap = days > 0 && cappedTotal < uncapped;
  const chargeRaw = useCap ? cappedTotal : uncapped;

  return {
    perUnitCharge: roundMoney(chargeRaw),
    breakdown: {
      weeks: useCap ? weeks + 1 : weeks,
      days: useCap ? 0 : days,
      weeklyRate,
      dailyRate,
      capped: useCap,
    },
  };
}

/** Human-readable breakdown for UI/PDF, e.g. "2 wk @ $150.00 + 3 d @ $30.00" or
 *  "charged as 1 wk (capped)". */
export function formatPriceBreakdown(b: PriceBreakdown): string {
  if (b.capped) return `charged as ${b.weeks} wk (capped)`;
  if (b.weeklyRate == null) {
    return b.dailyRate != null ? `${b.days} d @ $${b.dailyRate.toFixed(2)}` : "";
  }
  const parts: string[] = [];
  if (b.weeks > 0) parts.push(`${b.weeks} wk @ $${b.weeklyRate.toFixed(2)}`);
  if (b.days > 0 && b.dailyRate != null) parts.push(`${b.days} d @ $${b.dailyRate.toFixed(2)}`);
  return parts.length > 0 ? parts.join(" + ") : "0 d";
}

/** JSON-string ↔ PriceBreakdown, Zod-validated (R-8.2.3) — never trust a stored
 *  string blindly, even though it only ever originates server-side. Malformed /
 *  legacy data renders as no breakdown rather than throwing. */
export function serializePriceBreakdown(b: PriceBreakdown): string {
  return JSON.stringify(b);
}

export function parsePriceBreakdown(raw: string | null | undefined): PriceBreakdown | null {
  if (!raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = priceBreakdownSchema.safeParse(json);
  return result.success ? result.data : null;
}

/** Project-level "billed as N wk M d" summary — no capping (that's a per-line
 *  pricing concept); overrides win when set, otherwise derived from dates. */
export interface BillingSummary {
  weeks: number;
  days: number;
  /** True when either override field is set — the "edited" marker. */
  edited: boolean;
}

export function deriveBillingSummary(params: {
  rentalStartMs: number | null | undefined;
  rentalEndMs: number | null | undefined;
  weeksOverride: number | null | undefined;
  daysOverride: number | null | undefined;
}): BillingSummary {
  const derived = splitWeeksDays(inclusiveCalendarDays(params.rentalStartMs, params.rentalEndMs));
  const edited = params.weeksOverride != null || params.daysOverride != null;
  return {
    weeks: params.weeksOverride ?? derived.weeks,
    days: params.daysOverride ?? derived.days,
    edited,
  };
}

/**
 * True when a line's STORED breakdown no longer matches what the current
 * project dates would produce for the same rates — the "stale price" signal
 * that drives the "Rates derived from old dates — recalculate" banner.
 * Rates themselves can't go stale here (they come from the model, not the
 * date range), so weeks/days/capped diverging is sufficient.
 */
export function isBreakdownStale(stored: PriceBreakdown, fresh: PriceBreakdown): boolean {
  return stored.weeks !== fresh.weeks || stored.days !== fresh.days || stored.capped !== fresh.capped;
}
