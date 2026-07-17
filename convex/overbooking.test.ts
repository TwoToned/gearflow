// @vitest-environment node
//
// convex/overbooking.ts `bundle` — verifies the SCOPED read path (thisProjectId +
// rentalStartDate/rentalEndDate, added to fix the Phase 0 finding that this query
// was an unbounded all-time `by_modelId` scan — 77% of the org's measured monthly
// Database I/O, docs/designs/perf-convex-efficiency-2026-06.md) produces the SAME
// `reconstructOverbookedStatus` result as the pre-existing UNSCOPED path (no
// thisProjectId — the expand-contract fallback for callers on the previous app
// build). Ship-blocker parity test, same convention as availabilityCore.test.ts /
// reservationConflicts.test.ts.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import {
  reconstructOverbookedStatus,
  relevantOverbookModelIds,
  type OverbookLineItem,
} from "@/lib/overbooking-core";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const asUser = { subject: USER, orgId: ORG };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

/**
 * P1 = the project under inspection (window NOW..NOW+5d), 2 units of model `mdl`
 * booked. Overlapping/conflicting/irrelevant projects around it:
 *  - P2 overlaps P1's window, CONFIRMED, books 3 more units of `mdl` (counts).
 *  - P3 overlaps P1's window but is CANCELLED (must NOT count — dead status).
 *  - P4 does NOT overlap P1's window (starts 30 days later) — must NOT count.
 *  - P5 is a much older, long-settled booking of the SAME popular model, far in
 *    the past and RETURNED — the exact shape of the unbounded-scan problem. Must
 *    NOT count and must not even reach the scoped candidate walk.
 */
async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("models", { id: "mdl", organizationId: ORG, name: "IMX6A" });
    for (let i = 0; i < 5; i++) {
      await ctx.db.insert("assets", { id: `A${i}`, organizationId: ORG, modelId: "mdl", assetTag: `A-${i}`, status: "AVAILABLE" });
    }
    await ctx.db.insert("projects", {
      id: "P1", organizationId: ORG, projectNumber: "P1", name: "Under inspection", status: "CONFIRMED",
      isTemplate: false, rentalStartDate: NOW, rentalEndDate: NOW + 5 * DAY, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projects", {
      id: "P2", organizationId: ORG, projectNumber: "P2", name: "Overlapping", status: "CONFIRMED",
      isTemplate: false, rentalStartDate: NOW + 1 * DAY, rentalEndDate: NOW + 3 * DAY, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projects", {
      id: "P3", organizationId: ORG, projectNumber: "P3", name: "Overlapping but cancelled", status: "CANCELLED",
      isTemplate: false, rentalStartDate: NOW + 1 * DAY, rentalEndDate: NOW + 3 * DAY, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projects", {
      id: "P4", organizationId: ORG, projectNumber: "P4", name: "Non-overlapping", status: "CONFIRMED",
      isTemplate: false, rentalStartDate: NOW + 30 * DAY, rentalEndDate: NOW + 33 * DAY, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projects", {
      id: "P5", organizationId: ORG, projectNumber: "P5", name: "Ancient history", status: "RETURNED",
      isTemplate: false, rentalStartDate: NOW - 400 * DAY, rentalEndDate: NOW - 395 * DAY, createdAt: NOW, updatedAt: NOW,
    });

    await ctx.db.insert("projectLineItems", { id: "L1", organizationId: ORG, projectId: "P1", modelId: "mdl", status: "CONFIRMED", quantity: 2, type: "EQUIPMENT" });
    await ctx.db.insert("projectLineItems", { id: "L2", organizationId: ORG, projectId: "P2", modelId: "mdl", status: "CONFIRMED", quantity: 3, type: "EQUIPMENT" });
    await ctx.db.insert("projectLineItems", { id: "L3", organizationId: ORG, projectId: "P3", modelId: "mdl", status: "CONFIRMED", quantity: 3, type: "EQUIPMENT" });
    await ctx.db.insert("projectLineItems", { id: "L4", organizationId: ORG, projectId: "P4", modelId: "mdl", status: "CONFIRMED", quantity: 3, type: "EQUIPMENT" });
    await ctx.db.insert("projectLineItems", { id: "L5", organizationId: ORG, projectId: "P5", modelId: "mdl", status: "CONFIRMED", quantity: 3, type: "EQUIPMENT" });
  });
}

const p1LineItems: OverbookLineItem[] = [
  { id: "L1", modelId: "mdl", quantity: 2, isKitChild: false, parentLineItemId: null, kitId: null, status: "CONFIRMED" },
];

describe("overbooking.bundle — scoped vs unscoped parity", () => {
  test("reconstructOverbookedStatus is identical whether the bundle is scoped or unscoped", async () => {
    const t = makeT();
    await seed(t);
    const modelIds = relevantOverbookModelIds(p1LineItems);

    const unscoped = await t.withIdentity(asUser).query(api.overbooking.bundle, { orgId: ORG, modelIds });
    const scoped = await t.withIdentity(asUser).query(api.overbooking.bundle, {
      orgId: ORG,
      modelIds,
      thisProjectId: "P1",
      rentalStartDate: NOW,
      rentalEndDate: NOW + 5 * DAY,
    });

    const rStart = new Date(NOW);
    const rEnd = new Date(NOW + 5 * DAY);
    const unscopedResult = reconstructOverbookedStatus(unscoped, p1LineItems, rStart, rEnd, "P1");
    const scopedResult = reconstructOverbookedStatus(scoped, p1LineItems, rStart, rEnd, "P1");

    expect(scopedResult).toEqual(unscopedResult);
    // 5 total stock, 2 (P1) + 3 (P2) booked = 5, not over. Sanity-check the fixture
    // actually exercises "counts P2, excludes P3/P4/P5" rather than vacuously passing.
    expect(scopedResult.size).toBe(0);
  });

  test("scoped bundle excludes the cancelled/non-overlapping/ancient projects' line items", async () => {
    const t = makeT();
    await seed(t);
    const scoped = await t.withIdentity(asUser).query(api.overbooking.bundle, {
      orgId: ORG,
      modelIds: ["mdl"],
      thisProjectId: "P1",
      rentalStartDate: NOW,
      rentalEndDate: NOW + 5 * DAY,
    });
    const projectIdsInBundle = new Set(scoped.lineItems.map((li) => li.projectId));
    expect(projectIdsInBundle).toEqual(new Set(["P1", "P2"]));
  });

  test("scoped bundle with an over-capacity booking still flags overbooking (regression guard)", async () => {
    const t = makeT();
    await seed(t);
    // Push P2's booking up so total demand (2 + 6 = 8) exceeds the 5-asset stock.
    await t.run(async (ctx) => {
      const l2 = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "L2")).unique();
      if (l2) await ctx.db.patch(l2._id, { quantity: 6 });
    });
    const modelIds = relevantOverbookModelIds(p1LineItems);
    const scoped = await t.withIdentity(asUser).query(api.overbooking.bundle, {
      orgId: ORG,
      modelIds,
      thisProjectId: "P1",
      rentalStartDate: NOW,
      rentalEndDate: NOW + 5 * DAY,
    });
    const result = reconstructOverbookedStatus(scoped, p1LineItems, new Date(NOW), new Date(NOW + 5 * DAY), "P1");
    expect(result.get("L1")?.overBy).toBe(3); // 8 booked - 5 stock
  });

  test("dateless project (no rental window) scopes to only its own bookings, no org-wide read", async () => {
    const t = makeT();
    await seed(t);
    const scoped = await t.withIdentity(asUser).query(api.overbooking.bundle, {
      orgId: ORG,
      modelIds: ["mdl"],
      thisProjectId: "P1",
      // rentalStartDate/rentalEndDate omitted — mirrors a dateless project.
    });
    expect(new Set(scoped.lineItems.map((li) => li.projectId))).toEqual(new Set(["P1"]));
  });
});
