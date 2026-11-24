// @vitest-environment node
//
// UX Phase 14 (14a-1 follow-ups): the exact Undo of bulk `Edit rates` and of `Set reorder level`
// (both through convex/lib/fieldEditUndo.ts), and of bulk `Assign checks`. Ids only; each refusal pinned.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const USER = "user_1";
const asUser = { subject: USER, orgId: ORG };
const ACTOR = { userId: USER, userName: "Alice" };
const NOW = 1_800_000_000_000;

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: "user_2", role: "owner" });
    await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "Par", dailyRate: 100, defaultRentalPrice: 100, isActive: true });
    await ctx.db.insert("models", { id: "m2", organizationId: ORG, name: "Truss", dailyRate: 50, defaultRentalPrice: 50, isActive: true });
    await ctx.db.insert("checkItems", { id: "c1", organizationId: ORG, label: "Visual", type: "PASS_FAIL" } as never);
  });
}
const model = (t: T, id: string) => t.run(async (ctx) => (await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).first())!);

describe("Edit rates Undo", () => {
  afterEach(() => vi.useRealTimers());
  const edit = (t: T, value = 10) =>
    t.withIdentity(asUser).mutation(api.modelWrites.bulkUpdateRatesNative, { orgId: ORG, modelIds: ["m1", "m2"], rateType: "dailyRate", operation: "increase_percent", value, now: NOW, actor: ACTOR, auditId: "rt" });
  const undo = (t: T, ids: string[], id = asUser) => t.withIdentity(id).mutation(api.modelWrites.undoModelFieldEditsNative, { orgId: ORG, auditIds: ids, now: NOW + 1, actor: ACTOR });

  test("restores each model's exact prior rate (and the default price it moved), once", async () => {
    const t = makeT();
    await seed(t);
    const r = await edit(t);
    expect(r).toMatchObject({ count: 2 });
    expect(r.auditIds).toHaveLength(2);
    expect((await model(t, "m1")).dailyRate).toBe(110);
    expect(await undo(t, r.auditIds)).toEqual({ restored: 2 });
    expect(await model(t, "m1")).toMatchObject({ dailyRate: 100, defaultRentalPrice: 100 });
    expect(await model(t, "m2")).toMatchObject({ dailyRate: 50, defaultRentalPrice: 50 });
    await expect(undo(t, r.auditIds)).rejects.toThrow(/already undone/i);
  });

  test("refuses the WHOLE batch when one model's rate changed since: nothing is restored", async () => {
    const t = makeT();
    await seed(t);
    const r = await edit(t);
    await t.run(async (ctx) => {
      const m = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", "m2")).first();
      await ctx.db.patch(m!._id, { dailyRate: 99 });
    });
    await expect(undo(t, r.auditIds)).rejects.toThrow(/changed since/i);
    expect((await model(t, "m1")).dailyRate).toBe(110);
  });

  test("refuses another person and refuses past the 10-minute window", async () => {
    const t = makeT();
    await seed(t);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T10:00:00Z"));
    const r = await edit(t);
    await expect(undo(t, r.auditIds, { subject: "user_2", orgId: ORG })).rejects.toThrow();
    vi.setSystemTime(new Date("2026-11-24T10:11:00Z"));
    await expect(undo(t, r.auditIds)).rejects.toThrow(/10 minutes/);
    expect((await model(t, "m1")).dailyRate).toBe(110);
  });

  test("a sale-stock audit id (not a field edit) is not undoable here", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("activityLogs", { id: "x", organizationId: ORG, action: "UPDATE", entityType: "model", entityId: "m1", entityName: "Par", userId: USER, userName: "A", summary: "s", details: { saleStock: { from: 1, to: 2 } }, createdAt: 1 });
    });
    await expect(undo(t, ["x"])).rejects.toThrow();
  });
});

describe("Set reorder level", () => {
  const set = (t: T, level: number | null) =>
    t.withIdentity(asUser).mutation(api.modelWrites.setReorderLevelsNative, { orgId: ORG, entries: [{ id: "m1", level }], now: NOW, actor: ACTOR, auditId: "ro" });
  const undo = (t: T, ids: string[]) => t.withIdentity(asUser).mutation(api.modelWrites.undoModelFieldEditsNative, { orgId: ORG, auditIds: ids, now: NOW + 1, actor: ACTOR });

  test("sets, then Undo clears it again: an unset level stays absent, never 0", async () => {
    const t = makeT();
    await seed(t);
    const r = await set(t, 20);
    expect((await model(t, "m1")).reorderLevel).toBe(20);
    await undo(t, r.auditIds);
    expect((await model(t, "m1")).reorderLevel).toBeUndefined();
  });

  test("blank clears; setting the same value changes nothing and returns no audit id", async () => {
    const t = makeT();
    await seed(t);
    await set(t, 5);
    expect(await set(t, 5)).toEqual({ auditIds: [], count: 0 });
    const r = await set(t, null);
    expect(r.count).toBe(1);
    expect((await model(t, "m1")).reorderLevel).toBeUndefined();
  });

  test("rejects a negative or fractional level and another org's model", async () => {
    const t = makeT();
    await seed(t);
    await expect(set(t, -1)).rejects.toThrow();
    await expect(set(t, 1.5)).rejects.toThrow();
    await expect(t.withIdentity({ subject: USER, orgId: "org_2" }).mutation(api.modelWrites.setReorderLevelsNative, { orgId: ORG, entries: [{ id: "m1", level: 3 }], now: NOW, actor: ACTOR, auditId: "z" })).rejects.toThrow();
  });
});

describe("Assign checks Undo", () => {
  const assign = (t: T) =>
    t.withIdentity(asUser).mutation(api.checkItemsWrites.bulkAddCheckItemsToModelsNative, { orgId: ORG, modelIds: ["m1", "m2"], checkItemIds: ["c1"], rowIds: ["r1", "r2"], now: NOW, actor: ACTOR, auditId: "as1" });
  const undo = (t: T, id = asUser) => t.withIdentity(id).mutation(api.checkItemsWrites.undoAssignChecksNative, { orgId: ORG, auditId: "as1", now: NOW + 1, actor: ACTOR });
  const rows = (t: T) => t.run(async (ctx) => (await ctx.db.query("modelCheckItems").collect()).map((r) => r.id).sort());

  test("removes exactly the assignments it created, once", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      // An assignment that already existed must survive the Undo.
      await ctx.db.insert("modelCheckItems", { id: "pre", organizationId: ORG, modelId: "m1", checkItemId: "c0", sortOrder: 0 } as never);
    });
    await assign(t);
    expect(await rows(t)).toEqual(["pre", "r1", "r2"]);
    expect(await undo(t)).toEqual({ removed: 2, left: 0 });
    expect(await rows(t)).toEqual(["pre"]);
    await expect(undo(t)).rejects.toThrow(/already undone/);
  });

  test("leaves an assignment that was reordered since, and says so", async () => {
    const t = makeT();
    await seed(t);
    await assign(t);
    await t.run(async (ctx) => {
      const r = await ctx.db.query("modelCheckItems").withIndex("by_cuid", (q) => q.eq("id", "r1")).first();
      await ctx.db.patch(r!._id, { sortOrder: 9 });
    });
    expect(await undo(t)).toEqual({ removed: 1, left: 1 });
    expect(await rows(t)).toEqual(["r1"]);
  });

  test("refuses another person", async () => {
    const t = makeT();
    await seed(t);
    await assign(t);
    await expect(undo(t, { subject: "user_2", orgId: ORG })).rejects.toThrow(/Only the person/);
    expect(await rows(t)).toEqual(["r1", "r2"]);
  });
});
