/**
 * Pricing optimization — minimum-cost enumeration for rental periods.
 *
 * Given daily/weekly/monthly rates and a total number of rental days,
 * finds the cheapest combination of months + weeks + days.
 */

export const DEFAULT_DAYS_PER_BILLING_MONTH = 28
export const DAYS_PER_BILLING_WEEK = 7

/** @deprecated Use DEFAULT_DAYS_PER_BILLING_MONTH or the org-configured value. */
export const DAYS_PER_BILLING_MONTH = DEFAULT_DAYS_PER_BILLING_MONTH

export interface OptimizedPrice {
  months: number
  weeks: number
  days: number
  monthlyTotal: number
  weeklyTotal: number
  dailyTotal: number
  grandTotal: number
  breakdown: string
}

/**
 * Find the minimum-cost combination of monthly/weekly/daily billing units
 * for a given rental duration. Returns null if no rates are available.
 *
 * @param daysPerMonth How many days a "month" bills as (default 28). Orgs may
 *   override this in settings to match their market norm (28/30/calendar).
 */
export function optimizePrice(
  dailyRate: number | null,
  weeklyRate: number | null,
  monthlyRate: number | null,
  totalDays: number,
  daysPerMonth: number = DEFAULT_DAYS_PER_BILLING_MONTH
): OptimizedPrice | null {
  if (totalDays === 0) {
    return {
      months: 0,
      weeks: 0,
      days: 0,
      monthlyTotal: 0,
      weeklyTotal: 0,
      dailyTotal: 0,
      grandTotal: 0,
      breakdown: "0 days",
    }
  }

  if (totalDays < 0) {
    return null
  }

  // Need at least one rate to optimize
  if (dailyRate == null && weeklyRate == null && monthlyRate == null) {
    return null
  }

  // Only consider weekly if it's actually cheaper than 7 daily
  const effectiveWeeklyRate =
    weeklyRate != null &&
    (dailyRate == null || weeklyRate < dailyRate * DAYS_PER_BILLING_WEEK)
      ? weeklyRate
      : null

  // Only consider monthly if it's actually cheaper than the equivalent weekly+daily
  // coverage of `daysPerMonth` days.
  const monthlyWeeks = Math.floor(daysPerMonth / DAYS_PER_BILLING_WEEK)
  const monthlyRemainder = daysPerMonth - monthlyWeeks * DAYS_PER_BILLING_WEEK
  const effectiveMonthlyRate =
    monthlyRate != null &&
    (effectiveWeeklyRate == null
      ? dailyRate == null || monthlyRate < dailyRate * daysPerMonth
      : monthlyRate <
        effectiveWeeklyRate * monthlyWeeks + (dailyRate ?? 0) * monthlyRemainder)
      ? monthlyRate
      : null

  const maxMonths = effectiveMonthlyRate != null
    ? Math.floor(totalDays / daysPerMonth)
    : 0

  let bestCost = Infinity
  let bestMonths = 0
  let bestWeeks = 0
  let bestDays = totalDays

  for (let m = 0; m <= maxMonths; m++) {
    const afterMonths = totalDays - m * daysPerMonth
    const weeksLimit = effectiveWeeklyRate != null
      ? Math.floor(afterMonths / DAYS_PER_BILLING_WEEK)
      : 0

    for (let w = 0; w <= weeksLimit; w++) {
      const remainingDays = afterMonths - w * DAYS_PER_BILLING_WEEK

      // If we have no daily rate, we can only use exact month/week coverage
      if (remainingDays > 0 && dailyRate == null) {
        continue
      }

      const cost =
        (effectiveMonthlyRate ?? 0) * m +
        (effectiveWeeklyRate ?? 0) * w +
        (dailyRate ?? 0) * remainingDays

      if (cost < bestCost) {
        bestCost = cost
        bestMonths = m
        bestWeeks = w
        bestDays = remainingDays
      }
    }
  }

  // If we couldn't find any valid combination
  if (bestCost === Infinity) {
    return null
  }

  const grandTotal = Math.max(0, bestCost)

  return {
    months: bestMonths,
    weeks: bestWeeks,
    days: bestDays,
    monthlyTotal: (effectiveMonthlyRate ?? (monthlyRate ?? 0)) * bestMonths,
    weeklyTotal: (effectiveWeeklyRate ?? (weeklyRate ?? 0)) * bestWeeks,
    dailyTotal: (dailyRate ?? 0) * bestDays,
    grandTotal,
    breakdown: formatBreakdown(bestMonths, bestWeeks, bestDays),
  }
}

/**
 * Convert billing period fields to total days.
 *
 * @param daysPerMonth How many days a "month" bills as (default 28).
 */
export function computeTotalDays(
  months: number,
  weeks: number,
  days: number,
  daysPerMonth: number = DEFAULT_DAYS_PER_BILLING_MONTH
): number {
  return months * daysPerMonth + weeks * DAYS_PER_BILLING_WEEK + days
}

/**
 * Format a months/weeks/days breakdown into a human-readable string.
 * Omits zero segments, handles singular/plural.
 */
export function formatBreakdown(
  months: number,
  weeks: number,
  days: number
): string {
  const parts: string[] = []

  if (months > 0) {
    parts.push(`${months} ${months === 1 ? "month" : "months"}`)
  }
  if (weeks > 0) {
    parts.push(`${weeks} ${weeks === 1 ? "week" : "weeks"}`)
  }
  if (days > 0) {
    parts.push(`${days} ${days === 1 ? "day" : "days"}`)
  }

  return parts.length > 0 ? parts.join(" + ") : "0 days"
}

/**
 * Resolve and validate a days-per-month value from org settings.
 * Falls back to the default (28) if unset, non-numeric, or out of range.
 * Range: 20-31 to cover common conventions (28-day, 30-day, calendar-month).
 */
export function resolveDaysPerMonth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_DAYS_PER_BILLING_MONTH
  }
  const rounded = Math.round(value)
  if (rounded < 20 || rounded > 31) {
    return DEFAULT_DAYS_PER_BILLING_MONTH
  }
  return rounded
}
