// @vitest-environment node
//
// Follow-up automation — the pure quote-loop rule (docs/designs/follow-up-automation.md
// §8.1–§8.3). Fixtures include the production cases the design was written
// against: an unconfirmed quote 8 days from its event, a quote 170 days out,
// an expired quote, a job that went ahead without acceptance.
import { describe, test, expect } from "vitest";
import {
  DECISION_RUNG,
  FOLLOW_UP_DEFAULTS,
  HOUSEKEEPING_RUNG,
  planQuoteLoop,
  resolutionForHumanDone,
  type FollowUpRow,
  type QuoteLoopFacts,
} from "./lib/followUpRules";
import { addBusinessDaysInTimezone, startOfDayInTimezone } from "./lib/quoteDates";

const TZ = "Australia/Sydney";
const DAY = 86_400_000;
// Tue 2026-10-06 09:00 AEDT
const SENT = Date.UTC(2026, 9, 5, 22, 0, 0);
const CUTOVER = Date.UTC(2026, 8, 22, 14, 0, 0);

function facts(over: Partial<QuoteLoopFacts> & { quote?: Partial<NonNullable<QuoteLoopFacts["quote"]>> | null } = {}): QuoteLoopFacts {
  const base: QuoteLoopFacts = {
    now: SENT + 60_000,
    config: { quotesEnabled: true, ...FOLLOW_UP_DEFAULTS, cutoverAt: CUTOVER, timezone: TZ },
    project: { status: "QUOTED", eventStart: SENT + 120 * DAY, projectNumber: "260901" },
    quote: { id: "q1", version: 1, effectiveStatus: "SENT", sentAt: SENT, validUntil: SENT + 30 * DAY },
    rows: [],
  };
  const quote = over.quote === null ? null : { ...base.quote!, ...(over.quote ?? {}) };
  return { ...base, ...over, project: { ...base.project, ...(over.project ?? {}) }, quote } as QuoteLoopFacts;
}

function row(p: Partial<FollowUpRow>): FollowUpRow {
  return { id: "r1", open: true, createdAt: SENT, rung: 1, loopStartAt: SENT, subjectId: "q1", lockedFields: [], ...p };
}

describe("planQuoteLoop — opening the loop", () => {
  test("a fresh send opens rung 1, due two business days later", () => {
    const plan = planQuoteLoop(facts());
    expect(plan.close).toEqual([]);
    expect(plan.desired).toMatchObject({ rung: 1, subjectId: "q1", priority: "NORMAL", urgent: false });
    expect(plan.desired!.dueDate).toBe(addBusinessDaysInTimezone(SENT, 2, TZ));
    expect(plan.desired!.title).toBe("Follow up on quote 260901 v1");
    expect(plan.desired!.why).toContain("no reply logged");
  });

  test("an existing open rung is kept, not duplicated", () => {
    const plan = planQuoteLoop(facts({ rows: [row({})] }));
    expect(plan.desired?.existingId).toBe("r1");
    expect(plan.close).toEqual([]);
  });

  test("quotes sent before the cut-over are never touched", () => {
    const plan = planQuoteLoop(facts({ quote: { sentAt: CUTOVER - DAY } }));
    expect(plan).toEqual({ close: [], desired: null });
  });

  test("the org switch turns the rule off and closes what's open", () => {
    const f = facts({ rows: [row({})] });
    f.config.quotesEnabled = false;
    expect(planQuoteLoop(f)).toEqual({ close: [{ id: "r1", resolution: "disabled", status: "CANCELLED" }], desired: null });
  });
});

describe("planQuoteLoop — the event clamps the ladder (§4.1)", () => {
  test("event 8 days out: urgent, next business day, HIGH", () => {
    const plan = planQuoteLoop(facts({ project: { status: "QUOTED", eventStart: SENT + 8 * DAY, projectNumber: "260901" } }));
    expect(plan.desired).toMatchObject({ rung: 1, urgent: true, priority: "HIGH" });
    // deadline (event − 14d) is already past → clamped to it, i.e. overdue now
    expect(plan.desired!.dueDate).toBeLessThanOrEqual(startOfDayInTimezone(SENT, TZ));
    expect(plan.desired!.why).toContain("event");
  });

  test("event far away: gentle rungs, due never later than two days before expiry", () => {
    const validUntil = SENT + 10 * DAY;
    const plan = planQuoteLoop(
      facts({
        quote: { validUntil },
        rows: [row({ open: false, resolution: "no_reply", completedAt: SENT + 6 * DAY })],
      }),
    );
    expect(plan.desired!.rung).toBe(2);
    expect(plan.desired!.dueDate).toBeLessThanOrEqual(startOfDayInTimezone(validUntil - 2 * DAY, TZ));
  });

  test("no event date and no expiry: plain business-day ladder", () => {
    const plan = planQuoteLoop(facts({ project: { status: "QUOTED", eventStart: undefined, projectNumber: "P" }, quote: { validUntil: undefined } }));
    expect(plan.desired!.dueDate).toBe(addBusinessDaysInTimezone(SENT, 2, TZ));
    expect(plan.desired!.urgent).toBe(false);
  });
});

describe("planQuoteLoop — rungs, outcomes and the decision", () => {
  test("each no_reply advances a rung; the third is the decision", () => {
    const r1 = row({ id: "a", open: false, resolution: "no_reply", completedAt: SENT + 3 * DAY });
    const r2 = row({ id: "b", open: false, resolution: "no_reply", completedAt: SENT + 9 * DAY, createdAt: SENT + 3 * DAY, rung: 2 });
    const f = facts({ now: SENT + 9 * DAY + 1000, rows: [r1, r2] });
    const plan = planQuoteLoop(f);
    expect(plan.desired).toMatchObject({ rung: DECISION_RUNG, priority: "HIGH" });
    expect(plan.desired!.title).toMatch(/^Decide on quote/);
  });

  test("a human-chosen next date wins over the ladder", () => {
    const next = SENT + 20 * DAY;
    const plan = planQuoteLoop(facts({ rows: [row({ open: false, resolution: "no_reply", completedAt: SENT + DAY, nextDate: next })] }));
    expect(plan.desired!.dueDate).toBe(startOfDayInTimezone(next, TZ));
  });

  test("a deleted rung is consumed, not recreated", () => {
    const plan = planQuoteLoop(facts({ rows: [row({ open: false, resolution: "deleted", completedAt: SENT + DAY })] }));
    expect(plan.desired!.rung).toBe(2);
  });

  test("deleting the decision rung ends the chase", () => {
    const rows = [1, 2, 3].map((rung, i) =>
      row({ id: `x${i}`, rung, open: false, resolution: rung === 3 ? "deleted" : "no_reply", completedAt: SENT + (i + 1) * DAY, createdAt: SENT + i * DAY }),
    );
    expect(planQuoteLoop(facts({ rows })).desired).toBeNull();
  });

  test("a decided decision rung ends the loop", () => {
    const plan = planQuoteLoop(facts({ rows: [row({ rung: 3, open: false, resolution: "decided", completedAt: SENT + DAY })] }));
    expect(plan.desired).toBeNull();
    // …until the quote is sent again after that decision
    const resent = planQuoteLoop(
      facts({ now: SENT + 10 * DAY, quote: { sentAt: SENT + 9 * DAY }, rows: [row({ rung: 3, open: false, resolution: "decided", completedAt: SENT + DAY })] }),
    );
    expect(resent.desired).toMatchObject({ rung: 1, loopStartAt: SENT + 9 * DAY });
  });

  test("an expired quote jumps straight to a decision due today", () => {
    const now = SENT + 31 * DAY;
    const plan = planQuoteLoop(facts({ now, quote: { effectiveStatus: "EXPIRED" }, rows: [row({})] }));
    expect(plan.desired).toMatchObject({ rung: DECISION_RUNG, existingId: "r1" });
    expect(plan.desired!.title).toContain("expired");
    expect(plan.desired!.dueDate).toBeLessThanOrEqual(startOfDayInTimezone(now, TZ));
  });

  test("human done means no_reply on a chasing rung, decided on the decision", () => {
    expect(resolutionForHumanDone(1)).toBe("no_reply");
    expect(resolutionForHumanDone(2)).toBe("no_reply");
    expect(resolutionForHumanDone(DECISION_RUNG)).toBe("decided");
    expect(resolutionForHumanDone(HOUSEKEEPING_RUNG)).toBe("decided");
  });
});

describe("planQuoteLoop — the loop closes itself", () => {
  test.each([
    ["ACCEPTED", "accepted", "DONE"],
    ["DECLINED", "declined", "DONE"],
    ["DRAFT", "recalled", "CANCELLED"],
  ])("quote %s closes the open row as %s", (effectiveStatus, resolution, status) => {
    const plan = planQuoteLoop(facts({ quote: { effectiveStatus }, rows: [row({})] }));
    expect(plan).toEqual({ close: [{ id: "r1", resolution, status }], desired: null });
  });

  test("a cancelled project closes the loop", () => {
    const plan = planQuoteLoop(facts({ project: { status: "CANCELLED", eventStart: undefined, projectNumber: "P" }, rows: [row({})] }));
    expect(plan.close).toEqual([{ id: "r1", resolution: "cancelled", status: "CANCELLED" }]);
  });

  test("the job went ahead without acceptance: one housekeeping item, no chase", () => {
    const plan = planQuoteLoop(facts({ project: { status: "CONFIRMED", eventStart: SENT + 30 * DAY, projectNumber: "P" }, rows: [row({})] }));
    expect(plan.desired).toMatchObject({ rung: HOUSEKEEPING_RUNG, existingId: "r1", urgent: false });
    expect(plan.desired!.title).toMatch(/^Record the outcome/);
    const done = planQuoteLoop(
      facts({ project: { status: "CONFIRMED", eventStart: SENT + 30 * DAY, projectNumber: "P" }, rows: [row({ rung: 0, open: false, resolution: "decided", completedAt: SENT + DAY })] }),
    );
    expect(done.desired).toBeNull();
  });
});

describe("planQuoteLoop — re-sends", () => {
  test("a quick re-send of a new version continues the ladder on the new quote", () => {
    const r1 = row({ id: "a", open: false, resolution: "no_reply", completedAt: SENT + 2 * DAY });
    const r2 = row({ id: "b", open: true, rung: 2, createdAt: SENT + 2 * DAY });
    const plan = planQuoteLoop(facts({ now: SENT + 3 * DAY, quote: { id: "q2", version: 2, sentAt: SENT + 3 * DAY }, rows: [r1, r2] }));
    expect(plan.close).toEqual([]);
    expect(plan.desired).toMatchObject({ existingId: "b", rung: 2, subjectId: "q2", loopStartAt: SENT });
  });

  test("a re-send long after the last activity starts a new loop at rung 1", () => {
    const r1 = row({ id: "a", open: true, rung: 2 });
    const resent = SENT + 20 * DAY;
    const plan = planQuoteLoop(facts({ now: resent + 1000, quote: { id: "q2", version: 2, sentAt: resent, validUntil: resent + 30 * DAY }, rows: [r1] }));
    expect(plan.close).toEqual([{ id: "a", resolution: "superseded", status: "CANCELLED" }]);
    expect(plan.desired).toMatchObject({ rung: 1, loopStartAt: resent, subjectId: "q2" });
    expect(plan.desired!.existingId).toBeUndefined();
  });

  test("a stray second open row is closed, never duplicated", () => {
    const plan = planQuoteLoop(facts({ rows: [row({ id: "a" }), row({ id: "b", createdAt: SENT + 1 })] }));
    expect(plan.close).toEqual([{ id: "b", resolution: "superseded", status: "CANCELLED" }]);
    expect(plan.desired?.existingId).toBe("a");
  });
});
