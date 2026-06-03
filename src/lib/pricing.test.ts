import { describe, expect, it } from "vitest"
import {
  computeTotalDays,
  DAYS_PER_BILLING_MONTH,
  DAYS_PER_BILLING_WEEK,
  DEFAULT_DAYS_PER_BILLING_MONTH,
  formatBreakdown,
  optimizePrice,
  resolveDaysPerMonth,
} from "./pricing"

describe("optimizePrice", () => {
  it("single daily rate only: 17 days → 17 × dailyRate", () => {
    const result = optimizePrice(100, null, null, 17)
    expect(result).not.toBeNull()
    expect(result!.grandTotal).toBe(1700)
    expect(result!.months).toBe(0)
    expect(result!.weeks).toBe(0)
    expect(result!.days).toBe(17)
  })

  it("daily + weekly: 17 days → 2 weeks + 3 days when weekly is cheaper", () => {
    const result = optimizePrice(100, 500, null, 17)
    expect(result).not.toBeNull()
    expect(result!.weeks).toBe(2)
    expect(result!.days).toBe(3)
    expect(result!.grandTotal).toBe(500 * 2 + 100 * 3) // 1300
  })

  it("daily + weekly + monthly: 45 days → 1 month + 2 weeks + 3 days", () => {
    const result = optimizePrice(100, 500, 1500, 45)
    expect(result).not.toBeNull()
    expect(result!.months).toBe(1)
    expect(result!.weeks).toBe(2)
    expect(result!.days).toBe(3)
    expect(result!.grandTotal).toBe(1500 + 500 * 2 + 100 * 3) // 2800
  })

  it("monthly cheaper than 4 weeks: prefers monthly", () => {
    const result = optimizePrice(100, 600, 2000, 28)
    expect(result).not.toBeNull()
    expect(result!.months).toBe(1)
    expect(result!.weeks).toBe(0)
    expect(result!.days).toBe(0)
    expect(result!.grandTotal).toBe(2000)
  })

  it("weekly NOT cheaper than 7 daily: uses daily only", () => {
    const result = optimizePrice(100, 800, null, 14)
    expect(result).not.toBeNull()
    // 800 >= 700 (7*100), so weekly should not be used
    expect(result!.weeks).toBe(0)
    expect(result!.days).toBe(14)
    expect(result!.grandTotal).toBe(1400)
  })

  it("all rates null: returns null", () => {
    expect(optimizePrice(null, null, null, 10)).toBeNull()
  })

  it("totalDays = 0: returns zero result", () => {
    const result = optimizePrice(100, 500, 1500, 0)
    expect(result).not.toBeNull()
    expect(result!.grandTotal).toBe(0)
    expect(result!.breakdown).toBe("0 days")
  })

  it("negative totalDays: returns null", () => {
    expect(optimizePrice(100, 500, null, -5)).toBeNull()
  })

  it("only monthly rate set: uses exact month coverage", () => {
    const result = optimizePrice(null, null, 2000, 56)
    expect(result).not.toBeNull()
    expect(result!.months).toBe(2)
    expect(result!.grandTotal).toBe(4000)
  })

  it("only monthly rate set: returns null for non-exact month coverage", () => {
    // 30 days with only monthly (28 days) leaves 2 days uncoverable
    expect(optimizePrice(null, null, 2000, 30)).toBeNull()
  })

  it("large duration: 365 days with all rates", () => {
    const result = optimizePrice(100, 500, 1500, 365)
    expect(result).not.toBeNull()
    // 365 = 13 months (364 days) + 0 weeks + 1 day
    expect(result!.months).toBe(13)
    expect(result!.days).toBe(1)
    expect(result!.grandTotal).toBe(1500 * 13 + 100 * 1) // 19600
  })

  it("guarantees non-negative grandTotal", () => {
    // Even with odd rate combos, grandTotal should never go negative
    const result = optimizePrice(0, 0, 0, 10)
    expect(result).not.toBeNull()
    expect(result!.grandTotal).toBeGreaterThanOrEqual(0)
  })
})

describe("computeTotalDays", () => {
  it("0 months, 2 weeks, 3 days → 17", () => {
    expect(computeTotalDays(0, 2, 3)).toBe(17)
  })

  it("1 month, 0 weeks, 0 days → 28", () => {
    expect(computeTotalDays(1, 0, 0)).toBe(DAYS_PER_BILLING_MONTH)
  })

  it("2 months, 1 week, 4 days → 67", () => {
    expect(computeTotalDays(2, 1, 4)).toBe(
      2 * DAYS_PER_BILLING_MONTH + DAYS_PER_BILLING_WEEK + 4
    )
  })

  it("all zeros → 0", () => {
    expect(computeTotalDays(0, 0, 0)).toBe(0)
  })

  it("only days → days value unchanged", () => {
    expect(computeTotalDays(0, 0, 5)).toBe(5)
  })

  it("respects custom daysPerMonth (30): 1 month → 30", () => {
    expect(computeTotalDays(1, 0, 0, 30)).toBe(30)
  })

  it("respects custom daysPerMonth (31): 2 months + 1 week → 69", () => {
    expect(computeTotalDays(2, 1, 0, 31)).toBe(69)
  })
})

describe("optimizePrice with custom daysPerMonth", () => {
  it("30-day month: 30 days picks 1 month when cheaper", () => {
    // monthly 2000 < 30 * 100 = 3000 daily, so monthly wins
    const result = optimizePrice(100, null, 2000, 30, 30)
    expect(result).not.toBeNull()
    expect(result!.months).toBe(1)
    expect(result!.days).toBe(0)
    expect(result!.grandTotal).toBe(2000)
  })

  it("30-day month: 60 days picks 2 months", () => {
    const result = optimizePrice(100, 500, 2000, 60, 30)
    expect(result).not.toBeNull()
    expect(result!.months).toBe(2)
    expect(result!.grandTotal).toBe(4000)
  })

  it("default 28-day month still works when daysPerMonth omitted", () => {
    const result = optimizePrice(100, 500, 1500, 28)
    expect(result).not.toBeNull()
    expect(result!.months).toBe(1)
    expect(result!.grandTotal).toBe(1500)
  })
})

describe("resolveDaysPerMonth", () => {
  it("returns default for undefined", () => {
    expect(resolveDaysPerMonth(undefined)).toBe(DEFAULT_DAYS_PER_BILLING_MONTH)
  })

  it("returns default for null", () => {
    expect(resolveDaysPerMonth(null)).toBe(DEFAULT_DAYS_PER_BILLING_MONTH)
  })

  it("returns default for non-numeric", () => {
    expect(resolveDaysPerMonth("28")).toBe(DEFAULT_DAYS_PER_BILLING_MONTH)
    expect(resolveDaysPerMonth(NaN)).toBe(DEFAULT_DAYS_PER_BILLING_MONTH)
  })

  it("returns default for out-of-range values", () => {
    expect(resolveDaysPerMonth(0)).toBe(DEFAULT_DAYS_PER_BILLING_MONTH)
    expect(resolveDaysPerMonth(19)).toBe(DEFAULT_DAYS_PER_BILLING_MONTH)
    expect(resolveDaysPerMonth(32)).toBe(DEFAULT_DAYS_PER_BILLING_MONTH)
  })

  it("returns rounded value for in-range numerics", () => {
    expect(resolveDaysPerMonth(28)).toBe(28)
    expect(resolveDaysPerMonth(30)).toBe(30)
    expect(resolveDaysPerMonth(31)).toBe(31)
    expect(resolveDaysPerMonth(30.4)).toBe(30)
    expect(resolveDaysPerMonth(30.6)).toBe(31)
  })
})

describe("formatBreakdown", () => {
  it("singular: 1 month, 1 week, 1 day", () => {
    expect(formatBreakdown(1, 1, 1)).toBe("1 month + 1 week + 1 day")
  })

  it("zero-omission: 2 months, 0 weeks, 3 days", () => {
    expect(formatBreakdown(2, 0, 3)).toBe("2 months + 3 days")
  })

  it("days only: 0 months, 0 weeks, 5 days", () => {
    expect(formatBreakdown(0, 0, 5)).toBe("5 days")
  })

  it("weeks only: 0 months, 1 week, 0 days", () => {
    expect(formatBreakdown(0, 1, 0)).toBe("1 week")
  })

  it("all zeros → '0 days'", () => {
    expect(formatBreakdown(0, 0, 0)).toBe("0 days")
  })
})
