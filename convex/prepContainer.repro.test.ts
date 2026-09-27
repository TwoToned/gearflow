// @vitest-environment node
//
// Phase 1c regression (gearflow#1298, tracking #1296) — was the phase 0 repro
// (gearflow#1297) pinning defect #1 from
// docs/designs/packing-containers-manifest.md §1.5 ("the unit/line split —
// the hardly-works bug"): `prepUnit` wrote a `prepContainer` label onto the
// UNIT for a serialised prep, but every reader (the roll-up, the Deploy-tab
// grouping key) read the LINE's own `prepContainer`, which a serialised prep
// never set. So a case's contents never rolled the container line up to
// CHECKED_OUT.
//
// Phase 1c rewired prep onto `projectLineItemUnits.containerId` and moved the
// roll-up server-side (`syncContainerStatuses`, called once at the end of
// `checkoutItemsCore`/`checkinItemsCore` in warehouseOps.ts) — this file is
// now the real regression test, exercising the actual checkout mutation
// rather than a hand-patched status flip.
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

const lineById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique());
const containerById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("projectContainers").withIndex("by_cuid", (q) => q.eq("id", id)).unique());
const unitByLine = (t: T, lineItemId: string) =>
  t.run(async (ctx) => ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", lineItemId)).first());

const V1 = "v-p1";

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "member" });
    await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
    await ctx.db.insert("projects", {
      id: "p1", organizationId: ORG, projectNumber: "P-1", name: "Test",
      status: "CONFIRMED", total: 0, liveVersionId: V1, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projectVersions", {
      id: V1, organizationId: ORG, projectId: "p1", number: 1, contentState: "ready", createdAt: NOW, createdById: USER,
    });
    await ctx.db.insert("models", { id: "mdl1", organizationId: ORG, name: "Par Can", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "mdl1", assetTag: "A-1", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
    // The content line — an ordinary serialised rental line, not yet prepped.
    await ctx.db.insert("projectLineItems", {
      id: "L1", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "L1", type: "EQUIPMENT", modelId: "mdl1",
      quantity: 1, sortOrder: 0, status: "CONFIRMED", checkedOutQuantity: 0, prepStatus: "PENDING",
      createdAt: NOW, updatedAt: NOW,
    });
    // The case's own line item + its projectContainers row (the real #1296 shape).
    await ctx.db.insert("projectLineItems", {
      id: "case-li", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "case-li", type: "EQUIPMENT", modelId: "mdl1", assetId: "case-asset",
      quantity: 1, sortOrder: 1, status: "CONFIRMED", checkedOutQuantity: 0, prepStatus: "PACKED",
      prepContainer: "C1", containerId: "c1", isContainerLineItem: true, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projectContainers", {
      id: "c1", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "c1", kind: "ASSET", assetId: "case-asset", label: "C1",
      lineItemId: "case-li", sortOrder: 0, createdAt: NOW, updatedAt: NOW,
    });
  });
}

describe("prepContainer unit/line split (defect #1, §1.5) — fixed", () => {
  test("a serialised prep into a container rolls the container up to CHECKED_OUT once checkout runs, via the legacy label arg", async () => {
    const t = makeT();
    await seed(t);

    // Prep the serialised asset into "C1" via the OLD label arg — an
    // un-migrated caller must still resolve to the real container.
    await t.withIdentity(SERVICE).mutation(api.checkRecordOps.prepItems, {
      organizationId: ORG, projectId: "p1",
      items: [{ lineItemId: "L1", assetId: "a1", prepContainer: "C1" }],
      now: NOW,
    });

    const unit = await unitByLine(t, "L1");
    expect(unit?.containerId).toBe("c1");
    expect(unit?.prepContainer).toBe("C1"); // widen — still readable

    // Deploy it through the real checkout mutation (not a hand-patched
    // status flip) — this is what exercises `syncContainerStatuses`.
    await t.withIdentity(SERVICE).mutation(api.warehouseOps.checkoutItems, {
      organizationId: ORG, projectId: "p1", userId: USER,
      items: [{ lineItemId: "L1", assetId: "a1" }],
      includeAccessories: false, now: NOW,
    });

    // The only content unit is fully deployed — the container's own line
    // (and its projectContainers row) roll up to CHECKED_OUT automatically,
    // server-side, in the SAME transaction — no client-driven syncContainersBatch
    // follow-up call needed.
    const caseLine = await lineById(t, "case-li");
    expect(caseLine?.status).toBe("CHECKED_OUT");
  });

  test("prepping directly by containerId (no legacy label) works the same way", async () => {
    const t = makeT();
    await seed(t);

    await t.withIdentity(SERVICE).mutation(api.checkRecordOps.prepItems, {
      organizationId: ORG, projectId: "p1",
      items: [{ lineItemId: "L1", assetId: "a1", containerId: "c1" }],
      now: NOW,
    });
    expect((await unitByLine(t, "L1"))?.containerId).toBe("c1");

    await t.withIdentity(SERVICE).mutation(api.warehouseOps.checkoutItems, {
      organizationId: ORG, projectId: "p1", userId: USER,
      items: [{ lineItemId: "L1", assetId: "a1" }],
      includeAccessories: false, now: NOW,
    });
    expect((await lineById(t, "case-li"))?.status).toBe("CHECKED_OUT");
    expect((await containerById(t, "c1"))?.updatedAt).toBeDefined();
  });

  test("a content unit's containerId defaults from the line's plannedContainerId when prep gives no signal at all", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      const l = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "L1")).unique();
      if (l) await ctx.db.patch(l._id, { plannedContainerId: "c1" });
    });

    await t.withIdentity(SERVICE).mutation(api.checkRecordOps.prepItems, {
      organizationId: ORG, projectId: "p1",
      items: [{ lineItemId: "L1", assetId: "a1" }], // no containerId, no prepContainer
      now: NOW,
    });
    expect((await unitByLine(t, "L1"))?.containerId).toBe("c1");
  });
});
