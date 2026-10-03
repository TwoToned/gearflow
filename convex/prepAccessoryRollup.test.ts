// @vitest-environment node
//
// Regression — prepping an accessory parent must roll the PACKED state up onto
// each accessory CHILD LINE, not just its units. The warehouse UI reads
// `prepStatus` off the child line row, so a child whose units were packed but
// whose line was never re-synced stays "unprepped": the parent never leaves
// Pick/Prep for Deploy cleanly and Deploy flags every accessory as missing.
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
    await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "Handheld", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "HH1", status: "AVAILABLE", isActive: true, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("bulkAssets", { id: "ba1", organizationId: ORG, modelId: "m1", assetTag: "BAT", isActive: true });
    await ctx.db.insert("modelBulkAccessories", { id: "mba1", organizationId: ORG, modelId: "m1", bulkAssetId: "ba1", quantity: 1, addedById: USER });
    await ctx.db.insert("projectLineItems", {
      id: "L1", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", modelId: "m1", assetId: "a1",
      quantity: 1, status: "CONFIRMED", createdAt: NOW, updatedAt: NOW,
    });
  });
}

describe("prep cascades PACKED onto accessory child lines", () => {
  test("after prepping the parent asset, every accessory child line is PACKED", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(SERVICE).mutation(api.checkRecordOps.prepItems, {
      organizationId: ORG, projectId: "p1", items: [{ lineItemId: "L1", assetId: "a1" }], now: NOW,
      actor: { userId: USER, userName: "Alice" },
    });
    const children = await t.run(async (ctx) =>
      (await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", "L1")).collect())
        .filter((c) => c.childKind === "ACCESSORY"),
    );
    expect(children.length).toBeGreaterThan(0);
    for (const c of children) expect(c.prepStatus).toBe("PACKED");
  });
});
