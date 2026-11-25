// @vitest-environment node
//
// UX Phase 14 (verify round): one test per guard that a mutation run showed could be deleted alone without any
// test noticing. Each is written so that removing THAT guard, and only it, makes the test fail: the forward
// author is kept (so the author check cannot be what refuses), a seeded row is shaped so the neighbouring guard
// passes, and so on. See the comment on each.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { loadKitStates } from "./lib/kitState";
import { loadReservedByModel } from "./lib/saleStockFacts";
import { ReadBudget } from "./lib/readBudget";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const asUser = { subject: USER, orgId: ORG };
const ACTOR = { userId: USER, userName: "Alice" };
const NOW = Date.now();

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("locations", { id: "wh", organizationId: ORG, name: "Warehouse", type: "WAREHOUSE", tags: [], createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("locations", { id: "van", organizationId: ORG, name: "Van", type: "VEHICLE", tags: [], createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("locations", { id: "hall", organizationId: ORG, name: "Hall", type: "VENUE", tags: [], createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("locations", { id: "foreign", organizationId: OTHER, name: "Theirs", type: "WAREHOUSE", tags: [], createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m", assetTag: "A-1", status: "AVAILABLE", isActive: true, locationId: "wh" });
    await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "K-1", name: "Rack", status: "AVAILABLE", isActive: true });
  });
}
const demote = (t: T) =>
  t.run(async (ctx) => {
    const m = await ctx.db.query("members").withIndex("by_org_user", (q) => q.eq("organizationId", ORG).eq("userId", USER)).first();
    await ctx.db.patch(m!._id, { role: "viewer" });
  });

describe("permissions of the Undo mutations are checked on their own (the author is still the author)", () => {
  test("undoMarkCompleteNative needs kit:update", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      const k = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", "k1")).first();
      await ctx.db.patch(k!._id, { status: "INCOMPLETE" });
    });
    await t.withIdentity(asUser).mutation(api.kitWrites.markCompleteNative, { orgId: ORG, id: "k1", auditId: "mc", now: NOW, actor: ACTOR });
    await demote(t); // still the author, no longer allowed to edit kits
    await expect(t.withIdentity(asUser).mutation(api.kitWrites.undoMarkCompleteNative, { orgId: ORG, id: "k1", auditId: "mc", now: NOW, actor: ACTOR })).rejects.toThrow(/Forbidden|permission/i);
  });

  test("location undoCreateNative needs location:delete and undoUpdateNative needs location:update", async () => {
    const t = makeT();
    await seed(t);
    const as = t.withIdentity(asUser);
    await as.mutation(api.locationsWrites.createNative, { id: "new1", orgId: ORG, name: "New", type: "VEHICLE", tags: [], now: NOW, actor: ACTOR, auditId: "cr1" } as never);
    await as.mutation(api.locationsWrites.updateNative, { id: "wh", orgId: ORG, name: "Warehouse 2", type: "WAREHOUSE", tags: [], now: NOW, actor: ACTOR, auditId: "ed1" } as never);
    await demote(t);
    await expect(as.mutation(api.locationsWrites.undoCreateNative, { orgId: ORG, id: "new1", auditId: "cr1", now: NOW, actor: ACTOR })).rejects.toThrow(/Forbidden|permission/i);
    await expect(as.mutation(api.locationsWrites.undoUpdateNative, { orgId: ORG, id: "wh", auditId: "ed1", now: NOW, actor: ACTOR })).rejects.toThrow(/Forbidden|permission/i);
  });
});

describe("location Undo and write guards", () => {
  test("undoUpdateNative refuses a forged audit row that names a field the edit never writes", async () => {
    const t = makeT();
    await seed(t);
    // The author's own row, in the window, with every field "still as the edit left it": only the supported-fields
    // check stands between this and rewriting the location's organization.
    await t.run(async (ctx) => {
      await ctx.db.insert("activityLogs", {
        id: "forged", organizationId: ORG, action: "UPDATE", entityType: "location", entityId: "wh", entityName: "Warehouse",
        userId: USER, userName: "Alice", summary: "x", createdAt: NOW,
        details: { fieldEdit: { before: { organizationId: OTHER }, after: { organizationId: ORG }, serverSavedAt: Date.now(), authorId: USER } },
      } as never);
    });
    await expect(t.withIdentity(asUser).mutation(api.locationsWrites.undoUpdateNative, { orgId: ORG, id: "wh", auditId: "forged", now: NOW, actor: ACTOR })).rejects.toThrow(/can't be undone/);
    const wh = await t.run(async (ctx) => (await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", "wh")).first())!);
    expect(wh.organizationId).toBe(ORG);
  });

  test("an edit that changes the default flag AND an undoable field offers no Undo (the flag moved another location's)", async () => {
    const t = makeT();
    await seed(t);
    const r = await t.withIdentity(asUser).mutation(api.locationsWrites.updateNative, { id: "wh", orgId: ORG, name: "Warehouse renamed", type: "WAREHOUSE", tags: [], isDefault: true, now: NOW, actor: ACTOR, auditId: "ed" } as never);
    expect(r).toMatchObject({ changed: true, undoable: false });
  });

  test("create refuses an audit id that already names a row, and a parent from another org", async () => {
    const t = makeT();
    await seed(t);
    const as = t.withIdentity(asUser);
    const create = (over: Record<string, unknown>) =>
      as.mutation(api.locationsWrites.createNative, { id: `n${Math.random()}`, orgId: ORG, name: "N", type: "VEHICLE", tags: [], now: NOW, actor: ACTOR, auditId: `a${Math.random()}`, ...over } as never);
    await t.run(async (ctx) => {
      await ctx.db.insert("activityLogs", { id: "taken", organizationId: OTHER, action: "UPDATE", entityType: "x", entityId: "x", entityName: "x", userName: "x", summary: "x", createdAt: 1 } as never);
    });
    await expect(create({ auditId: "taken" })).rejects.toThrow(/already in use|AUDIT_ID_TAKEN/);
    await expect(create({ parentId: "foreign" })).rejects.toThrow();
    // ...and a normal create still works.
    await create({});
  });

  test("an absent capacity is stored absent on create (never 0)", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(asUser).mutation(api.locationsWrites.createNative, { id: "cap0", orgId: ORG, name: "No cap", type: "VEHICLE", tags: [], now: NOW, actor: ACTOR, auditId: "capa" } as never);
    const doc = await t.run(async (ctx) => (await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", "cap0")).first())!);
    expect(Object.hasOwn(doc, "capacity")).toBe(false);
  });
});

describe("Move contents Undo guards", () => {
  const move = (t: T) => t.withIdentity(asUser).mutation(api.locationsWrites.moveContentsNative, { orgId: ORG, fromIds: ["wh"], toId: "van", now: NOW, actor: ACTOR, auditId: "mv1" } as never);
  const undo = (t: T) => t.withIdentity(asUser).mutation(api.locationsWrites.undoMoveContentsNative, { orgId: ORG, auditId: "mv1", now: NOW + 1, actor: ACTOR });

  test("a row that moved elsewhere WITHOUT its updatedAt changing is still left alone (the location guard alone)", async () => {
    const t = makeT();
    await seed(t);
    await move(t);
    await t.run(async (ctx) => {
      const a = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).first();
      await ctx.db.patch(a!._id, { locationId: "hall" }); // updatedAt untouched: still the forward move's stamp
    });
    expect(await undo(t)).toEqual({ restored: 0, left: 1 });
    const at = await t.run(async (ctx) => (await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).first())!.locationId);
    expect(at).toBe("hall");
  });

  test("another org's row with the same deterministic undo id does not block this org's Undo", async () => {
    const t = makeT();
    await seed(t);
    await move(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("activityLogs", { id: "mv1:undo", organizationId: OTHER, action: "UNDO", entityType: "location", entityId: "foreign", entityName: "x", userName: "x", summary: "x", createdAt: 1 } as never);
    });
    expect(await undo(t)).toEqual({ restored: 1, left: 0 });
  });
});

describe("bulk size and read budgets", () => {
  test("bulkUpdateRatesNative refuses more models than the bulk cap", async () => {
    const t = makeT();
    await seed(t);
    const modelIds = Array.from({ length: 501 }, (_, i) => `m${i}`);
    await expect(
      t.withIdentity(asUser).mutation(api.modelWrites.bulkUpdateRatesNative, { orgId: ORG, modelIds, rateType: "dailyRate", operation: "set", value: 10, now: NOW, actor: ACTOR, auditId: "bulk" }),
    ).rejects.toThrow(/BULK_TOO_LARGE|limit/);
  });

  test("a model whose sale lines do not fit the budget is ABSENT (unknown), not summed from a partial read", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      for (const id of ["s1", "s2", "s3"]) {
        await ctx.db.insert("projectLineItems", { id, organizationId: ORG, projectId: "p", type: "SALE", saleMode: "NEW_STOCK", modelId: "mod", quantity: 4, status: "CONFIRMED" } as never);
      }
    });
    const out = await t.run(async (ctx) => {
      const r = await loadReservedByModel(ctx, ORG, ["mod"], new ReadBudget(2)); // 3 lines, room for 2
      return { has: r.reserved.has("mod"), truncated: r.truncated };
    });
    expect(out).toEqual({ has: false, truncated: true });
  });

  test("a kit whose members do not fit the budget has an unknown (null) state, not a partial one", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      for (const n of [1, 2, 3]) {
        await ctx.db.insert("assets", { id: `ka${n}`, organizationId: ORG, modelId: "m", assetTag: `KA-${n}`, status: "AVAILABLE", isActive: true });
        await ctx.db.insert("kitSerializedItems", { id: `ks${n}`, organizationId: ORG, kitId: "k1", assetId: `ka${n}`, addedById: "u" });
      }
    });
    const out = await t.run(async (ctx) => {
      const kit = (await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", "k1")).first())!;
      const tight = await loadKitStates(ctx, ORG, [kit], NOW, new ReadBudget(2)); // 3 member rows, room for 2
      const roomy = await loadKitStates(ctx, ORG, [kit], NOW, new ReadBudget(1000));
      return { tight: tight.get("k1"), roomy: roomy.get("k1")?.key };
    });
    expect(out).toEqual({ tight: null, roomy: "AVAILABLE" });
  });
});

describe("sort: an unknown key falls back to the default order, never a stored field", () => {
  test("models: 'sku' is not an ordering, so the name order stands", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
      await ctx.db.insert("models", { id: "a", organizationId: ORG, name: "Alpha", sku: "Z", isActive: true });
      await ctx.db.insert("models", { id: "b", organizationId: ORG, name: "Bravo", sku: "A", isActive: true });
    });
    const r = await t.withIdentity(asUser).query(api.modelsList.listPage, { orgId: ORG, sortBy: "sku", sortOrder: "asc" });
    expect(r.items.map((i) => i.name)).toEqual(["Alpha", "Bravo"]); // a stored-field fallback would put Bravo (sku A) first
    const proto = await t.withIdentity(asUser).query(api.modelsList.listPage, { orgId: ORG, sortBy: "toString" });
    expect(proto.items.map((i) => i.name)).toEqual(["Alpha", "Bravo"]); // and a prototype key is not an ordering either
  });

  test("sales stock: 'sku' is not an ordering, so the default (available) order stands", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
      await ctx.db.insert("models", { id: "a", organizationId: ORG, name: "Low", sku: "Z", saleStockQuantity: 1, isActive: true });
      await ctx.db.insert("models", { id: "b", organizationId: ORG, name: "High", sku: "A", saleStockQuantity: 9, isActive: true });
    });
    const r = await t.withIdentity(asUser).query(api.modelsList.saleStockPage, { orgId: ORG, sortBy: "sku", sortOrder: "asc" });
    expect(r.items.map((i) => i.name)).toEqual(["Low", "High"]); // a stored-field fallback would put High (sku A) first
  });
});
