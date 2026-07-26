/**
 * Byte-parity Convex-side port of `src/lib/billing-derivation.ts` (issue #943 /
 * WS4). Convex functions can only import from within `convex/` (the deploy
 * bundler doesn't reach outside it), so the pure math is duplicated here rather
 * than imported — `convex/lib/billing-derivation.test.ts` pins the two copies to
 * identical output across the full derivation matrix so they can't silently
 * diverge. Only the math that actually runs inside a mutation is ported:
 * `formatPriceBreakdown`/Zod parsing are UI/PDF-only and stay src-side.
 *
 * See src/lib/billing-derivation.ts for the full formula writeup.
 */

const MS_PER_DAY = 86_400_000;

/** Half-up rounding to cents. */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Inclusive calendar-day count (Fri→Mon = 4). Missing/non-finite date → 1 day. */
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

export function splitWeeksDays(totalDays: number): WeeksDays {
  const safe = Math.max(1, Math.floor(totalDays));
  return { weeks: Math.floor(safe / 7), days: safe % 7 };
}

export interface PriceBreakdown {
  weeks: number;
  days: number;
  weeklyRate: number | null;
  dailyRate: number | null;
  capped: boolean;
}

export interface BlendedCharge {
  perUnitCharge: number;
  breakdown: PriceBreakdown;
}

/** Best-price-capped blended charge — see src/lib/billing-derivation.ts for the
 *  full formula writeup. Byte-parity: every change here must be mirrored there. */
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

export function serializePriceBreakdown(b: PriceBreakdown): string {
  return JSON.stringify(b);
}

/** Structural (non-Zod — Convex mutations don't need the extra dependency) parse of a
 *  stored priceBreakdown string. Malformed/legacy data returns null rather than
 *  throwing (used by the stale-price detection query/mutation, never a trust
 *  boundary — the string only ever originates from this same module server-side). */
export function parsePriceBreakdown(raw: string | null | undefined): PriceBreakdown | null {
  if (!raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof json !== "object" || json == null) return null;
  const b = json as Record<string, unknown>;
  if (
    typeof b.weeks !== "number" ||
    typeof b.days !== "number" ||
    typeof b.capped !== "boolean" ||
    (b.weeklyRate !== null && typeof b.weeklyRate !== "number") ||
    (b.dailyRate !== null && typeof b.dailyRate !== "number")
  ) {
    return null;
  }
  return {
    weeks: b.weeks,
    days: b.days,
    weeklyRate: b.weeklyRate as number | null,
    dailyRate: b.dailyRate as number | null,
    capped: b.capped,
  };
}

/** Project-level "billed as N wk M d" summary — no capping, overrides win. */
export interface BillingSummary {
  weeks: number;
  days: number;
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

/** True when a line's stored breakdown no longer matches what the current
 *  project dates would produce (the "stale price" recalc-banner signal). */
export function isBreakdownStale(stored: PriceBreakdown, fresh: PriceBreakdown): boolean {
  return stored.weeks !== fresh.weeks || stored.days !== fresh.days || stored.capped !== fresh.capped;
}
