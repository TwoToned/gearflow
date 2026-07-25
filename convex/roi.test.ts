// @vitest-environment node
import { convexTest, type TestConvex } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import type { Doc } from "./_generated/dataModel";
import { api } from "./_generated/api";

/**
 * Convex-layer coverage for model/fleet ROI reads. The money-critical branches are
 * the STATUS filter (a QUOTED or CANCELLED project must not count as earned revenue)
 * and the DATE window; plus unit tallying for the capital side (totalQuantity on
 * bulk, isActive exclusion on both).
 */

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const asService = (t: T) => t.withIdentity(SERVICE);
// The bases the app treats as "earned" for ROI.
const COUNTED = ["CONFIRMED", "COMPLETED", "INVOICED", "RETURNED"];

type ProjSeed = {
  id: string;
  status: Doc<"projects">["status"];
  rentalStartDate?: number;
  createdAt?: number;
  isTemplate?: boolean;
};

async function seedProject(t: T, p: ProjSeed, revenues: { modelId: string; revenue: number }[]) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id: p.id, organizationId: ORG, projectNumber: p.id.toUpperCase(), name: p.id,
      status: p.status, isTemplate: p.isTemplate ?? false,
      rentalStartDate: p.rentalStartDate, createdAt: p.createdAt ?? NOW, updatedAt: NOW,
    });
    for (const r of revenues) {
      await ctx.db.insert("projectModelRevenues", {
        id: `pmr_${p.id}_${r.modelId}`, organizationId: ORG, projectId: p.id,
        modelId: r.modelId, allocatedRevenue: r.revenue, updatedAt: NOW,
      });
    }
  });
}

describe("getModelRoi — status + date filtering", () => {
  test("counts only projects in the requested status set; a QUOTED/CANCELLED project earns nothing", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "rx", organizationId: ORG, name: "Receiver", replacementCost: 2000 });
    });
    await seedProject(t, { id: "won", status: "COMPLETED", rentalStartDate: NOW }, [{ modelId: "rx", revenue: 300 }]);
    await seedProject(t, { id: "quote", status: "QUOTED", rentalStartDate: NOW }, [{ modelId: "rx", revenue: 999 }]);
    await seedProject(t, { id: "dead", status: "CANCELLED", rentalStartDate: NOW }, [{ modelId: "rx", revenue: 777 }]);
    // Template with a counted status must still be excluded.
    await seedProject(t, { id: "tmpl", status: "COMPLETED", rentalStartDate: NOW, isTemplate: true }, [{ modelId: "rx", revenue: 500 }]);

    const roi = await asService(t).query(api.roi.getModelRoi, { orgId: ORG, modelId: "rx", statuses: COUNTED });
    expect(roi.revenue).toBe(300);
    expect(roi.projects.map((p) => p.projectId)).toEqual(["won"]);
  });

  test("windows on rentalStartDate (falling back to createdAt), inclusive of the bounds", async () => {
    const t = convexTest(schema, modules);
    await seedProject(t, { id: "early", status: "COMPLETED", rentalStartDate: NOW - 10 * DAY }, [{ modelId: "rx", revenue: 100 }]);
    await seedProject(t, { id: "mid", status: "COMPLETED", rentalStartDate: NOW }, [{ modelId: "rx", revenue: 200 }]);
    await seedProject(t, { id: "late", status: "COMPLETED", rentalStartDate: NOW + 10 * DAY }, [{ modelId: "rx", revenue: 400 }]);

    const roi = await asService(t).query(api.roi.getModelRoi, {
      orgId: ORG, modelId: "rx", statuses: COUNTED, from: NOW - 5 * DAY, to: NOW + 5 * DAY,
    });
    expect(roi.revenue).toBe(200);
    expect(roi.projects.map((p) => p.projectId)).toEqual(["mid"]);
  });

  test("unitsOwned counts active serialized assets + active bulk totalQuantity, excluding retired", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "rx", organizationId: ORG, name: "Receiver", replacementCost: 2000 });
      // Two active serialized units, one retired (isActive:false) — counts 2.
      await ctx.db.insert("assets", { id: "s1", organizationId: ORG, modelId: "rx", assetTag: "S1", isActive: true });
      await ctx.db.insert("assets", { id: "s2", organizationId: ORG, modelId: "rx", assetTag: "S2" }); // undefined isActive counts
      await ctx.db.insert("assets", { id: "s3", organizationId: ORG, modelId: "rx", assetTag: "S3", isActive: false });
      // Bulk: totalQuantity 5 active + 8 inactive (excluded) → +5.
      await ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, modelId: "rx", assetTag: "B1", totalQuantity: 5, isActive: true });
      await ctx.db.insert("bulkAssets", { id: "b2", organizationId: ORG, modelId: "rx", assetTag: "B2", totalQuantity: 8, isActive: false });
    });
    const roi = await asService(t).query(api.roi.getModelRoi, { orgId: ORG, modelId: "rx", statuses: COUNTED });
    expect(roi.unitsOwned).toBe(7); // 2 serialized + 5 bulk
    expect(roi.replacementCost).toBe(2000);
  });
});

/**
 * The gearflow#798 fallback chain: `asset.purchasePrice ?? model.defaultPurchasePrice
 * ?? model.replacementCost`, decided per asset — not a uniform `replacementCost ×
 * unitsOwned` multiply. `getModelRoi` and `fleetInventory` share this via
 * `fleetCapitalFor`/`assetCost`, so both are exercised here.
 */
describe("fleet cost — per-asset purchase-price chain (gearflow#798)", () => {
  test("sums each asset's OWN purchase price — not a uniform multiply", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "rx", organizationId: ORG, name: "Receiver", replacementCost: 999 });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "rx", assetTag: "A1", purchasePrice: 1000 });
      await ctx.db.insert("assets", { id: "a2", organizationId: ORG, modelId: "rx", assetTag: "A2", purchasePrice: 1500 });
      await ctx.db.insert("assets", { id: "a3", organizationId: ORG, modelId: "rx", assetTag: "A3", purchasePrice: 2000 });
    });
    const roi = await asService(t).query(api.roi.getModelRoi, { orgId: ORG, modelId: "rx", statuses: COUNTED });
    expect(roi.fleetCost).toBe(4500); // 1000 + 1500 + 2000, NOT 999 × 3

    const inv = await asService(t).query(api.roi.fleetInventory, { orgId: ORG });
    expect(inv.rows.find((r) => r.modelId === "rx")?.fleetCost).toBe(4500);
  });

  test("falls back to model.defaultPurchasePrice before model.replacementCost", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", {
        id: "rx", organizationId: ORG, name: "Receiver", defaultPurchasePrice: 800, replacementCost: 500,
      });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "rx", assetTag: "A1" });
    });
    const roi = await asService(t).query(api.roi.getModelRoi, { orgId: ORG, modelId: "rx", statuses: COUNTED });
    expect(roi.fleetCost).toBe(800); // defaultPurchasePrice wins, not replacementCost
  });

  test("falls all the way to replacementCost when defaultPurchasePrice is also unset", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "rx", organizationId: ORG, name: "Receiver", replacementCost: 300 });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "rx", assetTag: "A1" });
    });
    const roi = await asService(t).query(api.roi.getModelRoi, { orgId: ORG, modelId: "rx", statuses: COUNTED });
    expect(roi.fleetCost).toBe(300);
  });

  test("mixes real purchase prices with fallbacks within the same model", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "rx", organizationId: ORG, name: "Receiver", replacementCost: 100 });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "rx", assetTag: "A1", purchasePrice: 900 });
      await ctx.db.insert("assets", { id: "a2", organizationId: ORG, modelId: "rx", assetTag: "A2" }); // falls back to 100
    });
    const roi = await asService(t).query(api.roi.getModelRoi, { orgId: ORG, modelId: "rx", statuses: COUNTED });
    expect(roi.fleetCost).toBe(1000);
  });

  test("no cost signal anywhere reports fleetCost null, not $0 — units are owned but unpriced", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "rx", organizationId: ORG, name: "Receiver" });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "rx", assetTag: "A1" });
    });
    const roi = await asService(t).query(api.roi.getModelRoi, { orgId: ORG, modelId: "rx", statuses: COUNTED });
    expect(roi.unitsOwned).toBe(1);
    expect(roi.fleetCost).toBeNull();

    const inv = await asService(t).query(api.roi.fleetInventory, { orgId: ORG });
    expect(inv.rows.find((r) => r.modelId === "rx")?.fleetCost).toBeNull();
  });

  test("a zero or negative value at any rung of the chain is treated as no signal, not free capital", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", {
        id: "rx", organizationId: ORG, name: "Receiver", defaultPurchasePrice: -5, replacementCost: 250,
      });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "rx", assetTag: "A1", purchasePrice: 0 });
    });
    const roi = await asService(t).query(api.roi.getModelRoi, { orgId: ORG, modelId: "rx", statuses: COUNTED });
    expect(roi.fleetCost).toBe(250); // 0 and -5 both skipped; replacementCost is the first real signal
  });

  test("bulk stock is unchanged: replacementCost × totalQuantity, purchasePricePerUnit ignored", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "rx", organizationId: ORG, name: "Receiver", replacementCost: 50 });
      // purchasePricePerUnit set but out of scope for #798 — must not affect the sum.
      await ctx.db.insert("bulkAssets", {
        id: "b1", organizationId: ORG, modelId: "rx", assetTag: "B1", totalQuantity: 4, purchasePricePerUnit: 9999,
      });
    });
    const roi = await asService(t).query(api.roi.getModelRoi, { orgId: ORG, modelId: "rx", statuses: COUNTED });
    expect(roi.fleetCost).toBe(200); // 50 × 4, not 9999 × 4
  });

  test("zero units owned reports fleetCost null even with a real replacementCost on file", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "rx", organizationId: ORG, name: "Receiver", replacementCost: 500 });
    });
    const roi = await asService(t).query(api.roi.getModelRoi, { orgId: ORG, modelId: "rx", statuses: COUNTED });
    expect(roi.unitsOwned).toBe(0);
    expect(roi.fleetCost).toBeNull();
  });
});

describe("fleetRevenue — status + date filtering", () => {
  test("aggregates by model across counted projects only, tracking projectCount", async () => {
    const t = convexTest(schema, modules);
    await seedProject(t, { id: "p1", status: "COMPLETED", rentalStartDate: NOW }, [
      { modelId: "rx", revenue: 100 }, { modelId: "belt", revenue: 10 },
    ]);
    await seedProject(t, { id: "p2", status: "INVOICED", rentalStartDate: NOW }, [{ modelId: "rx", revenue: 50 }]);
    await seedProject(t, { id: "p3", status: "QUOTED", rentalStartDate: NOW }, [{ modelId: "rx", revenue: 9999 }]);

    const fleet = await asService(t).query(api.roi.fleetRevenue, { orgId: ORG, statuses: COUNTED });
    const byModel = new Map(fleet.rows.map((r) => [r.modelId, r]));
    expect(byModel.get("rx")?.revenue).toBe(150); // p1 + p2, QUOTED p3 excluded
    expect(byModel.get("rx")?.projectCount).toBe(2);
    expect(byModel.get("belt")?.revenue).toBe(10);
    expect(fleet.truncated).toBe(false);
  });

  /**
   * The window is on rentalStartDate, but creation order does not track rental date:
   * a project entered today can be for a gig last year. An earlier version took an
   * index prefix and then filtered, so in-window projects sitting behind newer
   * out-of-window ones were never read at all.
   */
  test("finds an in-window project that was created most recently of all", async () => {
    const t = convexTest(schema, modules);
    // Seeded LAST (newest _creationTime) but its rental date is far outside the window.
    await seedProject(t, { id: "inwindow", status: "COMPLETED", rentalStartDate: NOW }, [{ modelId: "rx", revenue: 70 }]);
    await seedProject(t, { id: "future", status: "COMPLETED", rentalStartDate: NOW + 400 * DAY }, [{ modelId: "rx", revenue: 9999 }]);

    const fleet = await asService(t).query(api.roi.fleetRevenue, {
      orgId: ORG, statuses: COUNTED, from: NOW - DAY, to: NOW + DAY,
    });
    expect(fleet.rows.find((r) => r.modelId === "rx")?.revenue).toBe(70);
    expect(fleet.projectsCounted).toBe(1);
  });

  /**
   * The budget is spent by ROLLUP ROWS, not by projects. Reading exactly `remaining`
   * rows on the LAST project fills the budget, exits the loop normally, and would
   * leave `truncated` false while a model's revenue quietly went missing — which
   * looks identical to gear that simply didn't earn.
   */
  test("a project truncated exactly at the budget boundary still reports truncated", async () => {
    const t = convexTest(schema, modules);
    await seedProject(t, { id: "p1", status: "COMPLETED", rentalStartDate: NOW }, [
      { modelId: "a", revenue: 10 },
      { modelId: "b", revenue: 20 },
    ]);

    // Budget of exactly 2 rows: p1's page fills it precisely, with nothing left over.
    const exact = await asService(t).query(api.roi.fleetRevenue, {
      orgId: ORG, statuses: COUNTED, rollupBudget: 2,
    });
    expect(exact.truncated).toBe(false);
    expect(exact.projectsCounted).toBe(1);

    // Budget of 1: p1 has more to give, so the report must say so — and must not
    // ingest a half-read project, because a partial total is a wrong total.
    const short = await asService(t).query(api.roi.fleetRevenue, {
      orgId: ORG, statuses: COUNTED, rollupBudget: 1,
    });
    expect(short.truncated).toBe(true);
    expect(short.projectsCounted).toBe(0);
    expect(short.rows).toHaveLength(0);
  });

  test("respects the date window", async () => {
    const t = convexTest(schema, modules);
    await seedProject(t, { id: "old", status: "COMPLETED", rentalStartDate: NOW - 10 * DAY }, [{ modelId: "rx", revenue: 100 }]);
    await seedProject(t, { id: "new", status: "COMPLETED", rentalStartDate: NOW }, [{ modelId: "rx", revenue: 40 }]);
    const fleet = await asService(t).query(api.roi.fleetRevenue, { orgId: ORG, statuses: COUNTED, from: NOW - 2 * DAY });
    const rx = fleet.rows.find((r) => r.modelId === "rx");
    expect(rx?.revenue).toBe(40);
    expect(rx?.projectCount).toBe(1);
  });
});

describe("fleetInventory — unit tallying + dead-capital rows", () => {
  test("tallies bulk totalQuantity + active serialized units, excludes inactive units and models", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "rx", organizationId: ORG, name: "Receiver", replacementCost: 2000, manufacturer: "Shure", categoryId: "rf" });
      await ctx.db.insert("models", { id: "belt", organizationId: ORG, name: "Belt", replacementCost: 15 });
      await ctx.db.insert("models", { id: "old", organizationId: ORG, name: "Retired model", isActive: false });
      // rx: 1 active serialized + 1 retired serialized + bulk 4 active + 3 inactive → 5.
      await ctx.db.insert("assets", { id: "s1", organizationId: ORG, modelId: "rx", assetTag: "S1", isActive: true });
      await ctx.db.insert("assets", { id: "s2", organizationId: ORG, modelId: "rx", assetTag: "S2", isActive: false });
      await ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, modelId: "rx", assetTag: "B1", totalQuantity: 4, isActive: true });
      await ctx.db.insert("bulkAssets", { id: "b2", organizationId: ORG, modelId: "rx", assetTag: "B2", totalQuantity: 3, isActive: false });
      // belt owns nothing → dead capital, still listed with 0 units.
    });
    const inv = await asService(t).query(api.roi.fleetInventory, { orgId: ORG });
    const byModel = new Map(inv.rows.map((r) => [r.modelId, r]));

    expect(byModel.get("rx")?.unitsOwned).toBe(5);
    expect(byModel.get("rx")?.manufacturer).toBe("Shure");
    expect(byModel.get("rx")?.categoryId).toBe("rf");
    // Zero-revenue / zero-unit model still appears — the point of the report.
    expect(byModel.get("belt")?.unitsOwned).toBe(0);
    // Inactive MODEL is filtered out entirely.
    expect(byModel.has("old")).toBe(false);
    expect(inv.truncated).toBe(false);
  });
});

describe("getModelRoi — tenant isolation", () => {
  const OTHER = "org_2";

  /**
   * `models.by_cuid` and `assets.by_modelId` are GLOBAL indexes. `requireOrgRead`
   * validates the caller's org, not the model's. Before this was fixed, a caller
   * authorised for their own org could pass another org's modelId and read back its
   * name, replacement cost, and unit count.
   */
  test("refuses a modelId belonging to another org", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "secret", organizationId: OTHER, name: "Their Receiver", replacementCost: 99_000 });
      await ctx.db.insert("assets", { id: "a1", organizationId: OTHER, modelId: "secret", assetTag: "A1" });
    });

    await expect(
      asService(t).query(api.roi.getModelRoi, { orgId: ORG, modelId: "secret", statuses: COUNTED }),
    ).rejects.toThrow(/not in org/);
  });

  test("never counts another org's assets toward unitsOwned", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      // Same modelId string present in two orgs (e.g. after a bad import).
      await ctx.db.insert("models", { id: "rx", organizationId: ORG, name: "Receiver", replacementCost: 100 });
      await ctx.db.insert("assets", { id: "mine", organizationId: ORG, modelId: "rx", assetTag: "M1" });
      await ctx.db.insert("assets", { id: "theirs", organizationId: OTHER, modelId: "rx", assetTag: "T1" });
      await ctx.db.insert("bulkAssets", { id: "tb", organizationId: OTHER, modelId: "rx", assetTag: "TB", totalQuantity: 50 });
    });

    const roi = await asService(t).query(api.roi.getModelRoi, { orgId: ORG, modelId: "rx", statuses: COUNTED });
    expect(roi.unitsOwned).toBe(1);
  });
});

describe("zeroPricedGroups — flags gear that can't earn revenue", () => {
  test("flags an unpriced group carrying real gear, ignores a priced one and a customs-only one", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", {
        id: "p1", organizationId: ORG, projectNumber: "P1", name: "Wedding Gig",
        status: "COMPLETED", isTemplate: false, createdAt: NOW, updatedAt: NOW,
      });
      // Unpriced group with real gear inside — the case this report exists to catch.
      await ctx.db.insert("projectGroups", {
        id: "g_unpriced", organizationId: ORG, projectId: "p1", title: "RF Kit",
        quantity: 1, suggestedPrice: 450,
      });
      await ctx.db.insert("projectLineItems", {
        id: "l1", organizationId: ORG, projectId: "p1", groupId: "g_unpriced", modelId: "rx",
      });
      // A cancelled line inside the same group must not count toward gearLineCount.
      await ctx.db.insert("projectLineItems", {
        id: "l1b", organizationId: ORG, projectId: "p1", groupId: "g_unpriced", modelId: "rx",
        status: "CANCELLED",
      });
      // Priced group — not flagged, its gear earns normally.
      await ctx.db.insert("projectGroups", {
        id: "g_priced", organizationId: ORG, projectId: "p1", title: "Lighting Package",
        price: 900, quantity: 1,
      });
      await ctx.db.insert("projectLineItems", {
        id: "l2", organizationId: ORG, projectId: "p1", groupId: "g_priced", modelId: "par",
      });
      // Unpriced group with only a custom item, no gear — not flagged (nothing of
      // ours to attribute; the custom item bills on its own per recalc.ts).
      await ctx.db.insert("projectGroups", {
        id: "g_customs_only", organizationId: ORG, projectId: "p1", title: "Freight",
        quantity: 1,
      });
      await ctx.db.insert("projectLineItems", {
        id: "l3", organizationId: ORG, projectId: "p1", groupId: "g_customs_only",
        isCustomItem: true,
      });
    });

    const res = await asService(t).query(api.roi.zeroPricedGroups, { orgId: ORG, statuses: COUNTED });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      projectId: "p1", groupId: "g_unpriced", groupTitle: "RF Kit",
      gearLineCount: 1, suggestedPrice: 450,
    });
    expect(res.truncated).toBe(false);
  });

  test("only scans counted-status projects", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", {
        id: "quote", organizationId: ORG, projectNumber: "Q1", name: "Just a quote",
        status: "QUOTED", isTemplate: false, createdAt: NOW, updatedAt: NOW,
      });
      await ctx.db.insert("projectGroups", {
        id: "g1", organizationId: ORG, projectId: "quote", title: "RF Kit", quantity: 1,
      });
      await ctx.db.insert("projectLineItems", {
        id: "l1", organizationId: ORG, projectId: "quote", groupId: "g1", modelId: "rx",
      });
    });

    const res = await asService(t).query(api.roi.zeroPricedGroups, { orgId: ORG, statuses: COUNTED });
    expect(res.rows).toHaveLength(0);
  });
});

describe("status gating lives in Convex, not only in the server action", () => {
  test("a caller asking for QUOTED revenue gets nothing", async () => {
    const t = convexTest(schema, modules);
    await seedProject(t, { id: "q", status: "QUOTED", rentalStartDate: NOW }, [{ modelId: "rx", revenue: 5000 }]);
    await seedProject(t, { id: "won", status: "COMPLETED", rentalStartDate: NOW }, [{ modelId: "rx", revenue: 10 }]);

    // A browser-held user token can call the query directly, bypassing src/lib/roi.ts.
    const roi = await asService(t).query(api.roi.getModelRoi, {
      orgId: ORG, modelId: "rx", statuses: ["QUOTED", "CANCELLED", "COMPLETED"],
    });
    expect(roi.revenue).toBe(10);

    const fleet = await asService(t).query(api.roi.fleetRevenue, {
      orgId: ORG, statuses: ["QUOTED", "ENQUIRY"],
    });
    expect(fleet.rows).toHaveLength(0);
  });
});
