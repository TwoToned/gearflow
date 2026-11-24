// @vitest-environment node
//
// UX Phase 14 (14a-1): the Models and Sales stock list reads, and the exact Undo of a manual
// sale-stock adjustment. Cross-tenant rows must never appear; derived figures follow
// convex/lib/saleStockFacts.ts.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const asUser = { subject: USER, orgId: ORG };
const ACTOR = { userId: USER, userName: "Alice" };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("categories", { id: "cat", organizationId: ORG, name: "Lighting" });
    await ctx.db.insert("models", { id: "stocked", organizationId: ORG, name: "MAC Aura", categoryId: "cat", dailyRate: 100, isActive: true });
    await ctx.db.insert("models", { id: "empty", organizationId: ORG, name: "Truss", isActive: true });
    await ctx.db.insert("models", { id: "gone", organizationId: ORG, name: "Old Par", isActive: false });
    await ctx.db.insert("models", { id: "foreign", organizationId: OTHER, name: "Foreign", isActive: true });
    await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "stocked", assetTag: "A-1", status: "AVAILABLE", isActive: true });
    await ctx.db.insert("assets", { id: "a2", organizationId: ORG, modelId: "stocked", assetTag: "A-2", status: "CHECKED_OUT", isActive: true });
    await ctx.db.insert("assets", { id: "a3", organizationId: ORG, modelId: "stocked", assetTag: "A-3", status: "AVAILABLE", isActive: false });
    await ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, modelId: "stocked", assetTag: "B-1", totalQuantity: 10, availableQuantity: 7, isActive: true });
    await ctx.db.insert("assets", { id: "fa", organizationId: OTHER, modelId: "stocked", assetTag: "F-1", status: "AVAILABLE", isActive: true });
  });
}

const names = (r: { items: { name: string }[] }) => r.items.map((i) => i.name);

describe("modelsList.listPage", () => {
  test("owned and available count active units and bulk quantity, never another org's", async () => {
    const t = makeT();
    await seed(t);
    const r = await t.withIdentity(asUser).query(api.modelsList.listPage, { orgId: ORG });
    const row = r.items.find((i) => i.id === "stocked")!;
    expect(row).toMatchObject({ owned: 12, available: 8 });
    expect(names(r)).toEqual(["MAC Aura", "Truss"]);
    expect(row.category).toMatchObject({ name: "Lighting" });
  });

  test("segments: With stock, No stock, Archived; counts match", async () => {
    const t = makeT();
    await seed(t);
    const q = (segment: string) => t.withIdentity(asUser).query(api.modelsList.listPage, { orgId: ORG, segment });
    expect(names(await q("stock"))).toEqual(["MAC Aura"]);
    expect(names(await q("nostock"))).toEqual(["Truss"]);
    expect(names(await q("archived"))).toEqual(["Old Par"]);
    const counts = await t.withIdentity(asUser).query(api.modelsList.segmentCounts, { orgId: ORG });
    expect(counts).toEqual({ all: 2, stock: 1, nostock: 1, due: 0, archived: 1 });
  });

  test("Due for T&T lists the model of a due asset", async () => {
    const t = makeT();
    await seed(t);
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("testTagAssets", { id: "t1", organizationId: ORG, testTagId: "T1", description: "x", isActive: true, assetId: "a1", nextDueDate: now + 86_400_000 });
    });
    const r = await t.withIdentity(asUser).query(api.modelsList.listPage, { orgId: ORG, segment: "due", now });
    expect(names(r)).toEqual(["MAC Aura"]);
  });

  test("search, category filter, sort and paging", async () => {
    const t = makeT();
    await seed(t);
    const as = t.withIdentity(asUser);
    expect(names(await as.query(api.modelsList.listPage, { orgId: ORG, search: "truss" }))).toEqual(["Truss"]);
    expect(names(await as.query(api.modelsList.listPage, { orgId: ORG, categoryIdIn: ["cat"] }))).toEqual(["MAC Aura"]);
    expect(names(await as.query(api.modelsList.listPage, { orgId: ORG, sortBy: "owned", sortOrder: "desc" }))).toEqual(["MAC Aura", "Truss"]);
    const p2 = await as.query(api.modelsList.listPage, { orgId: ORG, page: 2, pageSize: 1 });
    expect(names(p2)).toEqual(["Truss"]);
    expect(p2.total).toBe(2);
  });

  test("a caller from another org is rejected", async () => {
    const t = makeT();
    await seed(t);
    await expect(t.withIdentity({ subject: USER, orgId: OTHER }).query(api.modelsList.listPage, { orgId: ORG })).rejects.toThrow();
  });

  test("a noFinancials-free caller sees cost fields; Value is a plain model field", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      const m = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", "stocked")).first();
      await ctx.db.patch(m!._id, { replacementCost: 4321 });
    });
    const r = await t.withIdentity(asUser).query(api.modelsList.listPage, { orgId: ORG });
    expect(r.items.find((i) => i.id === "stocked")).toMatchObject({ replacementCost: 4321 });
  });
});

async function seedSales(t: T) {
  await seed(t);
  await t.run(async (ctx) => {
    const set = async (id: string, patch: Record<string, unknown>) => {
      const m = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      await ctx.db.patch(m!._id, patch);
    };
    await set("stocked", { saleStockQuantity: 3, reorderLevel: 5, salePrice: 9 });
    await set("empty", { saleStockQuantity: 0, salePrice: 4 });
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P-1", name: "Gig", status: "CONFIRMED", isTemplate: false, liveVersionId: "v1", createdAt: 1, updatedAt: 1 });
    const line = { organizationId: ORG, projectId: "p1", type: "SALE" as const, saleMode: "NEW_STOCK" as const, status: "CONFIRMED" as const, description: "x" };
    await ctx.db.insert("projectLineItems", { ...line, id: "l1", modelId: "empty", quantity: 12, versionId: "v1" } as never);
    // Not the live version, already out, and another org's line: none of them reserve.
    await ctx.db.insert("projectLineItems", { ...line, id: "l2", modelId: "empty", quantity: 99, versionId: "v0" } as never);
    await ctx.db.insert("projectLineItems", { ...line, id: "l3", modelId: "empty", quantity: 98, versionId: "v1", status: "CHECKED_OUT" } as never);
    await ctx.db.insert("projectLineItems", { ...line, id: "l4", organizationId: OTHER, modelId: "empty", quantity: 97, versionId: "v1" } as never);
  });
}

describe("modelsList.saleStockPage", () => {
  test("Out of stock with 12 reserved: on hand - reserved = available", async () => {
    const t = makeT();
    await seedSales(t);
    const r = await t.withIdentity(asUser).query(api.modelsList.saleStockPage, { orgId: ORG });
    const empty = r.items.find((i) => i.id === "empty")!;
    expect(empty).toMatchObject({ available: 0, reserved: 12, onHand: 12, state: "OUT" });
    for (const i of r.items) expect(i.onHand - i.reserved).toBe(i.available);
  });

  test("Low stock needs a set reorder level; strip counts agree with the segments", async () => {
    const t = makeT();
    await seedSales(t);
    const as = t.withIdentity(asUser);
    expect((await as.query(api.modelsList.saleStockPage, { orgId: ORG, segment: "low" })).items.map((i) => i.id)).toEqual(["stocked"]);
    expect((await as.query(api.modelsList.saleStockPage, { orgId: ORG, segment: "out" })).items.map((i) => i.id)).toEqual(["empty"]);
    expect(await as.query(api.modelsList.saleStockSegmentCounts, { orgId: ORG })).toEqual({ all: 2, low: 1, out: 1 });
  });
});

describe("exact Undo of a manual sale-stock adjustment", () => {
  afterEach(() => vi.useRealTimers());

  const adjust = (t: T, auditId = "aud-1", delta = 5) =>
    t.withIdentity(asUser).mutation(api.modelWrites.adjustSaleStockManyNative, {
      orgId: ORG, adjustments: [{ id: "stocked", delta }], now: Date.now(), actor: ACTOR, auditIds: [auditId],
    });
  const undo = (t: T, ids = ["aud-1"], identity = asUser) =>
    t.withIdentity(identity).mutation(api.modelWrites.undoSaleStockNative, { orgId: ORG, auditIds: ids, now: Date.now(), actor: ACTOR });
  const pool = (t: T) =>
    t.run(async (ctx) => (await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", "stocked")).first())?.saleStockQuantity);

  test("restores the exact prior pool and cannot run twice", async () => {
    const t = makeT();
    await seedSales(t);
    const r = await adjust(t);
    expect(r.results[0]).toMatchObject({ auditId: "aud-1", from: 3, to: 8 });
    expect(await pool(t)).toBe(8);
    expect(await undo(t)).toEqual({ restored: 1 });
    expect(await pool(t)).toBe(3);
    await expect(undo(t)).rejects.toThrow(/already undone/);
    expect(await pool(t)).toBe(3);
  });

  test("refuses when the pool moved since (a later sale or adjustment)", async () => {
    const t = makeT();
    await seedSales(t);
    await adjust(t);
    await adjust(t, "aud-2", 1);
    await expect(undo(t)).rejects.toThrow(/changed since/);
    expect(await pool(t)).toBe(9);
  });

  test("refuses another person, and is all-or-nothing across a batch", async () => {
    const t = makeT();
    await seedSales(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: "user_2", role: "owner" });
    });
    await adjust(t);
    await expect(undo(t, ["aud-1"], { subject: "user_2", orgId: ORG })).rejects.toThrow();
    expect(await pool(t)).toBe(8);
    // A second, bogus id fails the whole batch and leaves the real one applied.
    await expect(undo(t, ["aud-1", "nope"])).rejects.toThrow(/can't be undone/);
    expect(await pool(t)).toBe(8);
  });

  test("refuses outside the 10-minute server-clock window", async () => {
    const t = makeT();
    await seedSales(t);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T10:00:00Z"));
    await adjust(t);
    vi.setSystemTime(new Date("2026-11-24T10:11:00Z"));
    await expect(undo(t)).rejects.toThrow(/10 minutes/);
    expect(await pool(t)).toBe(8);
  });

  test("never undoes a line-driven change or another org's row", async () => {
    const t = makeT();
    await seedSales(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("activityLogs", {
        id: "line-1", organizationId: ORG, action: "UPDATE", entityType: "model", entityId: "stocked", entityName: "x", userId: USER, userName: "A",
        summary: "Sold", details: { saleStock: { from: 3, to: 2, projectId: "p1", serverSavedAt: Date.now() } }, createdAt: 1,
      });
      await ctx.db.insert("activityLogs", {
        id: "foreign-1", organizationId: OTHER, action: "UPDATE", entityType: "model", entityId: "foreign", entityName: "x", userId: USER, userName: "A",
        summary: "x", details: { saleStock: { from: 1, to: 2, serverSavedAt: Date.now() } }, createdAt: 1,
      });
    });
    await expect(undo(t, ["line-1"])).rejects.toThrow(/can't be undone/);
    await expect(undo(t, ["foreign-1"])).rejects.toThrow(/can't be undone/);
  });

  test("a stranger from another org cannot adjust", async () => {
    const t = makeT();
    await seedSales(t);
    await expect(
      t.withIdentity({ subject: USER, orgId: OTHER }).mutation(api.modelWrites.adjustSaleStockManyNative, {
        orgId: ORG, adjustments: [{ id: "stocked", delta: 1 }], now: Date.now(), actor: ACTOR, auditIds: ["x"],
      }),
    ).rejects.toThrow();
  });
});
