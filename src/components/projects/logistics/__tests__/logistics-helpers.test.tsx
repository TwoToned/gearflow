import { describe, expect, test } from "vitest";
import type { LogisticsService } from "@/lib/logistics-model";
import { schedulePatch, windowMoved, type ScheduleSnapshot } from "../dates-sheet";
import { directionsHref } from "../day-mode";
import { groupCrew, PEOPLE_COLUMNS, type CrewAssignmentRow } from "../people-view";
import { rankMembers } from "../pick-crew-sheet";
import { splitOffers } from "../send-offers-dialog";
import { conflictRange } from "../use-logistics-data";
import { quickAddValues } from "../use-quick-add";
import { serviceTypeToPhase } from "../../../../../convex/lib/serviceSchedule";

const snap = (o: Partial<ScheduleSnapshot> = {}): ScheduleSnapshot => ({
  rentalStart: "2026-11-11", rentalEnd: "2026-11-13", loadIn: "", loadInTime: "", loadOut: "", loadOutTime: "", ...o,
});

describe("dates", () => {
  test("a blank job window follows the rental; an explicit one does not", () => {
    expect(windowMoved(snap(), snap({ rentalStart: "2026-11-14", rentalEnd: "2026-11-16" }))).toEqual({ loadInDays: 3, loadOutDays: 3 });
    // load in is its own date: moving the rental start leaves it, so it does not move
    const own = snap({ loadIn: "2026-11-10" });
    expect(windowMoved(own, { ...own, rentalStart: "2026-11-14" })).toEqual({ loadInDays: 0, loadOutDays: 0 });
  });
  test("the patch writes every key, so restoring a snapshot also clears what it cleared", () => {
    expect(schedulePatch(snap())).toEqual({
      rentalStartDate: "2026-11-11", rentalEndDate: "2026-11-13", projectStartDate: "", projectStartTime: "", projectEndDate: "", projectEndTime: "",
    });
  });
});

describe("crew rows", () => {
  const a = (id: string, o: Partial<CrewAssignmentRow> = {}): CrewAssignmentRow => ({
    id, status: "PENDING", crewMember: { id: "m" + id, firstName: "A", lastName: id, email: "a@x.com" }, ...o,
  });
  test("managers first, then phases in order, unphased last", () => {
    const g = groupCrew([a("1", { phase: "BUMP_OUT" }), a("2"), a("3", { isProjectManager: true }), a("4", { phase: "BUMP_IN" })]);
    expect(g.map((x) => x.title)).toEqual(["Project managers", "Bump out", "Bump in", "Other"]);
  });
  test("the Service column exists", () => {
    expect(PEOPLE_COLUMNS.map((c) => c.id)).toContain("service");
  });
  test("conflict range spans every dated assignment, null when none are dated", () => {
    expect(conflictRange([a("1")])).toBeNull();
    const r = conflictRange([a("1", { startDate: "2026-11-11T00:00:00.000Z", endDate: "2026-11-12T00:00:00.000Z" }), a("2", { startDate: "2026-11-10T00:00:00.000Z", endDate: "2026-11-11T00:00:00.000Z" })]);
    expect(r).toEqual({ start: Date.parse("2026-11-10T00:00:00.000Z"), end: Date.parse("2026-11-12T00:00:00.000Z") });
  });
});

describe("pick crew", () => {
  const m = (id: string, o: Record<string, unknown> = {}) => ({
    id, firstName: id, lastName: "", image: null, defaultDayRate: null, defaultHourlyRate: null, crewRole: { id: "r1", name: "Tech" },
    conflicts: [], isUnavailable: false, availability: "available" as const, hasPreferredBlock: false, ...o,
  });
  test("preferred, available, pencilled, booked; already-on-the-service and wrong-role members drop out", () => {
    const booked = m("booked", { conflicts: [{ severity: "hard", label: "Booked: #1" }] });
    const pencilled = m("pencilled", { availability: "tentative" });
    const preferred = m("preferred", { hasPreferredBlock: true });
    const free = m("free");
    const other = m("other", { crewRole: { id: "r2", name: "Rigger" } });
    const taken = m("taken");
    const list = rankMembers([booked, pencilled, free, preferred, other, taken], new Set(["taken"]), "r1");
    expect(list.map((x) => x.id)).toEqual(["preferred", "free", "pencilled", "booked"]);
    expect(rankMembers([other], new Set(), null)).toHaveLength(1);
  });
});

describe("offers", () => {
  test("members with no email are split out to be called", () => {
    const { sendable, noEmail } = splitOffers([
      { id: "1", name: "A", email: "a@x.com", serviceTitle: "s" }, { id: "2", name: "B", email: null, serviceTitle: "s" },
    ]);
    expect([sendable.length, noEmail.length]).toEqual([1, 1]);
  });
});

describe("quick add", () => {
  const ctx = { address: "1 Pitt St", latitude: -33.8, longitude: 151.2, window: { start: "2026-11-11", end: "2026-11-13" } };
  test("a pickup defaults to load out at the venue; a template's own defaults win", () => {
    const v = quickAddValues("PICKUP", ctx);
    expect(v).toMatchObject({ type: "PICKUP", title: "Pickup", date: "2026-11-13", endDate: "2026-11-13", address: "1 Pitt St", showOnDocuments: false, quantity: 1 });
    const t = quickAddValues("LABOUR", ctx, { title: "Rigging crew", defaultCrewCount: 3, defaultUnitPrice: 650, showOnDocuments: true });
    expect(t).toMatchObject({ title: "Rigging crew", crewCountRequired: 3, unitPrice: 650, showOnDocuments: true, date: "2026-11-11" });
  });
  test("a service type staffs its own phase", () => {
    expect(serviceTypeToPhase("LABOUR")).toBe("EVENT");
    expect(serviceTypeToPhase("MISC")).toBe("FULL_DURATION");
    expect(serviceTypeToPhase("BUMP_IN")).toBe("BUMP_IN");
  });
});

describe("directions", () => {
  const s = { latitude: -33.8, longitude: 151.2 } as LogisticsService;
  test("only with coordinates", () => {
    expect(directionsHref(s)).toContain("destination=-33.8,151.2");
    expect(directionsHref({ ...s, latitude: null })).toBeNull();
  });
});
