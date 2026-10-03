// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { recalcProjectTotals, loadTotalsBundle, computeTotals } from "./lib/recalc";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const NOW = 1_700_000_000_000;
const V1 = "v1";

/**
 * Project Versioning v2 Phase 2 (#1228, D59) — differential test for the
 * recalc.ts pure/persist split. Ported from the Phase 0 spike
 * (`worktree-agent-ab6397f97dceed5e7:convex/recalcSplit.differential.test.ts`)
 * and adapted onto this branch's real index rename: every child row now
 * carries `versionId`, and `projects.liveVersionId` points at the one
 * `projectVersions` row the fixture seeds — required because
 * `loadTotalsBundle`/`recalcProjectTotals` now read through
 * `by_versionId` (see `convex/lib/versionScope.ts`), not the deleted
 * `by_projectId`.
 *
 * Seeds ONE realistic fixture (groups with a flat-price bundle + a flat
 * discount, standalone + grouped sub-hire lines, a SALE line with a resolved
 * unit-cost chain, a service, a standalone crew assignment, a sub-hire order,
 * a client tax-rate cascade with a per-line override, and an ISSUED + a DRAFT
 * invoice) then asserts TWO independent things are byte-identical:
 *
 *   1. `computeTotals(loadTotalsBundle(...))` (the QueryCtx-callable pure
 *      path) equals every field `recalcProjectTotals` (the MutationCtx
 *      persist path) actually wrote to `projects.*` via `ctx.db.patch`.
 *   2. Running `recalcProjectTotals` itself still produces the pre-split
 *      values (a regression guard on top of the differential one).
 *
 * This is the proof that a future non-live-version read-time totals path
 * (D34) can call `loadTotalsBundle` + `computeTotals` and get EXACTLY what
 * making that version live would have written — no second copy of the money
 * math, no drift between "what you see" and "what you get".
 */
describe("recalc.ts pure/persist split — differential parity (#1228)", () => {
  async function seedFixture(t: ReturnType<typeof convexTest>) {
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Realistic Client", taxExempt: false });
      await ctx.db.insert("projects", {
        id: "p1", organizationId: ORG, projectNumber: "P1", name: "Realistic Gig",
        status: "CONFIRMED", isTemplate: false, taxRate: 10, discountPercent: 5,
        clientId: "c1", liveVersionId: V1, createdAt: NOW, updatedAt: NOW,
      });
      await ctx.db.insert("projectVersions", {
        id: V1, organizationId: ORG, projectId: "p1", number: 1,
        contentState: "ready", createdAt: NOW, createdById: "u1",
      });

      // Priced group: $100 x qty 2, minus a flat $20 discount = 180. Its own
      // custom-item extra (l-custom) is absorbed into the bundle, NOT added.
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "g1", title: "Lighting", price: 100, quantity: 2, discount: 20, sortOrder: 0 });
      await ctx.db.insert("projectLineItems", { id: "l-custom", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "l-custom", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, isCustomItem: true, groupId: "g1", lineTotal: 15 });

      // Standalone line, overridden tax rate (5%) — exercises the per-line
      // rate cascade + mixed-rate tax breakdown.
      await ctx.db.insert("projectLineItems", { id: "l1", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "l1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, taxRate: 5, lineTotal: 60 });
      // Optional line — excluded from every bucket.
      await ctx.db.insert("projectLineItems", { id: "l-opt", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "l-opt", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: true, lineTotal: 500 });
      // Cancelled line — excluded.
      await ctx.db.insert("projectLineItems", { id: "l-cancelled", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "l-cancelled", status: "CANCELLED", type: "EQUIPMENT", isKitChild: false, isOptional: false, lineTotal: 500 });

      // Sub-hire dropped into the priced group — bills on its own (2b), plus
      // its kit-style child which must be excluded.
      await ctx.db.insert("projectLineItems", { id: "sl1", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "sl1", status: "QUOTED", type: "EQUIPMENT", isKitChild: false, isOptional: false, groupId: "g1", subHireId: "sh1", subHireItemId: "si1", lineTotal: 45 });
      await ctx.db.insert("projectLineItems", { id: "sl2", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "sl2", status: "QUOTED", type: "EQUIPMENT", isKitChild: true, isOptional: false, groupId: "g1", subHireId: "sh1", subHireItemId: "si2", lineTotal: 30 });

      // SALE line resolving through asset -> model -> bulkAsset -> replacementCost.
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "SM58", defaultPurchasePrice: 50, replacementCost: 200 });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "TAG-1", purchasePrice: 80, status: "SOLD", isActive: false });
      await ctx.db.insert("projectLineItems", { id: "sale1", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "sale1", status: "CONFIRMED", type: "SALE", saleMode: "FROM_RENTAL_STOCK", assetId: "a1", modelId: "m1", quantity: 1, isKitChild: false, isOptional: false, lineTotal: 300 });

      // Service (billable + costed) + a mix of service-linked and standalone
      // crew assignments (must not double-count).
      await ctx.db.insert("projectServices", { id: "s1", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "s1", type: "LABOUR", title: "Design", status: "CONFIRMED", showOnDocuments: true, lineTotal: 30, costTotal: 20 });
      await ctx.db.insert("crewAssignments", { id: "asn-linked", organizationId: ORG, projectId: "p1", crewMemberId: "c1", serviceId: "s1", estimatedCost: 20 });
      await ctx.db.insert("crewAssignments", { id: "asn-standalone", organizationId: ORG, projectId: "p1", crewMemberId: "c2", estimatedCost: 40 });

      // Sub-hire order cost (non-cancelled, non-draft) + one excluded (DRAFT).
      await ctx.db.insert("subHires", { id: "sh1", organizationId: ORG, projectId: "p1", supplierId: "sup1", createdById: "u1", orderNumber: "SH-1", status: "CONFIRMED", totalCost: 15 });
      await ctx.db.insert("subHires", { id: "sh-draft", organizationId: ORG, projectId: "p1", supplierId: "sup1", createdById: "u1", orderNumber: "SH-2", status: "DRAFT", totalCost: 999 });

      // Invoices — one ISSUED deposit (counts), one DRAFT balance (excluded).
      await ctx.db.insert("invoices", { id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "DEPOSIT", status: "ISSUED", subtotal: 90.91, taxAmount: 9.09, total: 100, invoiceNumber: "INV-1" });
      await ctx.db.insert("invoices", { id: "i2", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "BALANCE", status: "DRAFT", subtotal: 454.55, taxAmount: 45.45, total: 500 });
    });
  }

  test("computeTotals(loadTotalsBundle(...)) equals what recalcProjectTotals writes to projects.*", async () => {
    const t = convexTest(schema, modules);
    await seedFixture(t);

    // Old path: mutation-only, in-mutation compute + patch.
    await t.run(async (ctx) => recalcProjectTotals(ctx, "p1", ORG, null, NOW + 1));
    const stored = await t.run(async (ctx) =>
      ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first(),
    );
    expect(stored).not.toBeNull();

    // New path: QueryCtx-callable load + PURE compute, no patch, no mutation.
    const computed = await t.run(async (ctx) => {
      const bundle = await loadTotalsBundle(ctx, "p1", ORG, null);
      expect(bundle).not.toBeNull();
      return computeTotals(bundle!);
    });

    // Every field recalcProjectTotals patched onto the project must match the
    // pure computation byte-for-byte.
    expect(computed.equipmentRevenue).toBe(stored!.equipmentRevenue);
    expect(computed.saleRevenue).toBe(stored!.saleRevenue);
    expect(computed.saleCostTotal).toBe(stored!.saleCostTotal);
    expect(computed.serviceCostTotal).toBe(stored!.serviceCostTotal);
    expect(computed.labourCostTotal).toBe(stored!.labourCostTotal);
    expect(computed.subHireCostTotal).toBe(stored!.subHireCostTotal);
    expect(computed.subtotal).toBe(stored!.subtotal);
    expect(computed.discountAmount).toBe(stored!.discountAmount);
    expect(computed.taxAmount).toBe(stored!.taxAmount);
    expect(computed.taxBreakdown).toBe(stored!.taxBreakdown);
    expect(computed.taxStatus).toBe(stored!.taxStatus);
    expect(computed.total).toBe(stored!.total);
    expect(computed.margin).toBe(stored!.margin);
    expect(computed.depositPaid).toBe(stored!.depositPaid);
    expect(computed.invoicedTotal).toBe(stored!.invoicedTotal);

    // Sanity: the fixture actually exercises non-trivial arithmetic, so this
    // isn't a vacuous all-zeros pass.
    // group: (100*2 - 20) = 180 (custom absorbed) + standalone 60 + grouped
    // sub-hire 45 (child 30 excluded) = 285
    expect(stored!.equipmentRevenue).toBe(285);
    expect(stored!.saleRevenue).toBe(300);
    expect(stored!.saleCostTotal).toBe(80); // asset.purchasePrice wins over model chain
    expect(stored!.serviceCostTotal).toBe(20);
    expect(stored!.labourCostTotal).toBe(40); // only the standalone assignment
    expect(stored!.subHireCostTotal).toBe(15); // DRAFT excluded
    // subtotal = equipment 285 + service 30 + sale 300 = 615
    expect(stored!.subtotal).toBe(615);
    expect(stored!.invoicedTotal).toBe(100); // DRAFT excluded
    expect(stored!.depositPaid).toBe(100);
  });

  test("computeTotals is pure: calling it twice on the same bundle yields identical output (no hidden mutation/state)", async () => {
    const t = convexTest(schema, modules);
    await seedFixture(t);
    const [first, second] = await t.run(async (ctx) => {
      const bundle = await loadTotalsBundle(ctx, "p1", ORG, null);
      return [computeTotals(bundle!), computeTotals(bundle!)];
    });
    expect(second).toEqual(first);
  });

  test("loadTotalsBundle is callable from a genuine QueryCtx (t.query), not just t.run", async () => {
    const t = convexTest(schema, modules);
    await seedFixture(t);

    // A bare query function, registered on the test instance, whose ctx is a
    // real Convex QueryCtx (not MutationCtx cast down) — proves the type
    // signature `QueryCtx | MutationCtx` is exercised for real, the whole
    // point of the split (a non-live-version read can't call a
    // MutationCtx-only function).
    const totals = await t.query(async (ctx) => {
      const bundle = await loadTotalsBundle(ctx, "p1", ORG, null);
      return bundle ? computeTotals(bundle) : null;
    });
    expect(totals).not.toBeNull();
    expect(totals!.equipmentRevenue).toBe(285);
  });

  test("loadTotalsBundle with an explicit non-live versionId reads ONLY that version's rows — proves the read-time non-live-version path (D34) is wired, not just the default", async () => {
    const t = convexTest(schema, modules);
    await seedFixture(t);
    const V2 = "v2";
    await t.run(async (ctx) => {
      await ctx.db.insert("projectVersions", {
        id: V2, organizationId: ORG, projectId: "p1", number: 2,
        contentState: "ready", createdAt: NOW, createdById: "u1",
      });
      // A non-live version with a totally different (single-line) plan.
      await ctx.db.insert("projectLineItems", { id: "v2-only", organizationId: ORG, projectId: "p1", versionId: V2, lineageId: "v2-only", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, lineTotal: 42 });
    });

    const v2Totals = await t.run(async (ctx) => {
      const bundle = await loadTotalsBundle(ctx, "p1", ORG, null, V2);
      return bundle ? computeTotals(bundle) : null;
    });
    expect(v2Totals).not.toBeNull();
    // Only the v2-only line (42), none of V1's fixture — proves version
    // isolation, not just "reads something".
    expect(v2Totals!.equipmentRevenue).toBe(42);
    expect(v2Totals!.saleRevenue).toBe(0);
    expect(v2Totals!.subtotal).toBe(42);

    // The live version (V1) is unaffected by V2 existing.
    const liveTotals = await t.run(async (ctx) => {
      const bundle = await loadTotalsBundle(ctx, "p1", ORG, null);
      return bundle ? computeTotals(bundle) : null;
    });
    expect(liveTotals!.equipmentRevenue).toBe(285);
  });
});
