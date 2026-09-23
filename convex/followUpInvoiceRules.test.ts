// @vitest-environment node
//
// Follow-up automation phase 2 — the pure invoice rules (FEATUREDOCS/82):
// the chase ladder, what closes it (paid in Flow or Xero, voided, fully
// credited), the cut-over, the urgent deposit, and "invoice not raised".
import { describe, test, expect } from "vitest";
import { planInvoiceLoop, planUnraisedLoop, INVOICE_DECISION_RUNG, type InvoiceLoopFacts, type UnraisedFacts } from "./lib/followUpInvoiceRules";
import { FOLLOW_UP_DEFAULTS, resolutionForHumanDone, type FollowUpRow } from "./lib/followUpRules";
import { addBusinessDaysInTimezone, startOfDayInTimezone } from "./lib/quoteDates";

const TZ = "Australia/Sydney";
const DAY = 86_400_000;
const ISSUED = Date.UTC(2026, 9, 1, 0, 0, 0);
const DUE = ISSUED + 14 * DAY;
const CUTOVER = Date.UTC(2026, 8, 22, 14, 0, 0);
const config = { quotesEnabled: true, invoicesEnabled: true, ...FOLLOW_UP_DEFAULTS, cutoverAt: CUTOVER, timezone: TZ };

function facts(over: Partial<InvoiceLoopFacts["invoice"]> = {}, rest: Partial<InvoiceLoopFacts> = {}): InvoiceLoopFacts {
  return {
    now: DUE + 3 * DAY,
    config,
    eventStart: DUE + 60 * DAY,
    invoice: {
      id: "i1", number: "INV-0042", kind: "FULL", status: "ISSUED", paymentStatus: "UNPAID", xeroStatus: "AUTHORISED",
      issuedAt: ISSUED, dueDate: DUE, total: 1650, amountPaid: 0, amountCredited: 0, ...over,
    },
    rows: [],
    ...rest,
  };
}
const row = (p: Partial<FollowUpRow>): FollowUpRow => ({ id: "r1", open: true, createdAt: DUE, rung: 1, loopStartAt: DUE, subjectId: "i1", lockedFields: [], ...p });

describe("planInvoiceLoop", () => {
  test("an overdue invoice opens rung 1, one business day after the due date", () => {
    const plan = planInvoiceLoop(facts());
    expect(plan.desired).toMatchObject({ rung: 1, subjectId: "i1", urgent: false, priority: "NORMAL" });
    expect(plan.desired!.dueDate).toBe(addBusinessDaysInTimezone(startOfDayInTimezone(DUE, TZ), 1, TZ));
    expect(plan.desired!.title).toBe("Chase payment: INV-0042 ($1,650.00 overdue)");
    expect(plan.desired!.why).toContain("$1,650.00 owed");
  });

  test("not yet overdue: nothing (Xero's reminders cover the client before the due date)", () => {
    expect(planInvoiceLoop(facts({}, { now: DUE - DAY })).desired).toBeNull();
  });

  test("the chase text uses the amount still owed after a part payment and a credit", () => {
    const plan = planInvoiceLoop(facts({ amountPaid: 500, amountCredited: 150, paymentStatus: "PARTIALLY_PAID" }));
    expect(plan.desired!.title).toContain("$1,000.00");
  });

  test.each([
    [{ paymentStatus: "PAID" }, "paid", "DONE"],
    [{ status: "VOID" }, "voided", "CANCELLED"],
    [{ xeroStatus: "VOIDED" }, "voided", "CANCELLED"],
    [{ amountCredited: 1650 }, "voided", "CANCELLED"],
  ])("%o closes the chase as %s", (over, resolution, status) => {
    expect(planInvoiceLoop(facts(over as never, { rows: [row({})] })).close).toEqual([{ id: "r1", resolution, status }]);
  });

  test("invoices issued before the cut-over are never chased", () => {
    expect(planInvoiceLoop(facts({ issuedAt: CUTOVER - DAY }))).toEqual({ close: [], desired: null });
  });

  test("credits are never chased", () => {
    expect(planInvoiceLoop(facts({ kind: "CREDIT" })).desired).toBeNull();
  });

  test("a DEPOSIT with the event under a week away is urgent — the gear is held", () => {
    const plan = planInvoiceLoop(facts({ kind: "DEPOSIT" }, { eventStart: DUE + 6 * DAY }));
    expect(plan.desired).toMatchObject({ urgent: true, priority: "HIGH" });
    expect(plan.desired!.why).toContain("gear is held");
  });

  test("each no-reply advances: rung 3 is the call, rung 4 the decision, then it stops", () => {
    const closed = (n: number) => Array.from({ length: n }, (_, i) => row({ id: `c${i}`, open: false, resolution: "no_reply", completedAt: DUE + (i + 2) * DAY, createdAt: DUE + i * DAY }));
    expect(planInvoiceLoop(facts({}, { rows: closed(2), now: DUE + 20 * DAY })).desired!.title).toMatch(/^Call the client/);
    expect(planInvoiceLoop(facts({}, { rows: closed(3), now: DUE + 20 * DAY })).desired!.rung).toBe(INVOICE_DECISION_RUNG);
    expect(planInvoiceLoop(facts({}, { rows: closed(4), now: DUE + 30 * DAY })).desired).toBeNull();
  });

  test("later rungs land on the design's schedule: due + 7, + 14, + 30 days", () => {
    const start = startOfDayInTimezone(DUE, TZ);
    const noReply = (i: number, at: number) => row({ id: `c${i}`, open: false, resolution: "no_reply", completedAt: at });
    expect(planInvoiceLoop(facts({}, { rows: [noReply(0, DUE + 2 * DAY)] })).desired!.dueDate).toBe(start + 7 * DAY);
    expect(planInvoiceLoop(facts({}, { rows: [noReply(0, DUE + 2 * DAY), noReply(1, DUE + 8 * DAY)], now: DUE + 9 * DAY })).desired!.dueDate).toBe(start + 14 * DAY);
    // A no-reply logged after the scheduled day: the next rung is due the next business day.
    const late = DUE + 40 * DAY;
    const rows = [noReply(0, DUE + 2 * DAY), noReply(1, DUE + 8 * DAY), noReply(2, late)];
    expect(planInvoiceLoop(facts({}, { rows, now: late })).desired!.dueDate).toBe(addBusinessDaysInTimezone(late, 1, TZ));
  });

  test("human done on the call rung keeps chasing; on the decision it ends", () => {
    expect(resolutionForHumanDone(3, "invoice")).toBe("no_reply");
    expect(resolutionForHumanDone(4, "invoice")).toBe("decided");
    expect(resolutionForHumanDone(1, "invoice_unraised")).toBe("decided");
  });
});

describe("planUnraisedLoop", () => {
  const ended = CUTOVER + 10 * DAY;
  const f = (over: Partial<UnraisedFacts> = {}, project: Partial<UnraisedFacts["project"]> = {}): UnraisedFacts => ({
    now: ended + 3 * DAY,
    config,
    project: { id: "p1", status: "RETURNED", projectNumber: "260901", endedAt: ended, total: 2866.6, ...project },
    hasIssuedInvoice: false,
    rows: [],
    ...over,
  });

  test("a job that came back with no invoice gets one item, two business days later", () => {
    const plan = planUnraisedLoop(f());
    expect(plan.desired).toMatchObject({ title: "Raise the invoice for 260901", subjectId: "p1" });
    expect(plan.desired!.dueDate).toBe(addBusinessDaysInTimezone(ended, 2, TZ));
  });

  test("issuing an invoice closes it", () => {
    expect(planUnraisedLoop(f({ hasIssuedInvoice: true, rows: [row({ subjectId: "p1" })] })).close).toEqual([{ id: "r1", resolution: "invoiced", status: "DONE" }]);
  });

  test("the pre-cut-over backlog, $0 jobs and jobs still out are left alone", () => {
    expect(planUnraisedLoop(f({}, { endedAt: CUTOVER - DAY })).desired).toBeNull();
    expect(planUnraisedLoop(f({}, { total: 0 })).desired).toBeNull();
    expect(planUnraisedLoop(f({}, { status: "CHECKED_OUT" })).desired).toBeNull();
  });

  test("one item per job, ever — dismissing it doesn't bring it back", () => {
    expect(planUnraisedLoop(f({ rows: [row({ open: false, resolution: "decided", subjectId: "p1" })] })).desired).toBeNull();
  });
});
