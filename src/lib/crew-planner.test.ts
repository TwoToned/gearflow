import { describe, expect, it } from "vitest";

import {
  callStatusWord,
  callsOn,
  candidatesFor,
  coversDay,
  daysCovered,
  isMultiDay,
  dayState,
  defaultWeek,
  isDimmed,
  memberMatches,
  openCallMatches,
  planSuggestedOffers,
  plannedHours,
  plannerFooter,
  stripCounts,
  weekDays,
  weekOf,
  weekRange,
  type OpenCall,
  type PlannerCall,
  type PlannerFilters,
  type PlannerMember,
} from "./crew-planner";
import { canonicalState, normalizeAvail, parseWeek, plannerFilters, weekParam, PLANNER_SPEC } from "./crew-planner-url";
import { parseListState } from "./list-url-state";

const WEEK = "2026-11-16"; // a Monday
const iso = (key: string) => `${key}T00:00:00.000Z`;
const call = (id: string, day: string, status: string, over: Partial<PlannerCall> = {}): PlannerCall => ({
  id, status, startDate: iso(day), endDate: iso(day), startTime: "08:00", endTime: "18:00", serviceId: `s-${id}`,
  project: { id: "p1", name: "Gala", projectNumber: "#2341", projectManagerId: "me" }, crewRole: { name: "Rigger" }, ...over,
});
const member = (id: string, last: string, over: Partial<PlannerMember> = {}): PlannerMember => ({
  id, firstName: id.toUpperCase(), lastName: last, department: null, crewRole: { id: "r1", name: "Rigger" }, skillIds: [], assignments: [], availability: [], ...over,
});
const open = (over: Partial<OpenCall> = {}): OpenCall => ({
  serviceId: "svc1", projectId: "p1", projectName: "Gala", projectNumber: "#2341", title: "Bump in", date: Date.parse(iso("2026-11-18")),
  shortfall: 2, shortDays: [], startTime: "08:00", endTime: "18:00", crewRoleId: "r1", crewRoleName: "Rigger", phase: "BUMP_IN", ...over,
});
const none: PlannerFilters = { seg: "all", q: "", role: [], skill: [], job: [], avail: [] };
const ctx = { week: WEEK, userId: "me", skillName: (id: string) => (id === "k1" ? "Dante" : id) };

describe("weeks (D46: one week, Mon–Sun)", () => {
  it("a week is Mon–Sun from the Monday it falls in", () => {
    expect(weekOf("2026-11-19")).toBe(WEEK);
    expect(weekOf("2026-11-22")).toBe(WEEK); // Sunday belongs to the week before
    expect(weekDays(WEEK)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]);
  });

  it("opens on the next working week when today is a weekend", () => {
    expect(defaultWeek("2026-11-18")).toBe(WEEK);
    expect(defaultWeek("2026-11-21")).toBe("2026-11-23");
    expect(defaultWeek("2026-11-22")).toBe("2026-11-23");
  });

  it("honours the org's week start (#1086): a Sunday-start org's week is Sun–Sat", () => {
    expect(weekOf("2026-11-19", 0)).toBe("2026-11-15");
    expect(weekOf("2026-11-15", 0)).toBe("2026-11-15"); // Sunday opens its own week
    expect(weekDays(weekOf("2026-11-19", 0))[6]).toBe("2026-11-21");
    // On a weekend the planner opens on the week holding the next working days.
    expect(defaultWeek("2026-11-21", 0)).toBe("2026-11-22"); // Saturday → tomorrow's week
    expect(defaultWeek("2026-11-22", 0)).toBe("2026-11-22"); // Sunday → this week (starts today)
    expect(parseWeek("2026-11-19", "2026-11-01", 0)).toBe("2026-11-15");
    expect(weekParam("2026-11-15", "2026-11-18", 0)).toBeNull();
  });

  it("the legacy week=<ms> link is read as the viewer's LOCAL day it was written from", () => {
    // East of Greenwich, local midnight Monday is still Sunday in UTC: reading it in UTC lands a week early.
    const tz = process.env.TZ;
    process.env.TZ = "Australia/Sydney";
    try {
      const localMon = new Date(2026, 10, 16, 0, 0, 0).getTime(); // local midnight Monday (startOfWeek output)
      expect(parseWeek(String(localMon), "2026-11-01")).toBe("2026-11-16");
    } finally {
      process.env.TZ = tz;
    }
  });

  it("the query window spans the whole Sunday", () => {
    const r = weekRange(WEEK);
    expect(new Date(r.endMs).toISOString()).toBe("2026-11-22T23:59:59.999Z");
  });
});

describe("the week URL (#1246 find-cover deep link kept)", () => {
  it("reads a day key, a legacy epoch-ms week, and falls back on junk", () => {
    expect(parseWeek("2026-11-19", "2026-11-01")).toBe(WEEK);
    expect(parseWeek(String(Date.parse(iso("2026-11-18"))), "2026-11-01")).toBe(WEEK);
    expect(parseWeek("garbage", "2026-11-18")).toBe(WEEK);
    expect(parseWeek(null, "2026-11-21")).toBe("2026-11-23");
  });

  it("omits the default week", () => {
    expect(weekParam(WEEK, "2026-11-18")).toBeNull();
    expect(weekParam("2026-11-23", "2026-11-18")).toBe("2026-11-23");
  });

  it("maps the old availability values (`avail=AVAILABLE` = Free) and drops junk", () => {
    expect(normalizeAvail(["AVAILABLE", "TENTATIVE", "free", "nope"])).toEqual(["free", "pencilled"]);
    const state = parseListState(new URLSearchParams("role=r1&avail=AVAILABLE&week=1&seg=needs"), PLANNER_SPEC);
    expect(plannerFilters(state)).toMatchObject({ seg: "needs", role: ["r1"], avail: ["free"] });
    expect(canonicalState(state).filters.avail).toEqual(["free"]);
  });
});

describe("cells", () => {
  it("places calls on the days they cover, earliest first", () => {
    const m = member("a", "Ryan", { assignments: [call("late", "2026-11-17", "OFFERED", { startTime: "14:00" }), call("early", "2026-11-17", "CONFIRMED", { startTime: "06:30" })] });
    expect(callsOn(m, "2026-11-17").map((c) => c.id)).toEqual(["early", "late"]);
    expect(callsOn(m, "2026-11-18")).toEqual([]);
  });

  it("availability words: Unavailable wins, then booked, then Pencilled (TENTATIVE), then Preferred", () => {
    const m = member("a", "Ryan", {
      availability: [
        { id: "v1", type: "UNAVAILABLE", startDate: iso("2026-11-16"), endDate: iso("2026-11-16"), reason: "Leave" },
        { id: "v2", type: "TENTATIVE", startDate: iso("2026-11-17"), endDate: iso("2026-11-18"), reason: "#2340 Launch night" },
        { id: "v3", type: "PREFERRED", startDate: iso("2026-11-19"), endDate: iso("2026-11-19") },
      ],
      assignments: [call("c1", "2026-11-18", "CONFIRMED")],
    });
    expect(dayState(m, "2026-11-16")).toMatchObject({ kind: "unavailable", text: "Unavailable · Leave" });
    expect(dayState(m, "2026-11-17")).toMatchObject({ kind: "pencilled", ref: "#2340 Launch night" });
    expect(dayState(m, "2026-11-18")).toMatchObject({ kind: "booked", text: "On #2341 · 08:00–18:00" });
    expect(dayState(m, "2026-11-18", "c1").kind).toBe("pencilled");
    expect(dayState(m, "2026-11-19").kind).toBe("preferred");
    expect(dayState(m, "2026-11-20").kind).toBe("free");
  });

  it("status word from the one label source; Offered carries its age, amber from 3 days", () => {
    const now = Date.parse("2026-11-20T09:00:00Z");
    expect(callStatusWord(call("c", WEEK, "CONFIRMED"), now)).toMatchObject({ label: "Confirmed" });
    expect(callStatusWord(call("c", WEEK, "OFFERED", { offeredAt: "2026-11-18T09:00:00Z" }), now)).toMatchObject({ label: "Offered", age: "2d", stale: false });
    expect(callStatusWord(call("c", WEEK, "OFFERED", { offeredAt: "2026-11-16T09:00:00Z" }), now)).toMatchObject({ age: "4d", stale: true });
    expect(callStatusWord(call("c", WEEK, "OFFERED", { offeredAt: "2026-11-20T08:00:00Z" }), now).age).toBeUndefined();
  });
});

describe("hours (planned, derived)", () => {
  it("each call's estimate, else times × days; pending / declined are not planned", () => {
    const m = member("a", "Ryan", {
      assignments: [
        call("est", "2026-11-16", "CONFIRMED", { estimatedHours: 6 }),
        call("span", "2026-11-17", "ACCEPTED", { endDate: iso("2026-11-18") }), // 10h × 2 days
        call("night", "2026-11-19", "OFFERED", { startTime: "23:30", endTime: "02:30" }), // 3h overnight
        call("pend", "2026-11-20", "PENDING"),
        call("dec", "2026-11-21", "DECLINED"),
        call("other", "2026-11-25", "CONFIRMED"),
      ],
    });
    expect(plannedHours(m, WEEK)).toBe(6 + 20 + 3);
  });
});

describe("strip, filters and dimming", () => {
  const a = member("a", "Ryan", { skillIds: ["k1"], assignments: [call("c1", "2026-11-17", "OFFERED"), call("c2", "2026-11-18", "CONFIRMED", { project: { id: "p2", name: "AGM", projectNumber: "#2338", projectManagerId: "you" } })] });
  const b = member("b", "Lee", { crewRole: { id: "r2", name: "Audio" }, assignments: [call("c3", "2026-11-19", "DECLINED")] });
  const c = member("c", "Fox", { availability: [{ id: "v", type: "UNAVAILABLE", startDate: iso("2026-11-20"), endDate: iso("2026-11-20") }] });

  it("counts: All = calls this week, Needs crew = open slots, Unconfirmed, Mine", () => {
    expect(stripCounts([a, b, c], [open(), open({ serviceId: "x", shortfall: 1 })], WEEK, "me")).toEqual({ all: 3, needs: 3, unconfirmed: 1, mine: 1 });
  });

  it("person filters: Role, Skill, Job, Availability, search", () => {
    const keep = (f: Partial<PlannerFilters>) => [a, b, c].filter((m) => memberMatches(m, { ...none, ...f }, ctx)).map((m) => m.id);
    expect(keep({ role: ["r2"] })).toEqual(["b"]);
    expect(keep({ skill: ["k1"] })).toEqual(["a"]);
    expect(keep({ job: ["p2"] })).toEqual(["a"]);
    expect(keep({ avail: ["free"] })).toEqual(["b"]); // a declined call does not book the week
    expect(keep({ avail: ["unavailable", "booked"] })).toEqual(["a", "c"]);
    expect(keep({ q: "dante" })).toEqual(["a"]);
    expect(keep({ q: "#2338" })).toEqual(["a"]);
  });

  it("Unconfirmed / Mine keep only people with a matching call and dim the other blocks", () => {
    expect([a, b, c].filter((m) => memberMatches(m, { ...none, seg: "unconfirmed" }, ctx)).map((m) => m.id)).toEqual(["a"]);
    expect(isDimmed(a.assignments[1], { ...none, seg: "unconfirmed" }, "me")).toBe(true);
    expect(isDimmed(a.assignments[0], { ...none, seg: "unconfirmed" }, "me")).toBe(false);
    expect(isDimmed(a.assignments[1], { ...none, seg: "mine" }, "me")).toBe(true);
    expect(isDimmed(a.assignments[0], { ...none, job: ["p2"] }, "me")).toBe(true);
    expect(isDimmed(a.assignments[0], none, "me")).toBe(false);
  });

  it("Needs crew rows follow Role / Job / search", () => {
    expect(openCallMatches(open(), { ...none, role: ["r2"] })).toBe(false);
    expect(openCallMatches(open(), { ...none, job: ["p1"], q: "bump" })).toBe(true);
  });

  it("footer: confirmed of active, then each word; declined is its own flag", () => {
    expect(plannerFooter([a, b, c], WEEK)).toEqual({ text: "3 people · 1 of 2 confirmed · 0 accepted · 1 offered · 0 pending", declined: 1 });
  });
});

describe("suggestions", () => {
  const free = member("f", "Ames");
  const pref = member("p", "Zed", { availability: [{ id: "v", type: "PREFERRED", startDate: iso("2026-11-18"), endDate: iso("2026-11-18") }] });
  const pencil = member("t", "Bo", { availability: [{ id: "v", type: "TENTATIVE", startDate: iso("2026-11-18"), endDate: iso("2026-11-18") }] });
  const off = member("o", "Cy", { availability: [{ id: "v", type: "UNAVAILABLE", startDate: iso("2026-11-18"), endDate: iso("2026-11-18") }] });
  const audio = member("x", "Al", { crewRole: { id: "r2", name: "Audio" } });
  const already = member("y", "Ay", { assignments: [call("q", "2026-11-18", "OFFERED", { serviceId: "svc1" })] });

  it("role match, not on the service, never unavailable: preferred first, then by last name", () => {
    expect(candidatesFor(open(), [free, pref, pencil, off, audio, already], ["2026-11-18"]).map((c) => c.member.id)).toEqual(["p", "f", "t"]);
  });

  it("Offer to suggested: free or preferred up to the shortfall, one person once per day", () => {
    const plan = planSuggestedOffers([open(), open({ serviceId: "svc2", shortfall: 1 })], [free, pref, pencil], weekDays(WEEK));
    expect(plan.offers.map((o) => `${o.open.serviceId}:${o.member.id}`)).toEqual(["svc1:p", "svc1:f"]);
    expect(plan.unfilled.map((o) => o.serviceId)).toEqual(["svc2"]);
  });
});

describe("multi-day open calls (a Tue–Thu run)", () => {
  const run = open({ serviceId: "run", date: Date.parse(iso("2026-11-17")), endDate: Date.parse(iso("2026-11-19")), shortfall: 1 });
  // Ana is free Tuesday (the run's start) but unavailable Wednesday.
  const ana = member("ana", "Ruiz", { availability: [{ id: "v", type: "UNAVAILABLE", startDate: iso("2026-11-18"), endDate: iso("2026-11-18"), reason: "Dentist" }] });
  const ben = member("ben", "Lee");

  it("covers every day of the run, and only those", () => {
    expect(daysCovered(run, weekDays(WEEK))).toEqual(["2026-11-17", "2026-11-18", "2026-11-19"]);
    expect(coversDay(run, "2026-11-18")).toBe(true);
    expect(coversDay(run, "2026-11-20")).toBe(false);
    expect(isMultiDay(run)).toBe(true);
    expect(isMultiDay(open())).toBe(false);
  });

  it("Ana, unavailable on Wednesday, is never suggested for the whole run (she was, checking only Tuesday)", () => {
    expect(candidatesFor(run, [ana, ben], daysCovered(run, weekDays(WEEK))).map((c) => c.member.id)).toEqual(["ben"]);
    expect(planSuggestedOffers([run], [ana, ben], weekDays(WEEK)).offers.map((o) => o.member.id)).toEqual(["ben"]);
    // Offered for Tuesday alone, she can take it.
    expect(candidatesFor(run, [ana, ben], ["2026-11-17"]).map((c) => c.member.id)).toEqual(["ben", "ana"]);
  });

  it("a run claims every day it covers: a Wednesday call can't go to the person the run took", () => {
    const wed = open({ serviceId: "wed", date: Date.parse(iso("2026-11-18")), shortfall: 1 });
    const plan = planSuggestedOffers([run, wed], [ben], weekDays(WEEK));
    expect(plan.offers.map((o) => `${o.open.serviceId}:${o.member.id}`)).toEqual(["run:ben"]);
    expect(plan.unfilled.map((o) => o.serviceId)).toEqual(["wed"]);
  });
});
