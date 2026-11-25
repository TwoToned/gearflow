// @vitest-environment node
// The ONE Delete rule (`assetHistoryReason`): every branch is exercised through the REAL
// `deleteNative`, each by seeding exactly one kind of history on an otherwise bare unit.
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
type Ctx = Parameters<Parameters<T["run"]>[0]>[0];
const ORG = "org_1";
const OTHER = "org_2";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const ME = { userId: "u1", userName: "Alice" };

async function bare(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "TAG-1", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, modelId: "m1", assetTag: "BK-1", totalQuantity: 3, availableQuantity: 3, status: "ACTIVE", isActive: true, createdAt: NOW, updatedAt: NOW });
  });
}
const delAsset = (t: T) => t.withIdentity(SERVICE).mutation(api.assetWrites.deleteNative, { id: "a1", orgId: ORG, actor: ME, auditId: "d1", now: NOW });
const delBulk = (t: T) => t.withIdentity(SERVICE).mutation(api.bulkAssetsWrites.deleteNative, { id: "b1", orgId: ORG, actor: ME, auditId: "d1", now: NOW });
const gone = (t: T, table: "assets" | "bulkAssets", id: string) =>
  t.run(async (ctx) => (await ctx.db.query(table).withIndex("by_cuid", (q) => q.eq("id", id)).first()) === null);

type Seed = (ctx: Ctx, org: string) => Promise<void>;
const put = (fn: (ctx: Ctx, org: string) => Promise<unknown>): Seed => async (ctx, org) => void (await fn(ctx, org));

/** One seed per reason; `org` lets the same seed be planted in ANOTHER org to prove it is ignored. */
const SERIALISED: Record<string, { reason: RegExp; seed: Seed }> = {
  JOB: { reason: /been on a job/, seed: put((ctx, org) => ctx.db.insert("projectLineItems", { id: "li1", organizationId: org, projectId: "p1", assetId: "a1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false })) },
  JOB_UNIT: { reason: /been on a job/, seed: put((ctx, org) => ctx.db.insert("projectLineItemUnits", { id: "u1", organizationId: org, lineItemId: "li1", assetId: "a1", status: "CONFIRMED", ordinal: 1 } as never)) },
  CASE: { reason: /case on a job/, seed: put((ctx, org) => ctx.db.insert("projectContainers", { id: "c1", organizationId: org, kind: "ASSET", assetId: "a1", label: "Case", lineItemId: "x", projectId: "p1" } as never)) },
  MAINTENANCE: {
    reason: /maintenance records/,
    seed: async (ctx, org) => {
      await ctx.db.insert("maintenanceRecords", { id: "mr1", organizationId: org, type: "REPAIR", title: "Fix" } as never);
      await ctx.db.insert("maintenanceRecordAssets", { id: "mra1", maintenanceRecordId: "mr1", assetId: "a1" });
    },
  },
  TEST_AND_TAG: { reason: /test & tag/, seed: put((ctx, org) => ctx.db.insert("testTagAssets", { id: "tt1", organizationId: org, assetId: "a1", testTagId: "T-1", description: "T", status: "CURRENT", isActive: true, lastTestDate: NOW })) },
  CHECK: { reason: /check records/, seed: put((ctx, org) => ctx.db.insert("checkRecords", { id: "cr1", organizationId: org, context: "PREP", assetId: "a1", checkItemId: "ci", checkItemLabelSnapshot: "x", checkItemTypeSnapshot: "PASS_FAIL", result: "PASS", performedById: "u1" } as never)) },
  SCAN: { reason: /scan history/, seed: put((ctx, org) => ctx.db.insert("assetScanLogs", { id: "s1", organizationId: org, assetId: "a1", action: "CHECK_OUT", scannedById: "u1" })) },
  KIT: { reason: /part of a kit/, seed: put((ctx, org) => ctx.db.insert("kitSerializedItems", { id: "ks1", organizationId: org, kitId: "k1", assetId: "a1", addedById: "u1" })) },
  ACCESSORY: { reason: /accessories attached/, seed: put((ctx, org) => ctx.db.insert("assets", { id: "kid", organizationId: org, modelId: "m1", assetTag: "KID", parentAssetId: "a1", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW })) },
  ORDER: {
    reason: /supplier order/,
    seed: async (ctx, org) => {
      await ctx.db.insert("supplierOrders", { id: "so1", organizationId: org, supplierId: "s", orderNumber: "PO-1", type: "PURCHASE", status: "RECEIVED" } as never);
      await ctx.db.insert("supplierOrderItems", { id: "soi1", orderId: "so1", description: "Unit", assetId: "a1" });
    },
  },
  MEDIA: { reason: /photos/, seed: put((ctx, org) => ctx.db.insert("assetMedia", { id: "am1", organizationId: org, assetId: "a1", fileId: "f1", type: "PHOTO" })) },
};

describe("assetHistoryReason: each branch blocks Delete through the real mutation, and only in this org", () => {
  for (const [name, { reason, seed }] of Object.entries(SERIALISED)) {
    test(`${name} blocks a serialised delete`, async () => {
      const t = makeT();
      await bare(t);
      await t.run((ctx) => seed(ctx, ORG));
      await expect(delAsset(t)).rejects.toThrow(reason);
      expect(await gone(t, "assets", "a1")).toBe(false);
    });

    test(`${name} planted in ANOTHER org does not block`, async () => {
      const t = makeT();
      await bare(t);
      await t.run((ctx) => seed(ctx, OTHER));
      await delAsset(t);
      expect(await gone(t, "assets", "a1")).toBe(true);
    });
  }
});

describe("assetDetail.bundle canDelete is the same rule as deleteNative", () => {
  const bundle = (t: T) => t.withIdentity(SERVICE).query(api.assetDetail.bundle, { assetId: "a1", orgId: ORG });

  test("a bare unit can be deleted; a unit with history says why", async () => {
    const t = makeT();
    await bare(t);
    expect((await bundle(t))?.facts).toMatchObject({ canDelete: true, deleteBlockedBy: null, deleteBlockedText: null });
    await t.run((ctx) => SERIALISED.SCAN.seed(ctx, ORG));
    expect((await bundle(t))?.facts).toMatchObject({ canDelete: false, deleteBlockedBy: "SCAN", deleteBlockedText: "it has scan history" });
    await expect(delAsset(t)).rejects.toThrow(/scan history/);
  });
});

const BULK: Record<string, { reason: RegExp; seed: Seed }> = {
  JOB: { reason: /been on a job/, seed: put((ctx, org) => ctx.db.insert("projectLineItems", { id: "li1", organizationId: org, projectId: "p1", bulkAssetId: "b1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, quantity: 1 })) },
  KIT: { reason: /part of a kit/, seed: put((ctx, org) => ctx.db.insert("kitBulkItems", { id: "kb1", organizationId: org, kitId: "k1", bulkAssetId: "b1", quantity: 1, addedById: "u1" } as never)) },
  CASE: { reason: /case on a job/, seed: put((ctx, org) => ctx.db.insert("projectContainers", { id: "c1", organizationId: org, kind: "BULK_ASSET", bulkAssetId: "b1", label: "Tub", lineItemId: "x", projectId: "p1" } as never)) },
  MODEL_ACCESSORY: { reason: /default accessory of a model/, seed: put((ctx, org) => ctx.db.insert("modelBulkAccessories", { id: "mba1", organizationId: org, modelId: "m1", bulkAssetId: "b1", quantity: 1, addedById: "u1" })) },
  SCAN: { reason: /scan history/, seed: put((ctx, org) => ctx.db.insert("assetScanLogs", { id: "s1", organizationId: org, bulkAssetId: "b1", action: "CHECK_OUT", scannedById: "u1" })) },
};

describe("assetHistoryReason: bulk branches", () => {
  for (const [name, { reason, seed }] of Object.entries(BULK)) {
    test(`${name} blocks a bulk delete`, async () => {
      const t = makeT();
      await bare(t);
      await t.run((ctx) => seed(ctx, ORG));
      await expect(delBulk(t)).rejects.toThrow(reason);
      expect(await gone(t, "bulkAssets", "b1")).toBe(false);
    });
    test(`${name} planted in ANOTHER org does not block`, async () => {
      const t = makeT();
      await bare(t);
      await t.run((ctx) => seed(ctx, OTHER));
      await delBulk(t);
      expect(await gone(t, "bulkAssets", "b1")).toBe(true);
    });
  }
});
