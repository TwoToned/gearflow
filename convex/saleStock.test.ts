// @vitest-environment node
//
// WS11 (#950) — sale-stock mechanics: new-stock decrement/restore
// (Model.saleStockQuantity), sell-from-rental-stock (serialised -> AssetStatus
// "SOLD", bulk -> adjustBulkTotal), un-sell reversal, SALE-forced FLAT/duration:1
// pricing, auto-pricing from Model.salePrice, and merge isolation across type/saleMode.
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

const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const asUser = (orgId: string) => ({ subject: USER, orgId });
const ACTOR = { userId: USER, userName: "Alice" };

async function ownerMember(t: ReturnType<typeof makeT>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "owner" });
  });
}

// QUOTED = OPEN lock-tier (see convex/lib/projectLocks.ts) — these tests are
// about sale-stock mechanics, not the #791/#957 lock feature, so they stay
// ungated (a locked/FINANCE_LOCKED project forces a fresh insert's price to $0,
// which would otherwise make every unitPrice assertion below fail for the
// wrong reason).
async function seedProject(t: ReturnType<typeof makeT>, over: Record<string, unknown> = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig",
      status: "QUOTED", isTemplate: false, createdAt: NOW, updatedAt: NOW,
      ...over,
    });
  });
}

async function getModel(t: ReturnType<typeof makeT>, id = "m1") {
  return t.run(async (ctx) => ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).first());
}
async function getAsset(t: ReturnType<typeof makeT>, id = "a1") {
  return t.run(async (ctx) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).first());
}
async function getBulk(t: ReturnType<typeof makeT>, id = "b1") {
  return t.run(async (ctx) => ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", id)).first());
}
async function getLine(t: ReturnType<typeof makeT>, id = "sale1") {
  return t.run(async (ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).first());
}

// ─── New-stock sale ────────────────────────────────────────────────────────

describe("new-stock sale (Model.saleStockQuantity)", () => {
  test("addNative decrements saleStockQuantity by qty + forces FLAT/duration:1 + writes an audit with saleStock details", async () => {
    const t = makeT();
    await ownerMember(t);
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "SM58", salePrice: 120, saleStockQuantity: 5 });
    });

    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addNative, {
      id: "sale1", organizationId: ORG, projectId: "p1",
      fields: { type: "SALE", saleMode: "NEW_STOCK", modelId: "m1", quantity: 3, unitPrice: 120, pricingType: "PER_DAY", duration: 7 },
      includeAccessories: false, allowOverbook: false, actor: ACTOR, auditId: "log1", now: NOW,
    });

    const model = await getModel(t);
    expect(model?.saleStockQuantity).toBe(2);

    const line = await getLine(t);
    expect(line?.pricingType).toBe("FLAT"); // forced, despite PER_DAY input
    expect(line?.duration).toBe(1); // forced, despite duration:7 input
    expect(line?.lineTotal).toBe(360); // 120 * 3 * 1

    const log = await t.run(async (ctx) =>
      ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first(),
    );
    // The line-item CREATE audit uses id "log1" (auditId) — the sale-stock audit
    // is a SEPARATE row (its own createId()), found by entityType.
    expect(log?.entityType).toBe("lineItem");
    const saleAudit = await t.run(async (ctx) =>
      (await ctx.db.query("activityLogs").collect()).find((a) => a.entityType === "model"),
    );
    expect((saleAudit?.details as { saleStock?: { from: number; to: number } } | undefined)?.saleStock).toEqual({
      from: 5, to: 2, projectId: "p1", lineItemId: "sale1",
    });
  });

  test("oversell is allowed — warn, never block (goes negative)", async () => {
    const t = makeT();
    await ownerMember(t);
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "SM58", saleStockQuantity: 1 });
    });

    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addNative, {
      id: "sale1", organizationId: ORG, projectId: "p1",
      fields: { type: "SALE", saleMode: "NEW_STOCK", modelId: "m1", quantity: 3, unitPrice: 50 },
      includeAccessories: false, allowOverbook: false, actor: ACTOR, auditId: "log1", now: NOW,
    });

    const model = await getModel(t);
    expect(model?.saleStockQuantity).toBe(-2);
  });

  test("restores sale stock when the line is deleted", async () => {
    const t = makeT();
    await ownerMember(t);
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "SM58", saleStockQuantity: 5 });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addNative, {
      id: "sale1", organizationId: ORG, projectId: "p1",
      fields: { type: "SALE", saleMode: "NEW_STOCK", modelId: "m1", quantity: 3, unitPrice: 50 },
      includeAccessories: false, allowOverbook: false, actor: ACTOR, auditId: "log1", now: NOW,
    });
    expect((await getModel(t))?.saleStockQuantity).toBe(2);

    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.removeNative, {
      id: "sale1", orgId: ORG, actor: ACTOR, auditId: "log2", now: NOW,
    });
    expect((await getModel(t))?.saleStockQuantity).toBe(5);
  });

  test("adjusts sale stock by the delta on a quantity-change patch", async () => {
    const t = makeT();
    await ownerMember(t);
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "SM58", saleStockQuantity: 5 });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addNative, {
      id: "sale1", organizationId: ORG, projectId: "p1",
      fields: { type: "SALE", saleMode: "NEW_STOCK", modelId: "m1", quantity: 3, unitPrice: 50 },
      includeAccessories: false, allowOverbook: false, actor: ACTOR, auditId: "log1", now: NOW,
    });
    expect((await getModel(t))?.saleStockQuantity).toBe(2);

    // Bump qty 3 -> 5: consumes 2 more.
    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.patchNative, {
      id: "sale1", orgId: ORG, set: { quantity: 5, lineTotal: 250, updatedAt: NOW }, clear: [],
      entityName: "Sale", allowOverbook: false, actor: ACTOR, auditId: "log2", now: NOW,
    });
    expect((await getModel(t))?.saleStockQuantity).toBe(0);

    // Drop qty 5 -> 1: restores 4.
    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.patchNative, {
      id: "sale1", orgId: ORG, set: { quantity: 1, lineTotal: 50, updatedAt: NOW }, clear: [],
      entityName: "Sale", allowOverbook: false, actor: ACTOR, auditId: "log3", now: NOW,
    });
    expect((await getModel(t))?.saleStockQuantity).toBe(4);
  });

  test("addLineItemSmartNative auto-prices a SALE line from Model.salePrice (no fallback chain)", async () => {
    const t = makeT();
    await ownerMember(t);
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "SM58", salePrice: 99.5, dailyRate: 10, saleStockQuantity: 10 });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addLineItemSmartNative, {
      id: "sale1", organizationId: ORG, projectId: "p1",
      fields: { type: "SALE", saleMode: "NEW_STOCK", modelId: "m1", quantity: 2 },
      allowOverbook: false, forceSeparate: false, includeAccessories: false,
      actor: ACTOR, auditId: "log1", now: NOW,
    });
    const line = await getLine(t);
    expect(line?.unitPrice).toBe(99.5); // NOT the blended dailyRate charge
    expect(line?.pricingType).toBe("FLAT");
    expect(line?.duration).toBe(1);
    expect(line?.lineTotal).toBe(199);
  });

  test("no salePrice set -> unitPrice stays unset (manual entry required, spec decision)", async () => {
    const t = makeT();
    await ownerMember(t);
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "SM58", saleStockQuantity: 10 });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addLineItemSmartNative, {
      id: "sale1", organizationId: ORG, projectId: "p1",
      fields: { type: "SALE", saleMode: "NEW_STOCK", modelId: "m1", quantity: 2 },
      allowOverbook: false, forceSeparate: false, includeAccessories: false,
      actor: ACTOR, auditId: "log1", now: NOW,
    });
    const line = await getLine(t);
    expect(line?.unitPrice).toBeUndefined();
  });

  test("merge isolation: two SALE adds of the same model never merge into one line", async () => {
    const t = makeT();
    await ownerMember(t);
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "SM58", saleStockQuantity: 10 });
    });
    const add = (id: string) =>
      t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addLineItemSmartNative, {
        id, organizationId: ORG, projectId: "p1",
        fields: { type: "SALE", saleMode: "NEW_STOCK", modelId: "m1", quantity: 1, unitPrice: 50 },
        allowOverbook: false, forceSeparate: false, includeAccessories: false,
        actor: ACTOR, auditId: `log-${id}`, now: NOW,
      });
    const r1 = await add("sale1");
    const r2 = await add("sale2");
    expect(r1.merged).toBe(false);
    expect(r2.merged).toBe(false);
    const lines = await t.run(async (ctx) =>
      ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", "p1")).collect(),
    );
    expect(lines.filter((l) => l.type === "SALE")).toHaveLength(2);
  });
});

// ─── Sell-from-rental-stock: serialised ───────────────────────────────────

describe("sell-from-rental-stock (serialised)", () => {
  test("selling flips the asset to SOLD (isActive:false) via addNative", async () => {
    const t = makeT();
    await ownerMember(t);
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "SM58", assetType: "SERIALIZED" });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "TAG-1", status: "AVAILABLE", isActive: true });
    });

    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addNative, {
      id: "sale1", organizationId: ORG, projectId: "p1",
      fields: { type: "SALE", saleMode: "FROM_RENTAL_STOCK", assetId: "a1", modelId: "m1", quantity: 1, unitPrice: 300 },
      includeAccessories: false, allowOverbook: false, actor: ACTOR, auditId: "log1", now: NOW,
    });

    const asset = await getAsset(t);
    expect(asset?.status).toBe("SOLD");
    expect(asset?.isActive).toBe(false);
  });

  test("warns (non-blocking) when the asset has a future conflicting booking, but still sells it", async () => {
    const t = makeT();
    await ownerMember(t);
    const DAY = 86_400_000;
    await seedProject(t, { rentalStartDate: NOW, rentalEndDate: NOW + DAY });
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "SM58", assetType: "SERIALIZED" });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "TAG-1", status: "AVAILABLE", isActive: true });
      // Another (future) project already has this exact asset booked, overlapping p1's window.
      await ctx.db.insert("projects", { id: "p2", organizationId: ORG, projectNumber: "P2", name: "Other Gig", status: "CONFIRMED", isTemplate: false, rentalStartDate: NOW, rentalEndDate: NOW + DAY });
      await ctx.db.insert("projectLineItems", { id: "other1", organizationId: ORG, projectId: "p2", type: "EQUIPMENT", assetId: "a1", modelId: "m1", quantity: 1, status: "CONFIRMED", isKitChild: false });
    });

    const res = await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addNative, {
      id: "sale1", organizationId: ORG, projectId: "p1",
      fields: { type: "SALE", saleMode: "FROM_RENTAL_STOCK", assetId: "a1", modelId: "m1", quantity: 1, unitPrice: 300 },
      includeAccessories: false, allowOverbook: false, actor: ACTOR, auditId: "log1", now: NOW,
    });

    expect(res.saleWarning).toMatch(/P2/);
    const asset = await getAsset(t);
    expect(asset?.status).toBe("SOLD"); // sold anyway — non-blocking
  });

  test("throws ALREADY_SOLD when selling an already-sold asset", async () => {
    const t = makeT();
    await ownerMember(t);
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "SM58", assetType: "SERIALIZED" });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "TAG-1", status: "SOLD", isActive: false });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addNative, {
        id: "sale1", organizationId: ORG, projectId: "p1",
        fields: { type: "SALE", saleMode: "FROM_RENTAL_STOCK", assetId: "a1", modelId: "m1", quantity: 1, unitPrice: 300 },
        includeAccessories: false, allowOverbook: false, actor: ACTOR, auditId: "log1", now: NOW,
      }),
    ).rejects.toThrow(/already been sold/i);
  });

  test("un-sell reverses SOLD -> AVAILABLE (isActive:true)", async () => {
    const t = makeT();
    await ownerMember(t);
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "SM58", assetType: "SERIALIZED" });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "TAG-1", status: "AVAILABLE", isActive: true });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addNative, {
      id: "sale1", organizationId: ORG, projectId: "p1",
      fields: { type: "SALE", saleMode: "FROM_RENTAL_STOCK", assetId: "a1", modelId: "m1", quantity: 1, unitPrice: 300 },
      includeAccessories: false, allowOverbook: false, actor: ACTOR, auditId: "log1", now: NOW,
    });
    expect((await getAsset(t))?.status).toBe("SOLD");

    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.unsellLineItemNative, {
      id: "sale1", orgId: ORG, actor: ACTOR, auditId: "log2", now: NOW,
    });
    const asset = await getAsset(t);
    expect(asset?.status).toBe("AVAILABLE");
    expect(asset?.isActive).toBe(true);

    // The line item itself is untouched by un-sell.
    const line = await getLine(t);
    expect(line).not.toBeNull();
  });

  test("un-sell rejects a line that isn't a FROM_RENTAL_STOCK sale", async () => {
    const t = makeT();
    await ownerMember(t);
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "SM58", saleStockQuantity: 10 });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addNative, {
      id: "sale1", organizationId: ORG, projectId: "p1",
      fields: { type: "SALE", saleMode: "NEW_STOCK", modelId: "m1", quantity: 1, unitPrice: 50 },
      includeAccessories: false, allowOverbook: false, actor: ACTOR, auditId: "log1", now: NOW,
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.unsellLineItemNative, {
        id: "sale1", orgId: ORG, actor: ACTOR, auditId: "log2", now: NOW,
      }),
    ).rejects.toThrow(/not a sell-from-rental-stock sale/i);
  });
});

// ─── Sell-from-rental-stock: bulk ─────────────────────────────────────────

describe("sell-from-rental-stock (bulk)", () => {
  test("adjustBulkTotal decrements totalQuantity + availableQuantity together", async () => {
    const t = makeT();
    await ownerMember(t);
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "XLR Cable", assetType: "BULK" });
      await ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, modelId: "m1", assetTag: "CABLE-1", totalQuantity: 20, availableQuantity: 20, status: "ACTIVE" });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addNative, {
      id: "sale1", organizationId: ORG, projectId: "p1",
      fields: { type: "SALE", saleMode: "FROM_RENTAL_STOCK", bulkAssetId: "b1", modelId: "m1", quantity: 5, unitPrice: 10 },
      includeAccessories: false, allowOverbook: false, actor: ACTOR, auditId: "log1", now: NOW,
    });
    const bulk = await getBulk(t);
    expect(bulk?.totalQuantity).toBe(15);
    expect(bulk?.availableQuantity).toBe(15);
  });

  test("floors the decrement at the deployed quantity — can't sell units out on a job", async () => {
    const t = makeT();
    await ownerMember(t);
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "XLR Cable", assetType: "BULK" });
      // 10 total, 3 available -> 7 deployed. Selling 5 should only free up to 3
      // (floor at 7 deployed), not the full 5 requested.
      await ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, modelId: "m1", assetTag: "CABLE-1", totalQuantity: 10, availableQuantity: 3, status: "ACTIVE" });
    });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addNative, {
      id: "sale1", organizationId: ORG, projectId: "p1",
      fields: { type: "SALE", saleMode: "FROM_RENTAL_STOCK", bulkAssetId: "b1", modelId: "m1", quantity: 5, unitPrice: 10 },
      includeAccessories: false, allowOverbook: false, actor: ACTOR, auditId: "log1", now: NOW,
    });
    const bulk = await getBulk(t);
    expect(bulk?.totalQuantity).toBe(7); // floored at deployed (10-3=7)
    expect(bulk?.availableQuantity).toBe(0);
    expect(res.saleWarning).toMatch(/Only 3 of 5/);
  });

  test("status auto-flips to OUT_OF_STOCK at zero, and un-sell restores + flips back to ACTIVE", async () => {
    const t = makeT();
    await ownerMember(t);
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "XLR Cable", assetType: "BULK" });
      await ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, modelId: "m1", assetTag: "CABLE-1", totalQuantity: 3, availableQuantity: 3, status: "ACTIVE" });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.addNative, {
      id: "sale1", organizationId: ORG, projectId: "p1",
      fields: { type: "SALE", saleMode: "FROM_RENTAL_STOCK", bulkAssetId: "b1", modelId: "m1", quantity: 3, unitPrice: 10 },
      includeAccessories: false, allowOverbook: false, actor: ACTOR, auditId: "log1", now: NOW,
    });
    let bulk = await getBulk(t);
    expect(bulk?.totalQuantity).toBe(0);
    expect(bulk?.status).toBe("OUT_OF_STOCK");

    await t.withIdentity(asUser(ORG)).mutation(api.lineItemWrites.unsellLineItemNative, {
      id: "sale1", orgId: ORG, actor: ACTOR, auditId: "log2", now: NOW,
    });
    bulk = await getBulk(t);
    expect(bulk?.totalQuantity).toBe(3);
    expect(bulk?.availableQuantity).toBe(3);
    expect(bulk?.status).toBe("ACTIVE");
  });
});
