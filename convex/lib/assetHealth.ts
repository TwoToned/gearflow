/**
 * `assetHealth()` — the asset page's "is this unit fit to go out?" checklist (UX
 * unification §9d.2, D30). PURE and DERIVED ON READ: nothing here is stored, so it
 * can never disagree with the records it reads (R-3.1). It lives in `convex/lib`
 * so the server read and `src/` import the same rule, like `crewPayRule`.
 *
 * Every row is one of:
 *  - `blocking` — the unit cannot go out (test & tag overdue or failed, damaged,
 *    missing / retired / sold, double booked).
 *  - `warning`  — real but not yet a violation (due soon, in repair, out on a job).
 *  - `pass`     — checked and clean.
 *  - `unknown`  — the check could not run, or nothing has ever been checked. It says
 *    `not checked`; it NEVER passes and never counts as clear, so a unit nobody has
 *    ever checked can never read `Ready to go`.
 *
 * A row that does not apply is ABSENT (a model that doesn't require test & tag and
 * has no record has no T&T row), so `total` counts only rows that apply.
 */
export type HealthSeverity = "blocking" | "warning" | "pass" | "unknown";
export type HealthCheckId = "testTag" | "service" | "condition" | "whereabouts" | "bookings" | "repairs";

/** Where a row's action leads: the surface that OWNS the fix. */
export type HealthFix =
  | { kind: "register-test-tag" }
  | { kind: "view-test-tag" }
  | { kind: "tab"; tab: "availability" | "checks" | "maintenance" | "history" }
  | { kind: "schedule-service" }
  | { kind: "report-issue" };

export interface HealthCheck {
  id: HealthCheckId;
  severity: HealthSeverity;
  /** One line stating the finding, never a bare label. */
  title: string;
  detail?: string;
  /** The row's right-hand action; absent on a passing row. */
  actionLabel?: string;
  fix?: HealthFix;
}

export type HealthHeadline = "Ready to go" | "Nearly ready" | "Can't go out";

export interface AssetHealth {
  headline: HealthHeadline;
  /** Rows that are `pass`. */
  clear: number;
  /** Rows that apply (`unknown` counts, `pass` counts). */
  total: number;
  checks: HealthCheck[];
}

export interface AssetHealthInput {
  /** Epoch ms, passed in (the caller's stable now); never read from a clock here. */
  now: number;
  status: string;
  condition: string;
  requiresTestAndTag: boolean;
  /** The unit's active T&T registration, or null. */
  testTag: { status?: string | null; lastTestDate?: number | null; nextDueDate?: number | null } | null;
  service: {
    /** The model's active service schedules. */
    schedules: { intervalMonths: number; anchorDate: number }[];
    /** Newest completed service for this unit. */
    lastServiceAt: number | null;
  };
  checks: {
    /** Newest prep / return check result for this unit, `null` = none on record. */
    lastResult: "PASS" | "FAIL" | "NOTES_ONLY" | null;
    hasPrepOrReturn: boolean;
  };
  /** When the unit is due back from the job it is out on, if any. */
  dueBackAt: number | null;
  /** Count of OTHER jobs this unit is booked on over the same dates; `null` = not read. */
  doubleBookings: number | null;
  /** Open repairs; `null` = not read. */
  openRepairs: number | null;
}

const DAY = 24 * 60 * 60 * 1000;
const WARN_DAYS = 30;

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const daysBetween = (from: number, to: number) => Math.floor((to - from) / DAY);

function addMonths(ms: number, months: number): number {
  const d = new Date(ms);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.getTime();
}

function sameUtcDay(a: number, b: number) {
  return Math.floor(a / DAY) === Math.floor(b / DAY);
}

function testTagCheck(i: AssetHealthInput): HealthCheck | null {
  const tt = i.testTag;
  if (!tt) {
    if (!i.requiresTestAndTag) return null;
    return { id: "testTag", severity: "unknown", title: "Test & tag not checked", detail: "not registered", actionLabel: "Register", fix: { kind: "register-test-tag" } };
  }
  const view = { actionLabel: "View", fix: { kind: "view-test-tag" } as const };
  if (tt.status === "FAILED") return { id: "testTag", severity: "blocking", title: "Test & tag failed", ...view };
  // A retired registration is not a current one, whatever dates it still carries.
  if (tt.status === "RETIRED") return { id: "testTag", severity: "unknown", title: "Test & tag not checked", detail: "registration retired", actionLabel: "Register", fix: { kind: "register-test-tag" } };
  if (tt.status === "NOT_YET_TESTED" || tt.nextDueDate == null) {
    return { id: "testTag", severity: "unknown", title: "Test & tag not checked", detail: "never tested", ...view };
  }
  const left = daysBetween(i.now, tt.nextDueDate);
  if (tt.nextDueDate < i.now) return { id: "testTag", severity: "blocking", title: `Test & tag overdue ${plural(-left, "day")}`, ...view };
  if (left <= WARN_DAYS) return { id: "testTag", severity: "warning", title: `Test & tag due in ${plural(left, "day")}`, ...view };
  // Never a pass without a recorded test, however far off the due date is.
  if (tt.lastTestDate == null) return { id: "testTag", severity: "unknown", title: "Test & tag not checked", detail: "never tested", ...view };
  return { id: "testTag", severity: "pass", title: "Test & tag current" };
}

/** Next due per schedule: last service + interval, else the schedule's anchor. */
function serviceCheck(i: AssetHealthInput): HealthCheck {
  const { schedules, lastServiceAt } = i.service;
  if (schedules.length === 0 && lastServiceAt == null) {
    return { id: "service", severity: "unknown", title: "Service not checked", detail: "no schedule", actionLabel: "Schedule", fix: { kind: "schedule-service" } };
  }
  const dues = schedules.map((s) => (lastServiceAt != null ? addMonths(lastServiceAt, s.intervalMonths) : s.anchorDate));
  if (dues.length === 0) return { id: "service", severity: "pass", title: "Serviced" };
  const next = Math.min(...dues);
  const left = daysBetween(i.now, next);
  const act = { actionLabel: "Schedule", fix: { kind: "schedule-service" } as const };
  if (next < i.now) return { id: "service", severity: "warning", title: `Service overdue ${plural(-left, "day")}`, ...act };
  if (left <= WARN_DAYS) return { id: "service", severity: "warning", title: `Service due in ${plural(left, "day")}`, ...act };
  return { id: "service", severity: "pass", title: "Service up to date" };
}

function conditionCheck(i: AssetHealthInput): HealthCheck {
  const tab = { actionLabel: "Checks", fix: { kind: "tab", tab: "checks" } as const };
  if (i.condition === "DAMAGED") return { id: "condition", severity: "blocking", title: "Damaged, needs repair", actionLabel: "Report", fix: { kind: "report-issue" } };
  if (i.condition === "POOR") return { id: "condition", severity: "warning", title: "Poor condition", ...tab };
  // No check on record, or one with no result, is `not checked`, never a pass.
  if (!i.checks.hasPrepOrReturn || i.checks.lastResult == null) return { id: "condition", severity: "unknown", title: "Condition not checked", detail: "no prep or return check on record", ...tab };
  if (i.checks.lastResult === "FAIL") return { id: "condition", severity: "warning", title: "Last check failed", ...tab };
  return { id: "condition", severity: "pass", title: "Condition checked" };
}

function whereaboutsCheck(i: AssetHealthInput): HealthCheck {
  const tab = { actionLabel: "History", fix: { kind: "tab", tab: "history" } as const };
  switch (i.status) {
    case "LOST":
      return { id: "whereabouts", severity: "blocking", title: "Missing", ...tab };
    case "RETIRED":
      return { id: "whereabouts", severity: "blocking", title: "Retired", ...tab };
    case "SOLD":
      return { id: "whereabouts", severity: "blocking", title: "Sold", ...tab };
    case "IN_MAINTENANCE":
      return { id: "whereabouts", severity: "warning", title: "In maintenance", actionLabel: "Maintenance", fix: { kind: "tab", tab: "maintenance" } };
    case "CHECKED_OUT":
      return i.dueBackAt != null && sameUtcDay(i.dueBackAt, i.now)
        ? { id: "whereabouts", severity: "warning", title: "Out, due back today", ...tab }
        : { id: "whereabouts", severity: "warning", title: "Out on a job", ...tab };
    default:
      return { id: "whereabouts", severity: "pass", title: "In the building" };
  }
}

function bookingsCheck(i: AssetHealthInput): HealthCheck {
  const tab = { actionLabel: "Availability", fix: { kind: "tab", tab: "availability" } as const };
  if (i.doubleBookings == null) return { id: "bookings", severity: "unknown", title: "Bookings not checked", ...tab };
  if (i.doubleBookings > 0) return { id: "bookings", severity: "blocking", title: `Double booked on ${plural(i.doubleBookings, "job")}`, ...tab };
  return { id: "bookings", severity: "pass", title: "No double bookings" };
}

function repairsCheck(i: AssetHealthInput): HealthCheck {
  const tab = { actionLabel: "Maintenance", fix: { kind: "tab", tab: "maintenance" } as const };
  if (i.openRepairs == null) return { id: "repairs", severity: "unknown", title: "Repairs not checked", ...tab };
  if (i.openRepairs > 0) return { id: "repairs", severity: "warning", title: `${plural(i.openRepairs, "open repair")}`, ...tab };
  return { id: "repairs", severity: "pass", title: "No open repairs" };
}

const ORDER: Record<HealthSeverity, number> = { blocking: 0, warning: 1, unknown: 2, pass: 3 };

export function assetHealth(i: AssetHealthInput): AssetHealth {
  const rows = [testTagCheck(i), serviceCheck(i), conditionCheck(i), whereaboutsCheck(i), bookingsCheck(i), repairsCheck(i)]
    .filter((c): c is HealthCheck => c != null)
    // stable: severity first, then the order above
    .map((c, idx) => ({ c, idx }))
    .sort((a, b) => ORDER[a.c.severity] - ORDER[b.c.severity] || a.idx - b.idx)
    .map((x) => x.c);
  const clear = rows.filter((c) => c.severity === "pass").length;
  const headline: HealthHeadline = rows.some((c) => c.severity === "blocking")
    ? "Can't go out"
    : clear === rows.length
      ? "Ready to go"
      : "Nearly ready";
  return { headline, clear, total: rows.length, checks: rows };
}
