// @vitest-environment node
//
// UX Phase 15 (spec §9h): the planner's Needs crew read and bulk call verbs.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1", OTHER = "org_2", USER = "user_1", USER2 = "user_2";
const DAY = 86_400_000;
const D0 = Date.UTC(2026, 10, 16);
const actor = { userId: USER, userName: "Alice" };
const asUser = { subject: USER, orgId: ORG };
const asUser2 = { subject: USER2, orgId: ORG };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

async function seedBase(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "manager" });
    await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: USER2, role: "manager" });
    await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
    await ctx.db.insert("users", { id: USER2, name: "Ben", email: "b@x.com" });
    await ctx.db.insert("crewRoles", { id: "r1", organizationId: ORG, name: "Rigger" });
    await ctx.db.insert("crewMembers", { id: "c1", organizationId: ORG, firstName: "Bob", lastName: "Ryan", isActive: true });
  });
}

describe("crewPlanner.openCalls (Needs crew)", () => {
  async function seedServices(t: T) {
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "2341", name: "Launch", status: "CONFIRMED", isTemplate: false, liveVersionId: "v2" });
      await ctx.db.insert("projects", { id: "pT", organizationId: ORG, projectNumber: "T1", name: "Template", status: "CONFIRMED", isTemplate: true });
      await ctx.db.insert("projects", { id: "pC", organizationId: ORG, projectNumber: "2000", name: "Off", status: "CANCELLED", isTemplate: false });
      await ctx.db.insert("projects", { id: "pX", organizationId: OTHER, projectNumber: "9", name: "Theirs", status: "CONFIRMED", isTemplate: false });
      const svc = (id: string, projectId: string, extra: Record<string, unknown> = {}) =>
        ctx.db.insert("projectServices", { id, organizationId: ORG, projectId, type: "LABOUR", title: `Svc ${id}`, date: D0 + DAY, crewCountRequired: 2, crewRoleId: "r1", startTime: "08:00", endTime: "18:00", ...extra } as never);
      await svc("live", "p1", { versionId: "v2" });
      await svc("oldVersion", "p1", { versionId: "v1" }); // a non-live version's copy — never counts
      await svc("template", "pT");
      await svc("cancelledJob", "pC");
      await svc("full", "p1", { versionId: "v2", crewCountRequired: 1 });
      await svc("noRequirement", "p1", { versionId: "v2", crewCountRequired: 0 });
      await svc("outOfRange", "p1", { versionId: "v2", date: D0 + 30 * DAY });
      await ctx.db.insert("projectServices", { id: "foreign", organizationId: OTHER, projectId: "pX", type: "LABOUR", title: "X", date: D0 + DAY, crewCountRequired: 3 } as never);
      await ctx.db.insert("crewAssignments", { id: "a1", organizationId: ORG, projectId: "p1", crewMemberId: "c1", serviceId: "live", status: "CONFIRMED" });
      await ctx.db.insert("crewAssignments", { id: "a2", organizationId: ORG, projectId: "p1", crewMemberId: "c1", serviceId: "full", status: "ACCEPTED" });
      await ctx.db.insert("crewAssignments", { id: "a3", organizationId: ORG, projectId: "p1", crewMemberId: "c1", serviceId: "live", status: "DECLINED" }); // does not fill
    });
  }

  test("only live-version services on live, in-org jobs that are short of people", async () => {
    const t = makeT(); await seedBase(t); await seedServices(t);
    const res = await t.withIdentity(asUser).query(api.crewPlanner.openCalls, { orgId: ORG, startMs: D0, endMs: D0 + 6 * DAY });
    expect(res.truncated).toBe(false);
    expect(res.calls.map((c) => c.serviceId)).toEqual(["live"]);
    expect(res.calls[0]).toMatchObject({ projectNumber: "2341", crewCountRequired: 2, assignedCount: 1, shortfall: 1, startTime: "08:00", crewRoleName: "Rigger" });
  });

  test("a multi-day service that started before the window but runs into it is open in it; one that ended before is not", async () => {
    const t = makeT(); await seedBase(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "2341", name: "Launch", status: "CONFIRMED", isTemplate: false });
      const svc = (id: string, date: number, endDate: number) =>
        ctx.db.insert("projectServices", { id, organizationId: ORG, projectId: "p1", type: "LABOUR", title: id, date, endDate, crewCountRequired: 1 } as never);
      await svc("runsIn", D0 - 3 * DAY, D0 + DAY);
      await svc("endedBefore", D0 - 5 * DAY, D0 - DAY);
    });
    const res = await t.withIdentity(asUser).query(api.crewPlanner.openCalls, { orgId: ORG, startMs: D0, endMs: D0 + 6 * DAY });
    expect(res.calls.map((c) => c.serviceId)).toEqual(["runsIn"]);
  });

  test("each open call carries the phase a call on it staffs (Offer a call creates with it)", async () => {
    const t = makeT(); await seedBase(t); await seedServices(t);
    const res = await t.withIdentity(asUser).query(api.crewPlanner.openCalls, { orgId: ORG, startMs: D0, endMs: D0 + 6 * DAY });
    expect(res.calls[0]).toMatchObject({ phase: "EVENT", endDate: null });
  });

  test("the range is bounded", async () => {
    const t = makeT(); await seedBase(t);
    await expect(t.withIdentity(asUser).query(api.crewPlanner.openCalls, { orgId: ORG, startMs: D0, endMs: D0 + 15 * DAY })).rejects.toThrow(/exceeds 14 days/);
    await expect(t.withIdentity(asUser).query(api.crewPlanner.openCalls, { orgId: ORG, startMs: D0, endMs: D0 - 1 })).rejects.toThrow(/endMs/);
  });
});

describe("confirmManyNative / unconfirmManyNative / cancelManyNative", () => {
  async function seedCalls(t: T) {
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "2341", name: "Launch", status: "CONFIRMED", isTemplate: false });
      for (const [id, status] of [["acc", "ACCEPTED"], ["acc2", "ACCEPTED"], ["off", "OFFERED"], ["pen", "PENDING"], ["dec", "DECLINED"]] as const) {
        await ctx.db.insert("crewAssignments", { id, organizationId: ORG, projectId: "p1", crewMemberId: "c1", status, updatedAt: D0 - 10 });
      }
      await ctx.db.insert("crewAssignments", { id: "foreign", organizationId: OTHER, projectId: "pX", crewMemberId: "cX", status: "ACCEPTED" });
    });
  }
  const asg = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", id)).first());
  const logs = (t: T, id: string) =>
    t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_organizationId_entityType_entityId", (q) => q.eq("organizationId", ORG).eq("entityType", "crew_assignment").eq("entityId", id)).collect());
  const confirm = (t: T, ids: string[]) => t.withIdentity(asUser).mutation(api.crewAssignmentsWrites.confirmManyNative, { orgId: ORG, ids, now: D0, actor, auditId: "cf" });

  test("confirm: only ACCEPTED moves; the rest is skipped; one activity row per call", async () => {
    const t = makeT(); await seedBase(t); await seedCalls(t);
    const res = await confirm(t, ["acc", "acc2", "off", "foreign"]);
    expect(res.confirmed.sort()).toEqual(["acc", "acc2"]);
    expect(res.skipped.sort()).toEqual(["foreign", "off"]);
    expect(await asg(t, "acc")).toMatchObject({ status: "CONFIRMED", confirmedAt: D0, confirmedById: USER });
    expect(await logs(t, "acc")).toHaveLength(1);
    expect(await logs(t, "acc2")).toHaveLength(1);
    expect((await asg(t, "foreign"))?.status).toBe("ACCEPTED");
  });

  test("unconfirm reverses exactly the confirm: status back, stamp cleared", async () => {
    const t = makeT(); await seedBase(t); await seedCalls(t);
    await confirm(t, ["acc", "acc2"]);
    await t.withIdentity(asUser).mutation(api.crewAssignmentsWrites.unconfirmManyNative, { orgId: ORG, ids: ["acc", "acc2"], stamp: D0, now: D0 + 5, actor, auditId: "uc" });
    const a = await asg(t, "acc");
    expect(a?.status).toBe("ACCEPTED");
    expect(a?.confirmedAt).toBeUndefined();
    expect(a?.confirmedById).toBeUndefined();
  });

  test("unconfirm refuses a call that changed since, a call it never confirmed, and another user's confirm", async () => {
    const t = makeT(); await seedBase(t); await seedCalls(t);
    await confirm(t, ["acc", "acc2"]);
    const undo = (ids: string[], who = asUser) =>
      t.withIdentity(who).mutation(api.crewAssignmentsWrites.unconfirmManyNative, { orgId: ORG, ids, stamp: D0, now: D0 + 5, actor, auditId: "uc" });
    await expect(undo(["acc"], asUser2)).rejects.toThrow(/Nothing to undo/);
    await t.run(async (ctx) => { const d = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", "acc2")).first(); await ctx.db.patch(d!._id, { updatedAt: D0 + 1 }); });
    await expect(undo(["acc", "acc2"])).rejects.toThrow(/changed after/);
    expect((await asg(t, "acc"))?.status).toBe("CONFIRMED"); // all-or-nothing
    await expect(undo(["off"])).rejects.toThrow(/changed after/);
  });

  test("cancel: cancellable calls go CANCELLED; toTell = the ones the crew member already had", async () => {
    const t = makeT(); await seedBase(t); await seedCalls(t);
    await t.run(async (ctx) => { await ctx.db.insert("crewTimeEntries", { id: "te1", organizationId: ORG, crewMemberId: "c1", assignmentId: "off", date: D0, startTime: "09:00", endTime: "17:00", status: "DRAFT" }); });
    const res = await t.withIdentity(asUser).mutation(api.crewAssignmentsWrites.cancelManyNative, { orgId: ORG, ids: ["off", "pen", "acc", "dec", "foreign"], now: D0, actor, auditId: "cx" });
    expect(res.cancelled.sort()).toEqual(["acc", "off", "pen"]);
    expect(res.toTell.sort()).toEqual(["acc", "off"]);
    expect(res.skipped.sort()).toEqual(["dec", "foreign"]);
    expect((await asg(t, "pen"))?.status).toBe("CANCELLED");
    expect(await logs(t, "pen")).toHaveLength(1);
    // timesheets stay
    expect(await t.run(async (ctx) => ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", "te1")).first())).not.toBeNull();
  });

  test("cancel kills the offer's accept/decline token (an old email link can't revive the call)", async () => {
    const t = makeT(); await seedBase(t); await seedCalls(t);
    await t.run(async (ctx) => {
      const off = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", "off")).first();
      await ctx.db.patch(off!._id, { responseToken: "tok" });
    });
    await t.withIdentity(asUser).mutation(api.crewAssignmentsWrites.cancelManyNative, { orgId: ORG, ids: ["off"], now: D0, actor, auditId: "cx" });
    const off = await asg(t, "off");
    expect(off?.status).toBe("CANCELLED");
    expect(off?.responseToken).toBeUndefined();
  });
});

describe("crewRolesWrites.moveNative", () => {
  test("one atomic renumber; ties become movable; ends are a no-op; the opposite move undoes it", async () => {
    const t = makeT(); await seedBase(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("crewRoles", { id: "r2", organizationId: ORG, name: "Audio", sortOrder: 0 });
      await ctx.db.insert("crewRoles", { id: "r3", organizationId: ORG, name: "LX", sortOrder: 0 });
    });
    const order = () => t.run(async (ctx) => (await ctx.db.query("crewRoles").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect())
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name)).map((r) => r.id));
    const move = (id: string, direction: "up" | "down") => t.withIdentity(asUser).mutation(api.crewRolesWrites.moveNative, { id, orgId: ORG, direction, now: D0, actor, auditId: `mv-${id}-${direction}` });
    expect(await order()).toEqual(["r2", "r3", "r1"]); // Audio, LX, Rigger (all tied at 0)
    expect((await move("r3", "up")).moved).toBe(true);
    expect(await order()).toEqual(["r3", "r2", "r1"]);
    expect((await move("r3", "up")).moved).toBe(false);
    await move("r3", "down");
    expect(await order()).toEqual(["r2", "r3", "r1"]);
  });

  test("moves past archived roles to the nearest role in the same list, and back", async () => {
    const t = makeT(); await seedBase(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("crewRoles", { id: "r2", organizationId: ORG, name: "Audio", sortOrder: 0 });
      await ctx.db.insert("crewRoles", { id: "rx", organizationId: ORG, name: "Old", sortOrder: 1, isActive: false });
      await ctx.db.insert("crewRoles", { id: "r4", organizationId: ORG, name: "Vision", sortOrder: 2 });
    });
    const order = () => t.run(async (ctx) => (await ctx.db.query("crewRoles").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect())
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name)).map((r) => r.id));
    const move = (id: string, direction: "up" | "down") => t.withIdentity(asUser).mutation(api.crewRolesWrites.moveNative, { id, orgId: ORG, direction, now: D0, actor, auditId: `mv2-${id}-${direction}` });
    const before = await order();
    const active = (ids: string[]) => ids.filter((id) => id !== "rx");
    // Vision swaps with the nearest ACTIVE role above it, never the archived one between.
    const i = active(before).indexOf("r4");
    expect((await move("r4", "up")).moved).toBe(true);
    expect(active(await order()).indexOf("r4")).toBe(i - 1);
    await move("r4", "down");
    expect(await order()).toEqual(before);
    // The only archived role has no neighbour in its own list.
    expect((await move("rx", "up")).moved).toBe(false);
  });
});

describe("crewAvailability.plannerData (the planner grid)", () => {
  test("a call's job carries its project manager (the planner's Mine = the Jobs My jobs rule)", async () => {
    const t = makeT(); await seedBase(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "2341", name: "Launch", status: "CONFIRMED", isTemplate: false, projectManagerId: USER });
      await ctx.db.insert("crewAssignments", { id: "a1", organizationId: ORG, projectId: "p1", crewMemberId: "c1", status: "OFFERED", startDate: D0 + DAY, endDate: D0 + DAY, responseToken: "secret" });
    });
    const rows = await t.withIdentity(asUser).query(api.crewAvailability.plannerData, { orgId: ORG, startMs: D0, endMs: D0 + 6 * DAY });
    const call = rows[0].assignments[0];
    expect(call.project).toMatchObject({ projectNumber: "2341", projectManagerId: USER });
    expect("responseToken" in call).toBe(false);
  });
});
