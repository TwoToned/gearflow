import { describe, test, expect } from "vitest";
import { bucketForDueDate } from "./today-buckets";

describe("bucketForDueDate", () => {
  // Australia/Brisbane observes no daylight saving (always UTC+10), so these
  // fixtures are deterministic year-round — no DST edge to trip on.
  const TZ = "Australia/Brisbane";

  test("an item due 23:00 local in UTC+10 belongs to Today, even though its UTC calendar date differs from 'now'", () => {
    // now = 2026-07-15 09:00 Brisbane (2026-07-14 23:00 UTC)
    const now = Date.UTC(2026, 6, 14, 23, 0, 0);
    // due = 2026-07-15 23:00 Brisbane (2026-07-15 13:00 UTC) — a NAIVE UTC-calendar-day
    // bucketing would see "now" as July 14 and "due" as July 15 and call this Later.
    const due = Date.UTC(2026, 6, 15, 13, 0, 0);
    expect(bucketForDueDate(due, now, TZ)).toBe("today");
  });

  test("an item due before the start of today (org tz) is Overdue", () => {
    const now = Date.UTC(2026, 6, 15, 1, 0, 0); // 2026-07-15 11:00 Brisbane
    const due = Date.UTC(2026, 6, 14, 12, 0, 0); // 2026-07-14 22:00 Brisbane — yesterday
    expect(bucketForDueDate(due, now, TZ)).toBe("overdue");
  });

  test("an item due after the end of today (org tz) is Later", () => {
    const now = Date.UTC(2026, 6, 15, 1, 0, 0); // 2026-07-15 11:00 Brisbane
    const due = Date.UTC(2026, 6, 16, 1, 0, 0); // 2026-07-16 11:00 Brisbane — tomorrow
    expect(bucketForDueDate(due, now, TZ)).toBe("later");
  });

  test("an undated item is Later", () => {
    expect(bucketForDueDate(null, Date.now(), TZ)).toBe("later");
    expect(bucketForDueDate(undefined, Date.now(), TZ)).toBe("later");
  });

  test("an unset org timezone falls back to UTC rather than throwing", () => {
    const now = Date.UTC(2026, 6, 15, 12, 0, 0);
    const due = Date.UTC(2026, 6, 15, 18, 0, 0);
    expect(bucketForDueDate(due, now, undefined)).toBe("today");
  });
});
