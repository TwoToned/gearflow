// @vitest-environment node
import { convexTest, type TestConvex } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

/**
 * Convex-layer coverage for the kit revenue-allocation surface: the panel view
 * assembly (getKitAllocation), the money guards on replaceKitAllocation, the
 * clear path, and the Convex-only cascade deletes on kit/project removal.
 *
 * convex/allocation.test.ts already proves suggestKitAllocation / allocationCoversKit
 * as pure functions; this proves they land correctly through the query, and that the
 * mutation refuses to persist a split the engine would later reject.
 */

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };

/** A kit with a $2000 receiver (rx) and a $15 belt, one unit each. */
async function seedKit(t: T, kitId = "k1") {
  await t.run(async (ctx) => {
    await ctx.db.insert("kits", { id: kitId, organizationId: ORG, assetTag: "KIT-1", name: "RF Kit" });
    await ctx.db.insert("models", { id: "rx", organizationId: ORG, name: "Receiver", replacementCost: 2000 });
    await ctx.db.insert("models", { id: "belt", organizationId: ORG, name: "Mic belt", replacementCost: 15 });
    await ctx.db.insert("assets", { id: "a_rx", organizationId: ORG, modelId: "rx", assetTag: "A-RX" });
    await ctx.db.insert("assets", { id: "a_belt", organizationId: ORG, modelId: "belt", assetTag: "A-BELT" });
    await ctx.db.insert("kitSerializedItems", { id: "ks1", organizationId: ORG, kitId, assetId: "a_rx", addedById: "u1" });
    await ctx.db.insert("kitSerializedItems", { id: "ks2", organizationId: ORG, kitId, assetId: "a_belt", addedById: "u1" });
  });
}

const asService = (t: T) => t.withIdentity(SERVICE);

describe("getKitAllocation — view assembly", () => {
  test("assembles model rows with quantities + cost-weighted suggestion, no saved split", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t);
    const view = await asService(t).query(api.kitAllocations.getKitAllocation, { kitId: "k1", orgId: ORG });

    expect(view.kitName).toBe("RF Kit");
    expect(view.hasAllocation).toBe(false);
    expect(view.isStale).toBe(false);
    expect(view.orphanedModelIds).toEqual([]);
    expect(view.rows).toHaveLength(2);

    // Sorted by suggestedPercent desc → the dear receiver first.
    expect(view.rows[0].modelId).toBe("rx");
    expect(view.rows[0].allocationPercent).toBeNull();
    expect(view.rows[0].suggestedPercent).toBeGreaterThan(view.rows[1].suggestedPercent);
    // Cost-weighted suggestion sums to exactly 100.
    expect(view.rows.reduce((s, r) => s + r.suggestedPercent, 0)).toBeCloseTo(100, 2);
  });

  test("a saved split that still covers the kit is not stale", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("kitRevenueAllocations", { id: "ka1", organizationId: ORG, kitId: "k1", modelId: "rx", allocationPercent: 80 });
      await ctx.db.insert("kitRevenueAllocations", { id: "ka2", organizationId: ORG, kitId: "k1", modelId: "belt", allocationPercent: 20 });
    });
    const view = await asService(t).query(api.kitAllocations.getKitAllocation, { kitId: "k1", orgId: ORG });

    expect(view.hasAllocation).toBe(true);
    expect(view.isStale).toBe(false);
    expect(view.orphanedModelIds).toEqual([]);
    const rx = view.rows.find((r) => r.modelId === "rx");
    expect(rx?.allocationPercent).toBe(80);
  });

  test("a saved split naming a model the kit no longer contains is stale + orphaned", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t);
    await t.run(async (ctx) => {
      // "gone" was in the kit when saved; belt has no saved percent (kit gained it).
      await ctx.db.insert("kitRevenueAllocations", { id: "ka1", organizationId: ORG, kitId: "k1", modelId: "rx", allocationPercent: 50 });
      await ctx.db.insert("kitRevenueAllocations", { id: "ka2", organizationId: ORG, kitId: "k1", modelId: "gone", allocationPercent: 50 });
    });
    const view = await asService(t).query(api.kitAllocations.getKitAllocation, { kitId: "k1", orgId: ORG });

    expect(view.hasAllocation).toBe(true);
    expect(view.isStale).toBe(true);
    expect(view.orphanedModelIds).toEqual(["gone"]);
  });

  test("unknown kit (or a kit in another org) throws", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t);
    await expect(
      asService(t).query(api.kitAllocations.getKitAllocation, { kitId: "nope", orgId: ORG }),
    ).rejects.toThrow(/kit not found/);
    // Cross-org read is indistinguishable from not-found (org guard on the kit doc).
    await expect(
      asService(t).query(api.kitAllocations.getKitAllocation, { kitId: "k1", orgId: "other_org" }),
    ).rejects.toThrow(/kit not found/);
  });
});

describe("replaceKitAllocation — money guards", () => {
  const row = (modelId: string, pct: number, id = `r_${modelId}`) => ({ id, modelId, allocationPercent: pct });

  test("rejects a split that does not sum to 100", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t);
    await expect(
      asService(t).mutation(api.kitAllocations.replaceKitAllocation, {
        kitId: "k1", orgId: ORG, now: NOW, rows: [row("rx", 70), row("belt", 20)],
      }),
    ).rejects.toThrow(/sum to 100/);
  });

  test("rejects a model that is not in the kit", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t);
    await expect(
      asService(t).mutation(api.kitAllocations.replaceKitAllocation, {
        kitId: "k1", orgId: ORG, now: NOW, rows: [row("rx", 50), row("ghost", 50)],
      }),
    ).rejects.toThrow(/not in kit/);
  });

  test("rejects a duplicate model", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t);
    await expect(
      asService(t).mutation(api.kitAllocations.replaceKitAllocation, {
        kitId: "k1", orgId: ORG, now: NOW, rows: [row("rx", 50, "a"), row("rx", 50, "b")],
      }),
    ).rejects.toThrow(/duplicate model/);
  });

  test("rejects an out-of-range percent (>100)", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t);
    await expect(
      asService(t).mutation(api.kitAllocations.replaceKitAllocation, {
        kitId: "k1", orgId: ORG, now: NOW, rows: [row("rx", 150), row("belt", -50)],
      }),
    ).rejects.toThrow(/out of range/);
  });

  test("persists a valid split and replaces any prior split wholesale", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t);
    // Prior split with a stale extra row that must be swept on replace.
    await t.run(async (ctx) => {
      await ctx.db.insert("kitRevenueAllocations", { id: "old1", organizationId: ORG, kitId: "k1", modelId: "rx", allocationPercent: 100 });
    });
    const res = await asService(t).mutation(api.kitAllocations.replaceKitAllocation, {
      kitId: "k1", orgId: ORG, now: NOW, rows: [row("rx", 60), row("belt", 40)],
    });
    expect(res).toEqual({ ok: true, count: 2 });

    const saved = await t.run(async (ctx) =>
      ctx.db.query("kitRevenueAllocations").withIndex("by_kitId", (q) => q.eq("kitId", "k1")).collect(),
    );
    expect(saved).toHaveLength(2);
    expect(new Map(saved.map((r) => [r.modelId, r.allocationPercent]))).toEqual(
      new Map([["rx", 60], ["belt", 40]]),
    );
  });

  test("empty rows clears the split and skips the sum-to-100 guard", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("kitRevenueAllocations", { id: "old1", organizationId: ORG, kitId: "k1", modelId: "rx", allocationPercent: 100 });
    });
    const res = await asService(t).mutation(api.kitAllocations.replaceKitAllocation, {
      kitId: "k1", orgId: ORG, now: NOW, rows: [],
    });
    expect(res).toEqual({ ok: true, count: 0 });
    const saved = await t.run(async (ctx) =>
      ctx.db.query("kitRevenueAllocations").withIndex("by_kitId", (q) => q.eq("kitId", "k1")).collect(),
    );
    expect(saved).toHaveLength(0);
  });

});

describe("clearKitAllocation", () => {
  test("drops every saved row for the kit", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("kitRevenueAllocations", { id: "ka1", organizationId: ORG, kitId: "k1", modelId: "rx", allocationPercent: 80 });
      await ctx.db.insert("kitRevenueAllocations", { id: "ka2", organizationId: ORG, kitId: "k1", modelId: "belt", allocationPercent: 20 });
    });
    const res = await asService(t).mutation(api.kitAllocations.clearKitAllocation, { kitId: "k1", orgId: ORG });
    expect(res).toEqual({ ok: true, count: 2 });
    const saved = await t.run(async (ctx) =>
      ctx.db.query("kitRevenueAllocations").withIndex("by_kitId", (q) => q.eq("kitId", "k1")).collect(),
    );
    expect(saved).toHaveLength(0);
  });

  test("does not delete another org's rows sharing the kitId", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("kitRevenueAllocations", { id: "mine", organizationId: ORG, kitId: "k1", modelId: "rx", allocationPercent: 100 });
      await ctx.db.insert("kitRevenueAllocations", { id: "theirs", organizationId: "other_org", kitId: "k1", modelId: "rx", allocationPercent: 100 });
    });
    await asService(t).mutation(api.kitAllocations.clearKitAllocation, { kitId: "k1", orgId: ORG });
    const remaining = await t.run(async (ctx) =>
      ctx.db.query("kitRevenueAllocations").withIndex("by_kitId", (q) => q.eq("kitId", "k1")).collect(),
    );
    expect(remaining.map((r) => r.id)).toEqual(["theirs"]);
  });
});

describe("cascade deletes of the Convex-only tables", () => {
  test("kits.remove sweeps the kit's revenue allocation rows", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("kitRevenueAllocations", { id: "ka1", organizationId: ORG, kitId: "k1", modelId: "rx", allocationPercent: 80 });
      await ctx.db.insert("kitRevenueAllocations", { id: "ka2", organizationId: ORG, kitId: "k1", modelId: "belt", allocationPercent: 20 });
    });
    await asService(t).mutation(api.kits.remove, { id: "k1" });
    const rows = await t.run(async (ctx) =>
      ctx.db.query("kitRevenueAllocations").withIndex("by_kitId", (q) => q.eq("kitId", "k1")).collect(),
    );
    expect(rows).toHaveLength(0);
  });

  test("projects.remove sweeps the project's model-revenue rollup rows", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", {
        id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig",
        status: "COMPLETED", isTemplate: false, createdAt: NOW, updatedAt: NOW,
      });
      await ctx.db.insert("projectModelRevenues", { id: "pmr1", organizationId: ORG, projectId: "p1", modelId: "rx", allocatedRevenue: 500, updatedAt: NOW });
      await ctx.db.insert("projectModelRevenues", { id: "pmr2", organizationId: ORG, projectId: "p1", modelId: "belt", allocatedRevenue: 10, updatedAt: NOW });
    });
    await asService(t).mutation(api.projects.remove, { id: "p1" });
    const rows = await t.run(async (ctx) =>
      ctx.db.query("projectModelRevenues").withIndex("by_projectId", (q) => q.eq("projectId", "p1")).collect(),
    );
    expect(rows).toHaveLength(0);
  });
});
