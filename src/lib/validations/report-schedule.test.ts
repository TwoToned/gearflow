import { describe, it, expect } from "vitest";
import {
  isReportScheduleDue,
  reportScheduleSchema,
} from "./report-schedule";

describe("reportScheduleSchema", () => {
  it("accepts a disabled schedule", () => {
    const result = reportScheduleSchema.safeParse({
      scheduleFrequency: null,
      scheduleHour: null,
      scheduleDayOfWeek: null,
      scheduleDayOfMonth: null,
      scheduleRecipients: [],
    });
    expect(result.success).toBe(true);
  });

  it("requires hour when frequency is set", () => {
    const result = reportScheduleSchema.safeParse({
      scheduleFrequency: "DAILY",
      scheduleHour: null,
      scheduleDayOfWeek: null,
      scheduleDayOfMonth: null,
      scheduleRecipients: ["ops@example.com"],
    });
    expect(result.success).toBe(false);
  });

  it("requires day-of-week for weekly", () => {
    const result = reportScheduleSchema.safeParse({
      scheduleFrequency: "WEEKLY",
      scheduleHour: 9,
      scheduleDayOfWeek: null,
      scheduleDayOfMonth: null,
      scheduleRecipients: ["ops@example.com"],
    });
    expect(result.success).toBe(false);
  });

  it("requires day-of-month for monthly", () => {
    const result = reportScheduleSchema.safeParse({
      scheduleFrequency: "MONTHLY",
      scheduleHour: 9,
      scheduleDayOfWeek: null,
      scheduleDayOfMonth: null,
      scheduleRecipients: ["ops@example.com"],
    });
    expect(result.success).toBe(false);
  });

  it("requires at least one recipient when enabled", () => {
    const result = reportScheduleSchema.safeParse({
      scheduleFrequency: "DAILY",
      scheduleHour: 9,
      scheduleDayOfWeek: null,
      scheduleDayOfMonth: null,
      scheduleRecipients: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = reportScheduleSchema.safeParse({
      scheduleFrequency: "DAILY",
      scheduleHour: 9,
      scheduleDayOfWeek: null,
      scheduleDayOfMonth: null,
      scheduleRecipients: ["not-an-email"],
    });
    expect(result.success).toBe(false);
  });
});

describe("isReportScheduleDue", () => {
  const base = {
    scheduleDayOfWeek: null,
    scheduleDayOfMonth: null,
    scheduleLastRunAt: null,
  } as const;

  it("never due when frequency is null", () => {
    const now = new Date("2026-05-14T10:00:00Z");
    const due = isReportScheduleDue(
      { ...base, scheduleFrequency: null, scheduleHour: 9 },
      now,
    );
    expect(due).toBe(false);
  });

  it("DAILY due if last run was before today's bucket", () => {
    const now = new Date("2026-05-14T10:00:00Z"); // past 09:00 today
    const due = isReportScheduleDue(
      {
        ...base,
        scheduleFrequency: "DAILY",
        scheduleHour: 9,
        scheduleLastRunAt: new Date("2026-05-13T09:05:00Z"),
      },
      now,
    );
    expect(due).toBe(true);
  });

  it("DAILY not due if already run today", () => {
    const now = new Date("2026-05-14T10:00:00Z");
    const due = isReportScheduleDue(
      {
        ...base,
        scheduleFrequency: "DAILY",
        scheduleHour: 9,
        scheduleLastRunAt: new Date("2026-05-14T09:05:00Z"),
      },
      now,
    );
    expect(due).toBe(false);
  });

  it("DAILY not due if hour hasn't been reached today and yesterday's bucket already ran", () => {
    const now = new Date("2026-05-14T08:00:00Z"); // before 09:00
    const due = isReportScheduleDue(
      {
        ...base,
        scheduleFrequency: "DAILY",
        scheduleHour: 9,
        // Yesterday's bucket already ran:
        scheduleLastRunAt: new Date("2026-05-13T09:05:00Z"),
      },
      now,
    );
    expect(due).toBe(false);
  });

  it("WEEKLY due if it's the right day-of-week and hour, never run before", () => {
    // 2026-05-14 is a Thursday (UTC day 4)
    const now = new Date("2026-05-14T10:00:00Z");
    const due = isReportScheduleDue(
      {
        ...base,
        scheduleFrequency: "WEEKLY",
        scheduleHour: 9,
        scheduleDayOfWeek: 4,
      },
      now,
    );
    expect(due).toBe(true);
  });

  it("WEEKLY not due if last run was today's bucket", () => {
    const now = new Date("2026-05-14T10:00:00Z");
    const due = isReportScheduleDue(
      {
        ...base,
        scheduleFrequency: "WEEKLY",
        scheduleHour: 9,
        scheduleDayOfWeek: 4,
        scheduleLastRunAt: new Date("2026-05-14T09:05:00Z"),
      },
      now,
    );
    expect(due).toBe(false);
  });

  it("MONTHLY due on the right day-of-month, never run", () => {
    const now = new Date("2026-05-14T10:00:00Z");
    const due = isReportScheduleDue(
      {
        ...base,
        scheduleFrequency: "MONTHLY",
        scheduleHour: 9,
        scheduleDayOfMonth: 14,
      },
      now,
    );
    expect(due).toBe(true);
  });

  it("MONTHLY not due before the configured day", () => {
    const now = new Date("2026-05-10T10:00:00Z");
    const due = isReportScheduleDue(
      {
        ...base,
        scheduleFrequency: "MONTHLY",
        scheduleHour: 9,
        scheduleDayOfMonth: 14,
      },
      now,
    );
    // April 14 09:00 has long since passed but last run is null — so it IS due.
    expect(due).toBe(true);
  });

  it("MONTHLY not due if last run was this month's bucket", () => {
    const now = new Date("2026-05-15T10:00:00Z");
    const due = isReportScheduleDue(
      {
        ...base,
        scheduleFrequency: "MONTHLY",
        scheduleHour: 9,
        scheduleDayOfMonth: 14,
        scheduleLastRunAt: new Date("2026-05-14T09:05:00Z"),
      },
      now,
    );
    expect(due).toBe(false);
  });
});
