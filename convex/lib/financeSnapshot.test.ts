// @vitest-environment node
//
// convex/lib/financeSnapshot.ts — buildFinanceLines, the shared quote/invoice
// line-breakdown builder. Regression: a model-linked equipment/kit line with
// no hand-typed description used to snapshot as the literal string "Line
// item" (a pushed Xero invoice showed that instead of e.g. "USB Pro DI"),
// because this builder never resolved the model/kit name the way the PDF
// pipeline (structure-line-items.ts) already does.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "../schema";
import { buildFinanceLines } from "./financeSnapshot";

const modules = import.meta.glob("../**/*.ts");
const ORG = "org_1";
const OTHER = "org_2";

function makeT() {
  return convexTest(schema, modules);
}

async function seedProject(t: ReturnType<typeof makeT>, orgId = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id: "p1", organizationId: orgId, projectNumber: "P1", name: "Gig",
      isTemplate: false, createdAt: 0, updatedAt: 0,
    });
  });
}

describe("buildFinanceLines", () => {
  test("resolves an EQUIPMENT line's model name when description is unset", async () => {
    const t = makeT();
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "USB Pro DI" });
      await ctx.db.insert("projectLineItems", {
        id: "l1", organizationId: ORG, projectId: "p1", modelId: "m1",
        isKitChild: false, isOptional: false, status: "CONFIRMED",
        quantity: 1, unitPrice: 50, lineTotal: 50,
      });
    });

    const lines = await t.run((ctx) => buildFinanceLines(ctx, "p1", ORG));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.description).toBe("USB Pro DI");
  });

  test("resolves a kit-PARENT line's kit name when description is unset", async () => {
    const t = makeT();
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "KIT-1", name: "Stage Box Kit" });
      await ctx.db.insert("projectLineItems", {
        id: "l1", organizationId: ORG, projectId: "p1", kitId: "k1",
        isKitChild: false, isOptional: false, status: "CONFIRMED",
        quantity: 1, unitPrice: 200, lineTotal: 200,
      });
    });

    const lines = await t.run((ctx) => buildFinanceLines(ctx, "p1", ORG));
    expect(lines[0]?.description).toBe("Stage Box Kit");
  });

  test("a hand-typed description still wins over the model name (unchanged behaviour)", async () => {
    const t = makeT();
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "USB Pro DI" });
      await ctx.db.insert("projectLineItems", {
        id: "l1", organizationId: ORG, projectId: "p1", modelId: "m1", description: "Custom label",
        isKitChild: false, isOptional: false, status: "CONFIRMED",
        quantity: 1, unitPrice: 50, lineTotal: 50,
      });
    });

    const lines = await t.run((ctx) => buildFinanceLines(ctx, "p1", ORG));
    expect(lines[0]?.description).toBe("Custom label");
  });

  test("falls back to the literal 'Line item' when there is truly nothing to resolve (no model/kit/description/groupName)", async () => {
    const t = makeT();
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", {
        id: "l1", organizationId: ORG, projectId: "p1",
        isKitChild: false, isOptional: false, status: "CONFIRMED",
        quantity: 1, unitPrice: 50, lineTotal: 50,
      });
    });

    const lines = await t.run((ctx) => buildFinanceLines(ctx, "p1", ORG));
    expect(lines[0]?.description).toBe("Line item");
  });

  // IDOR guard (R-8.4.3): models.by_cuid is a GLOBAL index, so a modelId
  // could in principle resolve to another org's row — must never leak a
  // foreign org's model name into this org's invoice/quote snapshot.
  test("never resolves a cross-org model's name (IDOR guard)", async () => {
    const t = makeT();
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: OTHER, name: "Foreign Org's Model" });
      await ctx.db.insert("projectLineItems", {
        id: "l1", organizationId: ORG, projectId: "p1", modelId: "m1",
        isKitChild: false, isOptional: false, status: "CONFIRMED",
        quantity: 1, unitPrice: 50, lineTotal: 50,
      });
    });

    const lines = await t.run((ctx) => buildFinanceLines(ctx, "p1", ORG));
    expect(lines[0]?.description).toBe("Line item");
  });

  // A service bills iff it has an actual charge — DERIVED from lineTotal, no
  // separate manual flag to keep in sync (R-3.1). Mirrors recalcProjectTotals's
  // serviceRevenue and the PDF pipeline's billableServices filter.
  describe("SERVICE lines", () => {
    test("includes a service with a charge set", async () => {
      const t = makeT();
      await seedProject(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("projectServices", {
          id: "s1", organizationId: ORG, projectId: "p1", type: "DELIVERY",
          title: "Truck delivery", status: "CONFIRMED", quantity: 1,
          unitPrice: 150, lineTotal: 150,
        });
      });

      const lines = await t.run((ctx) => buildFinanceLines(ctx, "p1", ORG));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ sourceType: "SERVICE", description: "Truck delivery", lineTotal: 150 });
    });

    test("excludes a service with no charge set (lineTotal null)", async () => {
      const t = makeT();
      await seedProject(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("projectServices", {
          id: "s1", organizationId: ORG, projectId: "p1", type: "BUMP_IN",
          title: "Bump in", status: "CONFIRMED", quantity: 1,
        });
      });

      const lines = await t.run((ctx) => buildFinanceLines(ctx, "p1", ORG));
      expect(lines).toHaveLength(0);
    });

    test("excludes a CANCELLED service even if it has a charge set", async () => {
      const t = makeT();
      await seedProject(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("projectServices", {
          id: "s1", organizationId: ORG, projectId: "p1", type: "LABOUR",
          title: "Show day", status: "CANCELLED", quantity: 1,
          unitPrice: 500, lineTotal: 500,
        });
      });

      const lines = await t.run((ctx) => buildFinanceLines(ctx, "p1", ORG));
      expect(lines).toHaveLength(0);
    });
  });
});

// ─── Category price rollup (src/lib/category-pricing-display.ts) ─────────────
//
// A category the operator set to `ROLLUP` bills as ONE line covering everything
// inside it — the finance counterpart of the single subtotal a quote/invoice PDF
// prints on that section's header. The safety property throughout: rollup
// REGROUPS, it never reprices, so the snapshot must keep summing to exactly what
// the itemised snapshot summed to.
/**
 * The invariant the Xero push now enforces
 * (`assertLinesReconcileWithTaxableBase`, src/server/xero.ts): these lines sum
 * to the amount Xero charges tax on, i.e. `recalc.ts`'s `taxableAmount`
 * (subtotal less the project discount). Nothing asserted this before, and two
 * ways of breaking it were already shipped — found by adversarial review of
 * the INV-260901 fix.
 */
describe("buildFinanceLines — sums to recalc's taxable amount", () => {
  test("a sub-hire line inside a PRICED group bills on its own, as recalc already counts it", async () => {
    // recalc.ts's subHireGroupedRevenue filters on `groupId != null &&
    // subHireId != null` with NO priced-group exclusion (pinned by
    // recalc.test.ts "counts a sub-hire line placed inside a priced project
    // group (issue #8)"). This builder used to drop the line with the rest of
    // the priced group's members, so the snapshot sat permanently BELOW
    // project.subtotal: Xero under-billed by the sub-hire's charge, and once
    // the reconcile guard landed such an invoice became unpushable.
    const t = makeT();
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: ORG, projectId: "p1", title: "Audio", price: 100, quantity: 1, sortOrder: 0 });
      // Ordinary member — absorbed by the group's flat price.
      await ctx.db.insert("projectLineItems", {
        id: "l1", organizationId: ORG, projectId: "p1", groupId: "g1",
        isKitChild: false, isOptional: false, status: "CONFIRMED",
        description: "Speaker", quantity: 1, unitPrice: 40, lineTotal: 40,
      });
      // Sub-hire member — carries its OWN client charge.
      await ctx.db.insert("projectLineItems", {
        id: "l2", organizationId: ORG, projectId: "p1", groupId: "g1", subHireId: "sh1",
        isKitChild: false, isOptional: false, status: "CONFIRMED",
        description: "Hired Console", quantity: 1, unitPrice: 60, lineTotal: 60,
      });
    });

    const lines = await t.run((ctx) => buildFinanceLines(ctx, "p1", ORG));
    const sum = lines.reduce((s, l) => s + l.lineTotal, 0);
    // recalc: groupRevenue 100 + subHireGroupedRevenue 60 = 160.
    expect(sum).toBe(160);
    expect(lines.map((l) => l.description)).toContain("Hired Console");
    expect(lines.map((l) => l.description)).not.toContain("Speaker");
  });

  test("a project discount rides along as its own negative line", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", {
        id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig",
        isTemplate: false, discountPercent: 10, createdAt: 0, updatedAt: 0,
      });
      await ctx.db.insert("projectLineItems", {
        id: "l1", organizationId: ORG, projectId: "p1",
        isKitChild: false, isOptional: false, status: "CONFIRMED",
        description: "PA System", quantity: 1, unitPrice: 1000, lineTotal: 1000,
      });
    });

    const lines = await t.run((ctx) => buildFinanceLines(ctx, "p1", ORG));
    const discount = lines.find((l) => l.description.startsWith("Discount"));
    expect(discount?.lineTotal).toBe(-100);
    expect(discount?.description).toBe("Discount (10%)");
    // recalc: subtotal 1000, discountAmount 100, taxableAmount 900.
    expect(lines.reduce((s, l) => s + l.lineTotal, 0)).toBe(900);
    // The deduction reads last, after everything it applies to.
    expect(lines[lines.length - 1]).toBe(discount);
  });

  test("no discount line when the project carries no discount", async () => {
    const t = makeT();
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", {
        id: "l1", organizationId: ORG, projectId: "p1",
        isKitChild: false, isOptional: false, status: "CONFIRMED",
        description: "PA System", quantity: 1, unitPrice: 1000, lineTotal: 1000,
      });
    });

    const lines = await t.run((ctx) => buildFinanceLines(ctx, "p1", ORG));
    expect(lines).toHaveLength(1);
    expect(lines.reduce((s, l) => s + l.lineTotal, 0)).toBe(1000);
  });

  test("another org's project row never supplies the discount", async () => {
    // `by_cuid` is global — a cross-org project must not decide this org's bill.
    const t = makeT();
    await seedProject(t, OTHER);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", {
        id: "l1", organizationId: OTHER, projectId: "p1",
        isKitChild: false, isOptional: false, status: "CONFIRMED",
        description: "PA System", quantity: 1, unitPrice: 1000, lineTotal: 1000,
      });
    });

    const lines = await t.run((ctx) => buildFinanceLines(ctx, "p1", ORG));
    expect(lines.find((l) => l.description.startsWith("Discount"))).toBeUndefined();
  });
});

describe("buildFinanceLines — category price rollup", () => {
  async function seedRollupCategory(t: ReturnType<typeof makeT>, pricingDisplay?: "ITEMISED" | "ROLLUP") {
    await t.run(async (ctx) => {
      await ctx.db.insert("projectCategories", {
        id: "cat1", organizationId: ORG, projectId: "p1", name: "Lighting",
        sortOrder: 0, ...(pricingDisplay ? { pricingDisplay } : {}),
      });
    });
  }

  async function seedTwoLightingLines(t: ReturnType<typeof makeT>) {
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", {
        id: "l1", organizationId: ORG, projectId: "p1", categoryId: "cat1",
        description: "LED Par", isKitChild: false, isOptional: false, status: "CONFIRMED",
        quantity: 24, unitPrice: 50, lineTotal: 1200,
      });
      await ctx.db.insert("projectLineItems", {
        id: "l2", organizationId: ORG, projectId: "p1", categoryId: "cat1",
        description: "Moving Head", isKitChild: false, isOptional: false, status: "CONFIRMED",
        quantity: 8, unitPrice: 425, lineTotal: 3400,
      });
    });
  }

  test("folds a ROLLUP category's lines into one CATEGORY line", async () => {
    const t = makeT();
    await seedProject(t);
    await seedRollupCategory(t, "ROLLUP");
    await seedTwoLightingLines(t);

    const lines = await t.run((ctx) => buildFinanceLines(ctx, "p1", ORG));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      sourceType: "CATEGORY",
      sourceLineItemId: "cat1",
      description: "Lighting",
      quantity: 1,
      unitPrice: 4600,
      lineTotal: 4600,
    });
  });

  test("leaves an ITEMISED category (and an absent setting) line-by-line", async () => {
    for (const display of ["ITEMISED", undefined] as const) {
      const t = makeT();
      await seedProject(t);
      await seedRollupCategory(t, display);
      await seedTwoLightingLines(t);

      const lines = await t.run((ctx) => buildFinanceLines(ctx, "p1", ORG));
      expect(lines.map((l) => l.sourceType)).toEqual(["EQUIPMENT", "EQUIPMENT"]);
      expect(lines.map((l) => l.lineTotal)).toEqual([1200, 3400]);
    }
  });

  test("rolling up does not change the total billed", async () => {
    const totals: number[] = [];
    for (const display of ["ITEMISED", "ROLLUP"] as const) {
      const t = makeT();
      await seedProject(t);
      await seedRollupCategory(t, display);
      await seedTwoLightingLines(t);
      const lines = await t.run((ctx) => buildFinanceLines(ctx, "p1", ORG));
      totals.push(lines.reduce((sum, l) => sum + l.lineTotal, 0));
    }
    expect(totals[0]).toBe(totals[1]);
  });

  // The per-item reveal is a DISPLAY decision. A revealed line stays inside the
  // category's one billing line — billing it separately as well would double it.
  test("a revealed line is still absorbed by the rollup line", async () => {
    const t = makeT();
    await seedProject(t);
    await seedRollupCategory(t, "ROLLUP");
    await seedTwoLightingLines(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", {
        id: "l3", organizationId: ORG, projectId: "p1", categoryId: "cat1",
        description: "Console", isKitChild: false, isOptional: false, status: "CONFIRMED",
        quantity: 1, unitPrice: 450, lineTotal: 450, revealPriceInRollup: true,
      });
    });

    const lines = await t.run((ctx) => buildFinanceLines(ctx, "p1", ORG));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.lineTotal).toBe(5050);
  });

  test("absorbs a priced GROUP that lives in the rolled-up category", async () => {
    const t = makeT();
    await seedProject(t);
    await seedRollupCategory(t, "ROLLUP");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectGroups", {
        id: "g1", organizationId: ORG, projectId: "p1", categoryId: "cat1",
        title: "Truss Package", quantity: 1, price: 2000,
      });
      await ctx.db.insert("projectLineItems", {
        id: "l1", organizationId: ORG, projectId: "p1", categoryId: "cat1",
        description: "LED Par", isKitChild: false, isOptional: false, status: "CONFIRMED",
        quantity: 24, unitPrice: 50, lineTotal: 1200,
      });
    });

    const lines = await t.run((ctx) => buildFinanceLines(ctx, "p1", ORG));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ sourceType: "CATEGORY", lineTotal: 3200 });
  });

  // A grouped line's OWN categoryId can legitimately be null while its group
  // carries the category — the rollup has to follow the group's FK, or a whole
  // group's worth of charges escapes the fold.
  test("follows the GROUP's category when a member's own categoryId is unset", async () => {
    const t = makeT();
    await seedProject(t);
    await seedRollupCategory(t, "ROLLUP");
    await t.run(async (ctx) => {
      // Unpriced group: its custom-item extras bill on their own.
      await ctx.db.insert("projectGroups", {
        id: "g1", organizationId: ORG, projectId: "p1", categoryId: "cat1",
        title: "Rigging", quantity: 1,
      });
      await ctx.db.insert("projectLineItems", {
        id: "l1", organizationId: ORG, projectId: "p1", groupId: "g1",
        description: "Rigger call-out", isCustomItem: true,
        isKitChild: false, isOptional: false, status: "CONFIRMED",
        quantity: 1, unitPrice: 300, lineTotal: 300,
      });
    });

    const lines = await t.run((ctx) => buildFinanceLines(ctx, "p1", ORG));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ sourceType: "CATEGORY", sourceLineItemId: "cat1", lineTotal: 300 });
  });

  test("services have no category and are never absorbed", async () => {
    const t = makeT();
    await seedProject(t);
    await seedRollupCategory(t, "ROLLUP");
    await seedTwoLightingLines(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectServices", {
        id: "s1", organizationId: ORG, projectId: "p1", type: "LABOUR",
        title: "Crew", status: "CONFIRMED", quantity: 2, unitPrice: 400, lineTotal: 800,
      });
    });

    const lines = await t.run((ctx) => buildFinanceLines(ctx, "p1", ORG));
    expect(lines.map((l) => l.sourceType)).toEqual(["CATEGORY", "SERVICE"]);
    expect(lines[1]?.lineTotal).toBe(800);
  });

  // `by_projectId` is a GLOBAL index — another org's category row with the same
  // projectId must never turn this project's lines into a rollup.
  test("ignores a same-projectId category belonging to another org", async () => {
    const t = makeT();
    await seedProject(t);
    await seedTwoLightingLines(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectCategories", {
        id: "cat1", organizationId: OTHER, projectId: "p1", name: "Lighting",
        sortOrder: 0, pricingDisplay: "ROLLUP",
      });
    });

    const lines = await t.run((ctx) => buildFinanceLines(ctx, "p1", ORG));
    expect(lines.map((l) => l.sourceType)).toEqual(["EQUIPMENT", "EQUIPMENT"]);
  });

  // The category lookup is by cuid (an indexed narrowing, not a whole-table
  // scan), and by_cuid is GLOBAL — so it is pinned to this project as well as
  // this org. A row pointing at another PROJECT's category must not decide how
  // this project bills.
  test("ignores a same-org category belonging to another project", async () => {
    const t = makeT();
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", {
        id: "p2", organizationId: ORG, projectNumber: "P2", name: "Other",
        isTemplate: false, createdAt: 0, updatedAt: 0,
      });
      // Same org, ROLLUP — but it belongs to p2, not p1.
      await ctx.db.insert("projectCategories", {
        id: "cat1", organizationId: ORG, projectId: "p2", name: "Lighting",
        sortOrder: 0, pricingDisplay: "ROLLUP",
      });
    });
    await seedTwoLightingLines(t);

    const lines = await t.run((ctx) => buildFinanceLines(ctx, "p1", ORG));
    expect(lines.map((l) => l.sourceType)).toEqual(["EQUIPMENT", "EQUIPMENT"]);
  });

  test("keeps the rollup line where its first member would have appeared", async () => {
    const t = makeT();
    await seedProject(t);
    await seedRollupCategory(t, "ROLLUP");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectCategories", {
        id: "cat2", organizationId: ORG, projectId: "p1", name: "Audio", sortOrder: 1,
      });
      await ctx.db.insert("projectLineItems", {
        id: "l1", organizationId: ORG, projectId: "p1", categoryId: "cat1",
        description: "LED Par", isKitChild: false, isOptional: false, status: "CONFIRMED",
        quantity: 1, unitPrice: 100, lineTotal: 100,
      });
      await ctx.db.insert("projectLineItems", {
        id: "l2", organizationId: ORG, projectId: "p1", categoryId: "cat2",
        description: "Wedge", isKitChild: false, isOptional: false, status: "CONFIRMED",
        quantity: 1, unitPrice: 200, lineTotal: 200,
      });
      await ctx.db.insert("projectLineItems", {
        id: "l3", organizationId: ORG, projectId: "p1", categoryId: "cat1",
        description: "Moving Head", isKitChild: false, isOptional: false, status: "CONFIRMED",
        quantity: 1, unitPrice: 300, lineTotal: 300,
      });
    });

    const lines = await t.run((ctx) => buildFinanceLines(ctx, "p1", ORG));
    expect(lines.map((l) => l.sourceType)).toEqual(["CATEGORY", "EQUIPMENT"]);
    expect(lines[0]?.lineTotal).toBe(400);
  });
});
