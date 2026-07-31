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
