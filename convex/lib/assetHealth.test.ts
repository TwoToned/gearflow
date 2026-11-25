// @vitest-environment node
import { describe, test, expect } from "vitest";
import { assetHealth, type AssetHealthInput } from "./assetHealth";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 24, 12);

/** A unit with every fact present and clean. */
const clean: AssetHealthInput = {
  now: NOW,
  status: "AVAILABLE",
  condition: "GOOD",
  requiresTestAndTag: true,
  testTag: { status: "CURRENT", lastTestDate: NOW - 30 * DAY, nextDueDate: NOW + 200 * DAY },
  service: { schedules: [{ intervalMonths: 12, anchorDate: NOW - 400 * DAY }], lastServiceAt: NOW - 30 * DAY },
  checks: { lastResult: "PASS", hasPrepOrReturn: true },
  dueBackAt: null,
  doubleBookings: 0,
  openRepairs: 0,
};
const health = (over: Partial<AssetHealthInput>) => assetHealth({ ...clean, ...over });
const row = (h: ReturnType<typeof assetHealth>, id: string) => h.checks.find((c) => c.id === id);

describe("assetHealth", () => {
  test("a clean unit is Ready to go with every row clear", () => {
    const h = assetHealth(clean);
    expect(h).toMatchObject({ headline: "Ready to go", clear: 6, total: 6 });
  });

  test("unknown never passes: a unit nobody has checked is never Ready to go", () => {
    const h = health({
      testTag: null,
      service: { schedules: [], lastServiceAt: null },
      checks: { lastResult: null, hasPrepOrReturn: false },
      doubleBookings: null,
      openRepairs: null,
    });
    expect(h.headline).toBe("Nearly ready");
    expect(h.clear).toBe(1); // only whereabouts can pass
    expect(h.checks.filter((c) => c.severity === "unknown").map((c) => c.id).sort()).toEqual(["bookings", "condition", "repairs", "service", "testTag"]);
  });

  test("test & tag: not required and unregistered has no row; required and unregistered is unknown with Register", () => {
    expect(row(health({ requiresTestAndTag: false, testTag: null }), "testTag")).toBeUndefined();
    expect(health({ requiresTestAndTag: false, testTag: null }).total).toBe(5);
    expect(row(health({ testTag: null }), "testTag")).toMatchObject({ severity: "unknown", actionLabel: "Register", fix: { kind: "register-test-tag" } });
  });

  test("test & tag: overdue blocks, within 30 days warns, failed blocks, never tested is unknown", () => {
    expect(row(health({ testTag: { status: "OVERDUE", nextDueDate: NOW - 3 * DAY } }), "testTag")).toMatchObject({ severity: "blocking", title: "Test & tag overdue 3 days" });
    expect(row(health({ testTag: { status: "DUE_SOON", nextDueDate: NOW + 12 * DAY } }), "testTag")).toMatchObject({ severity: "warning", title: "Test & tag due in 12 days" });
    expect(row(health({ testTag: { status: "FAILED", nextDueDate: NOW + 90 * DAY } }), "testTag")?.severity).toBe("blocking");
    expect(row(health({ testTag: { status: "NOT_YET_TESTED", nextDueDate: null } }), "testTag")?.severity).toBe("unknown");
    expect(health({ testTag: { status: "OVERDUE", nextDueDate: NOW - DAY } }).headline).toBe("Can't go out");
  });

  test("service: due from last + interval, else the anchor; overdue and soon warn", () => {
    expect(row(health({ service: { schedules: [{ intervalMonths: 1, anchorDate: NOW }], lastServiceAt: NOW - 90 * DAY } }), "service")?.severity).toBe("warning");
    expect(row(health({ service: { schedules: [{ intervalMonths: 12, anchorDate: NOW - 10 * DAY }], lastServiceAt: null } }), "service")).toMatchObject({ severity: "warning", title: "Service overdue 10 days" });
    expect(row(health({ service: { schedules: [{ intervalMonths: 12, anchorDate: NOW + 5 * DAY }], lastServiceAt: null } }), "service")?.title).toBe("Service due in 5 days");
    expect(row(health({ service: { schedules: [], lastServiceAt: null } }), "service")).toMatchObject({ severity: "unknown", fix: { kind: "schedule-service" } });
    expect(row(health({ service: { schedules: [], lastServiceAt: NOW - DAY } }), "service")?.severity).toBe("pass");
  });

  test("condition: damaged blocks, poor and a failed check warn, no check on record is unknown", () => {
    expect(row(health({ condition: "DAMAGED" }), "condition")?.severity).toBe("blocking");
    expect(row(health({ condition: "POOR" }), "condition")?.severity).toBe("warning");
    expect(row(health({ checks: { lastResult: "FAIL", hasPrepOrReturn: true } }), "condition")?.severity).toBe("warning");
    expect(row(health({ checks: { lastResult: null, hasPrepOrReturn: false } }), "condition")?.severity).toBe("unknown");
  });

  test("whereabouts: missing, retired and sold block; maintenance and out warn; due back today says so", () => {
    for (const s of ["LOST", "RETIRED", "SOLD"]) expect(row(health({ status: s }), "whereabouts")?.severity).toBe("blocking");
    expect(row(health({ status: "IN_MAINTENANCE" }), "whereabouts")?.severity).toBe("warning");
    expect(row(health({ status: "CHECKED_OUT", dueBackAt: NOW + 3 * DAY }), "whereabouts")?.title).toBe("Out on a job");
    expect(row(health({ status: "CHECKED_OUT", dueBackAt: NOW + 1000 }), "whereabouts")?.title).toBe("Out, due back today");
    expect(row(health({ status: "RESERVED" }), "whereabouts")?.severity).toBe("pass");
  });

  test("bookings and repairs", () => {
    expect(row(health({ doubleBookings: 2 }), "bookings")).toMatchObject({ severity: "blocking", title: "Double booked on 2 jobs" });
    expect(health({ doubleBookings: 1 }).headline).toBe("Can't go out");
    expect(row(health({ openRepairs: 1 }), "repairs")).toMatchObject({ severity: "warning", title: "1 open repair" });
    expect(health({ openRepairs: 1 }).headline).toBe("Nearly ready");
  });

  test("rows sort blocking, warning, unknown, pass, stable within a severity", () => {
    const h = health({
      status: "LOST",
      openRepairs: 2,
      doubleBookings: null,
    });
    expect(h.checks.map((c) => c.severity)).toEqual(["blocking", "warning", "unknown", "pass", "pass", "pass"]);
    expect(h.checks.map((c) => c.id).slice(0, 3)).toEqual(["whereabouts", "repairs", "bookings"]);
  });
});
