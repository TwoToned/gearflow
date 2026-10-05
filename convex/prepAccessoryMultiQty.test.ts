// @vitest-environment node
//
// Regression — a multi-quantity parent line (no line-level asset, units tagged
// one by one as they are scanned) whose accessory is a BULK child line created at
// line-creation time (one row, qty = perParent × parent qty, no units yet).
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P-1", name: "Test", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "Headset", createdAt: NOW, updatedAt: NOW });
    for (const n of [1, 2, 3]) {
      await ctx.db.insert("assets", { id: `a${n}`, organizationId: ORG, modelId: "m1", assetTag: `HS${n}`, status: "AVAILABLE", isActive: true, createdAt: NOW, updatedAt: NOW });
    }
    await ctx.db.insert("bulkAssets", { id: "ba1", organizationId: ORG, modelId: "m1", assetTag: "ADAPTER", isActive: true });
    await ctx.db.insert("modelBulkAccessories", { id: "mba1", organizationId: ORG, modelId: "m1", bulkAssetId: "ba1", quantity: 1, addedById: USER });
    await ctx.db.insert("projectLineItems", {
      id: "L1", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", modelId: "m1",
      quantity: 3, status: "CONFIRMED", createdAt: NOW, updatedAt: NOW,
    });
    // Created at line-add time: ONE bulk child line, qty 3, no units.
    await ctx.db.insert("projectLineItems", {
      id: "C1", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", modelId: "m1", bulkAssetId: "ba1",
      quantity: 3, isKitChild: true, childKind: "ACCESSORY", parentLineItemId: "L1", accessoryInclusion: "DEFAULT",
      status: "CONFIRMED", createdAt: NOW, updatedAt: NOW,
    });
  });
}

const prep = (t: T, assetId: string, extra: Record<string, unknown> = {}) =>
  t.withIdentity(SERVICE).mutation(api.checkRecordOps.prepItems, {
    organizationId: ORG, projectId: "p1", items: [{ lineItemId: "L1", assetId, ...extra }] as never,
    now: NOW, actor: { userId: USER, userName: "Alice" },
  });
const child = (t: T) => t.run(async (ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "C1")).unique());
const childUnits = (t: T) => t.run(async (ctx) => ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", "C1")).collect());

describe("multi-qty parent with a bulk accessory child line", () => {
  test("scan-prepping every unit packs the accessory line too", async () => {
    const t = makeT();
    await seed(t);
    for (const a of ["a1", "a2", "a3"]) await prep(t, a);
    const units = await childUnits(t);
    expect(units.map((u) => u.prepStatus)).toEqual(["PACKED", "PACKED", "PACKED"]);
    expect((await child(t))?.prepStatus).toBe("PACKED");
  });
  test("accessoriesOnly after a parents-only prep packs the accessory line", async () => {
    const t = makeT();
    await seed(t);
    for (const a of ["a1", "a2", "a3"]) await prep(t, a, { includeAccessoryIds: [] });
    expect((await child(t))?.prepStatus).not.toBe("PACKED");
    for (const a of ["a1", "a2", "a3"]) await prep(t, a, { accessoriesOnly: true });
    expect((await child(t))?.prepStatus).toBe("PACKED");
  });
});
