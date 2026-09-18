// @vitest-environment node
import { describe, test, expect } from "vitest";
import { computeNextOccurrenceDueDate } from "./workRecurrence";

describe("computeNextOccurrenceDueDate", () => {
  test("daily — advances exactly one calendar day", () => {
    const from = Date.UTC(2026, 0, 31); // Jan 31
    expect(computeNextOccurrenceDueDate(from, { freq: "daily" })).toBe(Date.UTC(2026, 1, 1));
  });

  test("weekly with no daysOfWeek — advances exactly 7 calendar days", () => {
    const from = Date.UTC(2026, 8, 10); // Thu 10 Sep
    expect(computeNextOccurrenceDueDate(from, { freq: "weekly", daysOfWeek: [] })).toBe(from + 7 * 86_400_000);
  });

  test("weekly with daysOfWeek — the next matching weekday strictly after the input", () => {
    const thursday = Date.UTC(2026, 8, 10); // 2026-09-10 is a Thursday (getUTCDay() === 4)
    // Next Monday (1) or Wednesday (3) after this Thursday is Monday 2026-09-14.
    const next = computeNextOccurrenceDueDate(thursday, { freq: "weekly", daysOfWeek: [1, 3] });
    expect(next).toBe(Date.UTC(2026, 8, 14));
    expect(new Date(next).getUTCDay()).toBe(1);
  });

  test("monthly — same day next month", () => {
    const from = Date.UTC(2026, 5, 15); // 15 Jun
    expect(computeNextOccurrenceDueDate(from, { freq: "monthly" })).toBe(Date.UTC(2026, 6, 15));
  });

  test("monthly — clamps to the shorter month (31st -> 30th of a 30-day month)", () => {
    const from = Date.UTC(2026, 0, 31); // 31 Jan
    expect(computeNextOccurrenceDueDate(from, { freq: "monthly" })).toBe(Date.UTC(2026, 1, 28)); // Feb 2026 has 28 days
  });

  test("monthly — explicit dayOfMonth overrides the input date's day", () => {
    const from = Date.UTC(2026, 5, 15);
    expect(computeNextOccurrenceDueDate(from, { freq: "monthly", dayOfMonth: 1 })).toBe(Date.UTC(2026, 6, 1));
  });

  test("December -> January year rollover (monthly)", () => {
    const from = Date.UTC(2026, 11, 20); // 20 Dec 2026
    expect(computeNextOccurrenceDueDate(from, { freq: "monthly" })).toBe(Date.UTC(2027, 0, 20));
  });
});
