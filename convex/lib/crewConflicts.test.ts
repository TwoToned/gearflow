// @vitest-environment node
//
// convex/lib/crewConflicts.ts — WS8 (#947): status-keyed assignment severity
// (classifyAssignmentConflict) + the shared per-member conflict signal
// (computeMemberConflictSignal) reused by crewAssignments.membersForAssignment
// (picker) and crewAssignments.conflictsForProject (crew table).
import { describe, test, expect } from "vitest";
import {
  classifyAssignmentConflict,
  classifyAvailabilityBlock,
  computeMemberConflictSignal,
  HARD_ASSIGNMENT_STATUSES,
  type MemberConflictAssignment,
  type MemberConflictBlock,
} from "./crewConflicts";

const DAY = 86_400_000;
const T0 = 1_700_000_000_000;
const RANGE = { start: T0, end: T0 + DAY };
const PROJECT = { projectNumber: "P100", name: "Big Show" };
const projectsById = new Map([["p1", PROJECT]]);

function assignment(a: Partial<MemberConflictAssignment> & { id: string }): MemberConflictAssignment {
  return { projectId: "p1", serviceId: null, status: "PENDING", startDate: T0, endDate: T0 + DAY, ...a };
}
function block(b: Partial<MemberConflictBlock> = {}): MemberConflictBlock {
  return { type: "UNAVAILABLE", reason: null, startDate: T0, endDate: T0 + DAY, ...b };
}

describe("classifyAssignmentConflict", () => {
  test("CONFIRMED/ACCEPTED/COMPLETED are hard ('Booked: …')", () => {
    for (const status of ["CONFIRMED", "ACCEPTED", "COMPLETED"]) {
      const { severity, label } = classifyAssignmentConflict(status, PROJECT);
      expect(severity).toBe("hard");
      expect(label).toBe("Booked: P100 - Big Show");
    }
  });

  test("PENDING/OFFERED are soft ('Pencilled: …')", () => {
    for (const status of ["PENDING", "OFFERED"]) {
      const { severity, label } = classifyAssignmentConflict(status, PROJECT);
      expect(severity).toBe("soft");
      expect(label).toBe("Pencilled: P100 - Big Show");
    }
  });

  test("an unrecognised status defaults to soft (safe default, matches the pencil rule's ethos)", () => {
    expect(classifyAssignmentConflict("SOME_FUTURE_STATUS", PROJECT).severity).toBe("soft");
  });

  test("null project falls back to a generic label", () => {
    expect(classifyAssignmentConflict("CONFIRMED", null).label).toBe("Booked: another project");
  });

  test("HARD_ASSIGNMENT_STATUSES is exactly the three explicit hard statuses", () => {
    expect([...HARD_ASSIGNMENT_STATUSES].sort()).toEqual(["ACCEPTED", "COMPLETED", "CONFIRMED"]);
  });
});

describe("classifyAvailabilityBlock (unchanged — org-wide board still relies on this)", () => {
  test("UNAVAILABLE hard, TENTATIVE/PREFERRED soft", () => {
    expect(classifyAvailabilityBlock("UNAVAILABLE", null).severity).toBe("hard");
    expect(classifyAvailabilityBlock("TENTATIVE", null).severity).toBe("soft");
    expect(classifyAvailabilityBlock("PREFERRED", null).severity).toBe("soft");
  });
});

describe("computeMemberConflictSignal", () => {
  test("no blocks, no assignments → available, no conflicts", () => {
    const s = computeMemberConflictSignal({ blocks: [], otherAssignments: [], rangeStart: RANGE.start, rangeEnd: RANGE.end, projectsById });
    expect(s).toEqual({ conflicts: [], isUnavailable: false, availability: "available", hasPreferredBlock: false });
  });

  test("UNAVAILABLE block wins outright — 'unavailable', even with a CONFIRMED assignment", () => {
    const s = computeMemberConflictSignal({
      blocks: [block({ type: "UNAVAILABLE" })],
      otherAssignments: [assignment({ id: "a1", status: "CONFIRMED" })],
      rangeStart: RANGE.start, rangeEnd: RANGE.end, projectsById,
    });
    expect(s.isUnavailable).toBe(true);
    expect(s.availability).toBe("unavailable");
    // still reports the assignment conflict too (advisory, both signals surface)
    expect(s.conflicts).toHaveLength(1);
    expect(s.conflicts[0].severity).toBe("hard");
  });

  test("TENTATIVE block → 'tentative' (soft), does not flip isUnavailable", () => {
    const s = computeMemberConflictSignal({ blocks: [block({ type: "TENTATIVE" })], otherAssignments: [], rangeStart: RANGE.start, rangeEnd: RANGE.end, projectsById });
    expect(s.isUnavailable).toBe(false);
    expect(s.availability).toBe("tentative");
  });

  test("PREFERRED block → hasPreferredBlock true, availability stays 'available' (dead fn never handled PREFERRED)", () => {
    const s = computeMemberConflictSignal({ blocks: [block({ type: "PREFERRED" })], otherAssignments: [], rangeStart: RANGE.start, rangeEnd: RANGE.end, projectsById });
    expect(s.hasPreferredBlock).toBe(true);
    expect(s.availability).toBe("available");
  });

  test("overlapping CONFIRMED assignment (no blocks) → 'busy' + one hard conflict, labelled 'Booked: …'", () => {
    const s = computeMemberConflictSignal({
      blocks: [], otherAssignments: [assignment({ id: "a1", status: "CONFIRMED" })],
      rangeStart: RANGE.start, rangeEnd: RANGE.end, projectsById,
    });
    expect(s.availability).toBe("busy");
    expect(s.conflicts).toEqual([
      expect.objectContaining({ severity: "hard", label: "Booked: P100 - Big Show", projectId: "p1" }),
    ]);
  });

  test("overlapping PENDING assignment → 'busy' + one soft conflict, labelled 'Pencilled: …'", () => {
    const s = computeMemberConflictSignal({
      blocks: [], otherAssignments: [assignment({ id: "a1", status: "PENDING" })],
      rangeStart: RANGE.start, rangeEnd: RANGE.end, projectsById,
    });
    expect(s.availability).toBe("busy");
    expect(s.conflicts[0]).toMatchObject({ severity: "soft", label: "Pencilled: P100 - Big Show" });
  });

  test("CANCELLED/DECLINED assignments are excluded entirely", () => {
    const s = computeMemberConflictSignal({
      blocks: [],
      otherAssignments: [assignment({ id: "a1", status: "CANCELLED" }), assignment({ id: "a2", status: "DECLINED" })],
      rangeStart: RANGE.start, rangeEnd: RANGE.end, projectsById,
    });
    expect(s.conflicts).toEqual([]);
    expect(s.availability).toBe("available");
  });

  test("non-overlapping assignment is excluded", () => {
    const s = computeMemberConflictSignal({
      blocks: [], otherAssignments: [assignment({ id: "a1", status: "CONFIRMED", startDate: T0 + 10 * DAY, endDate: T0 + 11 * DAY })],
      rangeStart: RANGE.start, rangeEnd: RANGE.end, projectsById,
    });
    expect(s.conflicts).toEqual([]);
  });

  test("excludeServiceId drops only that service's own assignment — a different service on the SAME project still surfaces", () => {
    const s = computeMemberConflictSignal({
      blocks: [],
      otherAssignments: [
        assignment({ id: "a1", serviceId: "svc-self", status: "CONFIRMED" }),
        assignment({ id: "a2", serviceId: "svc-other", status: "PENDING" }),
      ],
      excludeServiceId: "svc-self",
      rangeStart: RANGE.start, rangeEnd: RANGE.end, projectsById,
    });
    expect(s.conflicts).toHaveLength(1);
    expect(s.conflicts[0]).toMatchObject({ severity: "soft", projectId: "p1" });
  });

  test("excludeServiceId undefined/null excludes nothing", () => {
    const s = computeMemberConflictSignal({
      blocks: [], otherAssignments: [assignment({ id: "a1", serviceId: "svc-self", status: "CONFIRMED" })],
      excludeServiceId: null, rangeStart: RANGE.start, rangeEnd: RANGE.end, projectsById,
    });
    expect(s.conflicts).toHaveLength(1);
  });

  test("cross-project assignments always surface, unaffected by excludeServiceId", () => {
    const otherProjectsById = new Map([["p1", PROJECT], ["p2", { projectNumber: "P200", name: "Other Gig" }]]);
    const s = computeMemberConflictSignal({
      blocks: [],
      otherAssignments: [assignment({ id: "a1", projectId: "p2", serviceId: "svc-other-project", status: "CONFIRMED" })],
      excludeServiceId: "svc-self", // a different service entirely — no exclusion applies
      rangeStart: RANGE.start, rangeEnd: RANGE.end, projectsById: otherProjectsById,
    });
    expect(s.conflicts).toHaveLength(1);
    expect(s.conflicts[0]).toMatchObject({ projectId: "p2", severity: "hard" });
  });

  test("dateless assignment (no startDate/endDate) never counts as a conflict", () => {
    const s = computeMemberConflictSignal({
      blocks: [], otherAssignments: [assignment({ id: "a1", status: "CONFIRMED", startDate: null, endDate: null })],
      rangeStart: RANGE.start, rangeEnd: RANGE.end, projectsById,
    });
    expect(s.conflicts).toEqual([]);
  });

  test("crewMemberId passthrough onto each conflict entry when supplied", () => {
    const s = computeMemberConflictSignal({
      crewMemberId: "cm1", blocks: [], otherAssignments: [assignment({ id: "a1", status: "CONFIRMED" })],
      rangeStart: RANGE.start, rangeEnd: RANGE.end, projectsById,
    });
    expect(s.conflicts[0].crewMemberId).toBe("cm1");
  });
});
