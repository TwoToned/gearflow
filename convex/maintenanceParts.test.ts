// @vitest-environment node
//
// UX Phase 14 (14b-3, D76): maintenance PARTS. Rows on a record with a derived cost, browser-direct writes that each
// leave ONE audit row on the record and an exact Undo (ids only, the author, the window, once, only while the part
// is as the write left it), the Awaiting parts to In progress move on the last arrival, and money that follows the
// job-cost line.
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
const KEY = "key_1";
const asUser = { subject: USER, orgId: ORG };
const asAgent = { subject: USER, orgId: ORG, akid: KEY };
const ACTOR = { userId: USER, userName: "Alice" };
const NOW = Date.now();

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
async function seed(t: T, status: "SCHEDULED" | "AWAITING_PARTS" | "IN_PROGRESS" = "AWAITING_PARTS", noFinancialsKey = false) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: "user_2", role: "owner" });
    await ctx.db.insert("maintenanceRecords", { id: "r1", organizationId: ORG, type: "REPAIR", title: "Fix the desk", status, cost: 50, createdAt: 1, updatedAt: 1 } as never);
    await ctx.db.insert("maintenanceRecords", { id: "rx", organizationId: "org_2", type: "REPAIR", title: "Theirs", status: "SCHEDULED", createdAt: 1, updatedAt: 1 } as never);
    if (noFinancialsKey) {
      await ctx.db.insert("apiKeys", { id: KEY, organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h", scopes: JSON.stringify(["*"]), isActive: true, actingUserId: USER, createdById: USER, noFinancials: true });
    }
  });
}
const rec = (t: T) => t.run(async (ctx) => (await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", "r1")).first())!);
const part = (t: T, id: string) => t.run(async (ctx) => await ctx.db.query("maintenanceParts").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const base = { orgId: ORG, recordId: "r1", actor: ACTOR, now: NOW };

const add = (t: T, id: string, p: Record<string, unknown> = {}, auditId = `a_${id}`, who: Parameters<T["withIdentity"]>[0] = asUser) =>
  t.withIdentity(who).mutation(api.maintenancePartsWrites.addNative, { ...base, id, part: { name: "Gas strut", quantity: 2, unitPrice: 12.5, ...p }, auditId } as never);
const edit = (t: T, id: string, set: Record<string, unknown>, clear: string[] = [], auditId = `e_${id}`, who: Parameters<T["withIdentity"]>[0] = asUser) =>
  t.withIdentity(who).mutation(api.maintenancePartsWrites.editNative, { ...base, id, set, clear, auditId } as never);
const remove = (t: T, id: string, auditId = `d_${id}`) => t.withIdentity(asUser).mutation(api.maintenancePartsWrites.removeNative, { ...base, id, auditId });
const arrive = (t: T, id: string, auditId = `v_${id}`) => t.withIdentity(asUser).mutation(api.maintenancePartsWrites.markArrivedNative, { ...base, id, arrivedAt: NOW, auditId });
const undo = (t: T, auditId: string, who: Parameters<T["withIdentity"]>[0] = asUser, actor = ACTOR) =>
  t.withIdentity(who).mutation(api.maintenancePartsWrites.undoNative, { orgId: ORG, recordId: "r1", auditId, now: NOW + 1, actor });
const list = (t: T, who: Parameters<T["withIdentity"]>[0] = asUser) => t.withIdentity(who).query(api.maintenanceParts.listForRecord, { orgId: ORG, recordId: "r1", now: NOW });

describe("add, edit, remove and their exact Undo", () => {
  afterEach(() => vi.useRealTimers());

  test("add stores the row, bumps the record, and Undo removes exactly that row", async () => {
    const t = makeT();
    await seed(t);
    await add(t, "p1");
    expect(await part(t, "p1")).toMatchObject({ name: "Gas strut", quantity: 2, unitPrice: 12.5, maintenanceRecordId: "r1" });
    expect((await rec(t)).updatedAt).toBe(NOW);
    await undo(t, "a_p1");
    expect(await part(t, "p1")).toBeNull();
    await expect(undo(t, "a_p1")).rejects.toThrow(/already undone/);
  });

  test("edit sets and CLEARS fields; Undo restores the cleared price; an unchanged edit writes nothing", async () => {
    const t = makeT();
    await seed(t);
    await add(t, "p1", { supplierName: "Acme", etaDate: NOW + 86_400_000 });
    expect(await edit(t, "p1", { name: "Gas strut x2", quantity: 3 }, ["supplierName", "unitPrice"])).toEqual({ id: "p1", changed: true });
    const after = await part(t, "p1");
    expect(after).toMatchObject({ name: "Gas strut x2", quantity: 3 });
    expect(after?.supplierName).toBeUndefined();
    expect(after?.unitPrice).toBeUndefined();
    await undo(t, "e_p1");
    expect(await part(t, "p1")).toMatchObject({ name: "Gas strut", quantity: 2, unitPrice: 12.5, supplierName: "Acme" });
    expect(await edit(t, "p1", { name: "Gas strut" }, [], "e2")).toEqual({ id: "p1", changed: false });
  });

  test("remove deletes the row; Undo puts it back with the same id and values", async () => {
    const t = makeT();
    await seed(t);
    await add(t, "p1", { supplierName: "Acme" });
    await remove(t, "p1");
    expect(await part(t, "p1")).toBeNull();
    await undo(t, "d_p1");
    expect(await part(t, "p1")).toMatchObject({ id: "p1", name: "Gas strut", quantity: 2, unitPrice: 12.5, supplierName: "Acme" });
  });

  test("an Undo refuses once the part changed since, from another person, or after the window", async () => {
    const t = makeT();
    await seed(t);
    await add(t, "p1");
    await edit(t, "p1", { quantity: 9 }, [], "e1");
    await expect(undo(t, "a_p1")).rejects.toMatchObject({ data: { code: "CHANGED_SINCE" } }); // the add's Undo, after an edit
    await expect(undo(t, "e1", { subject: "user_2", orgId: ORG }, { userId: "user_2", userName: "Bob" })).rejects.toMatchObject({ data: { code: "NOT_AUTHOR" } });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    await expect(undo(t, "e1")).rejects.toThrow(/10 minutes|too long|expired/i);
    vi.useRealTimers();
    expect((await part(t, "p1"))?.quantity).toBe(9);
  });

  test("an Undo of remove refuses when the id is back in use", async () => {
    const t = makeT();
    await seed(t);
    await add(t, "p1");
    await remove(t, "p1");
    await add(t, "p1", {}, "a2");
    await expect(undo(t, "d_p1")).rejects.toMatchObject({ data: { code: "CHANGED_SINCE" } });
  });

  test("validation: empty name, bad quantity, negative price, a duplicate id, too many parts, another org's record", async () => {
    const t = makeT();
    await seed(t);
    await expect(add(t, "p1", { name: "  " })).rejects.toThrow(/needs a name/);
    await expect(add(t, "p1", { quantity: 0 })).rejects.toThrow(/at least 1/);
    await expect(add(t, "p1", { quantity: 1.5 })).rejects.toThrow(/whole number/);
    await expect(add(t, "p1", { unitPrice: -1 })).rejects.toThrow(/at least 0/);
    await add(t, "p1");
    await expect(add(t, "p1", {}, "a_dup")).rejects.toThrow(/already exists/);
    await expect(edit(t, "p1", {}, ["name"])).rejects.toThrow(/can't be cleared/);
    await expect(t.withIdentity(asUser).mutation(api.maintenancePartsWrites.addNative, { ...base, recordId: "rx", id: "px", part: { name: "x", quantity: 1 }, auditId: "ax" } as never)).rejects.toThrow(/not found/i);
  });

  test("a job holds at most 200 parts", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 200; i++) await ctx.db.insert("maintenanceParts", { id: `bulk${i}`, organizationId: ORG, maintenanceRecordId: "r1", name: "x", quantity: 1 });
    });
    await expect(add(t, "p201")).rejects.toMatchObject({ data: { code: "TOO_MANY_PARTS" } });
  });

  test("a part id that belongs to another record or org is not found", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("maintenanceParts", { id: "foreign", organizationId: "org_2", maintenanceRecordId: "r1", name: "x", quantity: 1 });
    });
    await expect(edit(t, "foreign", { quantity: 5 })).rejects.toThrow(/not found/i);
    await expect(remove(t, "foreign")).rejects.toThrow(/not found/i);
    expect((await part(t, "foreign"))?.quantity).toBe(1);
  });
});

describe("mark arrived", () => {
  test("the LAST arrival moves Awaiting parts to In progress; Undo reverses both; an earlier arrival does not", async () => {
    const t = makeT();
    await seed(t, "AWAITING_PARTS");
    await add(t, "p1");
    await add(t, "p2");
    expect(await arrive(t, "p1")).toEqual({ id: "p1", changed: true, advanced: false });
    expect((await rec(t)).status).toBe("AWAITING_PARTS");
    expect(await arrive(t, "p2")).toEqual({ id: "p2", changed: true, advanced: true });
    expect((await rec(t)).status).toBe("IN_PROGRESS");
    await undo(t, "v_p2");
    expect((await rec(t)).status).toBe("AWAITING_PARTS");
    expect((await part(t, "p2"))?.arrivedAt).toBeUndefined();
    expect((await part(t, "p1"))?.arrivedAt).toBe(NOW);
  });

  test("a job that is not Awaiting parts keeps its status; an already-arrived part is a no-op", async () => {
    const t = makeT();
    await seed(t, "IN_PROGRESS");
    await add(t, "p1");
    expect(await arrive(t, "p1")).toEqual({ id: "p1", changed: true, advanced: false });
    expect((await rec(t)).status).toBe("IN_PROGRESS");
    expect(await arrive(t, "p1", "v2")).toEqual({ id: "p1", changed: false, advanced: false });
  });

  test("Undo of the advancing arrival refuses once the job moved on", async () => {
    const t = makeT();
    await seed(t, "AWAITING_PARTS");
    await add(t, "p1");
    await arrive(t, "p1");
    await t.run(async (ctx) => {
      const r = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", "r1")).first();
      await ctx.db.patch(r!._id, { status: "QA", updatedAt: NOW + 5 });
    });
    await expect(undo(t, "v_p1")).rejects.toMatchObject({ data: { code: "CHANGED_SINCE" } });
    expect((await rec(t)).status).toBe("QA");
  });
});

describe("the parts read and the derived cost", () => {
  test("parts, the summary and the cost (parts + labour) for a caller who sees job cost", async () => {
    const t = makeT();
    await seed(t);
    await add(t, "p1", { quantity: 2, unitPrice: 10 });
    await add(t, "p2", { name: "Cable", quantity: 1, unitPrice: undefined, etaDate: NOW + 86_400_000 }, "a2");
    await arrive(t, "p1");
    const r = await list(t);
    expect(r.parts.map((p) => p.name)).toEqual(["Gas strut", "Cable"]);
    expect(r.summary).toMatchObject({ count: 2, onOrder: 1, arrived: 1 });
    expect(r.cost).toEqual({ parts: 20, labour: 50, total: 70, unpricedParts: 1 });
  });

  test("a noFinancials key gets NO price and NO cost, and cannot set or clear a price", async () => {
    const t = makeT();
    await seed(t, "AWAITING_PARTS", true);
    await add(t, "p1", { unitPrice: 99 }, "a_p1", asUser); // the owner prices it
    const r = await list(t, asAgent);
    expect(r.cost).toBeNull();
    expect(r.parts[0]).not.toHaveProperty("unitPrice");
    await add(t, "p2", { name: "Hidden price", unitPrice: 5 }, "a_p2", asAgent);
    expect((await part(t, "p2"))?.unitPrice).toBeUndefined(); // an add through the key stores no price
    await edit(t, "p1", { unitPrice: 1, name: "Renamed" }, [], "e_p1", asAgent);
    expect(await part(t, "p1")).toMatchObject({ name: "Renamed", unitPrice: 99 }); // the price it sent was ignored
    await edit(t, "p1", {}, ["unitPrice"], "e2_p1", asAgent);
    expect((await part(t, "p1"))?.unitPrice).toBe(99); // and it cannot clear it
  });

  test("another org's record is not readable", async () => {
    const t = makeT();
    await seed(t);
    await expect(t.withIdentity(asUser).query(api.maintenanceParts.listForRecord, { orgId: ORG, recordId: "rx" })).rejects.toThrow(/not found/i);
  });
});

describe("record delete cascades to its parts", () => {
  test("deleteNative removes the parts and leaves another org's alone", async () => {
    const t = makeT();
    await seed(t, "SCHEDULED");
    await t.run(async (ctx) => {
      await ctx.db.insert("maintenanceRecordAssets", { id: "l1", maintenanceRecordId: "r1", assetId: "a1", kind: "LINK" });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m", assetTag: "A-1", status: "AVAILABLE", isActive: true });
    });
    await add(t, "p1");
    await t.run(async (ctx) => {
      await ctx.db.insert("maintenanceParts", { id: "other", organizationId: "org_2", maintenanceRecordId: "r1", name: "x", quantity: 1 });
    });
    await t.withIdentity(asUser).mutation(api.maintenanceWrites.deleteNative, { orgId: ORG, id: "r1", now: NOW, actor: ACTOR, auditId: "del1" });
    expect(await part(t, "p1")).toBeNull();
    expect(await part(t, "other")).not.toBeNull();
  });
});
