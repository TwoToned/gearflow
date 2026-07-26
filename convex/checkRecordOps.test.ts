// @vitest-environment node
//
// gearflow#797 — regression: a returned line whose model has no check items
// routes through the "direct deprep" path (deprepItemInner). That path
// correctly resets line.prepStatus to PENDING, but then called
// syncLineItemRollup, which re-derived prepStatus from the RETURNED unit's
// still-PACKED prepStatus (return never clears it) and silently flipped the
// line straight back to PACKED — so the item never left the Return tab for
// De-prepped, even though the deprep mutation reported success. Fixed in
// convex/lib/lineItemUnits.ts's deriveOrderLinePrepStatus by excluding
// RETURNED/CANCELLED units from the "any unit PACKED ⇒ line PACKED" rule.
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

/** Seed a plain (non-kit) serialised line item, already prepped + deployed:
 *  line + unit both CHECKED_OUT with prepStatus PACKED, mirroring a real
 *  item that went out on a job (no check items configured on its model —
 *  the condition that routes deprep through the buggy direct path). */
async function seedDeployedItem(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "admin" });
    await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P-1", name: "Test", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("models", { id: "mdl1", organizationId: ORG, name: "Drum Shield", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("assets", { id: "as1", organizationId: ORG, modelId: "mdl1", assetTag: "AS1", status: "CHECKED_OUT", isActive: true, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("projectLineItems", {
      id: "L1", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", modelId: "mdl1", assetId: "as1",
      quantity: 1, status: "CHECKED_OUT", prepStatus: "PACKED", createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projectLineItemUnits", {
      id: "u1", organizationId: ORG, lineItemId: "L1", ordinal: 1, assetId: "as1",
      quantity: 1, returnedQuantity: 0, status: "CHECKED_OUT", prepStatus: "PACKED", createdAt: NOW, updatedAt: NOW,
    });
  });
}

const line = (t: T) => t.run(async (ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "L1")).unique());
const unit = (t: T) => t.run(async (ctx) => ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", "L1")).unique());

describe("gearflow#797 — return → direct deprep", () => {
  test("returning then deprepping a checked-item-free item moves it out of the Return tab", async () => {
    const t = makeT();
    await seedDeployedItem(t);

    await t.withIdentity(SERVICE).mutation(api.warehouseOps.checkinItems, {
      organizationId: ORG, projectId: "p1", userId: USER,
      items: [{ lineItemId: "L1", assetId: "as1", returnCondition: "GOOD" }],
      now: NOW,
    });

    // Sanity: the return landed it in the Return tab (RETURNED + still PACKED).
    let l = await line(t);
    expect(l?.status).toBe("RETURNED");
    expect(l?.prepStatus).toBe("PACKED");
    // The unit's prepStatus is untouched by return — it stays PACKED as history.
    expect((await unit(t))?.prepStatus).toBe("PACKED");

    // Deprep via the direct (no-check-items) path, exactly like the warehouse
    // page's "Deprep Selected" button for a model with zero check items.
    await t.withIdentity(SERVICE).mutation(api.checkRecordOps.deprepItems, {
      organizationId: ORG, projectId: "p1",
      ops: [{ lineItemId: "L1", quantity: 1 }],
      now: NOW,
    });

    l = await line(t);
    expect(l?.status).toBe("RETURNED");
    // Regression: this used to still read "PACKED" (bounced right back by
    // syncLineItemRollup reading the untouched RETURNED unit), keeping the
    // item stuck on the Return tab despite the "Removed from prep" toast.
    expect(l?.prepStatus).not.toBe("PACKED");
    expect(l?.prepStatus).toBe("PENDING");

    // The RETURNED unit itself must survive as return-history — deprep
    // must not delete it (it's excluded from deprepItemInner's removal set).
    const u = await unit(t);
    expect(u).not.toBeNull();
    expect(u?.status).toBe("RETURNED");
  });
});
