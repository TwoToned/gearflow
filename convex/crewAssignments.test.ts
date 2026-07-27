// @vitest-environment node
//
// convex/crewAssignments.ts — WS8 (#947): membersForAssignment's new range-branch
// wiring (excludeServiceId, severity, availability, index-bounded reads) +
// conflictsForProject (the crew table's sibling batched query). Both reuse
// computeMemberConflictSignal (unit-tested in convex/lib/crewConflicts.test.ts) —
// these tests focus on the Convex wiring: org isolation, index bounds, argument
// plumbing.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1", OTHER_ORG = "org_2", USER = "user_1";
const T0 = 1_700_000_000_000;
const DAY = 86_400_000;
const asUser = { subject: USER, orgId: ORG, role: "admin" };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

async function seedBase(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "admin" });
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Home Gig", status: "QUOTED", isTemplate: false });
    await ctx.db.insert("projects", { id: "p2", organizationId: ORG, projectNumber: "P2", name: "Other Gig", status: "CONFIRMED", isTemplate: false });
    await ctx.db.insert("crewMembers", { id: "cm1", organizationId: ORG, firstName: "Bob", lastName: "Ryan", isActive: true, status: "ACTIVE" });
  });
}

describe("membersForAssignment — range branch (WS8 #947)", () => {
  test("no rangeStartMs/rangeEndMs → no-op shape (conflicts:[], availability:'available')", async () => {
    const t = makeT(); await seedBase(t);
    const res = await t.withIdentity(asUser).query(api.crewAssignments.membersForAssignment, { projectId: "p1", orgId: ORG });
    expect(res).toEqual([
      expect.objectContaining({ id: "cm1", conflicts: [], isUnavailable: false, availability: "available", hasPreferredBlock: false }),
    ]);
  });

  test("cross-project CONFIRMED assignment → hard 'Booked:' conflict; PENDING → soft 'Pencilled:'", async () => {
    const t = makeT(); await seedBase(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("crewAssignments", { id: "a1", organizationId: ORG, projectId: "p2", crewMemberId: "cm1", status: "CONFIRMED", startDate: T0, endDate: T0 + DAY });
    });
    const res = await t.withIdentity(asUser).query(api.crewAssignments.membersForAssignment, { projectId: "p1", orgId: ORG, rangeStartMs: T0, rangeEndMs: T0 + DAY });
    expect(res[0].conflicts).toEqual([expect.objectContaining({ severity: "hard", label: "Booked: P2 - Other Gig", projectId: "p2" })]);
    expect(res[0].availability).toBe("busy");

    await t.run(async (ctx) => {
      const a = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", "a1")).unique();
      if (a) await ctx.db.patch(a._id, { status: "PENDING" });
    });
    const res2 = await t.withIdentity(asUser).query(api.crewAssignments.membersForAssignment, { projectId: "p1", orgId: ORG, rangeStartMs: T0, rangeEndMs: T0 + DAY });
    expect(res2[0].conflicts[0]).toMatchObject({ severity: "soft", label: "Pencilled: P2 - Other Gig" });
  });

  test("excludeServiceId hides that service's own assignment but surfaces a DIFFERENT service on the SAME project", async () => {
    const t = makeT(); await seedBase(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("crewAssignments", { id: "aSelf", organizationId: ORG, projectId: "p1", crewMemberId: "cm1", serviceId: "svc-self", status: "CONFIRMED", startDate: T0, endDate: T0 + DAY });
      await ctx.db.insert("crewAssignments", { id: "aOther", organizationId: ORG, projectId: "p1", crewMemberId: "cm1", serviceId: "svc-other", status: "PENDING", startDate: T0, endDate: T0 + DAY });
    });
    const withExclude = await t.withIdentity(asUser).query(api.crewAssignments.membersForAssignment, {
      projectId: "p1", orgId: ORG, rangeStartMs: T0, rangeEndMs: T0 + DAY, excludeServiceId: "svc-self",
    });
    expect(withExclude[0].conflicts).toHaveLength(1);
    expect(withExclude[0].conflicts[0]).toMatchObject({ severity: "soft" }); // only "aOther" (PENDING) surfaces

    const withoutExclude = await t.withIdentity(asUser).query(api.crewAssignments.membersForAssignment, {
      projectId: "p1", orgId: ORG, rangeStartMs: T0, rangeEndMs: T0 + DAY,
    });
    expect(withoutExclude[0].conflicts).toHaveLength(2); // no exclusion — both surface
  });

  test("TENTATIVE availability block surfaces as availability:'tentative'; UNAVAILABLE wins over a CONFIRMED assignment", async () => {
    const t = makeT(); await seedBase(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("crewAvailabilities", { id: "av1", organizationId: ORG, crewMemberId: "cm1", startDate: T0, endDate: T0 + DAY, type: "TENTATIVE" });
    });
    const res = await t.withIdentity(asUser).query(api.crewAssignments.membersForAssignment, { projectId: "p1", orgId: ORG, rangeStartMs: T0, rangeEndMs: T0 + DAY });
    expect(res[0].availability).toBe("tentative");
    expect(res[0].isUnavailable).toBe(false);

    await t.run(async (ctx) => {
      const av = await ctx.db.query("crewAvailabilities").withIndex("by_cuid", (q) => q.eq("id", "av1")).unique();
      if (av) await ctx.db.patch(av._id, { type: "UNAVAILABLE" });
      await ctx.db.insert("crewAssignments", { id: "a1", organizationId: ORG, projectId: "p2", crewMemberId: "cm1", status: "CONFIRMED", startDate: T0, endDate: T0 + DAY });
    });
    const res2 = await t.withIdentity(asUser).query(api.crewAssignments.membersForAssignment, { projectId: "p1", orgId: ORG, rangeStartMs: T0, rangeEndMs: T0 + DAY });
    expect(res2[0].availability).toBe("unavailable");
    expect(res2[0].isUnavailable).toBe(true);
  });

  test("index-bounded read: a multi-day assignment STARTING before the window but overlapping it is still caught (no false negative)", async () => {
    const t = makeT(); await seedBase(t);
    await t.run(async (ctx) => {
      // Starts 5 days before the range, ends 1 day into it — startDate < rangeStart,
      // but the assignment genuinely overlaps [T0, T0+DAY]. Proves the deliberately
      // one-sided `.lte("startDate", rangeEndMs)` bound (no matching `.gte`) doesn't
      // silently drop this real conflict.
      await ctx.db.insert("crewAssignments", { id: "aLong", organizationId: ORG, projectId: "p2", crewMemberId: "cm1", status: "CONFIRMED", startDate: T0 - 5 * DAY, endDate: T0 + DAY });
    });
    const res = await t.withIdentity(asUser).query(api.crewAssignments.membersForAssignment, { projectId: "p1", orgId: ORG, rangeStartMs: T0, rangeEndMs: T0 + DAY });
    expect(res[0].conflicts).toHaveLength(1);
  });

  test("an assignment starting after the window is excluded (can never overlap — correct, not just index noise)", async () => {
    const t = makeT(); await seedBase(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("crewAssignments", { id: "aFuture", organizationId: ORG, projectId: "p2", crewMemberId: "cm1", status: "CONFIRMED", startDate: T0 + 10 * DAY, endDate: T0 + 11 * DAY });
    });
    const res = await t.withIdentity(asUser).query(api.crewAssignments.membersForAssignment, { projectId: "p1", orgId: ORG, rangeStartMs: T0, rangeEndMs: T0 + DAY });
    expect(res[0].conflicts).toEqual([]);
  });

  test("cross-tenant: another org's assignment on the same crew-member id string never leaks in", async () => {
    const t = makeT(); await seedBase(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "pX", organizationId: OTHER_ORG, projectNumber: "PX", name: "Foreign", status: "CONFIRMED", isTemplate: false });
      await ctx.db.insert("crewAssignments", { id: "aX", organizationId: OTHER_ORG, projectId: "pX", crewMemberId: "cm1", status: "CONFIRMED", startDate: T0, endDate: T0 + DAY });
    });
    const res = await t.withIdentity(asUser).query(api.crewAssignments.membersForAssignment, { projectId: "p1", orgId: ORG, rangeStartMs: T0, rangeEndMs: T0 + DAY });
    expect(res[0].conflicts).toEqual([]);
  });
});

describe("conflictsForProject (crew table sibling query, WS8 #947)", () => {
  test("flags a CONFIRMED cross-project double-book as hard, a PENDING one as soft, and skips dateless rows", async () => {
    const t = makeT(); await seedBase(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("crewMembers", { id: "cm2", organizationId: ORG, firstName: "Amy", lastName: "Lee", isActive: true, status: "ACTIVE" });
      // cm1 double-booked hard on p1 vs p2
      await ctx.db.insert("crewAssignments", { id: "aHome", organizationId: ORG, projectId: "p1", crewMemberId: "cm1", status: "CONFIRMED", startDate: T0, endDate: T0 + DAY });
      await ctx.db.insert("crewAssignments", { id: "aAway", organizationId: ORG, projectId: "p2", crewMemberId: "cm1", status: "CONFIRMED", startDate: T0, endDate: T0 + DAY });
      // cm2 double-booked soft (PENDING elsewhere)
      await ctx.db.insert("crewAssignments", { id: "bHome", organizationId: ORG, projectId: "p1", crewMemberId: "cm2", status: "CONFIRMED", startDate: T0, endDate: T0 + DAY });
      await ctx.db.insert("crewAssignments", { id: "bAway", organizationId: ORG, projectId: "p2", crewMemberId: "cm2", status: "PENDING", startDate: T0, endDate: T0 + DAY });
      // dateless row on p1 — must be skipped, not crash
      await ctx.db.insert("crewAssignments", { id: "cNoDate", organizationId: ORG, projectId: "p1", crewMemberId: "cm2", status: "PENDING" });
    });
    const res = await t.withIdentity(asUser).query(api.crewAssignments.conflictsForProject, { projectId: "p1", orgId: ORG, rangeStartMs: T0, rangeEndMs: T0 + DAY });
    expect(res.aHome).toMatchObject({ severity: "hard" });
    expect(res.bHome).toMatchObject({ severity: "soft" });
    expect(res.cNoDate).toBeUndefined();
  });

  test("a different SERVICE on the same project surfaces (excludeServiceId is per-row, keyed off that row's own serviceId)", async () => {
    const t = makeT(); await seedBase(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("crewAssignments", { id: "svcA", organizationId: ORG, projectId: "p1", crewMemberId: "cm1", serviceId: "svc-a", status: "CONFIRMED", startDate: T0, endDate: T0 + DAY });
      await ctx.db.insert("crewAssignments", { id: "svcB", organizationId: ORG, projectId: "p1", crewMemberId: "cm1", serviceId: "svc-b", status: "PENDING", startDate: T0, endDate: T0 + DAY });
    });
    const res = await t.withIdentity(asUser).query(api.crewAssignments.conflictsForProject, { projectId: "p1", orgId: ORG, rangeStartMs: T0, rangeEndMs: T0 + DAY });
    expect(res.svcA).toMatchObject({ severity: "soft" }); // conflicts with svcB's PENDING row
    expect(res.svcB).toMatchObject({ severity: "hard" }); // conflicts with svcA's CONFIRMED row
  });

  test("no conflicting data → row is simply absent from the map (not a false 'no conflict' entry)", async () => {
    const t = makeT(); await seedBase(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("crewAssignments", { id: "aSolo", organizationId: ORG, projectId: "p1", crewMemberId: "cm1", status: "CONFIRMED", startDate: T0, endDate: T0 + DAY });
    });
    const res = await t.withIdentity(asUser).query(api.crewAssignments.conflictsForProject, { projectId: "p1", orgId: ORG, rangeStartMs: T0, rangeEndMs: T0 + DAY });
    expect(res.aSolo).toBeUndefined();
  });
});
