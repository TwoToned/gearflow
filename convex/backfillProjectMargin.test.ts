// @vitest-environment node
//
// The one-off GST margin backfill: patches ONLY `margin`, only where it is wrong,
// from the stored buckets through recalc's own formula; internal-only; idempotent.
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { readFileSync } from "node:fs";
import { internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const NOW = 1_700_000_000_000;

// $10,000 taxable + $1,000 GST = $11,000 total; $5,000 costs. Old margin = 11000 - 5000 = 6000.
const base = {
  organizationId: ORG, status: "CONFIRMED", isTemplate: false, createdAt: NOW, updatedAt: NOW,
  subtotal: 10000, discountAmount: 0, taxAmount: 1000, total: 11000,
  serviceCostTotal: 3000, labourCostTotal: 1500, subHireCostTotal: 500, saleCostTotal: 0,
};

async function seed(t: TestConvex<typeof schema>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", { ...base, id: "stale", projectNumber: "P1", name: "Stale", margin: 6000 } as never);
    await ctx.db.insert("projects", { ...base, id: "right", projectNumber: "P2", name: "Right", margin: 5000 } as never);
    // A finance-locked job (pricing-locked, stamped): only `margin` may change.
    await ctx.db.insert("projects", {
      ...base, id: "locked", projectNumber: "P3", name: "Locked", status: "INVOICED", margin: 6000,
      pricingLockedAt: NOW, pricingLockedById: "u1", revision: 3, liveRevision: 3, discountPercent: 10, taxRate: 10,
    } as never);
    // Never recalculated: nothing stored to correct.
    await ctx.db.insert("projects", { id: "fresh", organizationId: ORG, projectNumber: "P4", name: "Fresh", status: "QUOTING", isTemplate: false, createdAt: NOW, updatedAt: NOW } as never);
  });
}
const row = (t: TestConvex<typeof schema>, id: string) =>
  t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first());

describe("backfillProjectMarginPage", () => {
  test("rewrites only the stale margin; an already-correct row and a never-recalculated row are untouched", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const before = await row(t, "right");
    const r = await t.mutation(internal.backfillProjectMargin.backfillProjectMarginPage, { cursor: null });
    expect(r).toMatchObject({ scanned: 4, patched: 2, isDone: true });
    expect((await row(t, "stale"))?.margin).toBe(5000);
    expect(await row(t, "right")).toEqual(before); // byte-identical: not even re-patched
    expect((await row(t, "fresh"))?.margin).toBeUndefined();
  });

  test("a locked, finance-stamped job changes ONLY margin (no recalc, no updatedAt, no activity row)", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const before = await row(t, "locked");
    await t.mutation(internal.backfillProjectMargin.backfillProjectMarginPage, { cursor: null });
    const after = await row(t, "locked");
    expect({ ...after, margin: undefined }).toEqual({ ...before, margin: undefined });
    expect(after?.margin).toBe(5000);
    expect(await t.run(async (ctx) => ctx.db.query("activityLogs").collect())).toHaveLength(0);
  });

  test("run twice: the second run patches nothing (recomputed, never subtracted)", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await t.mutation(internal.backfillProjectMargin.backfillProjectMarginPage, { cursor: null });
    const again = await t.mutation(internal.backfillProjectMargin.backfillProjectMarginPage, { cursor: null });
    expect(again.patched).toBe(0);
    expect((await row(t, "stale"))?.margin).toBe(5000);
  });

  test("paginates by cursor and reports it", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const first = await t.mutation(internal.backfillProjectMargin.backfillProjectMarginPage, { cursor: null, numItems: 2 });
    expect(first.isDone).toBe(false);
    const second = await t.mutation(internal.backfillProjectMargin.backfillProjectMarginPage, { cursor: first.cursor, numItems: 2 });
    expect(first.scanned + second.scanned).toBe(4);
    expect(first.patched + second.patched).toBe(2);
  });

  test("it is internal only: absent from the API registry and the agent surface", () => {
    const registry = readFileSync(new URL("../src/lib/api/registry.generated.ts", import.meta.url), "utf8");
    expect(registry).not.toContain("backfillProjectMargin");
    expect(readFileSync(new URL("./backfillProjectMargin.ts", import.meta.url), "utf8")).not.toMatch(/export const agentOps|requireService\(/);
  });
});
