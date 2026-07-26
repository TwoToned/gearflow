import { describe, it, expect } from "vitest";
import type { Doc } from "../../convex/_generated/dataModel";
import {
  mapProjectServiceBase,
  mapServiceTemplate,
  compareServiceByDateThenSort,
  isNotCancelled,
  attachServiceCrew,
  groupAssignmentsByService,
} from "@/lib/project-service-read";

describe("project-service-read mappers", () => {
  it("mapProjectServiceBase converts dates, normalises absents, coerces defaults", () => {
    const m = mapProjectServiceBase({
      id: "svc1",
      organizationId: "org",
      projectId: "proj",
      type: "DELIVERY",
      title: "Deliver gear",
      date: 1_700_000_000_000,
      // status / showOnDocuments / billableToClient / quantity / taxable / sortOrder absent
      // description / notes / unitPrice / etc absent
    } as never);

    expect(m.id).toBe("svc1");
    expect(m.type).toBe("DELIVERY");
    expect(m.title).toBe("Deliver gear");
    expect(m.date).toBeInstanceOf(Date);
    expect(m.date?.getTime()).toBe(1_700_000_000_000);
    expect(m.endDate).toBeNull();
    // Prisma-defaulted columns coerced
    expect(m.status).toBe("PLANNED");
    expect(m.showOnDocuments).toBe(false);
    expect(m.billableToClient).toBe(false);
    expect(m.quantity).toBe(1);
    expect(m.taxable).toBe(true);
    expect(m.sortOrder).toBe(0);
    // absent optionals → null
    expect(m.description).toBeNull();
    expect(m.notes).toBeNull();
    expect(m.unitPrice).toBeNull();
    expect(m.crewRoleId).toBeNull();
    expect(m.createdAt).toBeNull();
  });

  it("mapProjectServiceBase keeps present numeric/boolean values (number stays number)", () => {
    const m = mapProjectServiceBase({
      id: "svc2",
      organizationId: "org",
      projectId: "proj",
      type: "LABOUR",
      title: "Show day",
      status: "CONFIRMED",
      showOnDocuments: true,
      billableToClient: true,
      taxable: false,
      quantity: 3,
      unitPrice: 250,
      lineTotal: 750,
      costTotal: 400,
      discount: 10,
      sortOrder: 5,
      crewRoleId: "role1",
      latitude: -33.8,
      longitude: 151.2,
    } as never);

    expect(m.status).toBe("CONFIRMED");
    expect(m.showOnDocuments).toBe(true);
    expect(m.billableToClient).toBe(true);
    expect(m.taxable).toBe(false);
    expect(m.quantity).toBe(3);
    expect(m.unitPrice).toBe(250);
    expect(m.lineTotal).toBe(750);
    expect(m.costTotal).toBe(400);
    expect(m.discount).toBe(10);
    expect(m.sortOrder).toBe(5);
    expect(m.crewRoleId).toBe("role1");
    expect(m.latitude).toBe(-33.8);
    expect(m.longitude).toBe(151.2);
  });

  it("mapServiceTemplate coerces template defaults + dates", () => {
    const m = mapServiceTemplate({
      id: "tpl1",
      organizationId: "org",
      type: "MISC",
      title: "Sound check",
      createdAt: 1_700_000_000_000,
      // showOnDocuments / isAutoAdded / isActive / sortOrder absent
    } as never);

    expect(m.id).toBe("tpl1");
    expect(m.title).toBe("Sound check");
    expect(m.showOnDocuments).toBe(false);
    expect(m.isAutoAdded).toBe(false);
    expect(m.isActive).toBe(true);
    expect(m.sortOrder).toBe(0);
    expect(m.defaultCrewCount).toBeNull();
    expect(m.defaultUnitPrice).toBeNull();
    expect(m.createdAt).toBeInstanceOf(Date);
    expect(m.updatedAt).toBeNull();
  });

  it("mapServiceTemplate honours explicit booleans (isActive false)", () => {
    const m = mapServiceTemplate({
      id: "tpl2",
      organizationId: "org",
      type: "DELIVERY",
      title: "Std delivery",
      showOnDocuments: true,
      isAutoAdded: true,
      isActive: false,
      sortOrder: 2,
      defaultUnitPrice: 100,
    } as never);
    expect(m.showOnDocuments).toBe(true);
    expect(m.isAutoAdded).toBe(true);
    expect(m.isActive).toBe(false);
    expect(m.sortOrder).toBe(2);
    expect(m.defaultUnitPrice).toBe(100);
  });
});

describe("compareServiceByDateThenSort (Postgres ORDER BY date ASC, sortOrder ASC)", () => {
  const d = (ms: number | null) => (ms === null ? null : new Date(ms));

  it("orders by date ascending", () => {
    const rows = [
      { date: d(300), sortOrder: 0 },
      { date: d(100), sortOrder: 0 },
      { date: d(200), sortOrder: 0 },
    ];
    rows.sort(compareServiceByDateThenSort);
    expect(rows.map((r) => r.date?.getTime())).toEqual([100, 200, 300]);
  });

  it("puts NULL dates LAST (ASC = NULLS LAST)", () => {
    const rows = [
      { date: null, sortOrder: 0 },
      { date: d(200), sortOrder: 0 },
      { date: null, sortOrder: 0 },
      { date: d(100), sortOrder: 0 },
    ];
    rows.sort(compareServiceByDateThenSort);
    expect(rows.map((r) => (r.date ? r.date.getTime() : "null"))).toEqual([
      100,
      200,
      "null",
      "null",
    ]);
  });

  it("tie-breaks equal dates by sortOrder ascending", () => {
    const rows = [
      { date: d(100), sortOrder: 2 },
      { date: d(100), sortOrder: 0 },
      { date: d(100), sortOrder: 1 },
    ];
    rows.sort(compareServiceByDateThenSort);
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2]);
  });

  it("treats two null dates as equal then sorts by sortOrder", () => {
    const rows = [
      { date: null, sortOrder: 5 },
      { date: null, sortOrder: 1 },
    ];
    rows.sort(compareServiceByDateThenSort);
    expect(rows.map((r) => r.sortOrder)).toEqual([1, 5]);
  });
});

describe("isNotCancelled (summary scope filter)", () => {
  it("keeps non-CANCELLED statuses", () => {
    expect(isNotCancelled({ status: "PLANNED" })).toBe(true);
    expect(isNotCancelled({ status: "CONFIRMED" })).toBe(true);
    expect(isNotCancelled({ status: "COMPLETED" })).toBe(true);
  });
  it("drops CANCELLED", () => {
    expect(isNotCancelled({ status: "CANCELLED" })).toBe(false);
  });
  it("defaults absent status to PLANNED (kept)", () => {
    expect(isNotCancelled({ status: undefined as unknown as string })).toBe(true);
  });
});

describe("groupAssignmentsByService", () => {
  it("groups flat assignments by serviceId, skipping null serviceId", () => {
    const assignments = [
      { id: "a1", serviceId: "s1" },
      { id: "a2", serviceId: "s2" },
      { id: "a3", serviceId: "s1" },
      { id: "a4", serviceId: undefined },
    ] as unknown as Doc<"crewAssignments">[];
    const grouped = groupAssignmentsByService(assignments);
    expect(grouped.get("s1")?.map((a) => a.id)).toEqual(["a1", "a3"]);
    expect(grouped.get("s2")?.map((a) => a.id)).toEqual(["a2"]);
    expect(grouped.size).toBe(2);
  });
});

describe("attachServiceCrew", () => {
  const base = mapProjectServiceBase({
    id: "svc1",
    organizationId: "org",
    projectId: "proj",
    type: "DELIVERY",
    title: "Deliver",
    crewRoleId: "role1",
  } as never);

  const roleMap = new Map<string, Doc<"crewRoles">>([
    ["role1", { id: "role1", name: "Driver", color: "#fff" } as Doc<"crewRoles">],
  ]);
  const memberMap = new Map<string, Doc<"crewMembers">>([
    [
      "m1",
      { id: "m1", firstName: "Ada", lastName: "Lovelace", image: "img.png" } as Doc<"crewMembers">,
    ],
  ]);

  it("attaches crewRole from the map (color orNull)", () => {
    const r = attachServiceCrew(base, [], roleMap, memberMap, true);
    expect(r.crewRole).toEqual({ id: "role1", name: "Driver", color: "#fff" });
  });

  it("returns null crewRole when the role is absent from the map", () => {
    const noRole = mapProjectServiceBase({
      id: "svc2",
      organizationId: "org",
      projectId: "proj",
      type: "DELIVERY",
      title: "x",
    } as never);
    const r = attachServiceCrew(noRole, [], roleMap, memberMap, true);
    expect(r.crewRole).toBeNull();
  });

  it("includes estimatedCost when withEstimatedCost=true (getProjectServices)", () => {
    const assignments = [
      { id: "a1", serviceId: "svc1", status: "CONFIRMED", estimatedCost: 200, crewMemberId: "m1" },
    ] as unknown as Doc<"crewAssignments">[];
    const r = attachServiceCrew(base, assignments, roleMap, memberMap, true);
    expect(r.crewAssignments[0]).toEqual({
      id: "a1",
      status: "CONFIRMED",
      estimatedCost: 200,
      crewMember: { id: "m1", firstName: "Ada", lastName: "Lovelace", image: "img.png" },
      rateOverride: null,
      rateType: null,
      estimatedHours: null,
      // No rateOverride, no member day/hourly rate, no role default → cascade falls
      // all the way through to the $0/DAILY fallback (convex/lib/crewRate.ts).
      resolvedRate: 0,
      resolvedRateType: "DAILY",
    });
  });

  it("forces estimatedCost null when withEstimatedCost=false (getProjectServiceById)", () => {
    const assignments = [
      { id: "a1", serviceId: "svc1", status: "PENDING", estimatedCost: 200, crewMemberId: "m1" },
    ] as unknown as Doc<"crewAssignments">[];
    const r = attachServiceCrew(base, assignments, roleMap, memberMap, false);
    expect(r.crewAssignments[0].estimatedCost).toBeNull();
    expect(r.crewAssignments[0].status).toBe("PENDING");
  });

  it("returns null crewMember when the member is absent from the map", () => {
    const assignments = [
      { id: "a2", serviceId: "svc1", status: "OFFERED", crewMemberId: "ghost" },
    ] as unknown as Doc<"crewAssignments">[];
    const r = attachServiceCrew(base, assignments, roleMap, memberMap, true);
    expect(r.crewAssignments[0].crewMember).toBeNull();
    expect(r.crewAssignments[0].estimatedCost).toBeNull();
  });

  // Issue #796 — the per-crew rate table needs the resolved rate, not just the
  // stored total cost, so the UI can show "$X/day" without re-implementing the
  // cascade (convex/lib/crewRate.ts) client-side.
  it("resolves rate from the crew member's default day rate when no override is set", () => {
    const memberMapWithRate = new Map<string, Doc<"crewMembers">>([
      ["m1", { id: "m1", firstName: "Ada", lastName: "Lovelace", image: null, defaultDayRate: 450 } as unknown as Doc<"crewMembers">],
    ]);
    const assignments = [
      { id: "a1", serviceId: "svc1", status: "CONFIRMED", crewMemberId: "m1" },
    ] as unknown as Doc<"crewAssignments">[];
    const r = attachServiceCrew(base, assignments, roleMap, memberMapWithRate, true);
    expect(r.crewAssignments[0].resolvedRate).toBe(450);
    expect(r.crewAssignments[0].resolvedRateType).toBe("DAILY");
  });

  it("resolves rate from a per-row rateOverride, taking priority over the member's default", () => {
    const memberMapWithRate = new Map<string, Doc<"crewMembers">>([
      ["m1", { id: "m1", firstName: "Ada", lastName: "Lovelace", image: null, defaultDayRate: 450 } as unknown as Doc<"crewMembers">],
    ]);
    const assignments = [
      { id: "a1", serviceId: "svc1", status: "CONFIRMED", crewMemberId: "m1", rateOverride: 90, rateType: "FLAT" },
    ] as unknown as Doc<"crewAssignments">[];
    const r = attachServiceCrew(base, assignments, roleMap, memberMapWithRate, true);
    expect(r.crewAssignments[0].rateOverride).toBe(90);
    expect(r.crewAssignments[0].resolvedRate).toBe(90);
    expect(r.crewAssignments[0].resolvedRateType).toBe("FLAT");
  });

  it("falls back to the crew role's default rate when the member has none", () => {
    const roleMapWithRate = new Map<string, Doc<"crewRoles">>([
      ["role1", { id: "role1", name: "Driver", color: "#fff", defaultRate: 380, rateType: "DAILY" } as Doc<"crewRoles">],
    ]);
    const assignments = [
      { id: "a1", serviceId: "svc1", status: "CONFIRMED", crewMemberId: "m1" },
    ] as unknown as Doc<"crewAssignments">[];
    const r = attachServiceCrew(base, assignments, roleMapWithRate, memberMap, true);
    expect(r.crewAssignments[0].resolvedRate).toBe(380);
    expect(r.crewAssignments[0].resolvedRateType).toBe("DAILY");
  });
});
