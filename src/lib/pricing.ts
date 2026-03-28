/**
 * Pricing optimization — minimum-cost enumeration for rental periods.
 *
 * Given daily/weekly/monthly rates and a total number of rental days,
 * finds the cheapest combination of months + weeks + days.
 */

export const DAYS_PER_BILLING_MONTH = 28
export const DAYS_PER_BILLING_WEEK = 7

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
 */
export function optimizePrice(
  dailyRate: number | null,
  weeklyRate: number | null,
  monthlyRate: number | null,
  totalDays: number
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

  // Only consider monthly if it's actually cheaper than 4 weekly (or 28 daily)
  const effectiveMonthlyRate =
    monthlyRate != null &&
    (effectiveWeeklyRate == null
      ? dailyRate == null || monthlyRate < dailyRate * DAYS_PER_BILLING_MONTH
      : monthlyRate < effectiveWeeklyRate * 4)
      ? monthlyRate
      : null

  const maxMonths = effectiveMonthlyRate != null
    ? Math.floor(totalDays / DAYS_PER_BILLING_MONTH)
    : 0

  const maxWeeks = effectiveWeeklyRate != null
    ? Math.floor(totalDays / DAYS_PER_BILLING_WEEK)
    : 0

  let bestCost = Infinity
  let bestMonths = 0
  let bestWeeks = 0
  let bestDays = totalDays

  for (let m = 0; m <= maxMonths; m++) {
    const afterMonths = totalDays - m * DAYS_PER_BILLING_MONTH
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
 */
export function computeTotalDays(
  months: number,
  weeks: number,
  days: number
): number {
  return months * DAYS_PER_BILLING_MONTH + weeks * DAYS_PER_BILLING_WEEK + days
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
