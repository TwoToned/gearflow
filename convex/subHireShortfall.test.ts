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
const asUser = (orgId: string) => ({ subject: USER, orgId });
const ACTOR = { userId: USER, userName: "Alice" };
const VERSION = "v-p1-org_1";

// admin: undoing a cover that created the order deletes it, which needs subHire:delete.
async function seed(t: T, role = "admin") {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role });
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P-1", name: "Gig", status: "CONFIRMED", total: 0, taxRate: 10, liveVersionId: VERSION });
    await ctx.db.insert("projectVersions", { id: VERSION, organizationId: ORG, projectId: "p1", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    await ctx.db.insert("suppliers", { id: "sup1", organizationId: ORG, name: "Acme Hire", isActive: true });
    await ctx.db.insert("models", { id: "mdl1", organizationId: ORG, name: "SL2" });
    await ctx.db.insert("projectLineItems", {
      id: "line1", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", modelId: "mdl1", description: "SL2",
      quantity: 5, unitPrice: 100, lineTotal: 500, isKitChild: false, status: "CONFIRMED", versionId: VERSION, lineageId: "line1",
    });
  });
}

const item = { modelId: "mdl1", description: "SL2", quantity: 2, unitCost: 40, unitCharge: 100, pricingType: "FLAT" as const, duration: 1, discount: 0 };
const cover = (over: Record<string, unknown> = {}) => ({
  orgId: ORG, lineItemId: "line1", supplierId: "sup1", newOrderId: "ord1", itemId: "it1",
  ...item, trimLine: true, now: NOW, actor: ACTOR, auditId: "a1", ...over,
});

const heads = (t: T) => t.run(async (ctx) => ctx.db.query("subHires").collect());
const items = (t: T) => t.run(async (ctx) => ctx.db.query("subHireItems").collect());
const lineQty = (t: T) => t.run(async (ctx) => (await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "line1")).first())?.quantity);

describe("coverShortfallNative", () => {
  test("creates a draft order, adds the item and trims the line in one go", async () => {
    const t = makeT();
    await seed(t);
    const r = await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.coverShortfallNative, cover());
    expect(r).toMatchObject({ orderId: "ord1", itemId: "it1", createdOrder: true, lineQuantityBefore: 5, lineQuantityAfter: 3 });
    expect(await heads(t)).toHaveLength(1);
    expect((await heads(t))[0]).toMatchObject({ id: "ord1", status: "DRAFT", projectId: "p1" });
    expect(await items(t)).toHaveLength(1);
    expect(await lineQty(t)).toBe(3);
  });

  test("appends to the supplier's existing draft order instead of creating one", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.coverShortfallNative, cover({ trimLine: false }));
    const r = await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.coverShortfallNative, cover({
      draftOrderId: "ord1", newOrderId: "ignored", itemId: "it2", trimLine: false, auditId: "a2",
    }));
    expect(r.createdOrder).toBe(false);
    expect(await heads(t)).toHaveLength(1);
    expect(await items(t)).toHaveLength(2);
    expect(await lineQty(t)).toBe(5);
  });

  test("a failure mid-write leaves nothing changed (no stray draft order, line untrimmed)", async () => {
    const t = makeT();
    await seed(t);
    // The order is created first, then addItem rejects the over-100% discount.
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.coverShortfallNative, cover({ discount: 500 })),
    ).rejects.toThrow(/Discount/i);
    expect(await heads(t)).toHaveLength(0);
    expect(await items(t)).toHaveLength(0);
    expect(await lineQty(t)).toBe(5);
  });

  test("a failing line trim rolls back the order and item that were already written", async () => {
    const t = makeT();
    await seed(t);
    // 4 custom units mean the line can't drop below 4: the order and item are written first,
    // then the trim (last step) is refused, and everything before it must disappear.
    await t.run(async (ctx) => {
      const l = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "line1")).first();
      await ctx.db.patch(l!._id, { offInventoryQuantity: 4 });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.coverShortfallNative, cover()),
    ).rejects.toThrow(/custom/i);
    expect(await heads(t)).toHaveLength(0);
    expect(await items(t)).toHaveLength(0);
    expect(await lineQty(t)).toBe(5);
  });

  test("cross-tenant: another org's line, supplier and draft order are all rejected", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("suppliers", { id: "supX", organizationId: OTHER, name: "Foreign", isActive: true });
      await ctx.db.insert("subHires", { id: "ordX", organizationId: OTHER, supplierId: "supX", createdById: "x", orderNumber: "SH-1", status: "DRAFT", projectId: "p1", showOnDocs: false, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", { id: "lineX", organizationId: OTHER, projectId: "pX", type: "EQUIPMENT", modelId: "mdl1", description: "x", quantity: 5, lineTotal: 0, isKitChild: false, status: "CONFIRMED", versionId: "vX", lineageId: "lineX" });
    });
    const c = t.withIdentity(asUser(ORG));
    await expect(c.mutation(api.subHiresWrites.coverShortfallNative, cover({ lineItemId: "lineX" }))).rejects.toThrow(/Line item not found/);
    await expect(c.mutation(api.subHiresWrites.coverShortfallNative, cover({ supplierId: "supX" }))).rejects.toThrow(/Supplier not found/);
    await expect(c.mutation(api.subHiresWrites.coverShortfallNative, cover({ draftOrderId: "ordX" }))).rejects.toThrow(/Sub-hire not found/);
    // A caller naming a foreign orgId has no role there.
    await expect(t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.coverShortfallNative, cover({ orgId: OTHER }))).rejects.toThrow();
    expect(await lineQty(t)).toBe(5);
  });

  test("a role without sub-hire write is refused", async () => {
    const t = makeT();
    await seed(t, "viewer");
    await expect(t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.coverShortfallNative, cover())).rejects.toThrow();
    expect(await heads(t)).toHaveLength(0);
  });

  test("refuses a non-draft order and a different job's / supplier's order", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("subHires", { id: "conf", organizationId: ORG, supplierId: "sup1", createdById: "x", orderNumber: "SH-2", status: "CONFIRMED", projectId: "p1", showOnDocs: false, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("suppliers", { id: "sup2", organizationId: ORG, name: "Other", isActive: true });
      await ctx.db.insert("subHires", { id: "othersup", organizationId: ORG, supplierId: "sup2", createdById: "x", orderNumber: "SH-3", status: "DRAFT", projectId: "p1", showOnDocs: false, createdAt: NOW, updatedAt: NOW });
    });
    const c = t.withIdentity(asUser(ORG));
    await expect(c.mutation(api.subHiresWrites.coverShortfallNative, cover({ draftOrderId: "conf" }))).rejects.toThrow(/draft/i);
    await expect(c.mutation(api.subHiresWrites.coverShortfallNative, cover({ draftOrderId: "othersup" }))).rejects.toThrow(/different supplier/);
  });
});

describe("undoShortfallNative", () => {
  const undo = (over: Record<string, unknown> = {}) => ({
    orgId: ORG, orderId: "ord1", itemId: "it1", now: NOW + 1, actor: ACTOR, auditId: "u1", ...over,
  });
  const coverageOf = (t: T, id = "it1") => t.run(async (ctx) => (await ctx.db.query("subHireItems").withIndex("by_cuid", (q) => q.eq("id", id)).first())?.coverage);

  test("the cover stores its own facts on the item, and the undo restores EXACTLY that quantity", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.coverShortfallNative, cover());
    expect(await coverageOf(t)).toEqual({ lineItemId: "line1", quantityBefore: 5, quantityAfter: 3, createdOrder: true });
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.undoShortfallNative, undo());
    expect(await lineQty(t)).toBe(5);
  });

  test("a forged restoreQuantity (or any old client arg) is rejected, nothing changes", async () => {
    const t = makeT();
    await seed(t);
    const c = t.withIdentity(asUser(ORG));
    await c.mutation(api.subHiresWrites.coverShortfallNative, cover());
    await expect(c.mutation(api.subHiresWrites.undoShortfallNative, undo({ restoreQuantity: 9999, lineItemId: "line1", trimmedTo: 3 }))).rejects.toThrow();
    expect(await lineQty(t)).toBe(3);
    expect(await items(t)).toHaveLength(1);
  });

  test("an item with no coverage (not made by a cover) cannot be undone this way", async () => {
    const t = makeT();
    await seed(t);
    const c = t.withIdentity(asUser(ORG));
    await c.mutation(api.subHiresWrites.coverShortfallNative, cover({ trimLine: false }));
    await t.run(async (ctx) => {
      const i = await ctx.db.query("subHireItems").withIndex("by_cuid", (q) => q.eq("id", "it1")).first();
      await ctx.db.patch(i!._id, { coverage: undefined });
    });
    await expect(c.mutation(api.subHiresWrites.undoShortfallNative, undo())).rejects.toThrow(/not added by a shortfall cover/);
  });

  test("a stored coverage pointing at another org's or another job's line is refused", async () => {
    const t = makeT();
    await seed(t);
    const c = t.withIdentity(asUser(ORG));
    await c.mutation(api.subHiresWrites.coverShortfallNative, cover());
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "lineX", organizationId: OTHER, projectId: "p1", type: "EQUIPMENT", modelId: "mdl1", description: "x", quantity: 3, lineTotal: 0, isKitChild: false, status: "CONFIRMED", versionId: "vX", lineageId: "lineX" });
      await ctx.db.insert("projectLineItems", { id: "lineY", organizationId: ORG, projectId: "p2", type: "EQUIPMENT", modelId: "mdl1", description: "y", quantity: 3, lineTotal: 0, isKitChild: false, status: "CONFIRMED", versionId: "vY", lineageId: "lineY" });
      const i = await ctx.db.query("subHireItems").withIndex("by_cuid", (q) => q.eq("id", "it1")).first();
      await ctx.db.patch(i!._id, { coverage: { lineItemId: "lineX", quantityBefore: 50, quantityAfter: 3, createdOrder: true } });
    });
    await expect(c.mutation(api.subHiresWrites.undoShortfallNative, undo())).rejects.toThrow(/Line item not found/);
    await t.run(async (ctx) => {
      const i = await ctx.db.query("subHireItems").withIndex("by_cuid", (q) => q.eq("id", "it1")).first();
      await ctx.db.patch(i!._id, { coverage: { lineItemId: "lineY", quantityBefore: 50, quantityAfter: 3, createdOrder: true } });
    });
    await expect(c.mutation(api.subHiresWrites.undoShortfallNative, undo())).rejects.toThrow(/no longer matches/);
    expect(await lineQty(t)).toBe(3);
    expect(await items(t)).toHaveLength(1);
  });

  test("a duplicated order does not carry the cover's coverage onto the copy", async () => {
    const t = makeT();
    await seed(t);
    const c = t.withIdentity(asUser(ORG));
    await c.mutation(api.subHiresWrites.coverShortfallNative, cover());
    await c.mutation(api.subHiresWrites.duplicateSubHireNative, { sourceId: "ord1", id: "ord2", orgId: ORG, now: NOW, actor: ACTOR, auditId: "d1" });
    const copies = (await items(t)).filter((i) => i.subHireId === "ord2");
    expect(copies).toHaveLength(1);
    expect(copies[0].coverage).toBeUndefined();
  });

  test("restores the line and removes the item and the order the cover created", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.coverShortfallNative, cover());
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.undoShortfallNative, undo());
    expect(await heads(t)).toHaveLength(0);
    expect(await items(t)).toHaveLength(0);
    expect(await lineQty(t)).toBe(5);
  });

  test("on an appended draft it removes only the item and keeps the order", async () => {
    const t = makeT();
    await seed(t);
    const c = t.withIdentity(asUser(ORG));
    await c.mutation(api.subHiresWrites.coverShortfallNative, cover({ trimLine: false }));
    await c.mutation(api.subHiresWrites.coverShortfallNative, cover({ draftOrderId: "ord1", itemId: "it2", trimLine: false, auditId: "a2" }));
    await c.mutation(api.subHiresWrites.undoShortfallNative, undo({ itemId: "it2" }));
    expect(await heads(t)).toHaveLength(1);
    expect((await items(t)).map((i) => i.id)).toEqual(["it1"]);
  });

  test("is refused once the order was issued, changing nothing", async () => {
    const t = makeT();
    await seed(t);
    const c = t.withIdentity(asUser(ORG));
    await c.mutation(api.subHiresWrites.coverShortfallNative, cover());
    await c.mutation(api.subHiresWrites.updateSubHireStatusNative, { id: "ord1", orgId: ORG, status: "CONFIRMED", now: NOW, actor: ACTOR, auditId: "s1" });
    await expect(c.mutation(api.subHiresWrites.undoShortfallNative, undo())).rejects.toThrow(/now confirmed/i);
    expect(await heads(t)).toHaveLength(1);
    expect(await items(t)).toHaveLength(1);
    expect(await lineQty(t)).toBe(3);
  });

  test("is refused when other items joined the order since, or the line was edited", async () => {
    const t = makeT();
    await seed(t);
    const c = t.withIdentity(asUser(ORG));
    await c.mutation(api.subHiresWrites.coverShortfallNative, cover());
    await c.mutation(api.subHiresWrites.addSubHireItemNative, { id: "it9", orgId: ORG, subHireId: "ord1", ...item, now: NOW, actor: ACTOR, auditId: "x" });
    await expect(c.mutation(api.subHiresWrites.undoShortfallNative, undo())).rejects.toThrow(/added to this order/i);
    await c.mutation(api.subHiresWrites.removeSubHireItemNative, { itemId: "it9", orgId: ORG, now: NOW, actor: ACTOR, auditId: "y" });
    await t.run(async (ctx) => {
      const l = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "line1")).first();
      await ctx.db.patch(l!._id, { quantity: 4 });
    });
    await expect(c.mutation(api.subHiresWrites.undoShortfallNative, undo())).rejects.toThrow(/edited since/i);
    expect(await items(t)).toHaveLength(1);
  });

  test("cross-tenant: cannot undo another org's order", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("subHires", { id: "ordX", organizationId: OTHER, supplierId: "sup1", createdById: "x", orderNumber: "SH-1", status: "DRAFT", showOnDocs: false, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("subHireItems", { id: "itX", subHireId: "ordX", description: "x", quantity: 1, sortOrder: 0 });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.undoShortfallNative, undo({ orderId: "ordX", itemId: "itX" })),
    ).rejects.toThrow(/Sub-hire not found/);
    expect(await items(t)).toHaveLength(1);
  });
});
