// @vitest-environment node
//
// Sales stock "Reserved" must be exactly what the pool has given out (review ruling). These drive the REAL
// write path (`lineItemWrites.addNative`) and then read `modelsList.saleStockPage`, so a drift between the
// decrement and the Reserved read fails here. The invariant in every case: On hand = the pool before the
// adds, minus whatever physically left the building.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { ReadBudget } from "./lib/readBudget";
import { loadReservedByModel, takesFromPool, isReservedSaleLine } from "./lib/saleStockFacts";

const modules = import.meta.glob("./**/*.ts");
function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
type T = ReturnType<typeof makeT>;

const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const as = (t: T) => t.withIdentity({ subject: USER, orgId: ORG });
const ACTOR = { userId: USER, userName: "Alice" };
const POOL = 20;

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "QUOTED", isTemplate: false, liveVersionId: "v1", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("projectVersions", { id: "v1", organizationId: ORG, projectId: "p1", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "SM58", salePrice: 120, saleStockQuantity: POOL });
  });
}

let n = 0;
async function addSale(t: T, over: Record<string, unknown>, qty = 3) {
  const id = `sale${++n}`;
  await as(t).mutation(api.lineItemWrites.addNative, {
    id, organizationId: ORG, projectId: "p1",
    fields: { type: "SALE", modelId: "m1", quantity: qty, unitPrice: 120, ...over },
    includeAccessories: false, allowOverbook: false, actor: ACTOR, auditId: `log${n}`, now: NOW,
  } as never);
  return id;
}
const patchLine = (t: T, id: string, patch: Record<string, unknown>) =>
  t.run(async (ctx) => {
    const l = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    await ctx.db.patch(l!._id, patch);
  });
async function row(t: T) {
  const r = await as(t).query(api.modelsList.saleStockPage, { orgId: ORG });
  return r.items.find((i) => i.id === "m1")!;
}

describe("Reserved is exactly what the pool gave out", () => {
  test("a live explicit NEW_STOCK line: pool down, reserved up, on hand unchanged", async () => {
    const t = makeT();
    await seed(t);
    await addSale(t, { saleMode: "NEW_STOCK" });
    expect(await row(t)).toMatchObject({ available: POOL - 3, reserved: 3, onHand: POOL });
  });

  test("a CANCELLED job still holds what was taken (nothing restores it): honest, still reserved", async () => {
    const t = makeT();
    await seed(t);
    await addSale(t, { saleMode: "NEW_STOCK" });
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      await ctx.db.patch(p!._id, { status: "CANCELLED" });
    });
    expect(await row(t)).toMatchObject({ available: POOL - 3, reserved: 3, onHand: POOL });
  });

  test("a line on a DRAFT (non-live) version was decremented too, so it is reserved", async () => {
    const t = makeT();
    await seed(t);
    const id = await addSale(t, { saleMode: "NEW_STOCK" });
    await patchLine(t, id, { versionId: "v0" });
    expect(await row(t)).toMatchObject({ available: POOL - 3, reserved: 3, onHand: POOL });
  });

  test("an UNSET saleMode is neither decremented nor reserved (whatever the write path does today)", async () => {
    const t = makeT();
    await seed(t);
    await addSale(t, {});
    const r = await row(t);
    expect(r.available).toBe(POOL);
    expect(r).toMatchObject({ reserved: 0, onHand: POOL });
  });

  test("a CHECKED_OUT line has left the building: not reserved, on hand drops with it", async () => {
    const t = makeT();
    await seed(t);
    const id = await addSale(t, { saleMode: "NEW_STOCK" });
    await patchLine(t, id, { status: "CHECKED_OUT" });
    expect(await row(t)).toMatchObject({ available: POOL - 3, reserved: 0, onHand: POOL - 3 });
  });

  test("a copy of a line in another version is one add: counted once per lineage", async () => {
    const t = makeT();
    await seed(t);
    const id = await addSale(t, { saleMode: "NEW_STOCK" });
    await t.run(async (ctx) => {
      const l = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      const { _id, _creationTime, ...rest } = l!;
      void _id;
      void _creationTime;
      await ctx.db.patch(l!._id, { lineageId: "lin1" });
      await ctx.db.insert("projectLineItems", { ...rest, id: `${id}-copy`, versionId: "v0", lineageId: "lin1" });
    });
    expect(await row(t)).toMatchObject({ reserved: 3, onHand: POOL });
  });
});

describe("the one predicate", () => {
  test("takesFromPool is what the write path decrements by; isReservedSaleLine adds only 'not out'", () => {
    const base = { type: "SALE", saleMode: "NEW_STOCK", modelId: "m1", status: "CONFIRMED" };
    expect(takesFromPool(base)).toBe(true);
    expect(takesFromPool({ ...base, saleMode: undefined })).toBe(false);
    expect(takesFromPool({ ...base, saleMode: "FROM_RENTAL_STOCK" })).toBe(false);
    expect(takesFromPool({ ...base, modelId: undefined })).toBe(false);
    expect(takesFromPool({ ...base, type: "EQUIPMENT" })).toBe(false);
    expect(isReservedSaleLine(base)).toBe(true);
    expect(isReservedSaleLine({ ...base, status: "CHECKED_OUT" })).toBe(false);
    expect(isReservedSaleLine({ ...base, status: "CANCELLED" })).toBe(true);
  });
});

describe("the read budget", () => {
  test("a model the budget cannot cover is absent (unknown), never zero, and truncated is set", async () => {
    const t = makeT();
    await seed(t);
    await addSale(t, { saleMode: "NEW_STOCK" });
    const out = await t.run(async (ctx) => {
      const r = await loadReservedByModel(ctx, ORG, ["m1", "m2"], new ReadBudget(1));
      return { keys: [...r.reserved.keys()], truncated: r.truncated };
    });
    expect(out.truncated).toBe(true);
    expect(out.keys).not.toContain("m2");
  });

  test("with no budget left nothing is read and nothing is guessed", async () => {
    const t = makeT();
    await seed(t);
    const r = await t.run(async (ctx) => {
      const x = await loadReservedByModel(ctx, ORG, ["m1"], new ReadBudget(0));
      return { size: x.reserved.size, truncated: x.truncated };
    });
    expect(r).toEqual({ size: 0, truncated: true });
  });
});
