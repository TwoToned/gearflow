// @vitest-environment node
// UX Phase 12: RETIRED is a one-way door. Retire / Reinstate are the only doors, so no low-level status
// WRITER (kit release, return correction, warehouse check-in, sale stock) may overwrite RETIRED, and a unit
// that is out on a job comes back before it can be retired.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { setAssetsStatus } from "./warehouseOps";
import { adjustBulkTotal } from "./lib/saleStock";
import { nextStatusUnlessRetired } from "./lib/assetRetire";
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
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const ME = { userId: "u1", userName: "Alice" };

const asset = (t: T, id = "a1") => t.run((ctx) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const retire = (t: T, auditId = "r1") =>
  t.withIdentity(SERVICE).mutation(api.assetWrites.archiveNative, { id: "a1", orgId: ORG, actor: ME, auditId, now: NOW });
const seedAsset = (t: T, extra: Record<string, unknown> = {}) =>
  t.run((ctx) => ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "TAG-1", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW, ...extra } as never));

describe("nextStatusUnlessRetired", () => {
  test("keeps RETIRED, passes everything else through", () => {
    expect(nextStatusUnlessRetired("RETIRED", "AVAILABLE")).toBe("RETIRED");
    expect(nextStatusUnlessRetired("CHECKED_OUT", "AVAILABLE")).toBe("AVAILABLE");
    expect(nextStatusUnlessRetired(undefined, "IN_MAINTENANCE")).toBe("IN_MAINTENANCE");
  });
});

describe("Retire refuses a unit that is out", () => {
  test("a CHECKED_OUT unit is refused with a clear code and stays as it was; once returned it retires", async () => {
    const t = makeT();
    await seedAsset(t, { status: "CHECKED_OUT" });
    await expect(retire(t)).rejects.toThrow(/Return it before retiring/);
    expect(await asset(t)).toMatchObject({ status: "CHECKED_OUT", isActive: true });
    const out = (await asset(t))!;
    await t.run((ctx) => ctx.db.patch(out._id, { status: "AVAILABLE" }));
    await retire(t, "r2");
    expect(await asset(t)).toMatchObject({ status: "RETIRED", isActive: false });
  });
});

describe("no status writer reinstates a retired unit", () => {
  test("retire a kit member, then remove it from the kit: it leaves the kit still retired", async () => {
    const t = makeT();
    await seedAsset(t, { kitId: "k1" });
    await t.run(async (ctx) => {
      await ctx.db.insert("kits", { id: "k1", organizationId: ORG, name: "Rack", assetTag: "KIT-1", status: "AVAILABLE", condition: "GOOD", isActive: true, isPrep: false } as never);
      await ctx.db.insert("kitSerializedItems", { id: "ks1", organizationId: ORG, kitId: "k1", assetId: "a1", addedById: "u1" } as never);
    });
    await retire(t);
    await t.withIdentity(SERVICE).mutation(api.kitWrites.removeSerializedItemNative, { orgId: ORG, kitId: "k1", assetId: "a1", actor: ME, auditId: "k-rm", now: NOW });
    const a = await asset(t);
    expect(a).toMatchObject({ status: "RETIRED", isActive: false });
    expect(a?.kitId).toBeUndefined(); // it did leave the kit
  });

  test("a return-condition correction on a retired asset leaves it retired (an available one still follows the condition)", async () => {
    const t = makeT();
    await seedAsset(t);
    await seedAsset(t, { id: "a2", assetTag: "TAG-2" });
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "l1", organizationId: ORG, projectId: "p1", versionId: "v1", lineageId: "l1", type: "EQUIPMENT", modelId: "m1", status: "RETURNED", isKitChild: false, quantity: 2, sortOrder: 1 } as never);
      await ctx.db.insert("projectLineItemUnits", { id: "u1", organizationId: ORG, lineItemId: "l1", ordinal: 1, assetId: "a1", status: "RETURNED" } as never);
      await ctx.db.insert("projectLineItemUnits", { id: "u2", organizationId: ORG, lineItemId: "l1", ordinal: 2, assetId: "a2", status: "RETURNED" } as never);
    });
    await retire(t);
    const correct = (unitId: string) =>
      t.withIdentity(SERVICE).mutation(api.returnsWrites.correctReturnConditionNative, { orgId: ORG, lineItemId: "l1", unitId, returnCondition: "DAMAGED", auditId: `c-${unitId}`, now: NOW, actor: ME });
    await correct("u1");
    expect(await asset(t)).toMatchObject({ status: "RETIRED", isActive: false });
    await correct("u2");
    expect((await asset(t, "a2"))?.status).toBe("IN_MAINTENANCE"); // damaged -> maintenance, the unchanged behaviour
  });

  test("a warehouse check-in (setAssetsStatus) leaves a retired unit retired and moves a live one", async () => {
    const t = makeT();
    await seedAsset(t);
    await seedAsset(t, { id: "a2", assetTag: "TAG-2", status: "CHECKED_OUT" });
    await retire(t);
    await t.run((ctx) => setAssetsStatus(ctx, ["a1", "a2"], "AVAILABLE", null, false, NOW));
    expect((await asset(t))?.status).toBe("RETIRED");
    expect((await asset(t, "a2"))?.status).toBe("AVAILABLE");
  });

  test("sale stock that takes a retired bulk row to zero leaves it RETIRED (a live row still flips to OUT_OF_STOCK)", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, modelId: "m1", assetTag: "BK-1", totalQuantity: 3, availableQuantity: 3, status: "RETIRED", isActive: false, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("bulkAssets", { id: "b2", organizationId: ORG, modelId: "m1", assetTag: "BK-2", totalQuantity: 3, availableQuantity: 3, status: "ACTIVE", isActive: true, createdAt: NOW, updatedAt: NOW });
    });
    const sell = (id: string) =>
      t.run((ctx) => adjustBulkTotal(ctx, { bulkAssetId: id, orgId: ORG, qty: 3, projectId: "p1", lineItemId: "l1", reason: "sale", actor: { userId: "u1", userName: "Alice" } as never, now: NOW }));
    await sell("b1");
    await sell("b2");
    const status = (id: string) => t.run((ctx) => ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", id)).first());
    expect((await status("b1"))?.status).toBe("RETIRED");
    expect((await status("b2"))?.status).toBe("OUT_OF_STOCK");
  });
});
