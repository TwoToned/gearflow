// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "../schema";
import { loadTotalsBundle } from "./recalc";
import { classifyCompareRows, buildMoneyBridge, assertBridgeIntegrity, type MoneyBridge } from "./versionCompare";

const modules = import.meta.glob("../**/*.ts");
const ORG = "org_1";
const PROJECT = "p1";

function makeT() {
  return convexTest(schema, modules);
}

/**
 * Loads both versions' `TotalsBundle`s the same way `versionsRead.ts`'s
 * `compareVersions` query will, and runs `fn` against them INSIDE the same
 * `t.run` transaction. `TotalsBundle.saleCostRefs` carries `Map`s
 * (`convex/lib/recalc.ts`'s `loadSaleCostRefs`), which `convex-test` cannot
 * serialize across its `t.run` boundary — so unlike `recalcSplit.
 * differential.test.ts` (which only pulls plain `Totals` numbers back out),
 * this helper never returns a raw bundle to the top-level test; `fn`'s
 * return value must itself be plain-serializable (rows/bridges are).
 */
async function withBundles<T>(
  t: ReturnType<typeof convexTest>,
  versionAId: string,
  versionBId: string,
  fn: (a: NonNullable<Awaited<ReturnType<typeof loadTotalsBundle>>>, b: NonNullable<Awaited<ReturnType<typeof loadTotalsBundle>>>) => T,
): Promise<T> {
  return t.run(async (ctx) => {
    const [a, b] = await Promise.all([
      loadTotalsBundle(ctx, PROJECT, ORG, null, versionAId),
      loadTotalsBundle(ctx, PROJECT, ORG, null, versionBId),
    ]);
    if (!a || !b) throw new Error("fixture bundle missing");
    return fn(a, b);
  });
}

async function seedProjectAndVersions(t: ReturnType<typeof convexTest>, projectOverrides: Record<string, unknown> = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Client", taxExempt: false });
    await ctx.db.insert("projects", {
      id: PROJECT,
      organizationId: ORG,
      projectNumber: "P1",
      name: "Gig",
      status: "CONFIRMED",
      isTemplate: false,
      taxRate: 10,
      discountPercent: 0,
      clientId: "c1",
      liveVersionId: "vA",
      createdAt: 1,
      updatedAt: 1,
      ...projectOverrides,
    });
    await ctx.db.insert("projectVersions", { id: "vA", organizationId: ORG, projectId: PROJECT, number: 1, contentState: "ready", createdAt: 1, createdById: "u1" });
    await ctx.db.insert("projectVersions", { id: "vB", organizationId: ORG, projectId: PROJECT, number: 2, contentState: "ready", createdAt: 2, createdById: "u1" });
  });
}

describe("versionCompare — classifyCompareRows", () => {
  test("added / removed / changed / unchanged / moved", async () => {
    const t = makeT();
    await seedProjectAndVersions(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectCategories", { id: "catVideo", organizationId: ORG, projectId: PROJECT, versionId: "vA", lineageId: "catVideo", name: "Video", sortOrder: 0 });
      await ctx.db.insert("projectCategories", { id: "catLighting", organizationId: ORG, projectId: PROJECT, versionId: "vA", lineageId: "catLighting", name: "Lighting", sortOrder: 1 });
      await ctx.db.insert("projectCategories", { id: "catVideoB", organizationId: ORG, projectId: PROJECT, versionId: "vB", lineageId: "catVideo", name: "Video", sortOrder: 0 });
      await ctx.db.insert("projectCategories", { id: "catLightingB", organizationId: ORG, projectId: PROJECT, versionId: "vB", lineageId: "catLighting", name: "Lighting", sortOrder: 1 });

      // Unchanged line — identical on both sides.
      await ctx.db.insert("projectLineItems", { id: "l-same-a", organizationId: ORG, projectId: PROJECT, versionId: "vA", lineageId: "l-same", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, categoryId: "catLighting", quantity: 1, unitPrice: 100, lineTotal: 100 });
      await ctx.db.insert("projectLineItems", { id: "l-same-b", organizationId: ORG, projectId: PROJECT, versionId: "vB", lineageId: "l-same", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, categoryId: "catLighting", quantity: 1, unitPrice: 100, lineTotal: 100 });

      // Removed — only on A.
      await ctx.db.insert("projectLineItems", { id: "l-removed", organizationId: ORG, projectId: PROJECT, versionId: "vA", lineageId: "l-removed", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, categoryId: "catLighting", quantity: 2, unitPrice: 180, lineTotal: 360 });

      // Added — only on B.
      await ctx.db.insert("projectLineItems", { id: "l-added", organizationId: ORG, projectId: PROJECT, versionId: "vB", lineageId: "l-added", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, categoryId: "catVideo", quantity: 1, unitPrice: 400, lineTotal: 400 });

      // Changed — same category, different price.
      await ctx.db.insert("projectLineItems", { id: "l-repriced-a", organizationId: ORG, projectId: PROJECT, versionId: "vA", lineageId: "l-repriced", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, categoryId: "catLighting", quantity: 6, unitPrice: 50, lineTotal: 300 });
      await ctx.db.insert("projectLineItems", { id: "l-repriced-b", organizationId: ORG, projectId: PROJECT, versionId: "vB", lineageId: "l-repriced", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, categoryId: "catLighting", quantity: 6, unitPrice: 55, lineTotal: 330 });

      // Unchanged service — services have no categoryId/groupId of their own
      // (schema.ts), so they can never be classified "moved"; a dedicated
      // line-item fixture covers "moved" below.
      await ctx.db.insert("projectServices", { id: "svc-same-a", organizationId: ORG, projectId: PROJECT, versionId: "vA", lineageId: "svc-same", type: "LABOUR", title: "Video technician", status: "CONFIRMED", lineTotal: 2280 });
      await ctx.db.insert("projectServices", { id: "svc-same-b", organizationId: ORG, projectId: PROJECT, versionId: "vB", lineageId: "svc-same", type: "LABOUR", title: "Video technician", status: "CONFIRMED", lineTotal: 2280 });

      // Excluded from comparison — kit child, optional, cancelled.
      await ctx.db.insert("projectLineItems", { id: "l-kitchild", organizationId: ORG, projectId: PROJECT, versionId: "vA", lineageId: "l-kitchild", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: true, isOptional: false, lineTotal: 999 });
      await ctx.db.insert("projectLineItems", { id: "l-optional", organizationId: ORG, projectId: PROJECT, versionId: "vA", lineageId: "l-optional", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: true, lineTotal: 999 });
    });

    const rows = await withBundles(t, "vA", "vB", (a, b) => classifyCompareRows(a, b));

    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey["l-same"].state).toBe("unchanged");
    expect(byKey["l-removed"].state).toBe("removed");
    expect(byKey["l-added"].state).toBe("added");
    expect(byKey["l-repriced"].state).toBe("changed");
    expect(byKey["svc-same"].state).toBe("unchanged");
    expect(byKey["l-kitchild"]).toBeUndefined();
    expect(byKey["l-optional"]).toBeUndefined();
  });

  test("a line that changes category is MOVED, not removed+added", async () => {
    const t = makeT();
    await seedProjectAndVersions(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "l-a", organizationId: ORG, projectId: PROJECT, versionId: "vA", lineageId: "l-mover", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, categoryId: "catLabour", quantity: 1, unitPrice: 95, lineTotal: 2280 });
      await ctx.db.insert("projectLineItems", { id: "l-b", organizationId: ORG, projectId: PROJECT, versionId: "vB", lineageId: "l-mover", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, categoryId: "catVideo", quantity: 1, unitPrice: 95, lineTotal: 2280 });
    });
    const rows = await withBundles(t, "vA", "vB", (a, b) => classifyCompareRows(a, b));
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("moved");
    expect(rows[0].movedFromCategoryId).toBe("catLabour");
    expect(rows[0].alsoRepriced).toBe(false);
  });
});

describe("versionCompare — buildMoneyBridge exactness (the core correctness invariant)", () => {
  test("sum(segments) === totalB - totalA for a realistic multi-change fixture", async () => {
    const t = makeT();
    await seedProjectAndVersions(t);
    await t.run(async (ctx) => {
      // Added — LED wall package (2 lines, same category).
      await ctx.db.insert("projectLineItems", { id: "led1-b", organizationId: ORG, projectId: PROJECT, versionId: "vB", lineageId: "led1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, categoryId: "catVideo", quantity: 18, unitPrice: 32, lineTotal: 2880 });
      await ctx.db.insert("projectLineItems", { id: "led2-b", organizationId: ORG, projectId: PROJECT, versionId: "vB", lineageId: "led2", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, categoryId: "catVideo", quantity: 1, unitPrice: 80, lineTotal: 400 });

      // Removed — MA3 Light.
      await ctx.db.insert("projectLineItems", { id: "ma3-a", organizationId: ORG, projectId: PROJECT, versionId: "vA", lineageId: "ma3", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, categoryId: "catLighting", quantity: 2, unitPrice: 180, lineTotal: 1440 });

      // Repriced — Source Four LED S2, $50 -> $55, qty 6.
      await ctx.db.insert("projectLineItems", { id: "s4-a", organizationId: ORG, projectId: PROJECT, versionId: "vA", lineageId: "s4", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, categoryId: "catLighting", quantity: 6, unitPrice: 50, lineTotal: 1200 });
      await ctx.db.insert("projectLineItems", { id: "s4-b", organizationId: ORG, projectId: PROJECT, versionId: "vB", lineageId: "s4", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, categoryId: "catLighting", quantity: 6, unitPrice: 55, lineTotal: 1320 });

      // Moved — a line item, Lighting -> Video, no reprice (services have no
      // categoryId/groupId of their own, so they can never be "moved" — see
      // the classifyCompareRows tests above).
      await ctx.db.insert("projectLineItems", { id: "tech-a", organizationId: ORG, projectId: PROJECT, versionId: "vA", lineageId: "tech", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, categoryId: "catLighting", quantity: 1, unitPrice: 95, lineTotal: 95 });
      await ctx.db.insert("projectLineItems", { id: "tech-b", organizationId: ORG, projectId: PROJECT, versionId: "vB", lineageId: "tech", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, categoryId: "catVideo", quantity: 1, unitPrice: 95, lineTotal: 95 });

      // Unchanged anchor — a priced group, identical on both sides.
      await ctx.db.insert("projectGroups", { id: "grp-a", organizationId: ORG, projectId: PROJECT, versionId: "vA", lineageId: "grp", title: "Stage wash package", quantity: 1, price: 1320, sortOrder: 0, categoryId: "catLighting" });
      await ctx.db.insert("projectGroups", { id: "grp-b", organizationId: ORG, projectId: PROJECT, versionId: "vB", lineageId: "grp", title: "Stage wash package", quantity: 1, price: 1320, sortOrder: 0, categoryId: "catLighting" });
    });

    const bridge = await withBundles(t, "vA", "vB", (a, b) => buildMoneyBridge(a, b, classifyCompareRows(a, b)));

    expect(() => assertBridgeIntegrity(bridge)).not.toThrow();
    const sum = Math.round(bridge.segments.reduce((s, seg) => s + seg.amount, 0) * 100) / 100;
    expect(sum).toBe(Math.round((bridge.totalB - bridge.totalA) * 100) / 100);
    // No defensive "unexplained" catch-up should ever be needed for a fixture
    // this complete — proves classification, not just the safety net, is correct.
    expect(bridge.segments.some((s) => s.state === "unexplained")).toBe(false);

    // Moved row contributes to the bridge exactly ONCE.
    const movedSegments = bridge.segments.filter((s) => s.rowKeys.includes("tech"));
    expect(movedSegments).toHaveLength(1);
    expect(movedSegments[0].state).toBe("moved");
  });

  test("a plan-field-only change (discount%) — no row changes at all — still bridges exactly", async () => {
    const t = makeT();
    await seedProjectAndVersions(t, { discountPercent: 0 });
    await t.run(async (ctx) => {
      // Identical line on both sides — the ONLY difference is the version's
      // own discountPercent (a PLAN FIELD), set directly on each version row
      // via resolveEffectiveProjectForVersion's overlay (vB is non-live, so
      // its own discountPercent wins over the live project's).
      await ctx.db.insert("projectLineItems", { id: "l-a", organizationId: ORG, projectId: PROJECT, versionId: "vA", lineageId: "l1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, quantity: 1, unitPrice: 1000, lineTotal: 1000 });
      await ctx.db.insert("projectLineItems", { id: "l-b", organizationId: ORG, projectId: PROJECT, versionId: "vB", lineageId: "l1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, quantity: 1, unitPrice: 1000, lineTotal: 1000 });
      // taxRate copied over unchanged (a real `versions.createNative` always
      // copies EVERY plan field from the source — this isolates the fixture
      // to discountPercent alone; leaving taxRate unset here would silently
      // ALSO clear it via `pickPlanFields`'s overlay, per that function's own
      // "always present, even as undefined" contract).
      await ctx.db.patch((await ctx.db.query("projectVersions").withIndex("by_cuid", (q) => q.eq("id", "vB")).first())!._id, { discountPercent: 10, taxRate: 10 });
    });

    const { rows, bridge } = await withBundles(t, "vA", "vB", (a, b) => {
      const rows = classifyCompareRows(a, b);
      return { rows, bridge: buildMoneyBridge(a, b, rows) };
    });
    // The single row is truly unchanged — this fixture proves the bridge
    // still explains the ENTIRE delta via a plan-field segment alone.
    expect(rows.every((r) => r.state === "unchanged")).toBe(true);

    expect(() => assertBridgeIntegrity(bridge)).not.toThrow();
    expect(bridge.totalA).not.toBe(bridge.totalB);
    expect(bridge.segments).toHaveLength(1);
    expect(bridge.segments[0].state).toBe("planField");
    expect(bridge.segments[0].planField).toBe("discountPercent");
    const sum = Math.round(bridge.segments.reduce((s, seg) => s + seg.amount, 0) * 100) / 100;
    expect(sum).toBe(Math.round((bridge.totalB - bridge.totalA) * 100) / 100);
  });

  test("moved AND repriced in the same row — contributes once, not double-counted", async () => {
    const t = makeT();
    await seedProjectAndVersions(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "l-a", organizationId: ORG, projectId: PROJECT, versionId: "vA", lineageId: "l1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, categoryId: "catLighting", quantity: 2, unitPrice: 100, lineTotal: 200 });
      await ctx.db.insert("projectLineItems", { id: "l-b", organizationId: ORG, projectId: PROJECT, versionId: "vB", lineageId: "l1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, categoryId: "catVideo", quantity: 2, unitPrice: 150, lineTotal: 300 });
    });
    const { rows, bridge } = await withBundles(t, "vA", "vB", (a, b) => {
      const rows = classifyCompareRows(a, b);
      return { rows, bridge: buildMoneyBridge(a, b, rows) };
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("moved");
    expect(rows[0].alsoRepriced).toBe(true);

    expect(() => assertBridgeIntegrity(bridge)).not.toThrow();
    // Exactly one segment traces to this row's key — never two (which would
    // mean it was counted once as a "removal" and again as an "addition").
    const segmentsForRow = bridge.segments.filter((s) => s.rowKeys.includes("l1"));
    expect(segmentsForRow).toHaveLength(1);
    // 300 - 200 = 100 of extra revenue, plus its 10% tax effect (project
    // taxRate is 10 throughout this fixture) = 110 — the FULL combined
    // delta, counted once, tax included, exactly what the client-facing
    // total actually moves by.
    expect(segmentsForRow[0].amount).toBe(110);
    const sum = Math.round(bridge.segments.reduce((s, seg) => s + seg.amount, 0) * 100) / 100;
    expect(sum).toBe(Math.round((bridge.totalB - bridge.totalA) * 100) / 100);
  });
});

describe("versionCompare — assertBridgeIntegrity catches a broken fixture", () => {
  test("a segment with no rows behind it fails the check", () => {
    const broken: MoneyBridge = {
      totalA: 100,
      totalB: 150,
      segments: [{ key: "mystery", state: "changed", kind: "mixed", categoryId: null, amount: 50, rowKeys: [] }],
    };
    expect(() => assertBridgeIntegrity(broken)).toThrow(/traces to no row/);
  });

  test("a segment sum that doesn't match totalB - totalA fails the check", () => {
    const broken: MoneyBridge = {
      totalA: 100,
      totalB: 150,
      segments: [{ key: "s1", state: "changed", kind: "line", categoryId: null, amount: 40, rowKeys: ["l1"] }],
    };
    expect(() => assertBridgeIntegrity(broken)).toThrow(/sum to/);
  });
});
