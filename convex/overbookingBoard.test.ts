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
      liveVersionId: "v-P1",
    });
    await ctx.db.insert("projectVersions", { id: "v-P1", organizationId: ORG, projectId: "P1", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    await ctx.db.insert("projectLineItems", { id: "L1", organizationId: ORG, projectId: "P1", modelId: "mdl", status: "CONFIRMED", quantity: 3, type: "EQUIPMENT",
      versionId: "v-P1",
      lineageId: "L1",
    });

    // P2: QUOTED, in range, books 2 more of the same model -> pencilled collision.
    await ctx.db.insert("projects", {
      id: "P2", organizationId: ORG, projectNumber: "P2", name: "Quoted collision", status: "QUOTED",
      isTemplate: false, rentalStartDate: NOW + 2 * DAY, rentalEndDate: NOW + 6 * DAY, createdAt: NOW, updatedAt: NOW,
      liveVersionId: "v-P2",
    });
    await ctx.db.insert("projectVersions", { id: "v-P2", organizationId: ORG, projectId: "P2", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    await ctx.db.insert("projectLineItems", { id: "L2", organizationId: ORG, projectId: "P2", modelId: "mdl", status: "QUOTED", quantity: 2, type: "EQUIPMENT",
      versionId: "v-P2",
      lineageId: "L2",
    });

    // NOISE: an ancient, long-settled RETURNED booking of the same model, far
    // outside the range — must not surface (same shape as overbooking.test.ts's P5).
    await ctx.db.insert("projects", {
      id: "P_ancient", organizationId: ORG, projectNumber: "P_ANCIENT", name: "Ancient history", status: "RETURNED",
      isTemplate: false, rentalStartDate: NOW - 400 * DAY, rentalEndDate: NOW - 395 * DAY, createdAt: NOW, updatedAt: NOW,
      liveVersionId: "v-P_ancient",
    });
    await ctx.db.insert("projectVersions", { id: "v-P_ancient", organizationId: ORG, projectId: "P_ancient", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    await ctx.db.insert("projectLineItems", { id: "L_ancient", organizationId: ORG, projectId: "P_ancient", modelId: "mdl", status: "CONFIRMED", quantity: 50, type: "EQUIPMENT",
      versionId: "v-P_ancient",
      lineageId: "L_ancient",
    });

    // NOISE: a far-future CONFIRMED project, well outside the range.
    await ctx.db.insert("projects", {
      id: "P_future", organizationId: ORG, projectNumber: "P_FUTURE", name: "Far future", status: "CONFIRMED",
      isTemplate: false, rentalStartDate: NOW + 100 * DAY, rentalEndDate: NOW + 103 * DAY, createdAt: NOW, updatedAt: NOW,
      liveVersionId: "v-P_future",
    });
    await ctx.db.insert("projectVersions", { id: "v-P_future", organizationId: ORG, projectId: "P_future", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    await ctx.db.insert("projectLineItems", { id: "L_future", organizationId: ORG, projectId: "P_future", modelId: "mdl", status: "CONFIRMED", quantity: 50, type: "EQUIPMENT",
      versionId: "v-P_future",
      lineageId: "L_future",
    });

    // Sale stock (WS11 #950): a model with negative Model.saleStockQuantity
    // and NO project demand, plus a NEW_STOCK sale line that drew it down.
    await ctx.db.insert("models", { id: "mdl_sale", organizationId: ORG, name: "Gaffer Tape", saleStockQuantity: -4 });
    await ctx.db.insert("projects", {
      id: "P_sale", organizationId: ORG, projectNumber: "P-SALE", name: "Tape order", status: "CONFIRMED",
      isTemplate: false, createdAt: NOW, updatedAt: NOW,
      liveVersionId: "v-P_sale",
    });
    await ctx.db.insert("projectVersions", { id: "v-P_sale", organizationId: ORG, projectId: "P_sale", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    await ctx.db.insert("projectLineItems", {
      id: "L_sale", organizationId: ORG, projectId: "P_sale", modelId: "mdl_sale", status: "CONFIRMED",
      quantity: 4, type: "SALE", saleMode: "NEW_STOCK",
      versionId: "v-P_sale",
      lineageId: "L_sale",
    });

    // Services missing crew: crewCountRequired 2, only 1 CONFIRMED assignment (a
    // 2nd is DECLINED and must not count as filled).
    await ctx.db.insert("crewMembers", { id: "C1", organizationId: ORG, firstName: "Alex", lastName: "Roadie", isActive: true, status: "ACTIVE" });
    await ctx.db.insert("crewMembers", { id: "C2", organizationId: ORG, firstName: "Sam", lastName: "Rigger", isActive: true, status: "ACTIVE" });
    await ctx.db.insert("projectServices", {
      id: "S1", organizationId: ORG, projectId: "P1", type: "BUMP_IN", title: "Bump-in", date: NOW + 1 * DAY, crewCountRequired: 2,
      versionId: "v-P1",
      lineageId: "S1",
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
      liveVersionId: "v-P3",
    });
    await ctx.db.insert("projectVersions", { id: "v-P3", organizationId: ORG, projectId: "P3", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
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
    expect(result.saleStockToProcure[0].contributingSaleLines).toEqual([
      { lineItemId: "L_sale", projectId: "P_sale", projectName: "Tape order", projectNumber: "P-SALE", quantity: 4 },
    ]);

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

describe("overbookingBoard.dateMoveImpact (#1227, Q3)", () => {
  async function seedDateMove(t: T) {
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
      await ctx.db.insert("models", { id: "mdl", organizationId: ORG, name: "IMX6A", assetType: "SERIALIZED" });
      await ctx.db.insert("assets", { id: "A0", organizationId: ORG, modelId: "mdl", assetTag: "A-0", status: "AVAILABLE" });
      await ctx.db.insert("assets", { id: "A1", organizationId: ORG, modelId: "mdl", assetTag: "A-1", status: "AVAILABLE" });

      // P_target: CONFIRMED, currently day0-day5, books 2 of the 2-stock model —
      // fits fine where it is.
      await ctx.db.insert("projects", {
        id: "P_target", organizationId: ORG, projectNumber: "P-TARGET", name: "Job to move", status: "CONFIRMED",
        isTemplate: false, rentalStartDate: NOW, rentalEndDate: NOW + 5 * DAY, createdAt: NOW, updatedAt: NOW,
        liveVersionId: "v-target",
      });
      await ctx.db.insert("projectVersions", { id: "v-target", organizationId: ORG, projectId: "P_target", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      await ctx.db.insert("projectLineItems", {
        id: "L_target", organizationId: ORG, projectId: "P_target", modelId: "mdl", status: "CONFIRMED", quantity: 2, type: "EQUIPMENT",
        versionId: "v-target", lineageId: "L_target",
      });

      // P_other: CONFIRMED, day10-day15, ALSO books 2 of the same model — no
      // overlap with P_target's CURRENT window, so no conflict today.
      await ctx.db.insert("projects", {
        id: "P_other", organizationId: ORG, projectNumber: "P-OTHER", name: "Other job", status: "CONFIRMED",
        isTemplate: false, rentalStartDate: NOW + 10 * DAY, rentalEndDate: NOW + 15 * DAY, createdAt: NOW, updatedAt: NOW,
        liveVersionId: "v-other",
      });
      await ctx.db.insert("projectVersions", { id: "v-other", organizationId: ORG, projectId: "P_other", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      await ctx.db.insert("projectLineItems", {
        id: "L_other", organizationId: ORG, projectId: "P_other", modelId: "mdl", status: "CONFIRMED", quantity: 2, type: "EQUIPMENT",
        versionId: "v-other", lineageId: "L_other",
      });
    });
  }

  test("requires project:read permission", async () => {
    const t = makeT();
    await seedDateMove(t);
    await expect(
      t.query(api.overbookingBoard.dateMoveImpact, { orgId: ORG, projectId: "P_target", start: NOW, end: NOW + 5 * DAY }),
    ).rejects.toThrow();
  });

  test("no rows and windowMoved:false when the window hasn't actually moved", async () => {
    const t = makeT();
    await seedDateMove(t);
    const result = await t.withIdentity(asUser).query(api.overbookingBoard.dateMoveImpact, {
      orgId: ORG, projectId: "P_target", start: NOW, end: NOW + 5 * DAY,
    });
    expect(result).toEqual({ rows: [], windowMoved: false });
  });

  test("moving into P_other's window creates a hard shortage naming P_other", async () => {
    const t = makeT();
    await seedDateMove(t);
    const result = await t.withIdentity(asUser).query(api.overbookingBoard.dateMoveImpact, {
      orgId: ORG, projectId: "P_target", start: NOW + 10 * DAY, end: NOW + 15 * DAY,
    });
    expect(result.windowMoved).toBe(true);
    expect(result.rows).toHaveLength(1);
    // FCFS (2026-09): P_target's line was created FIRST (before P_other's, in
    // `seedDateMove`) and claims its 2 units against the 2-stock model —
    // fits. P_other's line, created second, is the one that gets stranded by
    // the move — exactly the "does this strand someone" signal the gate is
    // for, and it now names the specific job that would be hurt instead of
    // vaguely naming both.
    expect(result.rows[0]).toMatchObject({ modelId: "mdl", qty: 2 });
    expect(result.rows[0].projectNumbers).toEqual(["P-OTHER"]);
  });

  test("uses the project's REAL status, not a CONFIRMED simulation (unlike confirmImpact)", async () => {
    const t = makeT();
    await seedDateMove(t);
    // Demote P_target to QUOTED (pencilled, not hard) — moving it into
    // P_other's window should NOT report a hard shortage, since P_target's
    // own demand no longer counts as hard once it isn't confirmed-or-later.
    await t.run(async (ctx) => {
      const doc = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "P_target")).unique();
      await ctx.db.patch(doc!._id, { status: "QUOTED" });
    });
    const result = await t.withIdentity(asUser).query(api.overbookingBoard.dateMoveImpact, {
      orgId: ORG, projectId: "P_target", start: NOW + 10 * DAY, end: NOW + 15 * DAY,
    });
    // P_other alone (2 units, CONFIRMED) still fits within the 2-unit stock,
    // so there is no hard shortage once P_target's own demand is pencilled.
    expect(result.rows).toEqual([]);
  });

  test("rejects a caller whose token org doesn't match the requested orgId (IDOR)", async () => {
    const t = makeT();
    await seedDateMove(t);
    await expect(
      t.withIdentity({ subject: "user_2", orgId: "org_2" }).query(api.overbookingBoard.dateMoveImpact, {
        orgId: ORG, projectId: "P_target", start: NOW + 10 * DAY, end: NOW + 15 * DAY,
      }),
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
