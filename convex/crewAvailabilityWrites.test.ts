// @vitest-environment node
//
// convex/crewAvailabilityWrites.ts + convex/crewAvailability.ts (memberAvailability /
// conflicts / plannerData). Verifies the member org-scoping on writes, RBAC (crew:update),
// the availability read + range filter, conflict detection (availability block + overlapping
// assignment), and the planner grid (active members, planner-filtered assignments).
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const DAY = 86_400_000;
const T0 = 1_700_000_000_000;
const actor = { userId: USER, userName: "Alice" };
const asUser = { subject: USER, orgId: ORG, role: "admin" };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}
async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "admin" });
    await ctx.db.insert("crewMembers", { id: "cm1", organizationId: ORG, firstName: "Bo", lastName: "Crew", status: "ACTIVE", isActive: true });
  });
}
const avails = (t: T) => t.run(async (ctx) => ctx.db.query("crewAvailabilities").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect());

describe("crewAvailabilityWrites", () => {
  test("add validates the member's org + inserts; remove is member-org-scoped", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asUser).mutation(api.crewAvailabilityWrites.addNative, { id: "av1", orgId: ORG, crewMemberId: "cm1", startDate: T0, endDate: T0 + DAY, type: "UNAVAILABLE", isAllDay: true, now: T0, actor, auditId: "a1" });
    expect((await avails(t)).map((r) => r.id)).toEqual(["av1"]);
    await t.withIdentity(asUser).mutation(api.crewAvailabilityWrites.removeNative, { id: "av1", orgId: ORG, now: T0, actor });
    expect(await avails(t)).toHaveLength(0);
  });

  test("add rejects a crew member in another org", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { await ctx.db.insert("crewMembers", { id: "cmX", organizationId: OTHER, firstName: "X", lastName: "Y", status: "ACTIVE" }); });
    await expect(t.withIdentity(asUser).mutation(api.crewAvailabilityWrites.addNative, { id: "av1", orgId: ORG, crewMemberId: "cmX", startDate: T0, endDate: T0 + DAY, type: "UNAVAILABLE", isAllDay: true, now: T0, actor, auditId: "a1" })).rejects.toThrow(/Crew member not found/i);
  });

  // R-8.6.2 — a direct-mutation caller (bypassing crewAvailabilitySchema.parse() in the
  // browser hook) must still hit the same business-constraint bounds server-side.
  test("add rejects a reason over the 500-char bound", async () => {
    const t = makeT(); await seed(t);
    await expect(
      t.withIdentity(asUser).mutation(api.crewAvailabilityWrites.addNative, { id: "av1", orgId: ORG, crewMemberId: "cm1", startDate: T0, endDate: T0 + DAY, type: "UNAVAILABLE", isAllDay: true, reason: "x".repeat(501), now: T0, actor, auditId: "a1" }),
    ).rejects.toThrow(/reason/);
  });

  test("add rejects a blank crewMemberId", async () => {
    const t = makeT(); await seed(t);
    await expect(
      t.withIdentity(asUser).mutation(api.crewAvailabilityWrites.addNative, { id: "av1", orgId: ORG, crewMemberId: "", startDate: T0, endDate: T0 + DAY, type: "UNAVAILABLE", isAllDay: true, now: T0, actor, auditId: "a1" }),
    ).rejects.toThrow(/crewMemberId/);
  });

  test("RBAC: a viewer is rejected", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { const m = await ctx.db.query("members").withIndex("by_cuid", (q) => q.eq("id", "m1")).first(); if (m) await ctx.db.patch(m._id, { role: "viewer" }); });
    await expect(t.withIdentity({ subject: USER, orgId: ORG, role: "viewer" }).mutation(api.crewAvailabilityWrites.addNative, { id: "av1", orgId: ORG, crewMemberId: "cm1", startDate: T0, endDate: T0 + DAY, type: "UNAVAILABLE", isAllDay: true, now: T0, actor, auditId: "a1" })).rejects.toThrow(/Forbidden|permission/i);
  });
});

describe("crewAvailability reads", () => {
  test("memberAvailability returns records in range, startDate-asc, ISO dates", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("crewAvailabilities", { id: "b", organizationId: ORG, crewMemberId: "cm1", startDate: T0 + 2 * DAY, endDate: T0 + 3 * DAY, type: "TENTATIVE" });
      await ctx.db.insert("crewAvailabilities", { id: "a", organizationId: ORG, crewMemberId: "cm1", startDate: T0, endDate: T0 + DAY, type: "UNAVAILABLE" });
      await ctx.db.insert("crewAvailabilities", { id: "far", organizationId: ORG, crewMemberId: "cm1", startDate: T0 + 30 * DAY, endDate: T0 + 31 * DAY, type: "UNAVAILABLE" });
    });
    const res = await t.withIdentity(asUser).query(api.crewAvailability.memberAvailability, { orgId: ORG, crewMemberId: "cm1", startMs: T0, endMs: T0 + 5 * DAY });
    expect(res.map((r) => r.id)).toEqual(["a", "b"]); // "far" out of range, sorted asc
    expect(res[0].startDate).toBe(new Date(T0).toISOString());
  });

  test("conflicts reports a hard availability block + a soft overlapping assignment", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("crewAvailabilities", { id: "b1", organizationId: ORG, crewMemberId: "cm1", startDate: T0, endDate: T0 + DAY, type: "UNAVAILABLE", reason: "Leave" });
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false, createdAt: T0, updatedAt: T0 });
      await ctx.db.insert("crewAssignments", { id: "as1", organizationId: ORG, crewMemberId: "cm1", projectId: "p1", status: "CONFIRMED", startDate: T0, endDate: T0 + DAY });
      await ctx.db.insert("crewAssignments", { id: "asDecl", organizationId: ORG, crewMemberId: "cm1", projectId: "p1", status: "DECLINED", startDate: T0, endDate: T0 + DAY });
    });
    const res = await t.withIdentity(asUser).query(api.crewAvailability.conflicts, { orgId: ORG, crewMemberId: "cm1", startMs: T0, endMs: T0 + DAY });
    expect(res.filter((c) => c.type === "availability")).toHaveLength(1);
    expect(res.find((c) => c.type === "availability")?.severity).toBe("hard");
    expect(res.filter((c) => c.type === "assignment")).toHaveLength(1); // DECLINED excluded
    expect(res.find((c) => c.type === "assignment")?.label).toContain("P1");
  });

  test("plannerData lists active members with planner-filtered assignments + availability", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("crewMembers", { id: "cmArch", organizationId: ORG, firstName: "Old", lastName: "Gone", status: "ARCHIVED", isActive: false });
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false, createdAt: T0, updatedAt: T0 });
      await ctx.db.insert("crewAssignments", { id: "as1", organizationId: ORG, crewMemberId: "cm1", projectId: "p1", status: "CONFIRMED", startDate: T0, endDate: T0 + DAY });
      await ctx.db.insert("crewAssignments", { id: "asCanc", organizationId: ORG, crewMemberId: "cm1", projectId: "p1", status: "CANCELLED", startDate: T0, endDate: T0 + DAY });
      await ctx.db.insert("crewAvailabilities", { id: "av1", organizationId: ORG, crewMemberId: "cm1", startDate: T0, endDate: T0 + DAY, type: "UNAVAILABLE" });
    });
    const res = await t.withIdentity(asUser).query(api.crewAvailability.plannerData, { orgId: ORG, startMs: T0, endMs: T0 + 5 * DAY });
    expect(res.map((m) => m.id)).toEqual(["cm1"]); // ARCHIVED excluded
    expect(res[0].assignments.map((a) => a.id)).toEqual(["as1"]); // CANCELLED excluded
    expect(res[0].assignments[0].project?.projectNumber).toBe("P1");
    expect(res[0].availability).toHaveLength(1);
  });
});
