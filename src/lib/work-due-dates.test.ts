import { describe, it, expect } from "vitest";
import {
  calendarDateInTimezone,
  shiftCalendarDate,
  resolveDuePreset,
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
