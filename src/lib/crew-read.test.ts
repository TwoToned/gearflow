/**
 * Unit tests for the pure crew-roster read primitives (Phase A read-rewiring).
 *
 * These replace the Prisma `where`/`orderBy`/`distinct`/`_count` of
 * src/server/crew.ts. The safety property for each: identical output to the
 * Prisma query it stands in for, given the same rows. Mappers reverse
 * convex-client.ts `toConvexDoc` (epoch-ms → Date, absent → null, defaults
 * coerced non-null).
 */
import { describe, it, expect } from "vitest";
import {
  mapCrewMember,
  mapCrewRole,
  mapCrewSkill,
  applyCrewMemberFilters,
  applyCrewMemberSearch,
  sortCrewMembers,
  paginate,
  distinctDepartments,
  activeRolesSorted,
  skillsSorted,
  countMembersByRole,
  type ConvexCrewMember,
  type ConvexCrewRole,
  type ConvexCrewSkill,
  type CrewMemberRow,
} from "@/lib/crew-read";

// ─── Mappers ──────────────────────────────────────────────────────────────

describe("mapCrewMember", () => {
  it("converts epoch-ms → Date, absent → null, coerces defaults non-null", () => {
    const doc = {
      _id: "convex_internal" as unknown,
      _creationTime: 1000,
      id: "m1",
      organizationId: "org1",
      firstName: "Ada",
      lastName: "Lovelace",
      // email/phone/etc absent
      defaultDayRate: 500.5,
      dateOfBirth: 631152000000, // 1990-01-01
      createdAt: 1700000000000,
      updatedAt: 1700000001000,
    } as unknown as ConvexCrewMember;
    const row = mapCrewMember(doc);
    expect(row).toMatchObject({
      id: "m1",
      organizationId: "org1",
      firstName: "Ada",
      lastName: "Lovelace",
      email: null,
      phone: null,
      type: "FREELANCER", // schema default
      status: "ACTIVE", // schema default
      tags: [], // schema default
      icalEnabled: false, // schema default
      isActive: true, // schema default
      defaultDayRate: 500.5,
      crewRoleId: null,
    });
    expect(row.dateOfBirth).toEqual(new Date(631152000000));
    expect(row.createdAt).toEqual(new Date(1700000000000));
    expect(row.updatedAt).toEqual(new Date(1700000001000));
    // _id / _creationTime stripped
    expect("_id" in row).toBe(false);
    expect("_creationTime" in row).toBe(false);
  });

  it("falls back createdAt/updatedAt to _creationTime when absent", () => {
    const doc = {
      _creationTime: 42,
      id: "m2",
      organizationId: "org1",
      firstName: "B",
      lastName: "C",
    } as unknown as ConvexCrewMember;
    const row = mapCrewMember(doc);
    expect(row.createdAt).toEqual(new Date(42));
    expect(row.updatedAt).toEqual(new Date(42));
    expect(row.dateOfBirth).toBeNull();
  });
});

describe("mapCrewRole", () => {
  it("coerces sortOrder/isActive defaults and absent → null", () => {
    const doc = {
      _creationTime: 1,
      id: "r1",
      organizationId: "org1",
      name: "Lighting Tech",
    } as unknown as ConvexCrewRole;
    expect(mapCrewRole(doc)).toEqual({
      id: "r1",
      organizationId: "org1",
      name: "Lighting Tech",
      description: null,
      department: null,
      color: null,
      defaultRate: null,
      rateType: null,
      sortOrder: 0,
      isActive: true,
    });
  });
});

describe("mapCrewSkill", () => {
  it("coerces category absent → null", () => {
    const doc = {
      _creationTime: 1,
      id: "s1",
      organizationId: "org1",
      name: "Rigging",
    } as unknown as ConvexCrewSkill;
    expect(mapCrewSkill(doc)).toEqual({
      id: "s1",
      organizationId: "org1",
      name: "Rigging",
      category: null,
    });
  });
});

// ─── Filters / search ─────────────────────────────────────────────────────

const member = (over: Partial<CrewMemberRow>): CrewMemberRow => ({
  id: "x",
  organizationId: "org1",
  firstName: "F",
  lastName: "L",
  email: null,
  phone: null,
  image: null,
  userId: null,
  type: "FREELANCER",
  status: "ACTIVE",
  department: null,
  defaultDayRate: null,
  defaultHourlyRate: null,
  overtimeMultiplier: null,
  currency: null,
  address: null,
  addressLatitude: null,
  addressLongitude: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  dateOfBirth: null,
  abnOrGst: null,
  notes: null,
  tags: [],
  icalEnabled: false,
  icalToken: null,
  crewRoleId: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  isActive: true,
  ...over,
});

describe("applyCrewMemberFilters", () => {
  const rows = [
    member({ id: "a", type: "EMPLOYEE", status: "ACTIVE", department: "Audio" }),
    member({ id: "b", type: "FREELANCER", status: "INACTIVE", department: "Video" }),
    member({ id: "c", type: "EMPLOYEE", status: "ON_LEAVE", department: null }),
  ];

  it("returns all rows when no filters", () => {
    expect(applyCrewMemberFilters(rows, undefined).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(applyCrewMemberFilters(rows, {}).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("filters by enum `in` for type", () => {
    expect(applyCrewMemberFilters(rows, { type: ["EMPLOYEE"] }).map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("combines multiple enum filters (AND)", () => {
    expect(
      applyCrewMemberFilters(rows, { type: ["EMPLOYEE"], status: ["ACTIVE"] }).map((r) => r.id),
    ).toEqual(["a"]);
  });

  it("filters by department and excludes null departments", () => {
    expect(applyCrewMemberFilters(rows, { department: ["Audio"] }).map((r) => r.id)).toEqual(["a"]);
  });

  it("ignores empty filter arrays", () => {
    expect(applyCrewMemberFilters(rows, { type: [] }).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("applyCrewMemberSearch", () => {
  const rows = [
    member({ id: "a", firstName: "Ada", lastName: "Smith", email: "ada@x.com" }),
    member({ id: "b", firstName: "Bob", phone: "555-1234", department: "Audio" }),
    member({ id: "c", firstName: "Cara", tags: ["rigging", "audio"] }),
  ];

  it("returns all rows when no search", () => {
    expect(applyCrewMemberSearch(rows, undefined).length).toBe(3);
  });

  it("matches firstName case-insensitively", () => {
    expect(applyCrewMemberSearch(rows, "ada").map((r) => r.id)).toEqual(["a"]);
  });

  it("matches across phone/department", () => {
    expect(applyCrewMemberSearch(rows, "555").map((r) => r.id)).toEqual(["b"]);
    // "audio" matches b's department (contains) AND c's exact tag token (hasSome)
    expect(applyCrewMemberSearch(rows, "AUDIO").map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("matches tags only on exact lowercased token (hasSome)", () => {
    // "rig" is a substring of the tag "rigging" but hasSome is exact-equality
    expect(applyCrewMemberSearch(rows, "rig").map((r) => r.id)).toEqual([]);
    expect(applyCrewMemberSearch(rows, "rigging").map((r) => r.id)).toEqual(["c"]);
  });
});

// ─── Sort / paginate ──────────────────────────────────────────────────────

describe("sortCrewMembers", () => {
  it("sorts by lastName asc (default)", () => {
    const rows = [
      member({ id: "a", lastName: "Charlie" }),
      member({ id: "b", lastName: "alpha" }),
      member({ id: "c", lastName: "Bravo" }),
    ];
    expect(sortCrewMembers(rows, "lastName", "asc").map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(sortCrewMembers(rows, "lastName", "desc").map((r) => r.id)).toEqual(["a", "c", "b"]);
  });

  it("puts nulls last on asc, first on desc (Postgres semantics)", () => {
    const rows = [
      member({ id: "a", department: "Audio" }),
      member({ id: "b", department: null }),
      member({ id: "c", department: "Video" }),
    ];
    expect(sortCrewMembers(rows, "department", "asc").map((r) => r.id)).toEqual(["a", "c", "b"]);
    expect(sortCrewMembers(rows, "department", "desc").map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("sorts dates and numbers numerically", () => {
    const rows = [
      member({ id: "a", defaultDayRate: 300 }),
      member({ id: "b", defaultDayRate: 100 }),
      member({ id: "c", defaultDayRate: 200 }),
    ];
    expect(sortCrewMembers(rows, "defaultDayRate", "asc").map((r) => r.id)).toEqual(["b", "c", "a"]);
  });
});

describe("paginate", () => {
  const rows = [1, 2, 3, 4, 5];
  it("slices 1-based pages", () => {
    expect(paginate(rows, 1, 2)).toEqual([1, 2]);
    expect(paginate(rows, 2, 2)).toEqual([3, 4]);
    expect(paginate(rows, 3, 2)).toEqual([5]);
    expect(paginate(rows, 4, 2)).toEqual([]);
  });
});

// ─── Departments / roles / skills / counts ────────────────────────────────

describe("distinctDepartments", () => {
  it("returns distinct non-null departments sorted asc", () => {
    const rows = [
      member({ department: "Video" }),
      member({ department: "Audio" }),
      member({ department: "Video" }),
      member({ department: null }),
    ];
    expect(distinctDepartments(rows)).toEqual(["Audio", "Video"]);
  });
});

describe("activeRolesSorted", () => {
  it("keeps only active roles, ordered by [sortOrder asc, name asc]", () => {
    const roles = [
      mapCrewRole({ _creationTime: 1, id: "r1", organizationId: "o", name: "Zeta", sortOrder: 0, isActive: true } as unknown as ConvexCrewRole),
      mapCrewRole({ _creationTime: 1, id: "r2", organizationId: "o", name: "Alpha", sortOrder: 0, isActive: true } as unknown as ConvexCrewRole),
      mapCrewRole({ _creationTime: 1, id: "r3", organizationId: "o", name: "Beta", sortOrder: 1, isActive: true } as unknown as ConvexCrewRole),
      mapCrewRole({ _creationTime: 1, id: "r4", organizationId: "o", name: "Gone", sortOrder: 0, isActive: false } as unknown as ConvexCrewRole),
    ];
    expect(activeRolesSorted(roles).map((r) => r.id)).toEqual(["r2", "r1", "r3"]);
  });
});

describe("skillsSorted", () => {
  it("orders by name asc", () => {
    const skills = [
      mapCrewSkill({ _creationTime: 1, id: "s1", organizationId: "o", name: "Welding" } as unknown as ConvexCrewSkill),
      mapCrewSkill({ _creationTime: 1, id: "s2", organizationId: "o", name: "Audio" } as unknown as ConvexCrewSkill),
    ];
    expect(skillsSorted(skills).map((s) => s.name)).toEqual(["Audio", "Welding"]);
  });
});

describe("countMembersByRole", () => {
  it("counts members per crewRoleId, ignoring null", () => {
    const rows = [
      member({ crewRoleId: "r1" }),
      member({ crewRoleId: "r1" }),
      member({ crewRoleId: "r2" }),
      member({ crewRoleId: null }),
    ];
    expect(countMembersByRole(rows)).toEqual({ r1: 2, r2: 1 });
  });
});
