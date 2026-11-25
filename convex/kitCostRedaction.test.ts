// @vitest-environment node
//
// UX Phase 12 review: kit reads and the kit pickers carry cost too (a kit's own purchase
// price, the units' purchase prices, a model's replacement / default purchase cost). A
// `noFinancials` API key gets every one ABSENT (never zeroed) and the cost is not a sort
// key. Sentinel sweep: unique values, read as each caller, grep the JSON.
import { convexTest, type TestConvex } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1", USER = "user_1", KEY = "key_1";
const KIT_PRICE = 31415.92;
const UNIT_PRICE = 27182.81;
const BULK_PRICE = 16180.33;
const REPLACEMENT = 14142.13;
const DEFAULT_PURCHASE = 17320.5;
const asUser = { subject: USER, orgId: ORG };
const asAgent = { subject: USER, orgId: ORG, akid: KEY };
type Who = typeof asUser | typeof asAgent;

async function seed(): Promise<T> {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "Aura", replacementCost: REPLACEMENT, defaultPurchasePrice: DEFAULT_PURCHASE, isActive: true, assetType: "SERIALIZED" } as never);
    await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "A-1", status: "AVAILABLE", isActive: true, purchasePrice: UNIT_PRICE } as never);
    await ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, modelId: "m1", assetTag: "B-1", totalQuantity: 4, availableQuantity: 4, purchasePricePerUnit: BULK_PRICE, status: "ACTIVE", isActive: true } as never);
    await ctx.db.insert("kits", { id: "k1", organizationId: ORG, name: "Rack", assetTag: "KIT-1", status: "AVAILABLE", condition: "GOOD", isActive: true, isPrep: false, purchasePrice: KIT_PRICE } as never);
    await ctx.db.insert("kits", { id: "k2", organizationId: ORG, name: "Case", assetTag: "KIT-2", status: "AVAILABLE", condition: "GOOD", isActive: true, isPrep: false, purchasePrice: 1 } as never);
    await ctx.db.insert("apiKeys", {
      id: KEY, organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h",
      scopes: JSON.stringify(["*"]), isActive: true, actingUserId: USER, createdById: USER, noFinancials: true,
    });
  });
  return t;
}

const reads = (t: T, who: Who) => {
  const c = t.withIdentity(who);
  return Promise.all([
    c.query(api.kits.list, { orgId: ORG }),
    c.query(api.kits.getById, { id: "k1" }),
    c.query(api.kits.listPage, { orgId: ORG, sortBy: "purchasePrice" }),
    c.query(api.kits.listByIds, { orgId: ORG, ids: ["k1"] }),
    c.query(api.kits.getByAssetTag, { organizationId: ORG, assetTag: "KIT-1" }),
    c.query(api.kits.availableAssets, { orgId: ORG }),
    c.query(api.kits.availableBulkAssets, { orgId: ORG }),
    c.query(api.kitDetail.bundle, { kitId: "k1", orgId: ORG }),
  ]);
};

describe("kit reads: cost for a noFinancials key", () => {
  test("no sentinel anywhere, and the rows themselves are intact", async () => {
    const t = await seed();
    const out = await reads(t, asAgent);
    for (const [i, r] of out.entries()) {
      const json = JSON.stringify(r);
      for (const s of [KIT_PRICE, UNIT_PRICE, BULK_PRICE, REPLACEMENT, DEFAULT_PURCHASE]) expect(json, `read #${i}`).not.toContain(String(s));
    }
    expect((out[0] as { assetTag: string }[]).map((k) => k.assetTag).sort()).toEqual(["KIT-1", "KIT-2"]);
    expect((out[5] as { assetTag: string }[]).map((a) => a.assetTag)).toEqual(["A-1"]);
    expect((out[6] as { assetTag: string }[]).map((b) => b.assetTag)).toEqual(["B-1"]);
    expect("purchasePrice" in (out[1] as object)).toBe(false);
  });

  test("a member still sees every cost", async () => {
    const t = await seed();
    const out = await reads(t, asUser);
    expect(JSON.stringify(out[0])).toContain(String(KIT_PRICE));
    expect(JSON.stringify(out[5])).toContain(String(UNIT_PRICE));
    expect(JSON.stringify(out[5])).toContain(String(REPLACEMENT));
    expect(JSON.stringify(out[6])).toContain(String(BULK_PRICE));
    expect(JSON.stringify(out[7])).toContain(String(KIT_PRICE));
  });

  test("the kit allocation read: replacement cost AND the cost-ratio suggestion are absent for a noFinancials key, the saved split is not", async () => {
    const t = await seed();
    await t.run(async (ctx) => {
      await ctx.db.insert("kitSerializedItems", { id: "ks1", organizationId: ORG, kitId: "k1", assetId: "a1", addedById: USER } as never);
      await ctx.db.insert("kitRevenueAllocations", { id: "ka1", organizationId: ORG, kitId: "k1", modelId: "m1", allocationPercent: 100 } as never);
    });
    const read = (who: Who) => t.withIdentity(who).query(api.kitAllocations.getKitAllocation, { orgId: ORG, kitId: "k1" });
    const theirs = await read(asAgent);
    expect(JSON.stringify(theirs)).not.toContain(String(REPLACEMENT));
    expect("replacementCost" in theirs.rows[0]).toBe(false);
    expect("suggestedPercent" in theirs.rows[0]).toBe(false);
    expect(theirs.rows[0].allocationPercent).toBe(100);
    const mine = await read(asUser);
    expect(mine.rows[0]).toMatchObject({ replacementCost: REPLACEMENT, suggestedPercent: 100 });
  });

  test("ordering: a member sorts kits by price; a noFinancials key falls back to tag order", async () => {
    const t = await seed(); // KIT-1 costs KIT_PRICE, KIT-2 costs 1: price order is the REVERSE of tag order
    const tags = async (who: Who) => (await t.withIdentity(who).query(api.kits.listPage, { orgId: ORG, sortBy: "purchasePrice" })).items.map((k) => k.assetTag);
    expect(await tags(asUser)).toEqual(["KIT-2", "KIT-1"]);
    expect(await tags(asAgent)).toEqual(["KIT-1", "KIT-2"]);
  });
});
