import { describe, it, expect } from "vitest";
import {
  isAssignableMember,
  compareByLastName,
  isConflictingAssignment,
  isUnavailableBlock,
  type AssignableMemberLike,
  type ConflictAssignmentLike,
  type AvailabilityBlockLike,
} from "@/lib/crew-assignment-availability";
import { mapAvailability } from "@/lib/crew-scheduling-read";

const member = (over: Partial<AssignableMemberLike>): AssignableMemberLike => ({
  isActive: true,
  status: "ACTIVE",
  firstName: "Jane",
  lastName: "Doe",
  email: "jane@example.com",
  department: "Lighting",
  ...over,
});

describe("isAssignableMember — member where + search", () => {
  it("accepts an active ACTIVE member with no search", () => {
    expect(isAssignableMember(member({}))).toBe(true);
  });

  it("treats absent isActive as true (Convex optional)", () => {
    expect(isAssignableMember(member({ isActive: undefined }))).toBe(true);
  });

  it("rejects isActive=false", () => {
    expect(isAssignableMember(member({ isActive: false }))).toBe(false);
  });

  it("rejects non-ACTIVE status", () => {
    expect(isAssignableMember(member({ status: "INACTIVE" }))).toBe(false);
    expect(isAssignableMember(member({ status: undefined }))).toBe(false);
  });

  it("search matches case-insensitively across firstName/lastName/email/department", () => {
    expect(isAssignableMember(member({ firstName: "Alice" }), "ali")).toBe(true);
    expect(isAssignableMember(member({ lastName: "Smith" }), "SMI")).toBe(true);
    expect(isAssignableMember(member({ email: "bob@acme.io" }), "ACME")).toBe(true);
    expect(isAssignableMember(member({ department: "Audio" }), "aud")).toBe(true);
  });

  it("search excludes members with no field match", () => {
    expect(isAssignableMember(member({}), "zzzz")).toBe(false);
  });

  it("guards null email/department during search (no throw, no false match)", () => {
    const m = member({ email: null, department: null, firstName: "X", lastName: "Y" });
    expect(isAssignableMember(m, "lighting")).toBe(false);
    expect(isAssignableMember(m, "x")).toBe(true);
  });
});

describe("compareByLastName + take semantics", () => {
  it("sorts ascending by lastName and slice(0,50) takes the first 50", () => {
    const names = Array.from({ length: 60 }, (_, i) => ({
      lastName: String(60 - i).padStart(3, "0"),
    }));
    const sorted = [...names].sort(compareByLastName).slice(0, 50);
    expect(sorted).toHaveLength(50);
    expect(sorted[0].lastName).toBe("001");
    expect(sorted[49].lastName).toBe("050");
  });
});

const RANGE_START = new Date("2026-06-10T00:00:00.000Z");
const RANGE_END = new Date("2026-06-20T00:00:00.000Z");

const assignment = (over: Partial<ConflictAssignmentLike>): ConflictAssignmentLike => ({
  crewMemberId: "m1",
  projectId: "other",
  status: "CONFIRMED",
  startDate: new Date("2026-06-12T00:00:00.000Z"),
  endDate: new Date("2026-06-15T00:00:00.000Z"),
  ...over,
});

describe("isConflictingAssignment — cross-project overlap", () => {
  const current = "current-project";

  it("flags an overlapping assignment on another project", () => {
    expect(isConflictingAssignment(assignment({}), current, RANGE_START, RANGE_END)).toBe(true);
  });

  it("excludes assignments on the current project", () => {
    expect(
      isConflictingAssignment(assignment({ projectId: current }), current, RANGE_START, RANGE_END),
    ).toBe(false);
  });

  it("excludes CANCELLED and DECLINED statuses", () => {
    expect(
      isConflictingAssignment(assignment({ status: "CANCELLED" }), current, RANGE_START, RANGE_END),
    ).toBe(false);
    expect(
      isConflictingAssignment(assignment({ status: "DECLINED" }), current, RANGE_START, RANGE_END),
    ).toBe(false);
  });

  it("excludes rows with null start or end date (Prisma lte/gte over NULL is false)", () => {
    expect(
      isConflictingAssignment(assignment({ startDate: null }), current, RANGE_START, RANGE_END),
    ).toBe(false);
    expect(
      isConflictingAssignment(assignment({ endDate: null }), current, RANGE_START, RANGE_END),
    ).toBe(false);
  });

  it("excludes non-overlapping ranges (entirely before / entirely after)", () => {
    const before = assignment({
      startDate: new Date("2026-06-01T00:00:00.000Z"),
      endDate: new Date("2026-06-05T00:00:00.000Z"),
    });
    const after = assignment({
      startDate: new Date("2026-06-25T00:00:00.000Z"),
      endDate: new Date("2026-06-30T00:00:00.000Z"),
    });
    expect(isConflictingAssignment(before, current, RANGE_START, RANGE_END)).toBe(false);
    expect(isConflictingAssignment(after, current, RANGE_START, RANGE_END)).toBe(false);
  });

  it("includes boundary-touching ranges (inclusive lte/gte)", () => {
    const touchesEnd = assignment({
      startDate: RANGE_END,
      endDate: new Date("2026-06-22T00:00:00.000Z"),
    });
    const touchesStart = assignment({
      startDate: new Date("2026-06-05T00:00:00.000Z"),
      endDate: RANGE_START,
    });
    expect(isConflictingAssignment(touchesEnd, current, RANGE_START, RANGE_END)).toBe(true);
    expect(isConflictingAssignment(touchesStart, current, RANGE_START, RANGE_END)).toBe(true);
  });
});

const block = (over: Partial<AvailabilityBlockLike>): AvailabilityBlockLike => ({
  crewMemberId: "m1",
  type: "UNAVAILABLE",
  startDate: new Date("2026-06-12T00:00:00.000Z"),
  endDate: new Date("2026-06-15T00:00:00.000Z"),
  ...over,
});

describe("isUnavailableBlock — availability overlap", () => {
  it("flags an overlapping UNAVAILABLE block", () => {
    expect(isUnavailableBlock(block({}), RANGE_START, RANGE_END)).toBe(true);
  });

  it("ignores non-UNAVAILABLE types", () => {
    expect(isUnavailableBlock(block({ type: "AVAILABLE" }), RANGE_START, RANGE_END)).toBe(false);
  });

  it("ignores non-overlapping UNAVAILABLE blocks", () => {
    const before = block({
      startDate: new Date("2026-06-01T00:00:00.000Z"),
      endDate: new Date("2026-06-05T00:00:00.000Z"),
    });
    expect(isUnavailableBlock(before, RANGE_START, RANGE_END)).toBe(false);
  });

  it("includes boundary-touching blocks", () => {
    const touches = block({
      startDate: RANGE_END,
      endDate: new Date("2026-06-22T00:00:00.000Z"),
    });
    expect(isUnavailableBlock(touches, RANGE_START, RANGE_END)).toBe(true);
  });
});

describe("mapAvailability — absent type defaults to UNAVAILABLE", () => {
  it("defaults absent Convex type to UNAVAILABLE (Prisma default)", () => {
    const m = mapAvailability({
      id: "av1",
      crewMemberId: "m1",
      startDate: 1_700_000_000_000,
      endDate: 1_700_086_400_000,
      // type absent
    } as never);
    expect(m.type).toBe("UNAVAILABLE");
    expect(m.startDate.getTime()).toBe(1_700_000_000_000);
    expect(m.endDate.getTime()).toBe(1_700_086_400_000);
  });

  it("preserves an explicit type", () => {
    const m = mapAvailability({
      id: "av2",
      crewMemberId: "m1",
      startDate: 1,
      endDate: 2,
      type: "AVAILABLE",
    } as never);
    expect(m.type).toBe("AVAILABLE");
  });
});
