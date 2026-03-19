/**
 * Tests for dashboard utility functions.
 *
 * Extracted pure logic from dashboard/page.tsx for testability:
 * - Greeting based on time of day
 * - Activity timeline builder (merges scan/test/maintenance records)
 */
import { describe, it, expect, vi, afterEach } from "vitest";

// ─── Greeting Logic ──────────────────────────────────────────────────

function getGreeting(hour: number): string {
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

describe("getGreeting", () => {
  it("returns 'Good morning' for hours 0-11", () => {
    expect(getGreeting(0)).toBe("Good morning");
    expect(getGreeting(6)).toBe("Good morning");
    expect(getGreeting(11)).toBe("Good morning");
  });

  it("returns 'Good afternoon' for hours 12-17", () => {
    expect(getGreeting(12)).toBe("Good afternoon");
    expect(getGreeting(15)).toBe("Good afternoon");
    expect(getGreeting(17)).toBe("Good afternoon");
  });

  it("returns 'Good evening' for hours 18-23", () => {
    expect(getGreeting(18)).toBe("Good evening");
    expect(getGreeting(21)).toBe("Good evening");
    expect(getGreeting(23)).toBe("Good evening");
  });

  it("handles boundary: midnight (0) is morning", () => {
    expect(getGreeting(0)).toBe("Good morning");
  });

  it("handles boundary: noon (12) is afternoon", () => {
    expect(getGreeting(12)).toBe("Good afternoon");
  });

  it("handles boundary: 6pm (18) is evening", () => {
    expect(getGreeting(18)).toBe("Good evening");
  });
});

// ─── Activity Timeline Builder ───────────────────────────────────────

interface TimelineItem {
  key: string;
  type: "scan" | "test" | "maintenance";
  time: Date;
  data: Record<string, unknown>;
}

function buildActivityTimeline(
  activity: Record<string, unknown> | undefined,
): TimelineItem[] {
  if (!activity) return [];

  const logs = activity.logs as Record<string, unknown>[] | undefined;
  const testRecords = activity.testRecords as Record<string, unknown>[] | undefined;
  const maintRecords = activity.maintenanceRecords as Record<string, unknown>[] | undefined;

  const items: TimelineItem[] = [];
  for (const log of logs || []) {
    items.push({
      key: `scan-${log.id}`,
      type: "scan",
      time: new Date(log.scannedAt as string),
      data: log,
    });
  }
  for (const rec of testRecords || []) {
    items.push({
      key: `test-${rec.id}`,
      type: "test",
      time: new Date(rec.testDate as string),
      data: rec,
    });
  }
  for (const mr of maintRecords || []) {
    items.push({
      key: `maint-${mr.id}`,
      type: "maintenance",
      time: new Date(mr.updatedAt as string),
      data: mr,
    });
  }

  items.sort((a, b) => b.time.getTime() - a.time.getTime());
  return items.slice(0, 12);
}

describe("buildActivityTimeline", () => {
  it("returns empty array when activity is undefined", () => {
    expect(buildActivityTimeline(undefined)).toEqual([]);
  });

  it("returns empty array when activity has no records", () => {
    expect(buildActivityTimeline({})).toEqual([]);
  });

  it("returns empty array when all sub-arrays are empty", () => {
    expect(
      buildActivityTimeline({ logs: [], testRecords: [], maintenanceRecords: [] }),
    ).toEqual([]);
  });

  it("builds scan items from logs", () => {
    const activity = {
      logs: [
        { id: "1", scannedAt: "2026-03-19T10:00:00Z", action: "CHECK_OUT" },
        { id: "2", scannedAt: "2026-03-19T11:00:00Z", action: "CHECK_IN" },
      ],
    };
    const items = buildActivityTimeline(activity);
    expect(items).toHaveLength(2);
    expect(items[0].type).toBe("scan");
    expect(items[0].key).toBe("scan-2"); // newer first
    expect(items[1].key).toBe("scan-1");
  });

  it("builds test items from testRecords", () => {
    const activity = {
      testRecords: [
        { id: "t1", testDate: "2026-03-19T09:00:00Z", result: "PASS" },
      ],
    };
    const items = buildActivityTimeline(activity);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("test");
    expect(items[0].key).toBe("test-t1");
  });

  it("builds maintenance items from maintenanceRecords", () => {
    const activity = {
      maintenanceRecords: [
        { id: "m1", updatedAt: "2026-03-18T08:00:00Z", status: "COMPLETED" },
      ],
    };
    const items = buildActivityTimeline(activity);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("maintenance");
    expect(items[0].key).toBe("maint-m1");
  });

  it("merges all three record types and sorts by time descending", () => {
    const activity = {
      logs: [{ id: "s1", scannedAt: "2026-03-19T10:00:00Z" }],
      testRecords: [{ id: "t1", testDate: "2026-03-19T12:00:00Z" }],
      maintenanceRecords: [{ id: "m1", updatedAt: "2026-03-19T08:00:00Z" }],
    };
    const items = buildActivityTimeline(activity);
    expect(items).toHaveLength(3);
    // Newest first: test (12:00) → scan (10:00) → maint (08:00)
    expect(items[0].type).toBe("test");
    expect(items[1].type).toBe("scan");
    expect(items[2].type).toBe("maintenance");
  });

  it("limits output to 12 items", () => {
    const logs = Array.from({ length: 20 }, (_, i) => ({
      id: `s${i}`,
      scannedAt: new Date(2026, 2, 19, i).toISOString(),
    }));
    const items = buildActivityTimeline({ logs });
    expect(items).toHaveLength(12);
  });

  it("handles missing sub-arrays gracefully", () => {
    const activity = {
      logs: [{ id: "s1", scannedAt: "2026-03-19T10:00:00Z" }],
      // testRecords and maintenanceRecords not present
    };
    const items = buildActivityTimeline(activity);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("scan");
  });
});

// ─── Warehouse Urgency Grouping ──────────────────────────────────────

type UrgencyGroup = "overdue" | "today" | "upcoming";

function getProjectUrgency(rentalStartDate: string | null): UrgencyGroup {
  if (!rentalStartDate) return "upcoming";

  const startDate = new Date(rentalStartDate);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 2); // 2-day window for "today"
  const projectDay = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate(),
  );

  if (projectDay < today) return "overdue";
  if (projectDay < tomorrow) return "today";
  return "upcoming";
}

describe("getProjectUrgency", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'upcoming' when no start date", () => {
    expect(getProjectUrgency(null)).toBe("upcoming");
  });

  it("returns 'overdue' for past dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-19T12:00:00"));

    expect(getProjectUrgency("2026-03-17")).toBe("overdue");
    expect(getProjectUrgency("2026-03-10")).toBe("overdue");
  });

  it("returns 'today' for current day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-19T12:00:00"));

    expect(getProjectUrgency("2026-03-19")).toBe("today");
  });

  it("returns 'today' for tomorrow (2-day window)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-19T12:00:00"));

    // tomorrow.setDate(today.getDate() + 2) means "today" includes today and tomorrow
    expect(getProjectUrgency("2026-03-20")).toBe("today");
  });

  it("returns 'upcoming' for dates 2+ days out", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-19T12:00:00"));

    expect(getProjectUrgency("2026-03-21")).toBe("upcoming");
    expect(getProjectUrgency("2026-04-01")).toBe("upcoming");
  });

  it("boundary: yesterday is overdue", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-19T12:00:00"));

    expect(getProjectUrgency("2026-03-18")).toBe("overdue");
  });
});
