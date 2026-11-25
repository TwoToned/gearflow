// @vitest-environment node
//
// UX Phase 14 (14b-3): Complete and Reopen a maintenance job, and their ONE exact Undo. Complete defaults each
// asset's disposition from the result (the server owns the default), applies the existing hold/release rules, and
// records the record's fields plus exactly the assets it moved; the Undo (ids only) restores both and refuses as a
// whole unless it is the author, in the window, the first, and nothing moved since.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
type Who = Parameters<T["withIdentity"]>[0];
const ORG = "org_1";
const USER = "user_1";
const KEY = "key_1";
const asUser: Who = { subject: USER, orgId: ORG };
const asAgent: Who = { subject: USER, orgId: ORG, akid: KEY };
const ACTOR = { userId: USER, userName: "Alice" };
const NOW = Date.now();
const DAY = 86_400_000;

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
async function seed(t: T, status = "IN_PROGRESS", noFinancialsKey = false) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: "user_2", role: "owner" });
    await ctx.db.insert("maintenanceRecords", { id: "r1", organizationId: ORG, type: "REPAIR", title: "Fix the desk", status, cost: 50, createdAt: 1, updatedAt: 1 } as never);
    await ctx.db.insert("maintenanceRecords", { id: "rx", organizationId: "org_2", type: "REPAIR", title: "Theirs", status: "IN_PROGRESS", createdAt: 1, updatedAt: 1 } as never);
    for (const id of ["a1", "a2"]) {
      await ctx.db.insert("assets", { id, organizationId: ORG, modelId: "m", assetTag: id.toUpperCase(), status: "IN_MAINTENANCE", isActive: true, updatedAt: 100 } as never);
      await ctx.db.insert("maintenanceRecordAssets", { id: `l_${id}`, maintenanceRecordId: "r1", assetId: id, kind: "LINK" });
    }
    if (noFinancialsKey) {
      await ctx.db.insert("apiKeys", { id: KEY, organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h", scopes: JSON.stringify(["*"]), isActive: true, actingUserId: USER, createdById: USER, noFinancials: true });
    }
  });
}
const rec = (t: T) => t.run(async (ctx) => (await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", "r1")).first())!);
const asset = (t: T, id: string) => t.run(async (ctx) => (await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).first())!);
const base = { orgId: ORG, actor: ACTOR, now: NOW };

const complete = (t: T, over: Record<string, unknown> = {}, auditId = "c1", who: Who = asUser, id = "r1") =>
  t.withIdentity(who).mutation(api.maintenanceLifecycleWrites.completeNative, { ...base, id, result: "PASS", completedDate: NOW - DAY, auditId, ...over } as never);
const reopen = (t: T, auditId = "o1", who: Who = asUser) => t.withIdentity(who).mutation(api.maintenanceLifecycleWrites.reopenNative, { ...base, id: "r1", auditId });
const undo = (t: T, auditId: string, who: Who = asUser, actor = ACTOR) =>
  t.withIdentity(who).mutation(api.maintenanceLifecycleWrites.undoNative, { orgId: ORG, id: "r1", auditId, now: NOW + 1, actor });

describe("completeNative", () => {
  afterEach(() => vi.useRealTimers());

  test("a Pass returns every asset to service by default, writes the outcome and labour, and Undo restores exactly", async () => {
    const t = makeT();
    await seed(t);
    expect(await complete(t, { labour: 120, nextDueDate: NOW + 90 * DAY })).toEqual({ id: "r1", undoable: true });
    expect(await rec(t)).toMatchObject({ status: "COMPLETED", result: "PASS", completedDate: NOW - DAY, cost: 120, nextDueDate: NOW + 90 * DAY });
    expect((await asset(t, "a1")).status).toBe("AVAILABLE");
    expect((await asset(t, "a2")).status).toBe("AVAILABLE");
    await undo(t, "c1");
    expect(await rec(t)).toMatchObject({ status: "IN_PROGRESS", cost: 50 });
    const back = await rec(t);
    expect(back.result).toBeUndefined();
    expect(back.completedDate).toBeUndefined();
    expect(back.nextDueDate).toBeUndefined();
    expect(await asset(t, "a1")).toMatchObject({ status: "IN_MAINTENANCE", updatedAt: 100 });
    await expect(undo(t, "c1")).rejects.toMatchObject({ data: { code: "ALREADY_UNDONE" } });
  });

  test("a Fail keeps assets out of service by default; a per-asset choice overrides it", async () => {
    const t = makeT();
    await seed(t);
    await complete(t, { result: "FAIL", dispositions: [{ assetId: "a2", disposition: "RETURN_TO_SERVICE" }] });
    expect((await asset(t, "a1")).status).toBe("IN_MAINTENANCE");
    expect((await asset(t, "a2")).status).toBe("AVAILABLE");
    expect(await rec(t)).toMatchObject({ status: "COMPLETED", result: "FAIL" });
  });

  test("an asset another open job still holds is not released, and Undo touches only what this write moved", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("maintenanceRecords", { id: "r2", organizationId: ORG, type: "REPAIR", title: "Other", status: "IN_PROGRESS", createdAt: 1, updatedAt: 1 } as never);
      await ctx.db.insert("maintenanceRecordAssets", { id: "l_x", maintenanceRecordId: "r2", assetId: "a1", kind: "LINK" });
    });
    await complete(t);
    expect((await asset(t, "a1")).status).toBe("IN_MAINTENANCE");
    expect((await asset(t, "a2")).status).toBe("AVAILABLE");
    await undo(t, "c1");
    expect(await asset(t, "a2")).toMatchObject({ status: "IN_MAINTENANCE", updatedAt: 100 });
    expect((await asset(t, "a1")).updatedAt).toBe(100);
  });

  test("Retire is terminal: the Complete reports no Undo and the Undo refuses", async () => {
    const t = makeT();
    await seed(t);
    expect(await complete(t, { dispositions: [{ assetId: "a1", disposition: "RETIRE" }] })).toEqual({ id: "r1", undoable: false });
    expect((await asset(t, "a1")).status).toBe("RETIRED");
    await expect(undo(t, "c1")).rejects.toMatchObject({ data: { code: "NOT_UNDOABLE" } });
    expect((await rec(t)).status).toBe("COMPLETED");
  });

  test("labour: absent leaves it, null clears it (blank is not $0), a number sets it", async () => {
    const a = makeT();
    await seed(a);
    await complete(a);
    expect((await rec(a)).cost).toBe(50);
    const b = makeT();
    await seed(b);
    await complete(b, { labour: null });
    expect((await rec(b)).cost).toBeUndefined();
    const c = makeT();
    await seed(c);
    await complete(c, { labour: 0 });
    expect((await rec(c)).cost).toBe(0);
  });

  test("a noFinancials key completes the job but cannot set or clear labour", async () => {
    const t = makeT();
    await seed(t, "IN_PROGRESS", true);
    await complete(t, { labour: 999 }, "c1", asAgent);
    expect(await rec(t)).toMatchObject({ status: "COMPLETED", cost: 50 });
    const u = makeT();
    await seed(u, "IN_PROGRESS", true);
    await complete(u, { labour: null }, "c1", asAgent);
    expect((await rec(u)).cost).toBe(50);
  });

  test("refusals: a closed job, a disposition for an unlinked asset, bad labour, another org's job", async () => {
    const t = makeT();
    await seed(t);
    await expect(complete(t, { dispositions: [{ assetId: "elsewhere", disposition: "RETIRE" }] })).rejects.toThrow(/not on this job/);
    await expect(complete(t, { labour: -1 })).rejects.toThrow(/at least 0/);
    await expect(complete(t, {}, "cx", asUser, "rx")).rejects.toThrow(/not found/i);
    await complete(t, {}, "c1");
    await expect(complete(t, {}, "c2")).rejects.toMatchObject({ data: { code: "NOT_OPEN" } });
    const u = makeT();
    await seed(u, "CANCELLED");
    await expect(complete(u)).rejects.toMatchObject({ data: { code: "NOT_OPEN" } });
  });
});

describe("reopenNative", () => {
  test("a completed job goes back to In progress with the completion cleared, released assets back on hold; Undo reverses", async () => {
    const t = makeT();
    await seed(t);
    await complete(t, { labour: 80 });
    expect(await reopen(t)).toEqual({ id: "r1", undoable: true });
    const r = await rec(t);
    expect(r).toMatchObject({ status: "IN_PROGRESS", cost: 80 });
    expect(r.result).toBeUndefined();
    expect(r.completedDate).toBeUndefined();
    expect((await asset(t, "a1")).status).toBe("IN_MAINTENANCE");
    await undo(t, "o1");
    expect(await rec(t)).toMatchObject({ status: "COMPLETED", result: "PASS", completedDate: NOW - DAY });
    expect((await asset(t, "a1")).status).toBe("AVAILABLE");
  });

  test("only a completed job can be reopened", async () => {
    const t = makeT();
    await seed(t);
    await expect(reopen(t)).rejects.toMatchObject({ data: { code: "NOT_COMPLETED" } });
  });

  test("a retired asset stays retired on Reopen", async () => {
    const t = makeT();
    await seed(t);
    await complete(t, { dispositions: [{ assetId: "a1", disposition: "RETIRE" }] });
    await reopen(t);
    expect((await asset(t, "a1")).status).toBe("RETIRED");
    expect((await asset(t, "a2")).status).toBe("IN_MAINTENANCE");
  });
});

describe("the exact Undo", () => {
  afterEach(() => vi.useRealTimers());

  test("refuses when the record was edited since, or an asset moved since (changing nothing)", async () => {
    const t = makeT();
    await seed(t);
    await complete(t);
    await t.run(async (ctx) => {
      const a = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a2")).first();
      await ctx.db.patch(a!._id, { status: "CHECKED_OUT", updatedAt: NOW + 9 });
    });
    await expect(undo(t, "c1")).rejects.toMatchObject({ data: { code: "CHANGED_SINCE" } });
    expect((await rec(t)).status).toBe("COMPLETED"); // nothing restored
    expect((await asset(t, "a1")).status).toBe("AVAILABLE");

    const u = makeT();
    await seed(u);
    await complete(u);
    await u.run(async (ctx) => {
      const r = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", "r1")).first();
      await ctx.db.patch(r!._id, { updatedAt: NOW + 5, title: "Edited" });
    });
    await expect(undo(u, "c1")).rejects.toMatchObject({ data: { code: "CHANGED_SINCE" } });
  });

  test("refuses another person, an unknown id, and an expired window", async () => {
    const t = makeT();
    await seed(t);
    await complete(t);
    await expect(undo(t, "c1", { subject: "user_2", orgId: ORG }, { userId: "user_2", userName: "Bob" })).rejects.toMatchObject({ data: { code: "NOT_AUTHOR" } });
    await expect(undo(t, "nope")).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    await expect(undo(t, "c1")).rejects.toThrow(/10 minutes|too long|expired/i);
    vi.useRealTimers();
    expect((await rec(t)).status).toBe("COMPLETED");
  });
});
