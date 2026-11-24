// @vitest-environment node
import { describe, test, expect } from "vitest";
import {
  ownGearModelIds,
  computeProjectGearReadiness,
  computeProjectCrewReadiness,
  computeProjectPricingReadiness,
  computeProjectPackingReadiness,
  computeProjectIncidentReadiness,
  type PricingLineInput,
  type PricingGroupInput,
  type PackingLineInput,
  type PackingUnitInput,
} from "./projectReadiness";
import type {
  BoardProject,
  BoardLineItem,
  BoardModel,
  BoardAsset,
  BoardAssignment,
  BoardService,
} from "./overbookingBoard";

const DAY = 86_400_000;
const WINDOW = { start: 0, end: 10 * DAY };
const ME = { id: "p1", name: "Main Stage", projectNumber: "P-1" };

function project(p: Partial<BoardProject> & { id: string }): BoardProject {
  return {
    name: p.id,
    projectNumber: "PRJ-" + p.id,
    status: "CONFIRMED",
    isTemplate: false,
    rentalStartDate: 0,
    rentalEndDate: 10 * DAY,
    ...p,
  };
}

function line(l: Partial<BoardLineItem> & { id: string; projectId: string; modelId: string; quantity: number }): BoardLineItem {
  return { status: "QUOTED", subHireId: null, isOptional: false, ...l };
}

function assignment(a: Partial<BoardAssignment> & { id: string }): BoardAssignment {
  return { projectId: "p1", crewMemberId: "c" + a.id, serviceId: null, status: "PENDING", ...a };
}

describe("ownGearModelIds", () => {
  test("only counts this project's real, committed demand", () => {
    const ids = ownGearModelIds("p1", [
      line({ id: "a", projectId: "p1", modelId: "m1", quantity: 1 }),
      line({ id: "b", projectId: "p2", modelId: "m2", quantity: 1 }), // another project
      line({ id: "c", projectId: "p1", modelId: "m3", quantity: 1, isOptional: true }), // optional
      line({ id: "d", projectId: "p1", modelId: "m4", quantity: 1, status: "CANCELLED" }),
      line({ id: "e", projectId: "p1", modelId: "m5", quantity: 1, subHireId: "sh1" }), // covered by sub-hire
    ]);
    expect([...ids]).toEqual(["m1"]);
  });
});

describe("computeProjectGearReadiness", () => {
  const models: BoardModel[] = [
    { id: "m1", name: "SM58", assetType: "SERIALIZED" },
    { id: "m2", name: "K12.2", assetType: "SERIALIZED" },
  ];
  const assets: BoardAsset[] = [
    { modelId: "m1", status: "AVAILABLE", isActive: true },
    { modelId: "m2", status: "AVAILABLE", isActive: true },
  ];

  test("reports a hard shortage on a model this project books", () => {
    const projects = [project({ id: "p1" }), project({ id: "p2" })];
    const lineItems = [
      line({ id: "a", projectId: "p1", modelId: "m1", quantity: 1 }),
      line({ id: "b", projectId: "p2", modelId: "m1", quantity: 3 }),
    ];
    const r = computeProjectGearReadiness("p1", WINDOW, projects, lineItems, models, assets, []);
    expect(r.hard).toHaveLength(1);
    expect(r.hard[0].modelId).toBe("m1");
    expect(r.hardQty).toBe(3); // demand 4 vs stock 1
  });

  test("a shortage on a model this project does not book is not its problem", () => {
    const projects = [project({ id: "p1" }), project({ id: "p2" })];
    const lineItems = [
      line({ id: "a", projectId: "p1", modelId: "m1", quantity: 1 }),
      line({ id: "b", projectId: "p2", modelId: "m2", quantity: 9 }), // m2 blown out elsewhere
    ];
    const r = computeProjectGearReadiness("p1", WINDOW, projects, lineItems, models, assets, []);
    expect(r.hard).toHaveLength(0);
  });

  test("an unconfirmed project's own demand reports as pencilled, not hard", () => {
    const projects = [project({ id: "p1", status: "ENQUIRY" })];
    const lineItems = [line({ id: "a", projectId: "p1", modelId: "m1", quantity: 4 })];
    const r = computeProjectGearReadiness("p1", WINDOW, projects, lineItems, models, assets, []);
    expect(r.hard).toHaveLength(0);
    expect(r.pencilled).toHaveLength(1);
    expect(r.pencilledQty).toBe(3);
  });

  test("a project booking nothing short-circuits to empty", () => {
    const r = computeProjectGearReadiness("p1", WINDOW, [project({ id: "p1" })], [], models, assets, []);
    expect(r).toEqual({ hard: [], pencilled: [], hardQty: 0, pencilledQty: 0 });
  });
});

describe("computeProjectCrewReadiness", () => {
  test("counts assignments awaiting a yes, ignoring settled-no", () => {
    const r = computeProjectCrewReadiness(
      "p1",
      [
        assignment({ id: "1", status: "CONFIRMED" }),
        assignment({ id: "2", status: "PENDING" }),
        assignment({ id: "3", status: "OFFERED" }),
        assignment({ id: "4", status: "DECLINED" }),
        assignment({ id: "5", status: "CANCELLED" }),
      ],
      [],
      ME,
    );
    expect(r.unconfirmedCount).toBe(2);
    expect(r.activeCount).toBe(3); // declined/cancelled are gone, not unconfirmed
  });

  test("another project's assignments never leak in", () => {
    const r = computeProjectCrewReadiness(
      "p1",
      [assignment({ id: "1", projectId: "p2", status: "PENDING" })],
      [],
      ME,
    );
    expect(r.unconfirmedCount).toBe(0);
    expect(r.activeCount).toBe(0);
  });

  test("flags a service below its required crew count, regardless of date", () => {
    const services: BoardService[] = [
      // Deliberately far outside any 30-day board range — the whole project is
      // in scope on its own page.
      { id: "s1", projectId: "p1", title: "Bump-in", date: 900 * DAY, crewCountRequired: 3 },
    ];
    const r = computeProjectCrewReadiness(
      "p1",
      [assignment({ id: "1", serviceId: "s1", status: "CONFIRMED" })],
      services,
      ME,
    );
    expect(r.servicesMissingCrew).toHaveLength(1);
    expect(r.servicesMissingCrew[0].shortfall).toBe(2);
    expect(r.crewShortfall).toBe(2);
  });

  test("a declined assignment leaves the service short a head", () => {
    const services: BoardService[] = [{ id: "s1", projectId: "p1", title: "FOH", date: DAY, crewCountRequired: 2 }];
    const r = computeProjectCrewReadiness(
      "p1",
      [assignment({ id: "1", serviceId: "s1", status: "CONFIRMED" }), assignment({ id: "2", serviceId: "s1", status: "DECLINED" })],
      services,
      ME,
    );
    expect(r.servicesMissingCrew[0].shortfall).toBe(1);
  });

  test("B1: a Mon-only call on a Mon–Wed run that needs 1 does not pass the check — Tue and Wed are short", () => {
    const services: BoardService[] = [{ id: "s1", projectId: "p1", title: "Show run", date: DAY, endDate: 3 * DAY, crewCountRequired: 1 }];
    const monOnly = computeProjectCrewReadiness("p1", [assignment({ id: "1", serviceId: "s1", startDate: DAY, endDate: DAY })], services, ME);
    expect(monOnly.servicesMissingCrew).toHaveLength(1);
    expect(monOnly.servicesMissingCrew[0].shortDays.map((d) => d.day)).toEqual([2 * DAY, 3 * DAY]);
    expect(monOnly.crewShortfall).toBe(1);
    const wholeRun = computeProjectCrewReadiness("p1", [assignment({ id: "1", serviceId: "s1", startDate: DAY, endDate: 3 * DAY })], services, ME);
    expect(wholeRun.servicesMissingCrew).toHaveLength(0);
  });

  test("a service with no stated requirement is never flagged", () => {
    const services: BoardService[] = [
      { id: "s1", projectId: "p1", title: "Ad-hoc", date: DAY, crewCountRequired: null },
      { id: "s2", projectId: "p1", title: "Zero", date: DAY, crewCountRequired: 0 },
    ];
    const r = computeProjectCrewReadiness("p1", [], services, ME);
    expect(r.servicesMissingCrew).toHaveLength(0);
  });
});

describe("computeProjectPricingReadiness", () => {
  function pline(l: Partial<PricingLineInput> & { id: string }): PricingLineInput {
    return { projectId: "p1", pricedUnderLock: true, isKitChild: false, ...l };
  }
  function pgroup(g: Partial<PricingGroupInput> & { id: string; title: string }): PricingGroupInput {
    return { projectId: "p1", pricedUnderLock: true, ...g };
  }

  test("lists lines and groups the lock forced to $0", () => {
    const r = computeProjectPricingReadiness(
      "p1",
      [pline({ id: "l1", description: "Custom truss bracket" })],
      [pgroup({ id: "g1", title: "Audio — FOH" })],
    );
    expect(r.unpricedCount).toBe(2);
    expect(r.unpriced.map((u) => u.label)).toEqual(["Custom truss bracket", "Audio — FOH"]);
  });

  test("falls back to the model name when nobody typed a description", () => {
    const r = computeProjectPricingReadiness("p1", [pline({ id: "l1", modelName: "Shure ULXD4Q" })], []);
    expect(r.unpriced[0].label).toBe("Shure ULXD4Q");
  });

  test("ignores kit children, cancelled lines, and deliberately free rows", () => {
    const r = computeProjectPricingReadiness(
      "p1",
      [
        pline({ id: "l1", description: "Kit child", isKitChild: true }),
        pline({ id: "l2", description: "Cancelled", status: "CANCELLED" }),
        pline({ id: "l3", description: "Free on purpose", pricedUnderLock: false }),
      ],
      [pgroup({ id: "g1", title: "Free group", pricedUnderLock: false })],
    );
    expect(r.unpricedCount).toBe(0);
  });

  test("another project's rows never leak in", () => {
    const r = computeProjectPricingReadiness(
      "p1",
      [pline({ id: "l1", projectId: "p2", description: "Elsewhere" })],
      [pgroup({ id: "g1", projectId: "p2", title: "Elsewhere" })],
    );
    expect(r.unpricedCount).toBe(0);
  });
});

describe("computeProjectIncidentReadiness (UX Phase 7)", () => {
  const ORG_ID = "org_1";
  test("counts only open incidents: incidentType set, not COMPLETED or CANCELLED", () => {
    const r = computeProjectIncidentReadiness(
      [
        { organizationId: ORG_ID, incidentType: "BROKEN_DAMAGED", status: "SCHEDULED" },
        { organizationId: ORG_ID, incidentType: "NEEDS_SERVICE", status: "IN_PROGRESS" },
        { organizationId: ORG_ID, incidentType: "BROKEN_DAMAGED", status: "COMPLETED" },
        { organizationId: ORG_ID, incidentType: "LOST_MISSING", status: "CANCELLED" },
        { organizationId: ORG_ID, incidentType: null, status: "SCHEDULED" }, // planned maintenance, not an incident
      ],
      ORG_ID,
    );
    expect(r).toEqual({ openCount: 2, truncated: false });
  });

  test("an org-mismatch row is dropped (the by_projectId index is global)", () => {
    const r = computeProjectIncidentReadiness(
      [
        { organizationId: ORG_ID, incidentType: "BROKEN_DAMAGED", status: "SCHEDULED" },
        { organizationId: "org_other", incidentType: "BROKEN_DAMAGED", status: "SCHEDULED" },
      ],
      ORG_ID,
    );
    expect(r).toEqual({ openCount: 1, truncated: false });
  });

  test("past the cap it counts the first `cap` rows and says the count is a floor", () => {
    const rows = Array.from({ length: 4 }, () => ({ organizationId: ORG_ID, incidentType: "BROKEN_DAMAGED", status: "SCHEDULED" }));
    expect(computeProjectIncidentReadiness(rows, ORG_ID, 3)).toEqual({ openCount: 3, truncated: true });
    expect(computeProjectIncidentReadiness(rows.slice(0, 3), ORG_ID, 3)).toEqual({ openCount: 3, truncated: false });
  });
});

describe("computeProjectPackingReadiness (#1296 build plan phase 4)", () => {
  function pkline(l: Partial<PackingLineInput> & { id: string }): PackingLineInput {
    return { projectId: "p1", type: "EQUIPMENT", status: "CONFIRMED", isKitChild: false, isContainerLineItem: false, ...l };
  }
  function punit(u: Partial<PackingUnitInput> & { lineItemId: string }): PackingUnitInput {
    return { containerId: null, ...u };
  }

  test("a line with neither a planned container nor a packed unit counts as not planned", () => {
    const r = computeProjectPackingReadiness("p1", [pkline({ id: "l1" })], []);
    expect(r).toEqual({ totalCount: 1, notPlannedCount: 1 });
  });

  test("a planned container (PM's intent) counts as planned even before anything is packed", () => {
    const r = computeProjectPackingReadiness("p1", [pkline({ id: "l1", plannedContainerId: "c1" })], []);
    expect(r).toEqual({ totalCount: 1, notPlannedCount: 0 });
  });

  test("an actually-packed unit counts as planned even with no plan set (actual overrides plan)", () => {
    const r = computeProjectPackingReadiness("p1", [pkline({ id: "l1" })], [punit({ lineItemId: "l1", containerId: "c1" })]);
    expect(r).toEqual({ totalCount: 1, notPlannedCount: 0 });
  });

  test("excludes kit children, container line items, cancelled lines, and non-equipment lines", () => {
    const r = computeProjectPackingReadiness(
      "p1",
      [
        pkline({ id: "l1", isKitChild: true }),
        pkline({ id: "l2", isContainerLineItem: true }),
        pkline({ id: "l3", status: "CANCELLED" }),
        pkline({ id: "l4", type: "SALE" }),
      ],
      [],
    );
    expect(r).toEqual({ totalCount: 0, notPlannedCount: 0 });
  });

  test("another project's rows never leak in", () => {
    const r = computeProjectPackingReadiness("p1", [pkline({ id: "l1", projectId: "p2" })], []);
    expect(r).toEqual({ totalCount: 0, notPlannedCount: 0 });
  });
});

describe("service confirmation", () => {
  const svc = (id: string, status?: string): BoardService => ({
    id,
    projectId: "p1",
    title: "Svc " + id,
    date: DAY,
    crewCountRequired: null,
    status,
  });

  test("PLANNED and status-less services count as not confirmed", () => {
    const r = computeProjectCrewReadiness("p1", [], [svc("a", "PLANNED"), svc("b")], ME);
    expect(r.unconfirmedServices.map((s) => s.id)).toEqual(["a", "b"]);
    expect(r.activeServiceCount).toBe(2);
  });

  test("work already underway or finished is past confirmation, not a nag", () => {
    const r = computeProjectCrewReadiness(
      "p1",
      [],
      [svc("a", "CONFIRMED"), svc("b", "IN_PROGRESS"), svc("c", "COMPLETED")],
      ME,
    );
    expect(r.unconfirmedServices).toHaveLength(0);
    expect(r.activeServiceCount).toBe(3);
  });

  test("a CANCELLED service is settled-no — out of both the flag and the denominator", () => {
    const r = computeProjectCrewReadiness("p1", [], [svc("a", "CANCELLED"), svc("b", "PLANNED")], ME);
    expect(r.unconfirmedServices.map((s) => s.id)).toEqual(["b"]);
    expect(r.activeServiceCount).toBe(1);
  });

  test("another project's services never leak in", () => {
    const foreign: BoardService = { ...svc("x", "PLANNED"), projectId: "p2" };
    const r = computeProjectCrewReadiness("p1", [], [foreign], ME);
    expect(r.unconfirmedServices).toHaveLength(0);
    expect(r.activeServiceCount).toBe(0);
  });

  test("unconfirmed services are ordered soonest-first", () => {
    const later: BoardService = { ...svc("later", "PLANNED"), date: 9 * DAY };
    const sooner: BoardService = { ...svc("sooner", "PLANNED"), date: 2 * DAY };
    const r = computeProjectCrewReadiness("p1", [], [later, sooner], ME);
    expect(r.unconfirmedServices.map((s) => s.id)).toEqual(["sooner", "later"]);
  });
});
