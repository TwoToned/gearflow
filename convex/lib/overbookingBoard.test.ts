// @vitest-environment node
import { describe, test, expect } from "vitest";
import {
  computeGearShortageBoard,
  computeSaleStockToProcure,
  computeServicesMissingCrew,
  computeUnconfirmedCrew,
  computeCrewDoubleBookings,
  type BoardProject,
  type BoardLineItem,
  type BoardModel,
  type BoardAsset,
  type BoardSaleLine,
  type BoardService,
  type BoardAssignment,
  type BoardAvailabilityBlock,
} from "./overbookingBoard";

const DAY = 86_400_000;
const RANGE = { start: 0, end: 30 * DAY };

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

function lineItem(l: Partial<BoardLineItem> & { id: string; projectId: string; modelId: string; quantity: number }): BoardLineItem {
  return { status: "QUOTED", subHireId: null, isOptional: false, ...l };
}

describe("computeGearShortageBoard", () => {
  const models: BoardModel[] = [{ id: "m1", name: "SM58", assetType: "SERIALIZED" }];
  const assets: BoardAsset[] = [{ modelId: "m1", status: "AVAILABLE", isActive: true }, { modelId: "m1", status: "AVAILABLE", isActive: true }];

  test("flags a hard shortage when confirmed-project demand exceeds stock", () => {
    const projects = [project({ id: "p1", status: "CONFIRMED" })];
    const lineItems = [lineItem({ id: "li1", projectId: "p1", modelId: "m1", quantity: 3 })];
    const { hard, pencilled } = computeGearShortageBoard(RANGE, projects, lineItems, models, assets, []);
    expect(hard).toHaveLength(1);
    expect(hard[0]).toMatchObject({ modelId: "m1", qty: 1 });
    expect(pencilled).toHaveLength(0);
  });

  test("a QUOTED project's demand alone is a pencilled collision, not a hard shortage", () => {
    const projects = [project({ id: "p1", status: "QUOTED" })];
    const lineItems = [lineItem({ id: "li1", projectId: "p1", modelId: "m1", quantity: 3 })];
    const { hard, pencilled } = computeGearShortageBoard(RANGE, projects, lineItems, models, assets, []);
    expect(hard).toHaveLength(0);
    expect(pencilled).toHaveLength(1);
    expect(pencilled[0]).toMatchObject({ modelId: "m1", qty: 1 });
  });

  test("an isOptional line on a CONFIRMED project stays pencilled", () => {
    const projects = [project({ id: "p1", status: "CONFIRMED" })];
    const lineItems = [lineItem({ id: "li1", projectId: "p1", modelId: "m1", quantity: 3, isOptional: true })];
    const { hard, pencilled } = computeGearShortageBoard(RANGE, projects, lineItems, models, assets, []);
    expect(hard).toHaveLength(0);
    expect(pencilled).toHaveLength(1);
  });

  test("hard + pencilled together: pencilled qty is the ADDITIONAL overage beyond hard", () => {
    // stock 2. p1 CONFIRMED books 3 (hard shortage 1). p2 QUOTED books 2 more
    // (pencilled) -> combined 5 vs stock 2 = shortage 3, pencilled = 3-1 = 2.
    const projects = [project({ id: "p1", status: "CONFIRMED" }), project({ id: "p2", status: "QUOTED" })];
    const lineItems = [
      lineItem({ id: "li1", projectId: "p1", modelId: "m1", quantity: 3 }),
      lineItem({ id: "li2", projectId: "p2", modelId: "m1", quantity: 2 }),
    ];
    const { hard, pencilled } = computeGearShortageBoard(RANGE, projects, lineItems, models, assets, []);
    expect(hard[0]).toMatchObject({ qty: 1 });
    expect(pencilled[0]).toMatchObject({ qty: 2 });
  });

  test("sub-hire lines are excluded (covered demand)", () => {
    const projects = [project({ id: "p1", status: "CONFIRMED" })];
    const lineItems = [lineItem({ id: "li1", projectId: "p1", modelId: "m1", quantity: 5, subHireId: "sh1" })];
    const { hard, pencilled } = computeGearShortageBoard(RANGE, projects, lineItems, models, assets, []);
    expect(hard).toHaveLength(0);
    expect(pencilled).toHaveLength(0);
  });

  test("CANCELLED / RETURNED projects never contribute", () => {
    const projects = [project({ id: "p1", status: "CANCELLED" }), project({ id: "p2", status: "RETURNED" })];
    const lineItems = [
      lineItem({ id: "li1", projectId: "p1", modelId: "m1", quantity: 5 }),
      lineItem({ id: "li2", projectId: "p2", modelId: "m1", quantity: 5 }),
    ];
    const { hard, pencilled } = computeGearShortageBoard(RANGE, projects, lineItems, models, assets, []);
    expect(hard).toHaveLength(0);
    expect(pencilled).toHaveLength(0);
  });

  test("a project whose window doesn't overlap the range is excluded", () => {
    const projects = [project({ id: "p1", status: "CONFIRMED", rentalStartDate: 100 * DAY, rentalEndDate: 110 * DAY })];
    const lineItems = [lineItem({ id: "li1", projectId: "p1", modelId: "m1", quantity: 5 })];
    const { hard, pencilled } = computeGearShortageBoard(RANGE, projects, lineItems, models, assets, []);
    expect(hard).toHaveLength(0);
    expect(pencilled).toHaveLength(0);
  });
});

describe("computeSaleStockToProcure (WS11 #950)", () => {
  const projectById = new Map([["p1", { id: "p1", name: "Big Show", projectNumber: "PRJ-1" }]]);

  test("flags a model whose Model.saleStockQuantity has gone negative, listing contributing NEW_STOCK sale lines", () => {
    const models: BoardModel[] = [{ id: "m1", name: "Gaffer Tape", saleStockQuantity: -3 }];
    const saleLines: BoardSaleLine[] = [
      { id: "li1", projectId: "p1", modelId: "m1", type: "SALE", saleMode: "NEW_STOCK", quantity: 3, status: "CONFIRMED" },
    ];
    const rows = computeSaleStockToProcure(models, saleLines, projectById);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ modelId: "m1", modelName: "Gaffer Tape", shortfallQty: 3 });
    expect(rows[0].contributingSaleLines).toEqual([
      { lineItemId: "li1", projectId: "p1", projectName: "Big Show", projectNumber: "PRJ-1", quantity: 3 },
    ]);
  });

  test("a model with a non-negative (or unset) saleStockQuantity is inert", () => {
    const models: BoardModel[] = [{ id: "m1", name: "Gaffer Tape" }, { id: "m2", name: "Cable", saleStockQuantity: 5 }];
    expect(computeSaleStockToProcure(models, [], projectById)).toHaveLength(0);
  });

  test("excludes CANCELLED sale lines and FROM_RENTAL_STOCK lines from the contributing list", () => {
    const models: BoardModel[] = [{ id: "m1", name: "Gaffer Tape", saleStockQuantity: -1 }];
    const saleLines: BoardSaleLine[] = [
      { id: "cancelled1", projectId: "p1", modelId: "m1", type: "SALE", saleMode: "NEW_STOCK", quantity: 5, status: "CANCELLED" },
      { id: "fromrental1", projectId: "p1", modelId: "m1", type: "SALE", saleMode: "FROM_RENTAL_STOCK", quantity: 5, status: "CONFIRMED" },
      { id: "rental1", projectId: "p1", modelId: "m1", type: "EQUIPMENT", quantity: 5, status: "CONFIRMED" },
    ];
    const rows = computeSaleStockToProcure(models, saleLines, projectById);
    expect(rows[0].contributingSaleLines).toHaveLength(0); // shortfall still flagged, just no matching contributing line
    expect(rows[0].shortfallQty).toBe(1);
  });
});

describe("computeServicesMissingCrew", () => {
  const projectsById = new Map([["p1", { id: "p1", name: "Big Show", projectNumber: "PRJ-1" }]]);

  test("flags a service whose FILLED crew (excluding DECLINED/CANCELLED) is below crewCountRequired", () => {
    const services: BoardService[] = [{ id: "s1", projectId: "p1", title: "Bump-in", date: 5 * DAY, crewCountRequired: 2 }];
    const assignmentsByServiceId = new Map<string, BoardAssignment[]>([
      ["s1", [
        { id: "a1", projectId: "p1", crewMemberId: "c1", status: "CONFIRMED" },
        { id: "a2", projectId: "p1", crewMemberId: "c2", status: "DECLINED" },
      ]],
    ]);
    const rows = computeServicesMissingCrew(RANGE, services, assignmentsByServiceId, projectsById);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ serviceId: "s1", assignedCount: 1, shortfall: 1 });
  });

  test("crewCountRequired null is skipped, never flagged", () => {
    const services: BoardService[] = [{ id: "s1", projectId: "p1", title: "Bump-in", date: 5 * DAY, crewCountRequired: null }];
    const rows = computeServicesMissingCrew(RANGE, services, new Map(), projectsById);
    expect(rows).toHaveLength(0);
  });

  test("a fully-staffed service is not flagged", () => {
    const services: BoardService[] = [{ id: "s1", projectId: "p1", title: "Bump-in", date: 5 * DAY, crewCountRequired: 1 }];
    const assignmentsByServiceId = new Map<string, BoardAssignment[]>([["s1", [{ id: "a1", projectId: "p1", crewMemberId: "c1", status: "CONFIRMED" }]]]);
    expect(computeServicesMissingCrew(RANGE, services, assignmentsByServiceId, projectsById)).toHaveLength(0);
  });

  test("a service outside the date range is not flagged", () => {
    const services: BoardService[] = [{ id: "s1", projectId: "p1", title: "Bump-in", date: 100 * DAY, crewCountRequired: 2 }];
    expect(computeServicesMissingCrew(RANGE, services, new Map(), projectsById)).toHaveLength(0);
  });
});

describe("computeUnconfirmedCrew", () => {
  test("flags a non-CONFIRMED assignment on a project whose window starts in range", () => {
    const projectsById = new Map([["p1", project({ id: "p1", rentalStartDate: 5 * DAY, rentalEndDate: 10 * DAY })]]);
    const assignments: BoardAssignment[] = [{ id: "a1", projectId: "p1", crewMemberId: "c1", status: "OFFERED" }];
    const rows = computeUnconfirmedCrew(RANGE, assignments, projectsById);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ assignmentId: "a1", status: "OFFERED" });
  });

  test("a CONFIRMED assignment is not flagged", () => {
    const projectsById = new Map([["p1", project({ id: "p1", rentalStartDate: 5 * DAY, rentalEndDate: 10 * DAY })]]);
    const assignments: BoardAssignment[] = [{ id: "a1", projectId: "p1", crewMemberId: "c1", status: "CONFIRMED" }];
    expect(computeUnconfirmedCrew(RANGE, assignments, projectsById)).toHaveLength(0);
  });

  test("a DECLINED assignment is not flagged (settled-no, not pending)", () => {
    const projectsById = new Map([["p1", project({ id: "p1", rentalStartDate: 5 * DAY, rentalEndDate: 10 * DAY })]]);
    const assignments: BoardAssignment[] = [{ id: "a1", projectId: "p1", crewMemberId: "c1", status: "DECLINED" }];
    expect(computeUnconfirmedCrew(RANGE, assignments, projectsById)).toHaveLength(0);
  });

  test("a project whose window starts outside range is not flagged", () => {
    const projectsById = new Map([["p1", project({ id: "p1", rentalStartDate: 100 * DAY, rentalEndDate: 110 * DAY })]]);
    const assignments: BoardAssignment[] = [{ id: "a1", projectId: "p1", crewMemberId: "c1", status: "PENDING" }];
    expect(computeUnconfirmedCrew(RANGE, assignments, projectsById)).toHaveLength(0);
  });
});

describe("computeCrewDoubleBookings", () => {
  const projectsById = new Map([
    ["p1", { id: "p1", name: "Job A", projectNumber: "PRJ-1" }],
    ["p2", { id: "p2", name: "Job B", projectNumber: "PRJ-2" }],
  ]);

  test("flags a hard conflict when an UNAVAILABLE block overlaps an assignment", () => {
    const assignments: BoardAssignment[] = [{ id: "a1", projectId: "p1", crewMemberId: "c1", status: "CONFIRMED", startDate: 5 * DAY, endDate: 7 * DAY }];
    const blocks: BoardAvailabilityBlock[] = [{ id: "b1", crewMemberId: "c1", startDate: 6 * DAY, endDate: 8 * DAY, type: "UNAVAILABLE" }];
    const rows = computeCrewDoubleBookings(RANGE, assignments, blocks, projectsById);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ severity: "hard", crewMemberId: "c1" });
  });

  test("flags a soft conflict for two overlapping assignments on different projects", () => {
    const assignments: BoardAssignment[] = [
      { id: "a1", projectId: "p1", crewMemberId: "c1", status: "CONFIRMED", startDate: 5 * DAY, endDate: 7 * DAY },
      { id: "a2", projectId: "p2", crewMemberId: "c1", status: "OFFERED", startDate: 6 * DAY, endDate: 8 * DAY },
    ];
    const rows = computeCrewDoubleBookings(RANGE, assignments, [], projectsById);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ severity: "soft", crewMemberId: "c1" });
  });

  test("two assignments on the SAME project are not a conflict", () => {
    const assignments: BoardAssignment[] = [
      { id: "a1", projectId: "p1", crewMemberId: "c1", status: "CONFIRMED", startDate: 5 * DAY, endDate: 7 * DAY },
      { id: "a2", projectId: "p1", crewMemberId: "c1", status: "CONFIRMED", startDate: 6 * DAY, endDate: 8 * DAY },
    ];
    expect(computeCrewDoubleBookings(RANGE, assignments, [], projectsById)).toHaveLength(0);
  });

  test("a DECLINED assignment never contributes a conflict", () => {
    const assignments: BoardAssignment[] = [
      { id: "a1", projectId: "p1", crewMemberId: "c1", status: "DECLINED", startDate: 5 * DAY, endDate: 7 * DAY },
      { id: "a2", projectId: "p2", crewMemberId: "c1", status: "OFFERED", startDate: 6 * DAY, endDate: 8 * DAY },
    ];
    expect(computeCrewDoubleBookings(RANGE, assignments, [], projectsById)).toHaveLength(0);
  });

  test("non-overlapping assignments for the same member are not flagged", () => {
    const assignments: BoardAssignment[] = [
      { id: "a1", projectId: "p1", crewMemberId: "c1", status: "CONFIRMED", startDate: 1 * DAY, endDate: 2 * DAY },
      { id: "a2", projectId: "p2", crewMemberId: "c1", status: "CONFIRMED", startDate: 10 * DAY, endDate: 11 * DAY },
    ];
    expect(computeCrewDoubleBookings(RANGE, assignments, [], projectsById)).toHaveLength(0);
  });
});
