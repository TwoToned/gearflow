// @vitest-environment node
//
// A kit reported missing cannot be checked out (KIT_REPORTED_MISSING), through the REAL path: the kit is booked on
// job B, goes out on job A and comes back MISSING (which writes the stored marker), then job B's check-out is
// refused and the marker is kept. The booking gate only runs at add-line, so this is the gate that closes it.
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

/** One kit (a serialised member) booked on BOTH job A (p1) and job B (p2) while it is still available. */
async function seed(t: T) {
  await t.run(async (ctx) => {
    for (const p of ["p1", "p2"]) {
      await ctx.db.insert("projects", { id: p, organizationId: ORG, projectNumber: p.toUpperCase(), name: `Job ${p}`, status: "CONFIRMED", isTemplate: false, liveVersionId: `v-${p}`, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectVersions", { id: `v-${p}`, organizationId: ORG, projectId: p, number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    }
    await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "KIT-1", name: "Lighting", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "PAR", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "A-1", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("kitSerializedItems", { id: "ks1", organizationId: ORG, kitId: "k1", assetId: "a1", addedById: USER });
  });
  const svc = t.withIdentity(SERVICE);
  await svc.mutation(api.projectLineItems.createKitLineItem, { id: "kl1", organizationId: ORG, projectId: "p1", kitId: "k1", pricingMode: "KIT_PRICE", now: NOW });
  await svc.mutation(api.projectLineItems.createKitLineItem, { id: "kl2", organizationId: ORG, projectId: "p2", kitId: "k1", pricingMode: "KIT_PRICE", now: NOW });
}

const op = (t: T, name: "checkoutKit" | "checkinKit", projectId: string, extra: Record<string, unknown> = {}) =>
  t.withIdentity(SERVICE).mutation(api.warehouseOps[name], { organizationId: ORG, projectId, userId: USER, kitId: "k1", now: NOW, ...extra } as never);
const kitStatus = (t: T) => t.run(async (ctx) => (await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", "k1")).unique())?.status);

describe("check-out refuses a kit reported missing", () => {
  test("booked on B, returned MISSING from A: B's check-out is refused with KIT_REPORTED_MISSING and the marker stays", async () => {
    const t = makeT();
    await seed(t);
    await op(t, "checkoutKit", "p1");
    await op(t, "checkinKit", "p1", { returnCondition: "MISSING" });
    expect(await kitStatus(t)).toBe("INCOMPLETE"); // the marker the MISSING return wrote

    await expect(op(t, "checkoutKit", "p2")).rejects.toMatchObject({ data: { code: "KIT_REPORTED_MISSING" } });
    expect(await kitStatus(t)).toBe("INCOMPLETE"); // not overwritten
    // Nothing was staged on job B: the kit line is not deployed.
    const line = await t.run(async (ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "kl2")).unique());
    expect(line?.status).not.toBe("CHECKED_OUT");
  });

  /** The same real path as above: the kit is out on A and comes back MISSING (writes the marker). Job B booked it. */
  async function reportedMissing() {
    const t = makeT();
    await seed(t);
    await op(t, "checkoutKit", "p1");
    await op(t, "checkinKit", "p1", { returnCondition: "MISSING" });
    expect(await kitStatus(t)).toBe("INCOMPLETE");
    return t;
  }
  const lineStatus = (t: T, id: string) => t.run(async (ctx) => (await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique())?.status);
  const checkoutItems = (t: T, lineItemId: string, projectId = "p2") =>
    t.withIdentity(SERVICE).mutation(api.warehouseOps.checkoutItems, { organizationId: ORG, projectId, userId: USER, items: [{ lineItemId }], includeAccessories: true, now: NOW });

  test("the per-line deploy (checkoutItems, what dispatch_gear calls) refuses the kit parent line too, and changes nothing", async () => {
    const t = await reportedMissing();
    await expect(checkoutItems(t, "kl2")).rejects.toMatchObject({ data: { code: "KIT_REPORTED_MISSING" } });
    expect(await lineStatus(t, "kl2")).not.toBe("CHECKED_OUT");
    expect(await kitStatus(t)).toBe("INCOMPLETE");
  });

  test("the batch check-out skips it and the report carries the CODE, not only the message", async () => {
    const t = await reportedMissing();
    const res = await t.withIdentity(SERVICE).mutation(api.warehouseOps.checkoutKitsBatch, { organizationId: ORG, projectId: "p2", userId: USER, kitIds: ["k1"], now: NOW });
    expect(res.succeeded).toEqual([]);
    expect(res.errors).toEqual([expect.objectContaining({ kitId: "k1", code: "KIT_REPORTED_MISSING", message: expect.stringMatching(/reported missing/i) })]);
    expect(await kitStatus(t)).toBe("INCOMPLETE");
  });

  test("a NESTED kit reported missing blocks the case it sits in, on both the kit and the per-line paths", async () => {
    const t = await reportedMissing();
    await t.run(async (ctx) => {
      // Job B also holds an outer case "kOut" (available) with the reported-missing kit k1 nested inside it.
      await ctx.db.insert("kits", { id: "kOut", organizationId: ORG, assetTag: "KIT-OUT", name: "Outer case", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", { id: "lOut", organizationId: ORG, projectId: "p2", versionId: "v-p2", kitId: "kOut", type: "EQUIPMENT", status: "CONFIRMED", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", { id: "lIn", organizationId: ORG, projectId: "p2", versionId: "v-p2", parentLineItemId: "lOut", kitId: "k1", isKitChild: true, type: "EQUIPMENT", status: "CONFIRMED", createdAt: NOW, updatedAt: NOW });
    });
    await expect(t.withIdentity(SERVICE).mutation(api.warehouseOps.checkoutKit, { organizationId: ORG, projectId: "p2", userId: USER, kitId: "kOut", now: NOW })).rejects.toMatchObject({ data: { code: "KIT_REPORTED_MISSING" } });
    await expect(checkoutItems(t, "lOut")).rejects.toMatchObject({ data: { code: "KIT_REPORTED_MISSING" } });
    expect(await lineStatus(t, "lOut")).toBe("CONFIRMED");
    expect(await kitStatus(t)).toBe("INCOMPLETE");
  });

  test("control: a kit that came back GOOD still checks out on B", async () => {
    const t = makeT();
    await seed(t);
    await op(t, "checkoutKit", "p1");
    await op(t, "checkinKit", "p1", { returnCondition: "GOOD" });
    await expect(op(t, "checkoutKit", "p2")).resolves.toBeTruthy();
    expect(await kitStatus(t)).toBe("CHECKED_OUT");
  });
});
