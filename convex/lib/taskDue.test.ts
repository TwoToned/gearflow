// @vitest-environment node
import { describe, expect, test } from "vitest";
import { dueClockZone, isTaskOverdue, taskDueBucket, todayDayNumber } from "./taskDue";

const due = Date.UTC(2026, 10, 24); // typed "2026-11-24"
describe("taskDue", () => {
  test("due day is the UTC calendar day; today is the ORG day", () => {
    // 2026-11-24 15:00 UTC is already 25 Nov 02:00 in Sydney (UTC+11).
    const now = Date.UTC(2026, 10, 24, 15);
    expect(isTaskOverdue({ status: "TODO", dueDate: due }, now, "UTC")).toBe(false);
    expect(isTaskOverdue({ status: "TODO", dueDate: due }, now, "Australia/Sydney")).toBe(true);
  });
  test("a missing or invalid timezone reads as UTC, whatever the host zone is", () => {
    const prev = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Kiritimati"; // UTC+14: the host's "today" is a day ahead of UTC
      const now = Date.UTC(2026, 10, 24, 15); // 25 Nov 05:00 in the host zone, 24 Nov in UTC
      expect(dueClockZone(undefined)).toBe("UTC");
      expect(dueClockZone("Not/AZone")).toBe("UTC");
      expect(dueClockZone("Australia/Sydney")).toBe("Australia/Sydney");
      expect(todayDayNumber(now, undefined)).toBe(todayDayNumber(now, "UTC"));
      expect(todayDayNumber(now, "Not/AZone")).toBe(todayDayNumber(now, "UTC"));
      expect(isTaskOverdue({ status: "TODO", dueDate: due }, now, undefined)).toBe(false);
      expect(isTaskOverdue({ status: "TODO", dueDate: due }, now, "Not/AZone")).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
    }
  });

  test("done, cancelled and dateless tasks are never overdue", () => {
    const now = Date.UTC(2026, 11, 1);
    expect(isTaskOverdue({ status: "DONE", dueDate: due }, now)).toBe(false);
    expect(isTaskOverdue({ status: "CANCELLED", dueDate: due }, now)).toBe(false);
    expect(isTaskOverdue({ status: "TODO" }, now)).toBe(false);
  });
  test("buckets", () => {
    const now = Date.UTC(2026, 10, 24, 9);
    expect(taskDueBucket(undefined, now)).toBe("NO_DATE");
    expect(taskDueBucket(Date.UTC(2026, 10, 23), now)).toBe("OVERDUE");
    expect(taskDueBucket(due, now)).toBe("TODAY");
    expect(taskDueBucket(Date.UTC(2026, 10, 25), now)).toBe("TOMORROW");
    expect(taskDueBucket(Date.UTC(2026, 10, 30), now)).toBe("THIS_WEEK");
    expect(taskDueBucket(Date.UTC(2026, 11, 2), now)).toBe("LATER");
  });
});
