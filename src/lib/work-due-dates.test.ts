import { describe, it, expect } from "vitest";
import {
  calendarDateInTimezone,
  shiftCalendarDate,
  resolveDuePreset,
  resolveWorkDue,
  workDueLabel,
  workDueDefault,
  formatCalendarDate,
} from "./work-due-dates";
import { bucketForDueDate } from "./today-buckets";

describe("calendarDateInTimezone", () => {
  it("resolves the ORG's calendar day, not UTC's", () => {
    // 2026-09-18T23:30Z is already the 19th in Melbourne (UTC+10) and still
    // the 18th in Los Angeles (UTC-7). The same instant, two calendar dates.
    const instant = Date.UTC(2026, 8, 18, 23, 30);
    expect(calendarDateInTimezone(instant, "Australia/Melbourne")).toBe("2026-09-19");
    expect(calendarDateInTimezone(instant, "America/Los_Angeles")).toBe("2026-09-18");
  });

  it("falls back to the runtime zone rather than throwing on a bad timezone", () => {
    expect(calendarDateInTimezone(Date.UTC(2026, 0, 2, 12), "Not/AZone")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("shiftCalendarDate", () => {
  it("rolls over month and year ends", () => {
    expect(shiftCalendarDate("2026-09-30", 1)).toBe("2026-10-01");
    expect(shiftCalendarDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftCalendarDate("2028-02-28", 1)).toBe("2028-02-29"); // leap year
  });

  it("does not skip a day across a DST transition", () => {
    // Melbourne springs forward on 2026-10-04. Adding a fixed 24h to an
    // instant near midnight would land on the 5th; calendar arithmetic can't.
    expect(shiftCalendarDate("2026-10-04", 1)).toBe("2026-10-05");
    expect(shiftCalendarDate("2026-10-03", 1)).toBe("2026-10-04");
  });
});

describe("resolveDuePreset", () => {
  const tz = "Australia/Melbourne";

  it("maps the presets onto org-local calendar dates", () => {
    const now = Date.UTC(2026, 8, 18, 23, 30); // already the 19th in Melbourne
    expect(resolveDuePreset("today", now, tz)).toBe("2026-09-19");
    expect(resolveDuePreset("tomorrow", now, tz)).toBe("2026-09-20");
    expect(resolveDuePreset("none", now, tz)).toBeNull();
  });

  // The contract that matters: what the composer calls "Today" must read back
  // as Today's `today` bucket. These two modules are a writer/reader pair, and
  // a disagreement between them is invisible until a task lands in the wrong
  // (collapsed) section — the second half of the vanishing-quick-add bug.
  it("round-trips through bucketForDueDate as the bucket it names", () => {
    const now = Date.UTC(2026, 8, 18, 23, 30);
    const due = resolveDuePreset("today", now, tz)!;
    expect(bucketForDueDate(new Date(due).getTime(), now, tz)).toBe("today");

    const tomorrow = resolveDuePreset("tomorrow", now, tz)!;
    expect(bucketForDueDate(new Date(tomorrow).getTime(), now, tz)).toBe("later");
  });

  it("round-trips at the start of the org's day too, not just the end", () => {
    const now = Date.UTC(2026, 8, 18, 22, 5); // 08:05 on the 19th in Melbourne
    const due = resolveDuePreset("today", now, tz)!;
    expect(bucketForDueDate(new Date(due).getTime(), now, tz)).toBe("today");
  });

  // KNOWN SKEW, pinned deliberately rather than left to be discovered.
  //
  // A date-only value is stored as UTC midnight of that calendar date (every
  // writer goes through `useProjectTaskWrites`'s `new Date("YYYY-MM-DD")`),
  // while `bucketForDueDate` compares against ORG-LOCAL day boundaries. For a
  // zone AHEAD of UTC those agree — UTC midnight falls inside the local day.
  // For a zone BEHIND it, UTC midnight is the previous local evening, so a
  // task due today reads as overdue.
  //
  // This predates the composer and affects every existing date-only due date
  // equally, not just ones it writes; the composer picks the right CALENDAR
  // date either way. The real fix is storing the org-local start-of-day
  // instant instead of UTC midnight, which changes what every task form
  // writes — out of scope here, tracked in
  // docs/designs/work-layer-v2-integration.md §8. Assert the current
  // behaviour so the change is a visible test update, not a silent shift.
  it("is skewed for a zone behind UTC — documented, not fixed here", () => {
    const la = "America/Los_Angeles";
    const now = Date.UTC(2026, 8, 18, 23, 30); // 16:30 on the 18th in LA
    const due = resolveDuePreset("today", now, la)!;
    expect(due).toBe("2026-09-18"); // the composer picks the right calendar date
    expect(bucketForDueDate(new Date(due).getTime(), now, la)).toBe("overdue"); // …the reader disagrees
  });
});

describe("resolveWorkDue", () => {
  const tz = "Australia/Melbourne";
  const nowMs = Date.UTC(2026, 8, 18, 3, 0); // 2026-09-18 13:00 in Melbourne

  it("passes a picked date straight through — no preset arithmetic touches it", () => {
    expect(resolveWorkDue({ kind: "date", date: "2027-01-04" }, nowMs, tz)).toBe("2027-01-04");
  });

  it("resolves a preset exactly as resolveDuePreset does", () => {
    expect(resolveWorkDue({ kind: "preset", preset: "tomorrow" }, nowMs, tz)).toBe(
      resolveDuePreset("tomorrow", nowMs, tz),
    );
    expect(resolveWorkDue({ kind: "preset", preset: "nextWeek" }, nowMs, tz)).toBe("2026-09-25");
    expect(resolveWorkDue({ kind: "preset", preset: "none" }, nowMs, tz)).toBeNull();
  });
});

describe("workDueDefault", () => {
  // Job work is undated until someone says otherwise; personal work defaults
  // to the list it will actually show up in.
  it("starts a job composer undated and a personal one on today", () => {
    expect(workDueDefault(true)).toEqual({ kind: "preset", preset: "none" });
    expect(workDueDefault(false)).toEqual({ kind: "preset", preset: "today" });
  });
});

describe("workDueLabel / formatCalendarDate", () => {
  const tz = "Australia/Melbourne";
  const nowMs = Date.UTC(2026, 8, 18, 3, 0);

  it("prints the preset's own label", () => {
    expect(workDueLabel({ kind: "preset", preset: "nextWeek" }, nowMs, tz)).toBe("Next week");
  });

  it("prints a picked date as a short human date, never the raw ISO string", () => {
    expect(workDueLabel({ kind: "date", date: "2026-10-12" }, nowMs, tz)).not.toContain("2026-10-12");
    expect(workDueLabel({ kind: "date", date: "2026-10-12" }, nowMs, tz)).toMatch(/12/);
  });

  it("adds the year only when it is not the current one", () => {
    expect(formatCalendarDate("2026-10-12", "2026-09-18")).not.toMatch(/2026/);
    expect(formatCalendarDate("2027-01-04", "2026-09-18")).toMatch(/2027/);
  });

  // Rendered through UTC getters off a midday instant, so no runtime zone can
  // pull the printed day back to the 11th.
  it("prints the day it was given, in any runtime zone", () => {
    expect(formatCalendarDate("2026-10-12", "2026-10-01")).toMatch(/\b12\b/);
  });
});
