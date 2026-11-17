// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";

const modules = import.meta.glob("./**/*.ts");
function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
type T = ReturnType<typeof makeT>;

const ORG = "org_1";
const OTHER = "org_other";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const D1 = 1_800_000_000_000;
const asUser = (orgId: string) => ({ subject: USER, orgId });
const ACTOR = { userId: USER, userName: "Alice" };
const baseInput = { type: "BUMP_IN" as const, title: "Bump in", showOnDocuments: true, quantity: 1, taxable: true };

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "member" });
    for (const [id, org] of [["p1", ORG], ["p2", ORG], ["px", OTHER]] as const) {
      await ctx.db.insert("projects", { id, organizationId: org, projectNumber: `P-${id}`, name: "Gig", status: "QUOTED", total: 0, taxRate: 10, liveVersionId: `v-${id}` });
      await ctx.db.insert("projectVersions", { id: `v-${id}`, organizationId: org, projectId: id, number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    }
    await ctx.db.insert("crewMembers", { id: "cm1", organizationId: ORG, firstName: "Bob", lastName: "Roe", status: "ACTIVE" });
  });
  const create = (id: string, projectId: string, extra: Record<string, unknown> = {}) =>
    t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
      id, orgId: ORG, projectId, ...baseInput, date: D1, endDate: D1 + DAY, startTime: "08:00", endTime: "16:00",
      now: NOW, actor: ACTOR, auditId: `log-${id}`, ...extra,
    });
  await create("s1", "p1", { crew: [{ id: "a1", crewMemberId: "cm1" }] });
  await create("s2", "p1", { type: "BUMP_OUT", title: "Bump out" });
  await create("s3", "p2");
}
const svc = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("projectServices").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const asg = (t: T) => t.run(async (ctx) => ctx.db.query("crewAssignments").withIndex("by_serviceId", (q) => q.eq("serviceId", "s1")).collect());
type Move = { offsetDays: number; serviceIds: string[] };
const shift = (
  t: T,
  args: Partial<{ offsetDays: number; serviceIds: string[]; moves: Move[]; projectId: string; auditId: string }> = {},
  as = ORG,
) =>
  t.withIdentity(asUser(as)).mutation(api.projectServicesWrites.shiftScheduleNative, {
    orgId: ORG, now: NOW + 1, actor: ACTOR, auditId: args.auditId ?? "shift1",
    projectId: args.projectId ?? "p1",
    moves: args.moves ?? [{ offsetDays: args.offsetDays ?? 2, serviceIds: args.serviceIds ?? ["s1", "s2"] }],
  } as never);

describe("shiftScheduleNative", () => {
  test("moves services and their crew calls by whole days; times stay", async () => {
    const t = makeT();
    await seed(t);
    const r = await shift(t, {});
    expect(r).toEqual({ services: 2, crewCalls: 1, undated: 0, confirmedMoved: 0 });
    const s1 = await svc(t, "s1");
    expect([s1?.date, s1?.endDate, s1?.startTime]).toEqual([D1 + 2 * DAY, D1 + 3 * DAY, "08:00"]);
    expect((await svc(t, "s2"))?.date).toBe(D1 + 2 * DAY);
    const [a] = await asg(t);
    expect([a.startDate, a.endDate]).toEqual([D1 + 2 * DAY, D1 + 3 * DAY]);
    // Not in the list, not moved.
    expect((await svc(t, "s3"))?.date).toBe(D1);
  });

  test("the negative offset is an exact reverse (Undo)", async () => {
    const t = makeT();
    await seed(t);
    await shift(t, {});
    await shift(t, { offsetDays: -2, auditId: "shift2" });
    expect((await svc(t, "s1"))?.date).toBe(D1);
    const [a] = await asg(t);
    expect([a.startDate, a.endDate]).toEqual([D1, D1 + DAY]);
  });

  test("writes one audit row", async () => {
    const t = makeT();
    await seed(t);
    await shift(t, {});
    const log = await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "shift1")).first());
    expect(log?.action).toBe("schedule_shifted");
    expect(log?.summary).toBe("Moved 2 services and 1 crew call");
  });

  test("a service from another org rejects the WHOLE call (nothing moves)", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectServices", { id: "sx", organizationId: OTHER, projectId: "px", type: "BUMP_IN", title: "Theirs", date: D1 } as never);
    });
    await expect(shift(t, { serviceIds: ["s1", "sx"] })).rejects.toThrow(/not found/i);
    expect((await svc(t, "s1"))?.date).toBe(D1);
  });

  test("a service on a different project rejects (atomic)", async () => {
    const t = makeT();
    await seed(t);
    await expect(shift(t, { serviceIds: ["s1", "s3"] })).rejects.toThrow(/not found/i);
    expect((await svc(t, "s1"))?.date).toBe(D1);
  });

  test("a project from another org is rejected", async () => {
    const t = makeT();
    await seed(t);
    await expect(shift(t, { projectId: "px" })).rejects.toThrow(/not found/i);
  });

  test("a caller whose own org is not the requested org is rejected", async () => {
    const t = makeT();
    await seed(t);
    await expect(shift(t, {}, OTHER)).rejects.toThrow();
  });

  test("caps: offset beyond a year and too many ids are rejected", async () => {
    const t = makeT();
    await seed(t);
    await expect(shift(t, { offsetDays: 400 })).rejects.toThrow(/at most/i);
    await expect(shift(t, { offsetDays: 1.5 })).rejects.toThrow(/whole/i);
    await expect(shift(t, { serviceIds: Array.from({ length: 201 }, (_, i) => `x${i}`) })).rejects.toThrow(/at most/i);
  });

  test("two offsets in one call move each group by its own amount", async () => {
    const t = makeT();
    await seed(t);
    await shift(t, { moves: [{ offsetDays: 1, serviceIds: ["s1"] }, { offsetDays: 3, serviceIds: ["s2"] }] });
    expect((await svc(t, "s1"))?.date).toBe(D1 + DAY);
    expect((await svc(t, "s2"))?.date).toBe(D1 + 3 * DAY);
  });

  test("the same service in two groups rejects (nothing moves)", async () => {
    const t = makeT();
    await seed(t);
    await expect(shift(t, { moves: [{ offsetDays: 1, serviceIds: ["s1"] }, { offsetDays: 2, serviceIds: ["s1"] }] })).rejects.toThrow(/once/i);
    expect((await svc(t, "s1"))?.date).toBe(D1);
  });

  test("offset 0 or no ids is a no-op", async () => {
    const t = makeT();
    await seed(t);
    expect(await shift(t, { offsetDays: 0 })).toEqual({ services: 0, crewCalls: 0, undated: 0, confirmedMoved: 0 });
    expect((await svc(t, "s1"))?.date).toBe(D1);
  });

  test("confirmedMoved counts CONFIRMED and OFFERED crew, and leaves their status alone", async () => {
    const t = makeT();
    await seed(t);
    for (const status of ["CONFIRMED", "OFFERED"]) {
      await t.run(async (ctx) => {
        const row = await ctx.db.query("crewAssignments").withIndex("by_serviceId", (q) => q.eq("serviceId", "s1")).first();
        await ctx.db.patch(row!._id, { status } as never);
      });
      const r = await shift(t, { serviceIds: ["s1"], offsetDays: 1, auditId: "c-" + status });
      expect(r.confirmedMoved).toBe(1);
      expect((await asg(t))[0].status).toBe(status);
    }
  });

  test("crew cost and the service totals are date-invariant across a weekend (why no pricing-lock gate)", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      const m = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", "cm1")).first();
      await ctx.db.patch(m!._id, { defaultDayRate: 500 } as never);
    });
    // Touch the assignment so its cost is resolved at the current rate, then snapshot.
    await shift(t, { serviceIds: ["s1"], offsetDays: 0 });
    await shift(t, { serviceIds: ["s1"], offsetDays: 1, auditId: "w0" });
    const money = async () => {
      const s = await svc(t, "s1");
      const [a] = await asg(t);
      return [a.estimatedCost, s?.costTotal, s?.lineTotal];
    };
    const before = await money();
    expect(before[0]).toBe(1000); // 2 days x $500: the test is not vacuously comparing zeros
    // D1 is a Thursday-ish anchor; 3 days crosses a weekend boundary either way.
    await shift(t, { serviceIds: ["s1"], offsetDays: 3, auditId: "w1" });
    expect(await money()).toEqual(before);
    await shift(t, { serviceIds: ["s1"], offsetDays: -4, auditId: "w2" });
    expect(await money()).toEqual(before);
  });

  test("an agent is held to the 50-row bulk cap", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("apiKeys", {
        id: "key_1", organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h",
        scopes: JSON.stringify(["*"]), isActive: true, actingUserId: USER, createdById: USER,
      });
    });
    const asAgent = { subject: USER, orgId: ORG, akid: "key_1" };
    const call = (n: number) =>
      t.withIdentity(asAgent).mutation(api.projectServicesWrites.shiftScheduleNative, {
        orgId: ORG, projectId: "p1", now: NOW + 1, actor: ACTOR, auditId: "agent" + n,
        moves: [{ offsetDays: 1, serviceIds: Array.from({ length: n }, (_, i) => `x${i}`) }],
      } as never);
    await expect(call(51)).rejects.toThrow(/exceeds the 50-item limit/i);
    // 50 clears the cap (the ids do not exist, so it then fails on "not found", not on size).
    await expect(call(50)).rejects.toThrow(/not found/i);
  });
});
