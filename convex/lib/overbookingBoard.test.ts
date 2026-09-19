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

  test("FCFS (2026-09): a shortage row lists only the LATER project, not the one that already claimed its stock", () => {
    // Job A's line was created first, Job B's second, both CONFIRMED, both
    // booking 10 against 16 usable stock — Job A's claim fits (0-10 of 16),
    // Job B's doesn't (10-20 of 16, 4 over). Only Job B should be blamed —
    // Job A already has its gear.
    const wideAssets: BoardAsset[] = Array.from({ length: 16 }, () => ({ modelId: "m1", status: "AVAILABLE", isActive: true }));
    const projects = [project({ id: "jobA", status: "CONFIRMED" }), project({ id: "jobB", status: "CONFIRMED" })];
    const lineItems = [
      { ...lineItem({ id: "liA", projectId: "jobA", modelId: "m1", quantity: 10 }), _creationTime: 1000 },
      { ...lineItem({ id: "liB", projectId: "jobB", modelId: "m1", quantity: 10 }), _creationTime: 2000 },
    ];
    const { hard } = computeGearShortageBoard(RANGE, projects, lineItems, models, wideAssets, []);
    expect(hard).toHaveLength(1);
    expect(hard[0]).toMatchObject({ modelId: "m1", qty: 4 });
    expect(hard[0].projects.map((p) => p.id)).toEqual(["jobB"]);
  });

  test("a QUOTED project's demand alone is a pencilled collision, not a hard shortage", () => {
    const projects = [project({ id: "p1", status: "QUOTED" })];
    const lineItems = [lineItem({ id: "li1", projectId: "p1", modelId: "m1", quantity: 3 })];
    const { hard, pencilled } = computeGearShortageBoard(RANGE, projects, lineItems, models, assets, []);
    expect(hard).toHaveLength(0);
    expect(pencilled).toHaveLength(1);
    expect(pencilled[0]).toMatchObject({ modelId: "m1", qty: 1 });
  });

  test("FCFS (2026-09): a pencilled collision row blames only the QUOTED job, not the CONFIRMED job already holding its stock", () => {
    // Model has 10 usable stock. Job A (CONFIRMED, hard) books 8 — alone
    // that's within stock (fits, and hard always allocates before pencilled),
    // so it never makes the `hard` row. Job B (QUOTED, pencilled) books 5 —
    // only 2 units are left after Job A's hard claim, so Job B is short by 3.
    // Job A already has its gear; the collision is Job B's alone.
    const wideAssets: BoardAsset[] = Array.from({ length: 10 }, () => ({ modelId: "m1", status: "AVAILABLE", isActive: true }));
    const projects = [project({ id: "jobA", status: "CONFIRMED" }), project({ id: "jobB", status: "QUOTED" })];
    const lineItems = [
      lineItem({ id: "liA", projectId: "jobA", modelId: "m1", quantity: 8 }),
      lineItem({ id: "liB", projectId: "jobB", modelId: "m1", quantity: 5 }),
    ];
    const { hard, pencilled } = computeGearShortageBoard(RANGE, projects, lineItems, models, wideAssets, []);
    expect(hard).toHaveLength(0);
    expect(pencilled).toHaveLength(1);
    expect(pencilled[0]).toMatchObject({ modelId: "m1", qty: 3 });
    expect(pencilled[0].projects.map((p) => p.id)).toEqual(["jobB"]);
  });

  test("day-slicing (2026-09 fix): two projects that each fit fine alone don't collide just because both fall within the query range", () => {
    // Model has 2 usable stock. Job A runs day 0-5 and books 2 (fits alone).
    // Job B runs day 10-15 and also books 2 (fits alone). Their windows never
    // overlap EACH OTHER, even though both fall inside the wide 30-day query
    // RANGE — before the fix, the whole-range pooling summed both into one
    // "4 booked against 2 stock" figure and falsely flagged a collision.
    const projects = [
      project({ id: "jobA", status: "CONFIRMED", rentalStartDate: 0, rentalEndDate: 5 * DAY }),
      project({ id: "jobB", status: "CONFIRMED", rentalStartDate: 10 * DAY, rentalEndDate: 15 * DAY }),
    ];
    const lineItems = [
      lineItem({ id: "liA", projectId: "jobA", modelId: "m1", quantity: 2 }),
      lineItem({ id: "liB", projectId: "jobB", modelId: "m1", quantity: 2 }),
    ];
    const { hard, pencilled } = computeGearShortageBoard(RANGE, projects, lineItems, models, assets, []);
    expect(hard).toHaveLength(0);
    expect(pencilled).toHaveLength(0);
  });

  test("day-slicing: a genuine conflict is bounded to the actual overlapping sub-window, not the whole query range", () => {
    // Model has 2 usable stock. Job A runs day 0-10 booking 2 (fits alone
    // for days 0-4, but days 5-10 overlap Job B). Job B runs day 5-20
    // booking 1 (created after A). Combined demand (3) only exceeds stock
    // (2) during the days 5-10 overlap — days 0-4 and 11-20 are each within
    // capacity on their own.
    const projects = [
      project({ id: "jobA", status: "CONFIRMED", rentalStartDate: 0, rentalEndDate: 10 * DAY }),
      project({ id: "jobB", status: "CONFIRMED", rentalStartDate: 5 * DAY, rentalEndDate: 20 * DAY }),
    ];
    const lineItems = [
      { ...lineItem({ id: "liA", projectId: "jobA", modelId: "m1", quantity: 2 }), _creationTime: 1000 },
      { ...lineItem({ id: "liB", projectId: "jobB", modelId: "m1", quantity: 1 }), _creationTime: 2000 },
    ];
    const { hard } = computeGearShortageBoard(RANGE, projects, lineItems, models, assets, []);
    expect(hard).toHaveLength(1);
    expect(hard[0]).toMatchObject({ modelId: "m1", qty: 1, spanStart: 5 * DAY, spanEnd: 10 * DAY });
    expect(hard[0].projects.map((p) => p.id)).toEqual(["jobB"]);
  });

  test("day-slicing: two separate, non-adjacent conflict windows against the same ongoing claim produce two separate rows", () => {
    // Model has 2 usable stock. Job A runs day 0-20 booking 2 (created
    // first, fits alone). Job B runs day 5-8 booking 1 (created second) and
    // Job C runs day 10-15 booking 1 (created third) — separated by a clean
    // gap (day 9) where only A is active and nothing collides. Each of B's
    // and C's windows collides with A's ongoing 2 independently — these are
    // two genuine, non-touching conflicts and must report as two rows, not
    // merged and not dropped.
    const projects = [
      project({ id: "jobA", status: "CONFIRMED", rentalStartDate: 0, rentalEndDate: 20 * DAY }),
      project({ id: "jobB", status: "CONFIRMED", rentalStartDate: 5 * DAY, rentalEndDate: 8 * DAY }),
      project({ id: "jobC", status: "CONFIRMED", rentalStartDate: 10 * DAY, rentalEndDate: 15 * DAY }),
    ];
    const lineItems = [
      { ...lineItem({ id: "liA", projectId: "jobA", modelId: "m1", quantity: 2 }), _creationTime: 1000 },
      { ...lineItem({ id: "liB", projectId: "jobB", modelId: "m1", quantity: 1 }), _creationTime: 2000 },
      { ...lineItem({ id: "liC", projectId: "jobC", modelId: "m1", quantity: 1 }), _creationTime: 3000 },
    ];
    const { hard } = computeGearShortageBoard(RANGE, projects, lineItems, models, assets, []);
    expect(hard).toHaveLength(2);
    const byProject = new Map(hard.map((r) => [r.projects[0]?.id, r]));
    expect(byProject.get("jobB")).toMatchObject({ qty: 1, spanStart: 5 * DAY, spanEnd: 8 * DAY });
    expect(byProject.get("jobC")).toMatchObject({ qty: 1, spanStart: 10 * DAY, spanEnd: 15 * DAY });
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

  test("a SALE line never counts as rental demand (WS11 #950)", () => {
    // Stock 2. A NEW_STOCK sale line for 5 units must not, on its own, flag a
    // shortage — it draws from Model.saleStockQuantity, not the rental pool.
    const projects = [project({ id: "p1", status: "CONFIRMED" })];
    const lineItems = [lineItem({ id: "li1", projectId: "p1", modelId: "m1", quantity: 5, type: "SALE" })];
    const { hard, pencilled } = computeGearShortageBoard(RANGE, projects, lineItems, models, assets, []);
    expect(hard).toHaveLength(0);
    expect(pencilled).toHaveLength(0);
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
