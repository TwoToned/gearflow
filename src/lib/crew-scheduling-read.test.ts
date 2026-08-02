import { describe, it, expect } from "vitest";
import {
  mapAssignment,
  mapShift,
  mapAvailability,
  mapTimeEntry,
  compareAscNullsLast,
  compareDescNullsFirst,
  countActiveConfirmedAssignments,
  countPendingOffers,
  countSubmittedTimeEntries,
  sumHoursThisWeek,
  selectActiveAssignmentsSummary,
  selectPendingOffers,
  selectPendingTimeEntries,
  selectMemberPickerAssignments,
  selectUpcomingShifts,
  sortProjectCrew,
  aggregateProjectLabourCost,
  shiftsForAssignmentSortedAsc,
  sortTimeEntries,
  filterTimeEntries,
  paginate,
  sortTimeEntriesDateThenStartDesc,
  overlapsRange,
  assignmentOverlapsRange,
  selectMemberAvailability,
  selectPlannerAssignments,
  selectPlannerAvailability,
  selectMemberConflicts,
  selectUnavailableMemberIds,
  PROJECT_PHASE_RANK,
  type ConvexCrewAssignment,
  type ConvexCrewShift,
  type ConvexCrewAvailability,
  type ConvexCrewTimeEntry,
  type MappedCrewAssignment,
  type MappedCrewTimeEntry,
} from "./crew-scheduling-read";

const ms = (iso: string) => new Date(iso).getTime();

// ─── Factory helpers ──────────────────────────────────────────────────────────
function rawAssignment(over: Partial<ConvexCrewAssignment> = {}): ConvexCrewAssignment {
  return {
    _id: "x" as never,
    _creationTime: 0,
    id: "a1",
    organizationId: "org",
    projectId: "p1",
    crewMemberId: "m1",
    ...over,
  } as ConvexCrewAssignment;
}
function mAssign(over: Partial<MappedCrewAssignment> = {}): MappedCrewAssignment {
  return { ...mapAssignment(rawAssignment()), ...over };
}
function mTime(over: Partial<MappedCrewTimeEntry> = {}): MappedCrewTimeEntry {
  return {
    id: "t1",
    organizationId: "org",
    assignmentId: null,
    crewMemberId: "m1",
    description: null,
    date: new Date("2026-06-10T00:00:00Z"),
    startTime: "09:00",
    endTime: "17:00",
    breakMinutes: 0,
    totalHours: 8,
    status: "DRAFT",
    approvedById: null,
    approvedAt: null,
    notes: null,
    createdAt: null,
    updatedAt: null,
    ...over,
  };
}

// ─── Mappers ──────────────────────────────────────────────────────────────────
describe("mappers", () => {
  it("mapAssignment: epoch->Date, absent->null, defaults coerced, _id stripped", () => {
    const d = mapAssignment(
      rawAssignment({
        status: "CONFIRMED",
        startDate: ms("2026-06-01T00:00:00Z"),
        estimatedCost: 1200,
        isProjectManager: true,
      }),
    );
    expect(d.startDate).toBeInstanceOf(Date);
    expect(d.startDate?.getTime()).toBe(ms("2026-06-01T00:00:00Z"));
    expect(d.endDate).toBeNull();
    expect(d.crewRoleId).toBeNull();
    expect(d.estimatedCost).toBe(1200);
    expect(d.isProjectManager).toBe(true);
    expect((d as unknown as Record<string, unknown>)._id).toBeUndefined();
    expect((d as unknown as Record<string, unknown>)._creationTime).toBeUndefined();
  });

  it("mapAssignment: missing status defaults to PENDING, missing isProjectManager false", () => {
    const d = mapAssignment(rawAssignment());
    expect(d.status).toBe("PENDING");
    expect(d.isProjectManager).toBe(false);
  });

  it("mapShift: date required->Date, status default SCHEDULED, breakMinutes absent->null", () => {
    const s = mapShift({
      _id: "x" as never,
      _creationTime: 0,
      id: "s1",
      assignmentId: "a1",
      date: ms("2026-06-05T00:00:00Z"),
    } as ConvexCrewShift);
    expect(s.date.getTime()).toBe(ms("2026-06-05T00:00:00Z"));
    expect(s.status).toBe("SCHEDULED");
    expect(s.breakMinutes).toBeNull();
  });

  it("mapAvailability: org optional->null, type default UNAVAILABLE, isAllDay default true", () => {
    const av = mapAvailability({
      _id: "x" as never,
      _creationTime: 0,
      id: "av1",
      crewMemberId: "m1",
      startDate: ms("2026-06-01T00:00:00Z"),
      endDate: ms("2026-06-02T00:00:00Z"),
    } as ConvexCrewAvailability);
    expect(av.organizationId).toBeNull();
    expect(av.type).toBe("UNAVAILABLE");
    expect(av.isAllDay).toBe(true);
    expect(av.startDate).toBeInstanceOf(Date);
  });

  it("mapTimeEntry: breakMinutes default 0, status default DRAFT, totalHours absent->null", () => {
    const e = mapTimeEntry({
      _id: "x" as never,
      _creationTime: 0,
      id: "t1",
      organizationId: "org",
      crewMemberId: "m1",
      date: ms("2026-06-10T00:00:00Z"),
      startTime: "09:00",
      endTime: "17:00",
    } as ConvexCrewTimeEntry);
    expect(e.breakMinutes).toBe(0);
    expect(e.status).toBe("DRAFT");
    expect(e.totalHours).toBeNull();
    expect(e.assignmentId).toBeNull();
  });
});

// ─── Comparators ───────────────────────────────────────────────────────────────
describe("comparators", () => {
  it("compareAscNullsLast puts nulls last", () => {
    const arr = [3, null, 1, undefined, 2].sort(compareAscNullsLast);
    expect(arr).toEqual([1, 2, 3, null, undefined]);
  });
  it("compareDescNullsFirst puts nulls first", () => {
    const arr = [3, null, 1, 2].sort(compareDescNullsFirst);
    expect(arr).toEqual([null, 3, 2, 1]);
  });
});

// ─── Dashboard ─────────────────────────────────────────────────────────────────
describe("dashboard stats", () => {
  const now = new Date("2026-06-15T00:00:00Z");
  it("countActiveConfirmedAssignments: CONFIRMED + (endDate>=now OR null)", () => {
    const list = [
      mAssign({ status: "CONFIRMED", endDate: new Date("2026-06-20T00:00:00Z") }),
      mAssign({ status: "CONFIRMED", endDate: null }),
      mAssign({ status: "CONFIRMED", endDate: new Date("2026-06-01T00:00:00Z") }), // past
      mAssign({ status: "PENDING", endDate: null }),
    ];
    expect(countActiveConfirmedAssignments(list, now)).toBe(2);
  });

  it("countPendingOffers counts PENDING + OFFERED", () => {
    const list = [
      mAssign({ status: "PENDING" }),
      mAssign({ status: "OFFERED" }),
      mAssign({ status: "CONFIRMED" }),
    ];
    expect(countPendingOffers(list)).toBe(2);
  });

  it("countSubmittedTimeEntries counts SUBMITTED only", () => {
    expect(
      countSubmittedTimeEntries([mTime({ status: "SUBMITTED" }), mTime({ status: "APPROVED" })]),
    ).toBe(1);
  });

  it("sumHoursThisWeek: APPROVED|EXPORTED, date>=weekAgo", () => {
    const weekAgo = new Date("2026-06-08T00:00:00Z");
    const list = [
      mTime({ status: "APPROVED", totalHours: 5, date: new Date("2026-06-10T00:00:00Z") }),
      mTime({ status: "EXPORTED", totalHours: 3, date: new Date("2026-06-09T00:00:00Z") }),
      mTime({ status: "APPROVED", totalHours: 9, date: new Date("2026-06-01T00:00:00Z") }), // before weekAgo
      mTime({ status: "SUBMITTED", totalHours: 4, date: new Date("2026-06-10T00:00:00Z") }), // wrong status
      mTime({ status: "APPROVED", totalHours: null, date: new Date("2026-06-10T00:00:00Z") }), // null hours
    ];
    expect(sumHoursThisWeek(list, weekAgo)).toBe(8);
  });

  it("selectActiveAssignmentsSummary: status CONFIRMED|ACCEPTED, running, sorted startDate asc, cap 20", () => {
    const list = [
      mAssign({ status: "ACCEPTED", startDate: new Date("2026-06-20T00:00:00Z"), endDate: null }),
      mAssign({ status: "CONFIRMED", startDate: new Date("2026-06-16T00:00:00Z"), endDate: null }),
      mAssign({ status: "DECLINED", startDate: new Date("2026-06-10T00:00:00Z"), endDate: null }),
    ];
    const out = selectActiveAssignmentsSummary(list, now);
    expect(out.map((a) => a.startDate?.getTime())).toEqual([
      ms("2026-06-16T00:00:00Z"),
      ms("2026-06-20T00:00:00Z"),
    ]);
  });

  it("selectPendingOffers: createdAt desc, cap 15", () => {
    const list = [
      mAssign({ status: "PENDING", createdAt: new Date("2026-06-01T00:00:00Z") }),
      mAssign({ status: "OFFERED", createdAt: new Date("2026-06-05T00:00:00Z") }),
    ];
    const out = selectPendingOffers(list);
    expect(out.map((a) => a.createdAt?.getTime())).toEqual([
      ms("2026-06-05T00:00:00Z"),
      ms("2026-06-01T00:00:00Z"),
    ]);
  });

  it("selectPendingTimeEntries: SUBMITTED, date desc, cap 15", () => {
    const list = [
      mTime({ status: "SUBMITTED", date: new Date("2026-06-01T00:00:00Z") }),
      mTime({ status: "SUBMITTED", date: new Date("2026-06-09T00:00:00Z") }),
      mTime({ status: "DRAFT", date: new Date("2026-06-10T00:00:00Z") }),
    ];
    const out = selectPendingTimeEntries(list);
    expect(out).toHaveLength(2);
    expect(out[0].date.getTime()).toBe(ms("2026-06-09T00:00:00Z"));
  });

  it("selectMemberPickerAssignments: exclude CANCELLED|DECLINED, startDate desc", () => {
    const list = [
      mAssign({ status: "CONFIRMED", startDate: new Date("2026-06-01T00:00:00Z") }),
      mAssign({ status: "CANCELLED", startDate: new Date("2026-06-09T00:00:00Z") }),
      mAssign({ status: "PENDING", startDate: new Date("2026-06-05T00:00:00Z") }),
    ];
    const out = selectMemberPickerAssignments(list);
    expect(out.map((a) => a.status)).toEqual(["PENDING", "CONFIRMED"]);
  });

  it("selectUpcomingShifts: SCHEDULED, date>=today, assignment in org, date asc, cap 10", () => {
    const orgIds = new Set(["a1", "a2"]);
    const today = new Date("2026-06-15T00:00:00Z");
    const shifts = [
      mapShift({ id: "s1", assignmentId: "a1", date: ms("2026-06-16T00:00:00Z"), status: "SCHEDULED" } as ConvexCrewShift),
      mapShift({ id: "s2", assignmentId: "a2", date: ms("2026-06-15T00:00:00Z"), status: "SCHEDULED" } as ConvexCrewShift),
      mapShift({ id: "s3", assignmentId: "a1", date: ms("2026-06-14T00:00:00Z"), status: "SCHEDULED" } as ConvexCrewShift), // past
      mapShift({ id: "s4", assignmentId: "a3", date: ms("2026-06-20T00:00:00Z"), status: "SCHEDULED" } as ConvexCrewShift), // not in org
      mapShift({ id: "s5", assignmentId: "a1", date: ms("2026-06-18T00:00:00Z"), status: "CANCELLED" } as ConvexCrewShift), // wrong status
    ];
    const out = selectUpcomingShifts(shifts, orgIds, today);
    expect(out.map((s) => s.id)).toEqual(["s2", "s1"]);
  });
});

// ─── Project crew ────────────────────────────────────────────────────────────
describe("project crew", () => {
  it("sortProjectCrew: PM first, then phase declared order, then lastName asc", () => {
    expect(PROJECT_PHASE_RANK.BUMP_IN).toBeLessThan(PROJECT_PHASE_RANK.EVENT);
    const rows = [
      { id: "1", isProjectManager: false, phase: "EVENT", lastName: "Adams" },
      { id: "2", isProjectManager: true, phase: "EVENT", lastName: "Zed" },
      { id: "3", isProjectManager: false, phase: "BUMP_IN", lastName: "Brown" },
      { id: "4", isProjectManager: false, phase: null, lastName: "Carter" },
    ];
    const out = sortProjectCrew(rows, (r) => r.lastName);
    expect(out.map((r) => r.id)).toEqual(["2", "3", "1", "4"]);
  });

  it("aggregateProjectLabourCost: sum estimatedCost + count, excl CANCELLED|DECLINED", () => {
    const list = [
      mAssign({ status: "CONFIRMED", estimatedCost: 100 }),
      mAssign({ status: "PENDING", estimatedCost: 50 }),
      mAssign({ status: "CANCELLED", estimatedCost: 999 }),
      mAssign({ status: "CONFIRMED", estimatedCost: null }),
    ];
    expect(aggregateProjectLabourCost(list)).toEqual({ totalLabourCost: 150, assignmentCount: 3 });
  });

  it("aggregateProjectLabourCost: excludes service-linked assignments (already counted in serviceCostTotal)", () => {
    const list = [
      mAssign({ status: "CONFIRMED", estimatedCost: 100, serviceId: null }),
      mAssign({ status: "CONFIRMED", estimatedCost: 500, serviceId: "svc1" }),
    ];
    expect(aggregateProjectLabourCost(list)).toEqual({ totalLabourCost: 100, assignmentCount: 1 });
  });

  it("shiftsForAssignmentSortedAsc filters by assignment and sorts date asc", () => {
    const shifts = [
      mapShift({ id: "s1", assignmentId: "a1", date: ms("2026-06-09T00:00:00Z") } as ConvexCrewShift),
      mapShift({ id: "s2", assignmentId: "a2", date: ms("2026-06-01T00:00:00Z") } as ConvexCrewShift),
      mapShift({ id: "s3", assignmentId: "a1", date: ms("2026-06-01T00:00:00Z") } as ConvexCrewShift),
    ];
    expect(shiftsForAssignmentSortedAsc(shifts, "a1").map((s) => s.id)).toEqual(["s3", "s1"]);
  });
});

// ─── Time entries list ─────────────────────────────────────────────────────────
describe("time entry list filter/sort/paginate", () => {
  const nameMap: Record<string, { firstName: string; lastName: string }> = {
    m1: { firstName: "Alice", lastName: "Zephyr" },
    m2: { firstName: "Bob", lastName: "Anders" },
  };
  const projMap: Record<string, { name: string; projectNumber: string }> = {
    a1: { name: "Gala Night", projectNumber: "P-0007" },
  };
  const ctxFilter = {
    nameOf: (e: MappedCrewTimeEntry) => nameMap[e.crewMemberId] ?? { firstName: "", lastName: "" },
    projectOf: (e: MappedCrewTimeEntry) => (e.assignmentId ? projMap[e.assignmentId] ?? null : null),
  };

  it("search matches member name, description, project name/number (case-insensitive)", () => {
    const entries = [
      mTime({ id: "t1", crewMemberId: "m1" }),
      mTime({ id: "t2", crewMemberId: "m2", description: "overnight" }),
      mTime({ id: "t3", crewMemberId: "m2", assignmentId: "a1" }),
    ];
    expect(filterTimeEntries(entries, { search: "alice" }, ctxFilter).map((e) => e.id)).toEqual(["t1"]);
    expect(filterTimeEntries(entries, { search: "OVERNIGHT" }, ctxFilter).map((e) => e.id)).toEqual(["t2"]);
    expect(filterTimeEntries(entries, { search: "p-0007" }, ctxFilter).map((e) => e.id)).toEqual(["t3"]);
  });

  it("status + crewMemberId filters use IN semantics", () => {
    const entries = [
      mTime({ id: "t1", crewMemberId: "m1", status: "DRAFT" }),
      mTime({ id: "t2", crewMemberId: "m2", status: "APPROVED" }),
    ];
    expect(
      filterTimeEntries(entries, { filters: { status: ["APPROVED"] } }, ctxFilter).map((e) => e.id),
    ).toEqual(["t2"]);
    expect(
      filterTimeEntries(entries, { filters: { crewMemberId: ["m1"] } }, ctxFilter).map((e) => e.id),
    ).toEqual(["t1"]);
  });

  it("sortTimeEntries by date desc adds startTime desc tie-break", () => {
    const d = new Date("2026-06-10T00:00:00Z");
    const entries = [
      mTime({ id: "t1", date: d, startTime: "08:00" }),
      mTime({ id: "t2", date: d, startTime: "12:00" }),
    ];
    const out = sortTimeEntries(entries, "date", "desc", { lastNameOf: (e) => nameMap[e.crewMemberId]?.lastName });
    expect(out.map((e) => e.id)).toEqual(["t2", "t1"]);
  });

  it("sortTimeEntries by crewMember uses lastName", () => {
    const entries = [mTime({ id: "t1", crewMemberId: "m1" }), mTime({ id: "t2", crewMemberId: "m2" })];
    const out = sortTimeEntries(entries, "crewMember", "asc", {
      lastNameOf: (e) => nameMap[e.crewMemberId]?.lastName,
    });
    expect(out.map((e) => e.id)).toEqual(["t2", "t1"]); // Anders before Zephyr
  });

  it("paginate slices 1-based pages", () => {
    const rows = [1, 2, 3, 4, 5];
    expect(paginate(rows, 1, 2)).toEqual([1, 2]);
    expect(paginate(rows, 2, 2)).toEqual([3, 4]);
    expect(paginate(rows, 3, 2)).toEqual([5]);
  });

  it("sortTimeEntriesDateThenStartDesc orders date desc then startTime desc", () => {
    const entries = [
      mTime({ id: "t1", date: new Date("2026-06-01T00:00:00Z"), startTime: "09:00" }),
      mTime({ id: "t2", date: new Date("2026-06-09T00:00:00Z"), startTime: "08:00" }),
      mTime({ id: "t3", date: new Date("2026-06-09T00:00:00Z"), startTime: "15:00" }),
    ];
    expect(sortTimeEntriesDateThenStartDesc(entries).map((e) => e.id)).toEqual(["t3", "t2", "t1"]);
  });
});

// ─── Overlap + availability ─────────────────────────────────────────────────────
describe("overlap + availability", () => {
  const range = { start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-12T00:00:00Z") };

  it("overlapsRange: rowStart<=end AND rowEnd>=start", () => {
    expect(
      overlapsRange(new Date("2026-06-11"), new Date("2026-06-15"), range.start, range.end),
    ).toBe(true);
    expect(
      overlapsRange(new Date("2026-06-01"), new Date("2026-06-05"), range.start, range.end),
    ).toBe(false);
    expect(
      overlapsRange(new Date("2026-06-13"), new Date("2026-06-20"), range.start, range.end),
    ).toBe(false);
  });

  it("assignmentOverlapsRange: null start/end never overlaps", () => {
    expect(assignmentOverlapsRange(mAssign({ startDate: null, endDate: null }), range.start, range.end)).toBe(false);
    expect(
      assignmentOverlapsRange(
        mAssign({ startDate: new Date("2026-06-11"), endDate: new Date("2026-06-11") }),
        range.start,
        range.end,
      ),
    ).toBe(true);
  });

  it("selectMemberAvailability: filter by member + optional overlap, sorted startDate asc", () => {
    const rows = [
      mapAvailability({ id: "av1", crewMemberId: "m1", startDate: ms("2026-06-11"), endDate: ms("2026-06-11") } as ConvexCrewAvailability),
      mapAvailability({ id: "av2", crewMemberId: "m1", startDate: ms("2026-06-01"), endDate: ms("2026-06-02") } as ConvexCrewAvailability),
      mapAvailability({ id: "av3", crewMemberId: "m2", startDate: ms("2026-06-11"), endDate: ms("2026-06-11") } as ConvexCrewAvailability),
    ];
    expect(selectMemberAvailability(rows, "m1", null).map((r) => r.id)).toEqual(["av2", "av1"]);
    expect(selectMemberAvailability(rows, "m1", range).map((r) => r.id)).toEqual(["av1"]);
  });

});

// ─── Planner + form helper ───────────────────────────────────────────────────
describe("planner + getCrewMembersForAssignment helpers", () => {
  const range = { start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-12T00:00:00Z") };

  it("selectPlannerAssignments: exclude CANCELLED|DECLINED; keep null-start OR overlap", () => {
    const list = [
      mAssign({ id: "1", status: "CONFIRMED", startDate: null, endDate: null }),
      mAssign({ id: "2", status: "CONFIRMED", startDate: new Date("2026-06-11"), endDate: new Date("2026-06-11") }),
      mAssign({ id: "3", status: "CONFIRMED", startDate: new Date("2026-06-01"), endDate: new Date("2026-06-02") }),
      mAssign({ id: "4", status: "DECLINED", startDate: null, endDate: null }),
    ];
    expect(selectPlannerAssignments(list, range).map((a) => a.id)).toEqual(["1", "2"]);
  });

  it("selectPlannerAvailability: only overlapping rows", () => {
    const rows = [
      mapAvailability({ id: "av1", crewMemberId: "m1", startDate: ms("2026-06-11"), endDate: ms("2026-06-11") } as ConvexCrewAvailability),
      mapAvailability({ id: "av2", crewMemberId: "m1", startDate: ms("2026-06-01"), endDate: ms("2026-06-02") } as ConvexCrewAvailability),
    ];
    expect(selectPlannerAvailability(rows, range).map((r) => r.id)).toEqual(["av1"]);
  });

  it("selectMemberConflicts: other-project, non-excluded, overlapping", () => {
    const list = [
      mAssign({ id: "c1", crewMemberId: "m1", projectId: "p2", status: "CONFIRMED", startDate: new Date("2026-06-11"), endDate: new Date("2026-06-11") }),
      mAssign({ id: "c2", crewMemberId: "m1", projectId: "p1", status: "CONFIRMED", startDate: new Date("2026-06-11"), endDate: new Date("2026-06-11") }), // same project
      mAssign({ id: "c3", crewMemberId: "m1", projectId: "p3", status: "DECLINED", startDate: new Date("2026-06-11"), endDate: new Date("2026-06-11") }), // declined
      mAssign({ id: "c4", crewMemberId: "m1", projectId: "p4", status: "CONFIRMED", startDate: new Date("2026-06-01"), endDate: new Date("2026-06-02") }), // no overlap
    ];
    const out = selectMemberConflicts(list, "m1", "p1", range);
    expect(out.map((a) => a.id)).toEqual(["c1"]);
  });

  it("selectUnavailableMemberIds: UNAVAILABLE blocks overlapping range", () => {
    const blocks = [
      mapAvailability({ id: "b1", crewMemberId: "m1", type: "UNAVAILABLE", startDate: ms("2026-06-11"), endDate: ms("2026-06-11") } as ConvexCrewAvailability),
      mapAvailability({ id: "b2", crewMemberId: "m2", type: "TENTATIVE", startDate: ms("2026-06-11"), endDate: ms("2026-06-11") } as ConvexCrewAvailability),
      mapAvailability({ id: "b3", crewMemberId: "m3", type: "UNAVAILABLE", startDate: ms("2026-06-01"), endDate: ms("2026-06-02") } as ConvexCrewAvailability),
    ];
    const out = selectUnavailableMemberIds(blocks, range);
    expect([...out]).toEqual(["m1"]);
  });
});
