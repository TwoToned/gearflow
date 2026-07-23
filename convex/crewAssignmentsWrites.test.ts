// @vitest-environment node
//
// convex/crewAssignmentsWrites.ts + convex/crewAssignments.ts (projectCrew/
// projectLabourCost/membersForAssignment). Verifies the rate cascade, CONFIRMED stamp,
// shift generation, cascade delete, bulk ops, cross-tenant + RBAC, and the reads.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1", OTHER = "org_2", USER = "user_1", NOW = 1_700_000_000_000;
const DAY = 86400000;
const actor = { userId: USER, userName: "Alice" };
const asUser = { subject: USER, orgId: ORG, role: "admin" };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "admin" });
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false });
    await ctx.db.insert("crewMembers", { id: "c1", organizationId: ORG, firstName: "Bob", lastName: "Ryan", defaultDayRate: 500, isActive: true });
    await ctx.db.insert("crewRoles", { id: "r1", organizationId: ORG, name: "Rigger", defaultRate: 400, rateType: "DAILY" });
  });
}
const asg = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const base = { id: "a1", orgId: ORG, projectId: "p1", crewMemberId: "c1", status: "PENDING" as const, isProjectManager: false, now: NOW, actor, auditId: "log1" };

describe("crewAssignmentsWrites", () => {
  test("create: rate cascade (member day rate) + estimatedCost over 3 days + shift gen + audit", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asUser).mutation(api.crewAssignmentsWrites.createNative, {
      ...base, startDate: NOW, endDate: NOW + 2 * DAY, generateShifts: true,
    });
    const a = await asg(t, "a1");
    expect(a?.estimatedCost).toBe(1500); // 500/day × 3 days
    const shifts = await t.run(async (ctx) => ctx.db.query("crewShifts").withIndex("by_assignmentId", (q) => q.eq("assignmentId", "a1")).collect());
    expect(shifts).toHaveLength(3);
    const log = await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first());
    expect(log?.action).toBe("CREATE");
  });

  test("create: rateOverride wins; role rate is the last fallback", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asUser).mutation(api.crewAssignmentsWrites.createNative, { ...base, rateOverride: 999, rateType: "FLAT" });
    expect((await asg(t, "a1"))?.estimatedCost).toBe(999); // FLAT override
    // member with no rates → role default
    await t.run(async (ctx) => { const m = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", "c1")).first(); if (m) await ctx.db.patch(m._id, { defaultDayRate: undefined }); });
    await t.withIdentity(asUser).mutation(api.crewAssignmentsWrites.createNative, { ...base, id: "a2", crewRoleId: "r1", startDate: NOW, endDate: NOW, auditId: "l2" });
    expect((await asg(t, "a2"))?.estimatedCost).toBe(400); // role 400/day × 1
  });

  test("updateStatus + update stamp confirmedAt/confirmedById on first CONFIRMED edge only", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asUser).mutation(api.crewAssignmentsWrites.createNative, base);
    await t.withIdentity(asUser).mutation(api.crewAssignmentsWrites.updateStatusNative, { id: "a1", orgId: ORG, status: "CONFIRMED", now: NOW + 10, actor, auditId: "l2" });
    const a = await asg(t, "a1");
    expect(a?.status).toBe("CONFIRMED");
    expect(a?.confirmedAt).toBe(NOW + 10);
    expect(a?.confirmedById).toBe(USER);
    // second confirm doesn't re-stamp
    await t.withIdentity(asUser).mutation(api.crewAssignmentsWrites.updateStatusNative, { id: "a1", orgId: ORG, status: "CONFIRMED", now: NOW + 20, actor, auditId: "l3" });
    expect((await asg(t, "a1"))?.confirmedAt).toBe(NOW + 10); // unchanged
  });

  test("delete cascades shifts + linked time entries (org-filtered)", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asUser).mutation(api.crewAssignmentsWrites.createNative, { ...base, startDate: NOW, endDate: NOW, generateShifts: true });
    await t.run(async (ctx) => {
      await ctx.db.insert("crewTimeEntries", { id: "te1", organizationId: ORG, crewMemberId: "c1", assignmentId: "a1", date: NOW, startTime: "09:00", endTime: "17:00" });
    });
    await t.withIdentity(asUser).mutation(api.crewAssignmentsWrites.deleteNative, { id: "a1", orgId: ORG, now: NOW, actor, auditId: "l2" });
    expect(await asg(t, "a1")).toBeNull();
    expect(await t.run(async (ctx) => ctx.db.query("crewShifts").withIndex("by_assignmentId", (q) => q.eq("assignmentId", "a1")).collect())).toHaveLength(0);
    expect(await t.run(async (ctx) => ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", "te1")).first())).toBeNull();
  });

  test("bulkDelete + bulkStatus (org re-check skips foreign)", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asUser).mutation(api.crewAssignmentsWrites.createNative, base);
    await t.withIdentity(asUser).mutation(api.crewAssignmentsWrites.createNative, { ...base, id: "a2", auditId: "l2" });
    await t.run(async (ctx) => { await ctx.db.insert("crewAssignments", { id: "aX", organizationId: OTHER, projectId: "pX", crewMemberId: "cX", status: "PENDING" }); });
    const s = await t.withIdentity(asUser).mutation(api.crewAssignmentsWrites.bulkStatusNative, { orgId: ORG, ids: ["a1", "a2", "aX"], status: "CONFIRMED", now: NOW, actor, auditId: "l3" });
    expect(s.updated).toBe(2); expect(s.skipped).toBe(1);
    const d = await t.withIdentity(asUser).mutation(api.crewAssignmentsWrites.bulkDeleteNative, { orgId: ORG, ids: ["a1", "a2", "aX"], now: NOW, actor, auditId: "l4" });
    expect(d.deleted).toBe(2); expect(d.skipped).toBe(1);
    expect(await t.run(async (ctx) => ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", "aX")).first())).not.toBeNull(); // foreign survives
  });

  // R-8.6.2 — a direct-mutation caller (bypassing crewAssignmentSchema.parse() in the
  // browser hook) must still hit the same business-constraint bounds server-side.
  test("create rejects a notes field over the 2000-char bound", async () => {
    const t = makeT(); await seed(t);
    await expect(
      t.withIdentity(asUser).mutation(api.crewAssignmentsWrites.createNative, { ...base, notes: "x".repeat(2001) }),
    ).rejects.toThrow(/notes/);
  });

  test("create rejects a startTime over the 5-char bound", async () => {
    const t = makeT(); await seed(t);
    await expect(
      t.withIdentity(asUser).mutation(api.crewAssignmentsWrites.createNative, { ...base, startTime: "123456" }),
    ).rejects.toThrow(/startTime/);
  });

  test("create rejects a blank crewMemberId", async () => {
    const t = makeT(); await seed(t);
    await expect(
      t.withIdentity(asUser).mutation(api.crewAssignmentsWrites.createNative, { ...base, crewMemberId: "" }),
    ).rejects.toThrow(/crewMemberId/);
  });

  test("update rejects an internalNotes field over the 2000-char bound", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asUser).mutation(api.crewAssignmentsWrites.createNative, base);
    await expect(
      t.withIdentity(asUser).mutation(api.crewAssignmentsWrites.updateNative, {
        id: "a1", orgId: ORG, crewMemberId: "c1", status: "PENDING" as const, isProjectManager: false,
        internalNotes: "x".repeat(2001), now: NOW, actor, auditId: "l2",
      }),
    ).rejects.toThrow(/internalNotes/);
  });

  test("generateShifts regenerates SCHEDULED shifts; RBAC + cross-tenant", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asUser).mutation(api.crewAssignmentsWrites.createNative, { ...base, startDate: NOW, endDate: NOW + DAY });
    const res = await t.withIdentity(asUser).mutation(api.crewAssignmentsWrites.generateShiftsNative, { assignmentId: "a1", orgId: ORG });
    expect(res.count).toBe(2);
    // cross-tenant assignment rejected
    await t.run(async (ctx) => { await ctx.db.insert("crewAssignments", { id: "aX", organizationId: OTHER, projectId: "pX", crewMemberId: "cX", status: "PENDING", startDate: NOW, endDate: NOW } as any); }); // eslint-disable-line @typescript-eslint/no-explicit-any
    await expect(t.withIdentity(asUser).mutation(api.crewAssignmentsWrites.generateShiftsNative, { assignmentId: "aX", orgId: ORG })).rejects.toThrow(/not found/i);
    // viewer denied create
    await t.run(async (ctx) => { const m = await ctx.db.query("members").withIndex("by_cuid", (q) => q.eq("id", "m1")).first(); if (m) await ctx.db.patch(m._id, { role: "viewer" }); });
    await expect(t.withIdentity({ subject: USER, orgId: ORG, role: "viewer" }).mutation(api.crewAssignmentsWrites.createNative, { ...base, id: "a9", auditId: "l9" })).rejects.toThrow(/Forbidden|permission/i);
  });
});

describe("crewAssignments reads", () => {
  test("projectCrew: joins member/role/service/shifts + PM-first sort; projectLabourCost sums non-excluded", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("crewMembers", { id: "c2", organizationId: ORG, firstName: "Al", lastName: "Aaron", isActive: true });
      await ctx.db.insert("crewAssignments", { id: "a1", organizationId: ORG, projectId: "p1", crewMemberId: "c1", crewRoleId: "r1", status: "CONFIRMED", isProjectManager: false, estimatedCost: 1000, startDate: NOW });
      await ctx.db.insert("crewAssignments", { id: "a2", organizationId: ORG, projectId: "p1", crewMemberId: "c2", status: "CONFIRMED", isProjectManager: true, estimatedCost: 500 });
      await ctx.db.insert("crewAssignments", { id: "a3", organizationId: ORG, projectId: "p1", crewMemberId: "c1", status: "CANCELLED", estimatedCost: 999 });
      await ctx.db.insert("crewShifts", { id: "sh1", assignmentId: "a1", date: NOW });
      await ctx.db.insert("crewAssignments", { id: "aX", organizationId: OTHER, projectId: "p1", crewMemberId: "c1", status: "CONFIRMED", estimatedCost: 777 });
    });
    const crew = await t.withIdentity(asUser).query(api.crewAssignments.projectCrew, { projectId: "p1", orgId: ORG });
    expect(crew.map((a) => a.id)).toEqual(["a2", "a1", "a3"]); // PM first (a2), then non-PM
    expect(crew.find((a) => a.id === "a1")?.crewMember.lastName).toBe("Ryan");
    expect(crew.find((a) => a.id === "a1")?.crewRole?.name).toBe("Rigger");
    expect(crew.find((a) => a.id === "a1")?.shifts).toHaveLength(1);
    const labour = await t.withIdentity(asUser).query(api.crewAssignments.projectLabourCost, { projectId: "p1", orgId: ORG });
    expect(labour.totalLabourCost).toBe(1500); // a1+a2, excludes CANCELLED a3 + foreign aX
    expect(labour.assignmentCount).toBe(2);
  });

  test("membersForAssignment: active members + this-project assignments + conflicts/unavailability", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p2", organizationId: ORG, projectNumber: "P2", name: "Other", status: "CONFIRMED", isTemplate: false });
      await ctx.db.insert("crewAssignments", { id: "a1", organizationId: ORG, projectId: "p1", crewMemberId: "c1", status: "CONFIRMED", phase: "EVENT" });
      // conflicting assignment on ANOTHER project in the window
      await ctx.db.insert("crewAssignments", { id: "a2", organizationId: ORG, projectId: "p2", crewMemberId: "c1", status: "CONFIRMED", startDate: NOW, endDate: NOW + DAY });
      await ctx.db.insert("crewAvailabilities", { id: "av1", organizationId: ORG, crewMemberId: "c1", type: "UNAVAILABLE", startDate: NOW, endDate: NOW + DAY });
    });
    const res = await t.withIdentity(asUser).query(api.crewAssignments.membersForAssignment, { projectId: "p1", orgId: ORG, rangeStartMs: NOW, rangeEndMs: NOW + DAY });
    const c1 = res.find((m) => m.id === "c1");
    expect(c1?.assignments.map((a) => a.id)).toEqual(["a1"]); // only THIS project
    expect(c1?.conflicts[0]?.projectId).toBe("p2");
    expect(c1?.isUnavailable).toBe(true);
  });
});
