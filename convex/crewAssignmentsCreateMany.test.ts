// @vitest-environment node
//
// crewAssignmentsWrites.createManyNative (UX Phase 13, the Crew list's `Assign n to job…`):
// unsent PENDING calls in ONE transaction, per-member gates, and an Undo
// (`bulkDeleteNative(createdIds)`) that removes exactly the created rows.
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
const asAdmin = { subject: USER, orgId: ORG, role: "admin" };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
async function seed(t: T, role = "admin") {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role });
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "QUOTED", isTemplate: false, liveVersionId: "v-p1" });
    await ctx.db.insert("projects", { id: "px", organizationId: OTHER, projectNumber: "PX", name: "Foreign", status: "QUOTED" });
    await ctx.db.insert("projectVersions", { id: "v-p1", organizationId: ORG, projectId: "p1", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    await ctx.db.insert("crewMembers", { id: "c1", organizationId: ORG, firstName: "Bob", lastName: "Ryan", defaultDayRate: 500, isActive: true });
    await ctx.db.insert("crewMembers", { id: "c2", organizationId: ORG, firstName: "Cy", lastName: "Dee", isActive: true });
    await ctx.db.insert("crewMembers", { id: "c3", organizationId: ORG, firstName: "Off", lastName: "Duty", status: "INACTIVE" });
    await ctx.db.insert("crewMembers", { id: "cf", organizationId: OTHER, firstName: "For", lastName: "Eign" });
    await ctx.db.insert("crewAssignments", { id: "live", organizationId: ORG, projectId: "p1", crewMemberId: "c2", status: "CONFIRMED" });
  });
}
const rows = (t: T) => t.run(async (ctx) => ctx.db.query("crewAssignments").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect());
const base = { orgId: ORG, projectId: "p1", startDate: NOW, endDate: NOW + DAY, now: NOW, actor, auditId: "log1" };

describe("createManyNative", () => {
  test("creates unsent PENDING calls, skips and names the rest, one audit row", async () => {
    const t = makeT(); await seed(t);
    const res = await t.withIdentity(asAdmin).mutation(api.crewAssignmentsWrites.createManyNative, {
      ...base,
      items: [
        { id: "n1", crewMemberId: "c1" },
        { id: "n2", crewMemberId: "c2" }, // already holds a live call on this job
        { id: "n3", crewMemberId: "c3" }, // inactive
        { id: "n4", crewMemberId: "cf" }, // another org's member
        { id: "n5", crewMemberId: "c1" }, // repeated: never a second call
      ],
    });
    expect(res.created).toEqual([{ id: "n1", crewMemberId: "c1" }]);
    expect(res.skipped.sort((a, b) => a.crewMemberId.localeCompare(b.crewMemberId))).toEqual([
      { crewMemberId: "c2", reason: "already on this job" },
      { crewMemberId: "c3", reason: "inactive" },
      { crewMemberId: "cf", reason: "not found" },
    ]);
    const n1 = (await rows(t)).find((r) => r.id === "n1")!;
    expect(n1).toMatchObject({ status: "PENDING", startDate: NOW });
    expect(n1.offeredAt).toBeUndefined(); // nothing was offered or mailed
    const logs = await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect());
    expect(logs.filter((l) => l.id === "log1")).toHaveLength(1);
  });

  const assign = (t: T, items: { id: string; crewMemberId: string }[], who = t.withIdentity(asAdmin)) =>
    who.mutation(api.crewAssignmentsWrites.createManyNative, { ...base, items });
  const undo = (t: T, over: Record<string, unknown> = {}, who = t.withIdentity(asAdmin)) =>
    who.mutation(api.crewAssignmentsWrites.undoCreateManyNative, { orgId: ORG, forwardAuditId: "log1", now: NOW + 1, actor, ...over });

  test("Undo removes exactly the untouched calls this assign created, and nothing else", async () => {
    const t = makeT(); await seed(t);
    await assign(t, [{ id: "n1", crewMemberId: "c1" }]);
    expect((await rows(t)).map((r) => r.id).sort()).toEqual(["live", "n1"]);
    expect(await undo(t)).toEqual({ removed: 1, kept: [], reasons: [] });
    expect((await rows(t)).map((r) => r.id)).toEqual(["live"]);
  });

  test("REPRO: a call that was confirmed and has an approved time entry is KEPT (and named), never wiped", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { await ctx.db.insert("crewMembers", { id: "c4", organizationId: ORG, firstName: "Di", lastName: "Eve", isActive: true }); });
    await assign(t, [{ id: "n1", crewMemberId: "c1" }, { id: "n2", crewMemberId: "c4" }]);
    await t.run(async (ctx) => {
      const n1 = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", "n1")).first();
      await ctx.db.patch(n1!._id, { status: "CONFIRMED", confirmedAt: NOW });
      await ctx.db.insert("crewTimeEntries", { id: "te1", organizationId: ORG, assignmentId: "n1", crewMemberId: "c1", date: NOW, startTime: "09:00", endTime: "17:00", status: "APPROVED" });
    });
    const res = await undo(t);
    expect(res.removed).toBe(1);
    expect(res.kept).toEqual([{ id: "n1", crewMemberId: "c1", reason: "it has moved on" }]);
    expect((await rows(t)).map((r) => r.id).sort()).toEqual(["live", "n1"]);
    expect(await t.run(async (ctx) => ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", "te1")).first())).toBeTruthy();
  });

  test("a pending call with a shift or logged time, or one already offered, is kept", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { await ctx.db.insert("crewMembers", { id: "c4", organizationId: ORG, firstName: "Di", lastName: "Eve", isActive: true }); });
    await assign(t, [{ id: "n1", crewMemberId: "c1" }, { id: "n2", crewMemberId: "c4" }]);
    await t.run(async (ctx) => {
      await ctx.db.insert("crewShifts", { id: "sh1", assignmentId: "n1", date: NOW });
      const n2 = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", "n2")).first();
      await ctx.db.patch(n2!._id, { offeredAt: NOW });
    });
    const res = await undo(t);
    expect(res.removed).toBe(0);
    expect(res.kept.map((k) => k.reason).sort()).toEqual(["it has shifts", "it was offered"]);
  });

  test("a call edited since, or attached to a service, is KEPT and named; an all-kept Undo writes no marker and can be retried", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { await ctx.db.insert("crewMembers", { id: "c4", organizationId: ORG, firstName: "Di", lastName: "Eve", isActive: true }); });
    await assign(t, [{ id: "n1", crewMemberId: "c1" }, { id: "n2", crewMemberId: "c4" }]);
    const patch = (id: string, p: Record<string, unknown>) => t.run(async (ctx) => { const r = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", id)).first(); await ctx.db.patch(r!._id, p); });
    await patch("n1", { updatedAt: NOW + 5 });
    await patch("n2", { serviceId: "svc1" });
    const res = await undo(t);
    expect(res.removed).toBe(0);
    expect(res.kept.map((k) => k.reason).sort()).toEqual(["it was attached to a service", "it was edited since"]);
    expect(res.reasons.sort()).toEqual(["it was attached to a service", "it was edited since"]);
    expect(await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "undo:log1")).first())).toBeNull();
    // Whatever kept them is resolved: the SAME Undo now works (it was never spent).
    await patch("n1", { updatedAt: NOW });
    await patch("n2", { serviceId: undefined });
    expect((await undo(t)).removed).toBe(2);
    expect((await rows(t)).map((r) => r.id)).toEqual(["live"]);
  });

  test("Undo recalculates the job's labour cost (the created calls' estimates leave the total)", async () => {
    const t = makeT(); await seed(t);
    await assign(t, [{ id: "n1", crewMemberId: "c1" }]);
    const labour = () => t.run(async (ctx) => (await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first())?.labourCostTotal ?? 0);
    expect(await labour()).toBeGreaterThan(0);
    await undo(t);
    expect(await labour()).toBe(0);
  });

  test("another org cannot undo this org's assign, and nothing is deleted", async () => {
    const t = makeT(); await seed(t);
    await assign(t, [{ id: "n1", crewMemberId: "c1" }]);
    await t.run(async (ctx) => { await ctx.db.insert("members", { id: "mo", organizationId: OTHER, userId: USER, role: "admin" }); });
    await expect(undo(t, { orgId: OTHER }, t.withIdentity({ subject: USER, orgId: OTHER, role: "admin" }))).rejects.toThrow(/not found/);
    expect((await rows(t)).map((r) => r.id).sort()).toEqual(["live", "n1"]);
  });

  test("a manager (crew:create, no crew:delete) can undo; another user, the second time, and outside the window are refused", async () => {
    const t = makeT(); await seed(t, "manager");
    const asManager = t.withIdentity({ subject: USER, orgId: ORG, role: "manager" });
    await assign(t, [{ id: "n1", crewMemberId: "c1" }], asManager);
    await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: "user_2", role: "manager" }); });
    await expect(undo(t, {}, t.withIdentity({ subject: "user_2", orgId: ORG, role: "manager" }))).rejects.toThrow(/person who assigned/);
    expect((await undo(t, {}, asManager)).removed).toBe(1);
    await expect(undo(t, {}, asManager)).rejects.toThrow(/already undone/);
    const t2 = makeT(); await seed(t2);
    await assign(t2, [{ id: "n1", crewMemberId: "c1" }]);
    await t2.run(async (ctx) => {
      const f = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      await ctx.db.patch(f!._id, { details: { ...(f!.details as object), serverSavedAt: Date.now() - 11 * 60 * 1000 } });
    });
    await expect(undo(t2)).rejects.toThrow(/10 minutes/);
    expect((await rows(t2)).map((r) => r.id).sort()).toEqual(["live", "n1"]);
  });

  test("the live-call check is org-filtered: another org's call on a job with the same id never blocks", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { await ctx.db.insert("crewAssignments", { id: "foreignCall", organizationId: OTHER, projectId: "p1", crewMemberId: "c1", status: "CONFIRMED" }); });
    const res = await assign(t, [{ id: "n1", crewMemberId: "c1" }]);
    expect(res.created).toHaveLength(1);
  });

  test("another org's project and a role without crew:create are refused; nothing is written", async () => {
    const t = makeT(); await seed(t, "viewer");
    await expect(t.withIdentity({ subject: USER, orgId: ORG, role: "viewer" }).mutation(api.crewAssignmentsWrites.createManyNative, { ...base, items: [{ id: "n1", crewMemberId: "c1" }] })).rejects.toThrow();
    const t2 = makeT(); await seed(t2);
    await expect(t2.withIdentity(asAdmin).mutation(api.crewAssignmentsWrites.createManyNative, { ...base, projectId: "px", items: [{ id: "n1", crewMemberId: "c1" }] })).rejects.toThrow();
    expect((await rows(t2)).map((r) => r.id)).toEqual(["live"]);
  });

  test("an end date before the start is refused", async () => {
    const t = makeT(); await seed(t);
    await expect(t.withIdentity(asAdmin).mutation(api.crewAssignmentsWrites.createManyNative, { ...base, startDate: NOW + DAY, endDate: NOW, items: [{ id: "n1", crewMemberId: "c1" }] })).rejects.toThrow(/end date/);
  });
});
