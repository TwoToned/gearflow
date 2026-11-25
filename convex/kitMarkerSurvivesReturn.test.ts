// @vitest-environment node
//
// The stored kit status INCOMPLETE is the human-cleared "reported missing" marker (convex/lib/kitState.ts).
// A normal return (checkinKit -> patchKitStatusAt) and a force-release (forceReturnKit ->
// releaseKitToLocation, both the location and the location-cleared branch) must keep it: only
// kitWrites.markCompleteNative clears it. A kit WITHOUT the marker still returns to AVAILABLE.
import { convexTest } from "convex-test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };

const makeT = () => {
  const tc = convexTest(schema, modules);
  registerShardedCounter(tc, "shardedCounter");
  return tc;
};
type T = ReturnType<typeof makeT>;

/** A deployed, unit-less kit (the legacy path) at the given stored status; optionally an org default location. */
async function seed(t: T, status: "INCOMPLETE" | "CHECKED_OUT", withDefaultLocation: boolean) {
  await t.run(async (ctx) => {
    await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "KIT-1", name: "L", status, condition: "GOOD", isActive: true, locationId: "away", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "A-1", status: "CHECKED_OUT", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("projectLineItems", { id: "kl1", organizationId: ORG, projectId: "p1", kitId: "k1", type: "EQUIPMENT", status: "CHECKED_OUT", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("projectLineItems", { id: "kc1", organizationId: ORG, projectId: "p1", parentLineItemId: "kl1", assetId: "a1", type: "EQUIPMENT", status: "CHECKED_OUT", isKitChild: true, createdAt: NOW, updatedAt: NOW });
    if (withDefaultLocation) await ctx.db.insert("locations", { id: "home", organizationId: ORG, name: "Home", type: "WAREHOUSE", isDefault: true, tags: [], createdAt: 1, updatedAt: 1 });
  });
}

const kit = (t: T) => t.run(async (ctx) => ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", "k1")).unique());
const checkin = (t: T) => t.withIdentity(SERVICE).mutation(api.warehouseOps.checkinKit, { organizationId: ORG, projectId: "p1", userId: USER, kitId: "k1", returnCondition: "GOOD", now: NOW });
const forceReturn = (t: T) => t.withIdentity(SERVICE).mutation(api.warehouseOps.forceReturnKit, { organizationId: ORG, kitId: "k1", userId: USER, now: NOW });

describe("the reported-missing marker survives a return", () => {
  test("a GOOD check-in (patchKitStatusAt) keeps INCOMPLETE", async () => {
    const t = makeT();
    await seed(t, "INCOMPLETE", true);
    await checkin(t);
    const k = await kit(t);
    expect(k?.status).toBe("INCOMPLETE");
    expect(k?.locationId).toBe("home"); // it still came home
  });

  test("a force-release to the default location (releaseKitToLocation) keeps INCOMPLETE", async () => {
    const t = makeT();
    await seed(t, "INCOMPLETE", true);
    await forceReturn(t);
    const k = await kit(t);
    expect(k?.status).toBe("INCOMPLETE");
    expect(k?.locationId).toBe("home");
  });

  test("a force-release with no default location clears the location but keeps INCOMPLETE", async () => {
    const t = makeT();
    await seed(t, "INCOMPLETE", false);
    await forceReturn(t);
    const k = await kit(t);
    expect(k?.status).toBe("INCOMPLETE");
    expect(k?.locationId).toBeUndefined();
  });

  test("control: a kit without the marker still returns to AVAILABLE on both paths", async () => {
    const a = makeT();
    await seed(a, "CHECKED_OUT", true);
    await checkin(a);
    expect((await kit(a))?.status).toBe("AVAILABLE");

    const b = makeT();
    await seed(b, "CHECKED_OUT", true);
    await forceReturn(b);
    expect((await kit(b))?.status).toBe("AVAILABLE");
  });
});
