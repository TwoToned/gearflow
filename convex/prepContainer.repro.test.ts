// @vitest-environment node
//
// Phase 0 repro (gearflow#1297, tracking #1296) — pins defect #1 from
// docs/designs/packing-containers-manifest.md §1.5 ("the unit/line split — the
// hardly-works bug"). `prepUnit` (convex/lib/fulfillment.ts) writes
// `prepContainer` onto the UNIT for a serialised/tagged-bulk prep, but every
// reader — `syncContainersBatchCore`'s roll-up (warehouseOps.ts), the
// Deploy-tab grouping key, `clearPrepContainerCore` — reads the LINE's own
// `prepContainer`, which a serialised prep never sets. So a case's contents
// never roll the container line up to CHECKED_OUT, and the case never
// auto-deploys with the job.
//
// `it.fails`: this is expected to fail today and turn green once phase 1c
// rewires prep/checkout onto `projectLineItemUnits.containerId` +
// `syncContainerStatuses` (the container's roll-up moving server-side and
// keying by container id instead of a label). At that point this file is
// rewritten as the real regression test per the build plan's phase 1c note.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, it, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const asUser = (orgId: string) => ({ subject: USER, orgId });

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

const lineById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique());
const unitByLine = (t: T, lineItemId: string) =>
  t.run(async (ctx) => ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", lineItemId)).first());

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "member" });
    await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
    await ctx.db.insert("projects", {
      id: "p1", organizationId: ORG, projectNumber: "P-1", name: "Test",
      status: "CONFIRMED", total: 0, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("models", { id: "mdl1", organizationId: ORG, name: "Par Can", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "mdl1", assetTag: "A-1", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
    // The content line — an ordinary serialised rental line, not yet prepped.
    await ctx.db.insert("projectLineItems", {
      id: "L1", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", modelId: "mdl1",
      quantity: 1, sortOrder: 0, status: "CONFIRMED", checkedOutQuantity: 0, prepStatus: "PENDING",
      createdAt: NOW, updatedAt: NOW,
    });
    // The case's own line item, created the way `ensureContainerOnProjectCore`
    // does today: isContainerLineItem, prepContainer = its label.
    await ctx.db.insert("projectLineItems", {
      id: "case1", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", modelId: "mdl1", assetId: "case-asset",
      quantity: 1, sortOrder: 1, status: "CONFIRMED", checkedOutQuantity: 0, prepStatus: "PACKED",
      prepContainer: "C1", isContainerLineItem: true, createdAt: NOW, updatedAt: NOW,
    });
  });
}

describe("prepContainer unit/line split (defect #1, §1.5)", () => {
  it.fails("a serialised prep into a container rolls the container line up to CHECKED_OUT once its contents deploy", async () => {
    const t = makeT();
    await seed(t);

    // Prep the serialised asset into container "C1" via the same path the
    // warehouse page's Pick/Prep tab uses.
    await t.withIdentity(SERVICE).mutation(api.checkRecordOps.prepItems, {
      organizationId: ORG, projectId: "p1",
      items: [{ lineItemId: "L1", assetId: "a1", prepContainer: "C1" }],
      now: NOW,
    });

    // The unit got the label (fulfillment.ts prepUnit)...
    const unit = await unitByLine(t, "L1");
    expect(unit?.prepContainer).toBe("C1");
    // ...but the line — which every reader (roll-up, Deploy-tab grouping,
    // clearPrepContainer) actually trusts — never did.
    const lineAfterPrep = await lineById(t, "L1");
    expect(lineAfterPrep?.prepContainer).toBeUndefined();

    // Simulate the item going out on the job — checkout mechanics aren't the
    // point of this repro, so flip status directly the way the existing
    // syncContainersBatch tests do.
    await t.run(async (ctx) => {
      const l = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "L1")).unique();
      if (l) await ctx.db.patch(l._id, { status: "CHECKED_OUT", checkedOutQuantity: 1, updatedAt: NOW });
    });

    const res = await t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.syncContainersBatch, {
      orgId: ORG, projectId: "p1", containerNames: ["C1"], now: NOW,
      actor: { userId: USER, userName: "Alice" },
    });

    // The only content line is fully deployed, so the container should flip
    // too — but the roll-up buckets by the LINE's `prepContainer`, which L1
    // never carries, so the container is invisible to the sync.
    expect(res.results[0]?.updated).toBe(true);
    const caseLine = await lineById(t, "case1");
    expect(caseLine?.status).toBe("CHECKED_OUT");
  });
});
