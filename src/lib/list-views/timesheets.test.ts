import { describe, expect, it } from "vitest";

import { defaultListState, parseListState, setFilter, withPatch } from "@/lib/list-url-state";
import { viewQuery } from "@/lib/list-views/saved-view-url";
import {
  TIMESHEETS_SPEC,
  TIMESHEETS_VIEW_ALIASES,
  statusFilterOf,
  timeEntryRowOf,
  timesheetColumns,
  timesheetSegments,
  timesheetsQueryArgs,
  totalsText,
  type TimeEntrySource,
} from "./timesheets";

const base: TimeEntrySource = {
  id: "e1",
  crewMemberId: "c1",
  assignmentId: "a1",
  description: "Bump in",
  date: "2026-11-07T00:00:00.000Z",
  startTime: "08:00",
  endTime: "17:00",
  breakMinutes: 30,
  totalHours: 8.5,
  status: "SUBMITTED",
  notes: null,
  queryReason: null,
  updatedAtMs: 1,
  crewMember: { id: "c1", firstName: "Ana", lastName: "Ruiz" },
  assignment: { id: "a1", project: { id: "p1", name: "Hilton gala", projectNumber: "#2336" }, crewRole: { name: "Rigger" } },
  approvedBy: null,
};
const withPay = (over: Partial<TimeEntrySource>): TimeEntrySource => ({ ...base, rate: 450, rateType: "DAILY", total: 450, rateIncluded: false, ...over });

describe("Timesheets URL state", () => {
  it("opens on Submitted, newest first", () => {
    const s = defaultListState(TIMESHEETS_SPEC);
    expect(s.seg).toBe("submitted");
    expect(`${s.sortBy}:${s.sortOrder}`).toBe("date:desc");
  });

  it("the strip and Status ▾ intersect; no overlap matches nothing", () => {
    const s = defaultListState(TIMESHEETS_SPEC);
    expect(statusFilterOf(s)).toEqual(["SUBMITTED"]);
    expect(statusFilterOf(withPatch(s, { seg: "all" }))).toBeUndefined();
    expect(statusFilterOf(setFilter(withPatch(s, { seg: "all" }), "status", ["DRAFT", "EXPORTED"]))).toEqual(["DRAFT", "EXPORTED"]);
    expect(statusFilterOf(setFilter(s, "status", ["DRAFT"]))).toEqual(["__none__"]);
    expect(statusFilterOf(setFilter(s, "status", ["SUBMITTED", "DRAFT"]))).toEqual(["SUBMITTED"]);
  });

  it("query args carry person as crewMemberId and never a clock", () => {
    const s = setFilter(parseListState(new URLSearchParams("seg=queried&q=ana"), TIMESHEETS_SPEC), "person", ["c1"]);
    expect(timesheetsQueryArgs(s)).toEqual({
      search: "ana",
      filters: { status: ["DISPUTED"], crewMemberId: ["c1"] },
      page: 1,
      pageSize: 25,
      sortBy: "date",
      sortOrder: "desc",
    });
  });

  it("an old saved view's crewMemberId filter converts to person on read", () => {
    const q = viewQuery({ filters: { crewMemberId: ["c1"], status: ["APPROVED"] }, sortBy: "totalHours", sortOrder: "asc" }, TIMESHEETS_SPEC, TIMESHEETS_VIEW_ALIASES);
    const s = parseListState(new URLSearchParams(q), TIMESHEETS_SPEC);
    expect(s.filters).toEqual({ status: ["APPROVED"], person: ["c1"] });
    expect(s.sortBy).toBe("totalHours");
  });
});

describe("strip and columns", () => {
  it("strip words read Queried for DISPUTED and carry the server counts", () => {
    const segs = timesheetSegments({ SUBMITTED: 10, APPROVED: 6, DISPUTED: 1, all: 43 });
    expect(segs.map((s) => `${s.label} ${s.count}`)).toEqual(["Submitted 10", "Approved 6", "Queried 1", "All 43"]);
  });

  it("Rate (pay) and Total exist only when the server says pay is visible", () => {
    expect(timesheetColumns(true).map((c) => c.id)).toContain("rate");
    expect(timesheetColumns(false).map((c) => c.id)).not.toContain("rate");
    expect(timesheetColumns(false).map((c) => c.id)).not.toContain("total");
    expect(timesheetColumns(true).find((c) => c.id === "rate")!.header).toBe("Rate (pay)");
    // At most 8 always-shown columns (playbook §3.8).
    expect(timesheetColumns(true).filter((c) => !c.optional).length + 1).toBeLessThanOrEqual(8);
  });
});

describe("rows", () => {
  it("desktop row: person + role, job, day, hours, rate and total from the server", () => {
    const r = timeEntryRowOf(withPay({}), { phone: false });
    expect(r.title).toBe("Ana Ruiz");
    expect(r.subtitle).toBe("Rigger");
    expect(r.status?.label).toBe("Submitted");
    expect(r.facts.date).toEqual({ kind: "text", label: "Sat 7 Nov" });
    expect(r.facts.hours).toEqual({ kind: "text", label: "8.5h" });
    expect(r.facts.rate).toEqual({ kind: "text", label: "$450/day" });
    expect(r.facts.total).toEqual({ kind: "money", amount: 450 });
  });

  it("no pay keys from the server: no pay facts at all", () => {
    const r = timeEntryRowOf(base, { phone: false });
    expect(r.facts.rate).toBeUndefined();
    expect(r.facts.total).toBeUndefined();
  });

  it("a carried day rate prints incl.; an unresolved rate is blank, never $0", () => {
    expect(timeEntryRowOf(withPay({ rateIncluded: true, total: null }), { phone: false }).facts.total).toEqual({ kind: "text", label: "incl." });
    const blank = timeEntryRowOf(withPay({ rate: null, rateType: null, total: null }), { phone: false });
    expect(blank.facts.rate).toEqual({ kind: "text", label: "—" });
    expect(blank.facts.total).toEqual({ kind: "money", amount: null });
  });

  it("the phone card folds to #2336 · Sat 7 Nov · 8.5h · Submitted with the total on the right", () => {
    const r = timeEntryRowOf(withPay({ status: "DISPUTED" }), { phone: true });
    expect(r.subtitle).toBeUndefined();
    expect(Object.keys(r.facts)).toEqual(["job", "date", "hours", "status", "total"]);
    expect(r.facts.status).toEqual({ kind: "text", label: "Queried" });
  });

  it("totals: money only for a pay-visible caller", () => {
    expect(totalsText({ hours: 361, pay: 16962 }, true)).toBe("Totals · 361h · $16,962");
    expect(totalsText({ hours: 361 }, false)).toBe("Totals · 361h");
  });
});
