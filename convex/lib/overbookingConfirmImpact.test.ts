// @vitest-environment node
import { describe, test, expect } from "vitest";
import { computeConfirmImpactModels, countUnconfirmedCrewForProject } from "./overbookingConfirmImpact";
import type { BoardProject, BoardLineItem, BoardModel, BoardAsset, BoardAssignment } from "./overbookingBoard";

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

describe("computeConfirmImpactModels (confirm-time gate, WS3 #942)", () => {
  const models: BoardModel[] = [{ id: "m1", name: "SM58", assetType: "SERIALIZED" }];
  const assets: BoardAsset[] = [{ modelId: "m1", status: "AVAILABLE", isActive: true }, { modelId: "m1", status: "AVAILABLE", isActive: true }];

  test("flags a model that would go hard-overbooked if the caller's project were confirmed", () => {
    // stock 2. p1 (simulated CONFIRMED by the caller) books 3 of its own; p2
    // (already CONFIRMED) books 1 more of the same model.
    const projects = [
      project({ id: "p1", status: "CONFIRMED" }), // caller already simulates this
      project({ id: "p2", status: "CONFIRMED" }),
    ];
    const lineItems = [
      lineItem({ id: "li1", projectId: "p1", modelId: "m1", quantity: 3 }),
      lineItem({ id: "li2", projectId: "p2", modelId: "m1", quantity: 1 }),
    ];
    const result = computeConfirmImpactModels("p1", RANGE, projects, lineItems, models, assets, []);
    expect(result).toEqual({ modelCount: 1, qty: 2 }); // 4 booked - 2 stock = 2 over
  });

  test("an isOptional line never contributes to the impact (stays pencilled even simulated-confirmed)", () => {
    const projects = [project({ id: "p1", status: "CONFIRMED" })];
    const lineItems = [lineItem({ id: "li1", projectId: "p1", modelId: "m1", quantity: 5, isOptional: true })];
    const result = computeConfirmImpactModels("p1", RANGE, projects, lineItems, models, assets, []);
    expect(result).toEqual({ modelCount: 0, qty: 0 });
  });

  test("no impact when the project's own demand fits within stock", () => {
    const projects = [project({ id: "p1", status: "CONFIRMED" })];
    const lineItems = [lineItem({ id: "li1", projectId: "p1", modelId: "m1", quantity: 2 })];
    const result = computeConfirmImpactModels("p1", RANGE, projects, lineItems, models, assets, []);
    expect(result).toEqual({ modelCount: 0, qty: 0 });
  });

  test("a model the project doesn't touch is never counted, even if it's short elsewhere", () => {
    const models2: BoardModel[] = [...models, { id: "m2", name: "Other", assetType: "SERIALIZED" }];
    const projects = [project({ id: "p1", status: "CONFIRMED" }), project({ id: "p2", status: "CONFIRMED" })];
    const lineItems = [
      lineItem({ id: "li1", projectId: "p1", modelId: "m1", quantity: 1 }), // p1 fits fine
      lineItem({ id: "li2", projectId: "p2", modelId: "m2", quantity: 99 }), // unrelated shortage
    ];
    const result = computeConfirmImpactModels("p1", RANGE, projects, lineItems, models2, assets, []);
    expect(result).toEqual({ modelCount: 0, qty: 0 });
  });
});

describe("countUnconfirmedCrewForProject", () => {
  test("counts assignments that aren't CONFIRMED, excluding DECLINED/CANCELLED", () => {
    const assignments: BoardAssignment[] = [
      { id: "a1", projectId: "p1", crewMemberId: "c1", status: "CONFIRMED" },
      { id: "a2", projectId: "p1", crewMemberId: "c2", status: "OFFERED" },
      { id: "a3", projectId: "p1", crewMemberId: "c3", status: "DECLINED" },
      { id: "a4", projectId: "p1", crewMemberId: "c4", status: "PENDING" },
    ];
    expect(countUnconfirmedCrewForProject(assignments)).toBe(2);
  });

  test("zero when every assignment is already CONFIRMED", () => {
    const assignments: BoardAssignment[] = [{ id: "a1", projectId: "p1", crewMemberId: "c1", status: "CONFIRMED" }];
    expect(countUnconfirmedCrewForProject(assignments)).toBe(0);
  });
});
