// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";

// import.meta.glob typed via convex/import-meta-glob.d.ts (see convex/rbac.test.ts).
const modules = import.meta.glob("./**/*.ts");
// enforceBrowserWriteLimit (reconcileIfStale) calls the rate-limiter component for
// user tokens; mount it so those paths resolve in tests. Service-token calls no-op.
function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}
const ORG = "org_1";
const USER = "user_1";
const SERVICE = { subject: "gearflow-service", svc: true };
const asUser = (orgId: string) => ({ subject: USER, orgId });
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

async function seed(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "viewer" });

    // Assets: 2 active (1 checked out), 1 inactive (excluded), + 1 other-org.
    const asset = (id: string, org: string, status: string, isActive: boolean) =>
      ctx.db.insert("assets", { id, organizationId: org, modelId: "m1", assetTag: id, status, isActive });
    await asset("a1", ORG, "AVAILABLE", true);
    await asset("a2", ORG, "CHECKED_OUT", true);
    await asset("a3", ORG, "AVAILABLE", false);
    await asset("a4", "other", "CHECKED_OUT", true);

    // Bulk: active 10 + 5, inactive 99 (excluded).
    const bulk = (id: string, qty: number, isActive: boolean) =>
      ctx.db.insert("bulkAssets", { id, organizationId: ORG, modelId: "m1", assetTag: id, totalQuantity: qty, isActive });
    await bulk("b1", 10, true);
    await bulk("b2", 5, true);
    await bulk("b3", 99, false);

    // Projects: 2 active (CONFIRMED, ON_SITE), 1 template (excluded), 1 QUOTED (not active),
    // 1 overdue (CHECKED_OUT, past rentalEndDate) with a checked-out line item.
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "P1", status: "CONFIRMED", isTemplate: false });
    await ctx.db.insert("projects", { id: "p2", organizationId: ORG, projectNumber: "P2", name: "P2", status: "ON_SITE", isTemplate: false });
    await ctx.db.insert("projects", { id: "pt", organizationId: ORG, projectNumber: "PT", name: "PT", status: "CONFIRMED", isTemplate: true });
    await ctx.db.insert("projects", { id: "pq", organizationId: ORG, projectNumber: "PQ", name: "PQ", status: "QUOTED", isTemplate: false });
    await ctx.db.insert("projects", { id: "pov", organizationId: ORG, projectNumber: "POV", name: "POV", status: "CHECKED_OUT", isTemplate: false, rentalEndDate: NOW - DAY });

    // p2 + pov are active (ON_SITE / CHECKED_OUT). p1 active (CONFIRMED). pov also overdue.
    // overdueReturns: CHECKED_OUT line items in pov.
    await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "pov", status: "CHECKED_OUT", quantity: 1 });
    await ctx.db.insert("projectLineItems", { id: "li2", organizationId: ORG, projectId: "pov", status: "CHECKED_OUT", quantity: 1 });
    await ctx.db.insert("projectLineItems", { id: "li3", organizationId: ORG, projectId: "pov", status: "RETURNED", quantity: 1 }); // not counted
    await ctx.db.insert("projectLineItems", { id: "li4", organizationId: ORG, projectId: "p1", status: "CHECKED_OUT", quantity: 1 }); // p1 not overdue

    // Crew: 2 ACTIVE, 1 INACTIVE (excluded).
    const crew = (id: string, status: string) =>
      ctx.db.insert("crewMembers", { id, organizationId: ORG, firstName: id, lastName: "X", status });
    await crew("c1", "ACTIVE");
    await crew("c2", "ACTIVE");
    await crew("c3", "INACTIVE");

    // Assignments: OFFERED + PENDING counted, ACCEPTED not.
    const assign = (id: string, status: string) =>
      ctx.db.insert("crewAssignments", { id, organizationId: ORG, projectId: "p1", crewMemberId: "c1", status });
    await assign("ca1", "OFFERED");
    await assign("ca2", "PENDING");
    await assign("ca3", "ACCEPTED");

    // Maintenance: 1 due (SCHEDULED, past), 1 future (not due), 1 completed (excluded).
    const maint = (id: string, status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED", scheduledDate: number) =>
      ctx.db.insert("maintenanceRecords", { id, organizationId: ORG, title: id, type: "REPAIR", status, scheduledDate });
    await maint("mr1", "SCHEDULED", NOW - DAY);
    await maint("mr2", "IN_PROGRESS", NOW + DAY);
    await maint("mr3", "COMPLETED", NOW - DAY);
  });
}

describe("dashboardCounters", () => {
  test("reconcile computes the six counters from source", async () => {
    const t = makeT();
    await seed(t);
    const values = await t.withIdentity(SERVICE).mutation(api.dashboardCounters.reconcile, { orgId: ORG, now: NOW });
    expect(values).toEqual({
      activeAssets: 2, // a1, a2 (a3 inactive, a4 other-org)
      checkedOutAssets: 1, // a2
      bulkQuantity: 15, // 10 + 5 (b3 inactive)
      activeProjects: 3, // p1 CONFIRMED, p2 ON_SITE, pov CHECKED_OUT (pt template, pq QUOTED)
      activeCrew: 2,
      pendingCrewOffers: 2, // OFFERED + PENDING
    });
  });

  test("dashboardStats.bundle returns the 7 stats (counters + date-derived)", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(SERVICE).mutation(api.dashboardCounters.reconcile, { orgId: ORG, now: NOW });
    const stats = await t.withIdentity(asUser(ORG)).query(api.dashboardStats.bundle, { orgId: ORG, now: NOW });
    expect(stats).toMatchObject({
      totalAssets: 2 + 15, // activeAssets + bulkQuantity
      checkedOutAssets: 1,
      activeProjects: 3,
      activeCrew: 2,
      pendingCrewOffers: 2,
      maintenanceDue: 1, // mr1 (mr2 future, mr3 resolved)
      overdueReturns: 2, // li1 + li2 in pov (li3 returned, li4 in non-overdue p1)
      countersReady: true,
    });
  });

  test("bump adjusts a single field and clamps at 0", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(SERVICE).mutation(api.dashboardCounters.reconcile, { orgId: ORG, now: NOW });
    await t.withIdentity(SERVICE).mutation(api.dashboardCounters.bump, { orgId: ORG, field: "checkedOutAssets", delta: 1, now: NOW + 1 });
    let row = await t.withIdentity(asUser(ORG)).query(api.dashboardCounters.getByOrg, { orgId: ORG });
    expect(row?.checkedOutAssets).toBe(2);
    // Over-decrement clamps at 0.
    await t.withIdentity(SERVICE).mutation(api.dashboardCounters.bump, { orgId: ORG, field: "checkedOutAssets", delta: -10, now: NOW + 2 });
    row = await t.withIdentity(asUser(ORG)).query(api.dashboardCounters.getByOrg, { orgId: ORG });
    expect(row?.checkedOutAssets).toBe(0);
  });

  test("reconcileIfStale is a no-op while fresh, recomputes when stale", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(SERVICE).mutation(api.dashboardCounters.reconcile, { orgId: ORG, now: NOW });
    // Within maxAge → no-op.
    const fresh = await t.withIdentity(asUser(ORG)).mutation(api.dashboardCounters.reconcileIfStale, { orgId: ORG, now: NOW + 30_000, maxAgeMs: 60_000 });
    expect(fresh).toEqual({ reconciled: false });
    // Past maxAge → recompute.
    const stale = await t.withIdentity(asUser(ORG)).mutation(api.dashboardCounters.reconcileIfStale, { orgId: ORG, now: NOW + 120_000, maxAgeMs: 60_000 });
    expect(stale).toEqual({ reconciled: true });
  });

  test("dashboardStats denies a non-member", async () => {
    const t = makeT();
    await expect(
      t.withIdentity(asUser("other")).query(api.dashboardStats.bundle, { orgId: ORG, now: NOW }),
    ).rejects.toThrow();
  });

  // §3.6: the per-write in-transaction deltas (convex/lib/counters.ts, wired into
  // the generated + custom mutations) must keep the counter row EQUAL to the
  // authoritative reconcile recompute after an arbitrary sequence of writes.
  test("counters stay equal to the reconcile recompute after a write sequence", async () => {
    const t = makeT();
    await seed(t);
    const svc = t.withIdentity(SERVICE);
    // Backfill so the row exists — per-write deltas require it (an absent row is
    // left for reconcile to seed accurately; see the next test).
    await svc.mutation(api.dashboardCounters.reconcile, { orgId: ORG, now: NOW });

    // ── Assets ──
    await svc.mutation(api.assets.create, { id: "a5", organizationId: ORG, modelId: "m1", assetTag: "a5", status: "CHECKED_OUT", isActive: true }); // +active +checkedOut
    await svc.mutation(api.assets.patchAsset, { id: "a1", set: { status: "CHECKED_OUT" }, clear: [] }); // AVAILABLE→CHECKED_OUT: +checkedOut
    await svc.mutation(api.assets.patchAsset, { id: "a2", set: { isActive: false }, clear: [] }); // active checked-out → inactive: -active -checkedOut
    await svc.mutation(api.assets.remove, { id: "a5" }); // -active -checkedOut

    // ── Bulk ──
    await svc.mutation(api.bulkAssets.create, { id: "b4", organizationId: ORG, modelId: "m1", assetTag: "b4", totalQuantity: 20, isActive: true }); // +20
    await svc.mutation(api.bulkAssets.patchBulkAsset, { id: "b1", set: { totalQuantity: 7 }, clear: [] }); // 10→7: -3
    await svc.mutation(api.bulkAssets.patchBulkAsset, { id: "b2", set: { isActive: false }, clear: [] }); // active 5 → inactive: -5

    // ── Projects ──
    await svc.mutation(api.projects.createWithUniqueNumber, { id: "p5", organizationId: ORG, projectNumber: "P5", name: "P5", status: "PREPPING", isTemplate: false }); // +active
    await svc.mutation(api.projects.patchProject, { id: "p1", set: { status: "QUOTED" }, clear: [] }); // CONFIRMED→QUOTED: -active
    await svc.mutation(api.projects.remove, { id: "pov" }); // active CHECKED_OUT: -active

    // ── Crew ──
    await svc.mutation(api.crewMembers.create, { id: "c4", organizationId: ORG, firstName: "c4", lastName: "X", status: "ACTIVE" }); // +active
    await svc.mutation(api.crewMembers.patchMember, { id: "c1", set: { status: "INACTIVE" } }); // -active

    // ── Assignments ──
    await svc.mutation(api.crewAssignments.create, { id: "ca4", organizationId: ORG, projectId: "p2", crewMemberId: "c2", status: "OFFERED" }); // +pending
    await svc.mutation(api.crewAssignments.patchAssignment, { id: "ca1", set: { status: "ACCEPTED" } }); // OFFERED→ACCEPTED: -pending
    await svc.mutation(api.crewAssignments.deleteCascade, { id: "ca2" }); // PENDING: -pending

    // Row as maintained by the per-write deltas.
    const maintained = await t.withIdentity(asUser(ORG)).query(api.dashboardCounters.getByOrg, { orgId: ORG });
    // Authoritative recompute from source — must match the maintained values exactly.
    const recomputed = await svc.mutation(api.dashboardCounters.reconcile, { orgId: ORG, now: NOW + 1 });

    expect({
      activeAssets: maintained?.activeAssets,
      checkedOutAssets: maintained?.checkedOutAssets,
      bulkQuantity: maintained?.bulkQuantity,
      activeProjects: maintained?.activeProjects,
      activeCrew: maintained?.activeCrew,
      pendingCrewOffers: maintained?.pendingCrewOffers,
    }).toEqual(recomputed);
  });

  test("a per-write delta against a not-yet-backfilled org is skipped (reconcile seeds it)", async () => {
    const t = makeT();
    await seed(t);
    const svc = t.withIdentity(SERVICE);
    // No reconcile yet → row absent. A counted write must NOT create a partial row
    // (a delta can't reconstruct the pre-existing population).
    await svc.mutation(api.assets.create, { id: "a9", organizationId: ORG, modelId: "m1", assetTag: "a9", status: "AVAILABLE", isActive: true });
    const before = await t.withIdentity(asUser(ORG)).query(api.dashboardCounters.getByOrg, { orgId: ORG });
    expect(before).toBeNull();
    // First reconcile creates it accurately (includes a9 → a1, a2, a9 active).
    const values = await svc.mutation(api.dashboardCounters.reconcile, { orgId: ORG, now: NOW });
    expect(values.activeAssets).toBe(3);
  });
});
