// @vitest-environment node
import { convexTest, type TestConvex } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import type { Doc } from "./_generated/dataModel";
import { recalcProjectTotals } from "./lib/recalc";

type T = TestConvex<typeof schema>;
type NewLine = Omit<Doc<"projectLineItems">, "_id" | "_creationTime">;

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const NOW = 1_700_000_000_000;

/**
 * End-to-end gate: allocation must actually LAND, through the same function every
 * write in the app funnels through.
 *
 * convex/allocation.test.ts proves the arithmetic. This proves the wiring — that
 * recalcProjectTotals persists `allocatedRevenue` / `allocationBasis` onto the line
 * rows and rebuilds the projectModelRevenues rollup. A pure-unit suite passes
 * happily while the pass is never invoked, or writes to nothing.
 */

const line = (o: Partial<NewLine> & { id: string }): NewLine => ({
  organizationId: ORG,
  projectId: "p1",
  type: "EQUIPMENT",
  status: "CONFIRMED",
  isKitChild: false,
  isOptional: false,
  ...o,
});

async function seedKitProject(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig",
      status: "COMPLETED", isTemplate: false, taxRate: 10, discountPercent: 0,
      createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("models", { id: "rx", organizationId: ORG, name: "Receiver", replacementCost: 2000 });
    await ctx.db.insert("models", { id: "belt", organizationId: ORG, name: "Mic belt", replacementCost: 15 });

    // Kit line at $900, two child models, no saved allocation yet.
    await ctx.db.insert("projectLineItems", line({ id: "kit", kitId: "k1", lineTotal: 900, sortOrder: 0 }));
    await ctx.db.insert("projectLineItems", line({ id: "c1", modelId: "rx", parentLineItemId: "kit", isKitChild: true, childKind: "KIT", quantity: 4, sortOrder: 1 }));
    await ctx.db.insert("projectLineItems", line({ id: "c2", modelId: "belt", parentLineItemId: "kit", isKitChild: true, childKind: "KIT", quantity: 4, sortOrder: 2 }));
  });
}

const readLine = (t: T, id: string) =>
  t.run(async (ctx) =>
    ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).first(),
  );

const readRollup = (t: T) =>
  t.run(async (ctx) =>
    ctx.db.query("projectModelRevenues").withIndex("by_projectId", (q) => q.eq("projectId", "p1")).collect(),
  );

describe("recalcProjectTotals — allocation lands on the rows", () => {
  test("kit children are allocated and the parent is left as a container", async () => {
    const t = convexTest(schema, modules);
    await seedKitProject(t);
    await t.run(async (ctx) => recalcProjectTotals(ctx, "p1", ORG, null, NOW + 1));

    // No day rates on either model → falls through to replacement cost:
    // 8000 vs 60 of 8060 total.
    const rx = await readLine(t, "c1");
    const belt = await readLine(t, "c2");
    expect(rx?.allocationBasis).toBe("WEIGHTED");
    expect(rx!.allocatedRevenue! + belt!.allocatedRevenue!).toBeCloseTo(900, 2);
    expect(rx!.allocatedRevenue!).toBeGreaterThan(belt!.allocatedRevenue!);

    const parent = await readLine(t, "kit");
    expect(parent?.allocatedRevenue).toBeUndefined();
    expect(parent?.allocationBasis).toBe("EXCLUDED_NON_GEAR");
  });

  test("a saved kit allocation overrides the fallback weighting", async () => {
    const t = convexTest(schema, modules);
    await seedKitProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("kitRevenueAllocations", { id: "ka1", organizationId: ORG, kitId: "k1", modelId: "rx", allocationPercent: 80 });
      await ctx.db.insert("kitRevenueAllocations", { id: "ka2", organizationId: ORG, kitId: "k1", modelId: "belt", allocationPercent: 20 });
      await recalcProjectTotals(ctx, "p1", ORG, null, NOW + 1);
    });

    expect((await readLine(t, "c1"))?.allocatedRevenue).toBe(720);
    expect((await readLine(t, "c2"))?.allocatedRevenue).toBe(180);
    expect((await readLine(t, "c1"))?.allocationBasis).toBe("KIT_PERCENT");
  });

  test("a stale kit allocation is ignored rather than misapplied", async () => {
    const t = convexTest(schema, modules);
    await seedKitProject(t);
    await t.run(async (ctx) => {
      // Covers only one of the kit's two models — the drift a warehouse swap causes.
      await ctx.db.insert("kitRevenueAllocations", { id: "ka1", organizationId: ORG, kitId: "k1", modelId: "rx", allocationPercent: 100 });
      await recalcProjectTotals(ctx, "p1", ORG, null, NOW + 1);
    });

    expect((await readLine(t, "c1"))?.allocationBasis).toBe("WEIGHTED");
    // The uncovered model still earns — it is not zeroed out.
    expect((await readLine(t, "c2"))!.allocatedRevenue!).toBeGreaterThan(0);
  });

  test("the projectModelRevenues rollup is rebuilt, and stale models are dropped", async () => {
    const t = convexTest(schema, modules);
    await seedKitProject(t);
    await t.run(async (ctx) => {
      // A rollup row for a model that no longer appears in the project.
      await ctx.db.insert("projectModelRevenues", { id: "stale", organizationId: ORG, projectId: "p1", modelId: "gone", allocatedRevenue: 500, updatedAt: NOW });
      await recalcProjectTotals(ctx, "p1", ORG, null, NOW + 1);
    });

    const rows = await readRollup(t);
    const byModel = new Map(rows.map((r) => [r.modelId, r.allocatedRevenue]));
    expect(byModel.has("gone")).toBe(false);
    expect(byModel.get("rx")! + byModel.get("belt")!).toBeCloseTo(900, 2);
  });

  test("sub-hired gear is stored but kept out of the rollup", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", {
        id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig",
        status: "COMPLETED", isTemplate: false, taxRate: 10, discountPercent: 0,
        createdAt: NOW, updatedAt: NOW,
      });
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: ORG, projectId: "p1", title: "RF", price: 200, quantity: 1, sortOrder: 0 });
      await ctx.db.insert("projectLineItems", line({ id: "owned", modelId: "rx", groupId: "g1", lineTotal: 100, sortOrder: 1 }));
      await ctx.db.insert("projectLineItems", line({ id: "hired", modelId: "rx", groupId: "g1", lineTotal: 100, subHireId: "sh1", sortOrder: 2 }));
      await recalcProjectTotals(ctx, "p1", ORG, null, NOW + 1);
    });

    expect((await readLine(t, "hired"))?.allocatedRevenue).toBe(100);
    expect((await readLine(t, "hired"))?.allocationBasis).toBe("EXCLUDED_SUBHIRE");

    // Both rows carry model rx; only the owned $100 is our capital's earnings.
    const rows = await readRollup(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].allocatedRevenue).toBe(100);
  });

  test("re-running on an unchanged project is a no-op (no cent drift)", async () => {
    const t = convexTest(schema, modules);
    await seedKitProject(t);
    await t.run(async (ctx) => recalcProjectTotals(ctx, "p1", ORG, null, NOW + 1));
    const first = (await readLine(t, "c1"))?.allocatedRevenue;

    await t.run(async (ctx) => recalcProjectTotals(ctx, "p1", ORG, null, NOW + 2));
    expect((await readLine(t, "c1"))?.allocatedRevenue).toBe(first);
    expect(await readRollup(t)).toHaveLength(2);
  });

  test("removing the kit price zeroes its children rather than stranding old values", async () => {
    const t = convexTest(schema, modules);
    await seedKitProject(t);
    await t.run(async (ctx) => recalcProjectTotals(ctx, "p1", ORG, null, NOW + 1));
    expect((await readLine(t, "c1"))!.allocatedRevenue!).toBeGreaterThan(0);

    await t.run(async (ctx) => {
      const kit = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "kit")).first();
      await ctx.db.patch(kit!._id, { lineTotal: undefined });
      await recalcProjectTotals(ctx, "p1", ORG, null, NOW + 2);
    });

    expect((await readLine(t, "c1"))?.allocatedRevenue).toBe(0);
    expect((await readLine(t, "c1"))?.allocationBasis).toBe("NO_REVENUE");
    expect(await readRollup(t)).toHaveLength(0);
  });
});
