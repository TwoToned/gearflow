// @vitest-environment node
//
// convex/overbookingBoard.ts `bundle` — end-to-end integration test through a
// real Convex-test DB (schema.ts, real indexes), verifying every section
// against a fixture that mixes in-range hard/pencilled/crew signals with
// deliberately out-of-range "noise" (an ancient RETURNED booking of the same
// popular model, a far-future project) that must NOT surface — the same
// convention `overbooking.test.ts` uses to demonstrate the read stays bounded
// to the requested range rather than falling back to an org-wide scan.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const asUser = { subject: USER, orgId: ORG };
const RANGE_START = NOW - 1 * DAY;
const RANGE_END = NOW + 10 * DAY;

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("models", { id: "mdl", organizationId: ORG, name: "IMX6A", assetType: "SERIALIZED" });
    await ctx.db.insert("assets", { id: "A0", organizationId: ORG, modelId: "mdl", assetTag: "A-0", status: "AVAILABLE" });
    await ctx.db.insert("assets", { id: "A1", organizationId: ORG, modelId: "mdl", assetTag: "A-1", status: "AVAILABLE" });

    // P1: CONFIRMED, in range, books 3 of a 2-stock model -> hard shortage 1.
    await ctx.db.insert("projects", {
      id: "P1", organizationId: ORG, projectNumber: "P1", name: "Confirmed overbook", status: "CONFIRMED",
      isTemplate: false, rentalStartDate: NOW, rentalEndDate: NOW + 5 * DAY, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projectLineItems", { id: "L1", organizationId: ORG, projectId: "P1", modelId: "mdl", status: "CONFIRMED", quantity: 3, type: "EQUIPMENT" });

    // P2: QUOTED, in range, books 2 more of the same model -> pencilled collision.
    await ctx.db.insert("projects", {
      id: "P2", organizationId: ORG, projectNumber: "P2", name: "Quoted collision", status: "QUOTED",
      isTemplate: false, rentalStartDate: NOW + 2 * DAY, rentalEndDate: NOW + 6 * DAY, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projectLineItems", { id: "L2", organizationId: ORG, projectId: "P2", modelId: "mdl", status: "QUOTED", quantity: 2, type: "EQUIPMENT" });

    // NOISE: an ancient, long-settled RETURNED booking of the same model, far
    // outside the range — must not surface (same shape as overbooking.test.ts's P5).
    await ctx.db.insert("projects", {
      id: "P_ancient", organizationId: ORG, projectNumber: "P_ANCIENT", name: "Ancient history", status: "RETURNED",
      isTemplate: false, rentalStartDate: NOW - 400 * DAY, rentalEndDate: NOW - 395 * DAY, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projectLineItems", { id: "L_ancient", organizationId: ORG, projectId: "P_ancient", modelId: "mdl", status: "CONFIRMED", quantity: 50, type: "EQUIPMENT" });

    // NOISE: a far-future CONFIRMED project, well outside the range.
    await ctx.db.insert("projects", {
      id: "P_future", organizationId: ORG, projectNumber: "P_FUTURE", name: "Far future", status: "CONFIRMED",
      isTemplate: false, rentalStartDate: NOW + 100 * DAY, rentalEndDate: NOW + 103 * DAY, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projectLineItems", { id: "L_future", organizationId: ORG, projectId: "P_future", modelId: "mdl", status: "CONFIRMED", quantity: 50, type: "EQUIPMENT" });

    // Sale stock: a model with negative saleStockQuantity and NO project demand.
    await ctx.db.insert("models", { id: "mdl_sale", organizationId: ORG, name: "Gaffer Tape" });
    await ctx.db.insert("bulkAssets", { id: "B1", organizationId: ORG, modelId: "mdl_sale", assetTag: "TAPE-1", saleStockQuantity: -4 });

    // Services missing crew: crewCountRequired 2, only 1 CONFIRMED assignment (a
    // 2nd is DECLINED and must not count as filled).
    await ctx.db.insert("crewMembers", { id: "C1", organizationId: ORG, firstName: "Alex", lastName: "Roadie", isActive: true, status: "ACTIVE" });
    await ctx.db.insert("crewMembers", { id: "C2", organizationId: ORG, firstName: "Sam", lastName: "Rigger", isActive: true, status: "ACTIVE" });
    await ctx.db.insert("projectServices", {
      id: "S1", organizationId: ORG, projectId: "P1", type: "BUMP_IN", title: "Bump-in", date: NOW + 1 * DAY, crewCountRequired: 2,
    });
    await ctx.db.insert("crewAssignments", {
      id: "CA1", organizationId: ORG, projectId: "P1", crewMemberId: "C1", serviceId: "S1", status: "CONFIRMED",
      startDate: NOW + 1 * DAY, endDate: NOW + 1 * DAY,
    });
    await ctx.db.insert("crewAssignments", {
      id: "CA2", organizationId: ORG, projectId: "P1", crewMemberId: "C2", serviceId: "S1", status: "DECLINED",
      startDate: NOW + 1 * DAY, endDate: NOW + 1 * DAY,
    });

    // Unconfirmed crew: an OFFERED assignment on P2, whose window starts in range.
    await ctx.db.insert("crewAssignments", {
      id: "CA3", organizationId: ORG, projectId: "P2", crewMemberId: "C1", status: "OFFERED",
      startDate: NOW + 2 * DAY, endDate: NOW + 3 * DAY,
    });

    // Crew double-booking: C1 also double-booked on a THIRD project overlapping CA3.
    await ctx.db.insert("projects", {
      id: "P3", organizationId: ORG, projectNumber: "P3", name: "Double-booked", status: "CONFIRMED",
      isTemplate: false, rentalStartDate: NOW + 2 * DAY, rentalEndDate: NOW + 3 * DAY, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("crewAssignments", {
      id: "CA4", organizationId: ORG, projectId: "P3", crewMemberId: "C1", status: "CONFIRMED",
      startDate: NOW + 2 * DAY, endDate: NOW + 3 * DAY,
    });
  });
}

describe("overbookingBoard.bundle", () => {
  test("requires project:read permission", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.query(api.overbookingBoard.bundle, { orgId: ORG, rangeStart: RANGE_START, rangeEnd: RANGE_END }),
    ).rejects.toThrow();
  });

  test("aggregates hard shortage, pencilled collision, sale stock, missing/unconfirmed/double-booked crew — excluding ancient and future noise", async () => {
    const t = makeT();
    await seed(t);
    const result = await t.withIdentity(asUser).query(api.overbookingBoard.bundle, {
      orgId: ORG,
      rangeStart: RANGE_START,
      rangeEnd: RANGE_END,
    });

    expect(result.gearHard).toHaveLength(1);
    expect(result.gearHard[0]).toMatchObject({ modelId: "mdl", qty: 1 });

    expect(result.gearPencilled).toHaveLength(1);
    expect(result.gearPencilled[0]).toMatchObject({ modelId: "mdl", qty: 2 });

    expect(result.saleStockToProcure).toHaveLength(1);
    expect(result.saleStockToProcure[0]).toMatchObject({ modelId: "mdl_sale", shortfallQty: 4 });

    expect(result.servicesMissingCrew).toHaveLength(1);
    expect(result.servicesMissingCrew[0]).toMatchObject({ serviceId: "S1", assignedCount: 1, shortfall: 1 });

    expect(result.unconfirmedCrew.map((r) => r.assignmentId)).toContain("CA3");

    expect(result.crewDoubleBookings.some((r) => r.crewMemberId === "C1" && r.severity === "soft")).toBe(true);
  });

  test("a range that excludes P1/P2 entirely returns empty gear sections (bounded, not org-wide)", async () => {
    const t = makeT();
    await seed(t);
    const result = await t.withIdentity(asUser).query(api.overbookingBoard.bundle, {
      orgId: ORG,
      rangeStart: NOW + 200 * DAY,
      rangeEnd: NOW + 210 * DAY,
    });
    expect(result.gearHard).toHaveLength(0);
    expect(result.gearPencilled).toHaveLength(0);
  });

  test("rejects a range wider than the max window", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.withIdentity(asUser).query(api.overbookingBoard.bundle, { orgId: ORG, rangeStart: 0, rangeEnd: 400 * DAY }),
    ).rejects.toThrow();
  });
});

describe("overbookingBoard.counts (dashboard chips)", () => {
  test("matches the full bundle's section lengths exactly (chip/board parity)", async () => {
    const t = makeT();
    await seed(t);
    const [bundle, counts] = await Promise.all([
      t.withIdentity(asUser).query(api.overbookingBoard.bundle, { orgId: ORG, rangeStart: RANGE_START, rangeEnd: RANGE_END }),
      t.withIdentity(asUser).query(api.overbookingBoard.counts, { orgId: ORG, rangeStart: RANGE_START, rangeEnd: RANGE_END }),
    ]);
    expect(counts).toEqual({
      hardCount: bundle.gearHard.length,
      pencilledCount: bundle.gearPencilled.length,
      saleStockCount: bundle.saleStockToProcure.length,
    });
    expect(counts.hardCount).toBe(1);
    expect(counts.pencilledCount).toBe(1);
    expect(counts.saleStockCount).toBe(1);
  });
});
