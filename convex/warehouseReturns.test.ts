// @vitest-environment node
//
// Org-wide returns board (issue #944 WS5): groups CHECKED_OUT lines by project,
// overdue-first ordering, accessory cascade with parent, sub-hire/custom
// display-only+unscannable, partial returns included, org isolation, and the
// on-demand unit-expansion query.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_other";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const asUser = (orgId: string) => ({ subject: USER, orgId });

function makeT() {
  return convexTest(schema, modules);
}
type T = ReturnType<typeof makeT>;

async function member(t: T, orgId = ORG, role = "member") {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: `m-${orgId}`, organizationId: orgId, userId: USER, role });
  });
}

async function seedProject(t: T, id: string, extra: Record<string, unknown>, orgId = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id, organizationId: orgId, projectNumber: `P-${id}`, name: `Project ${id}`, status: "CHECKED_OUT",
      total: 0, ...extra,
    });
  });
}

async function seedModel(t: T, id = "m1", orgId = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("models", { id, organizationId: orgId, name: "PAR Can", createdAt: NOW, updatedAt: NOW });
  });
}

const baseLine = (id: string, projectId: string, extra: Record<string, unknown>, orgId = ORG) => ({
  id, organizationId: orgId, projectId, type: "EQUIPMENT" as const, quantity: 1, sortOrder: 0,
  status: "CHECKED_OUT" as const, checkedOutQuantity: 1, isKitChild: false, createdAt: NOW, updatedAt: NOW, ...extra,
});

describe("warehouseReturns.bundle", () => {
  test("groups CHECKED_OUT lines by project, overdue project first", async () => {
    const t = makeT();
    await member(t);
    await seedModel(t);
    // p1: not overdue (ends in the future). p2: overdue (ended yesterday).
    await seedProject(t, "p1", { rentalEndDate: NOW + 5 * DAY });
    await seedProject(t, "p2", { rentalEndDate: NOW - 5 * DAY });
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", baseLine("li1", "p1", { modelId: "m1", assetId: "a1" }));
      await ctx.db.insert("projectLineItems", baseLine("li2", "p2", { modelId: "m1", assetId: "a2" }));
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.warehouseReturns.bundle, { orgId: ORG });
    expect(res.projects.map((p) => p.projectId)).toEqual(["p2", "p1"]); // overdue (p2) first
    expect(res.projects[0].urgency).toBe("overdue");
    expect(res.truncated).toBe(false);
  });

  test("includes partially-returned lines (status stays CHECKED_OUT until every unit is back)", async () => {
    const t = makeT();
    await member(t);
    await seedModel(t);
    await seedProject(t, "p1", {});
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", baseLine("li1", "p1", { modelId: "m1", bulkAssetId: "b1", checkedOutQuantity: 10, returnedQuantity: 6 }));
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.warehouseReturns.bundle, { orgId: ORG });
    const line = res.projects[0].lines.find((l) => l.lineItemId === "li1");
    expect(line?.outstanding).toBe(4);
  });

  test("accessory children cascade under their parent, not as independent rows", async () => {
    const t = makeT();
    await member(t);
    await seedModel(t);
    await seedProject(t, "p1", {});
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", baseLine("parent1", "p1", { modelId: "m1", assetId: "a1" }));
      await ctx.db.insert("projectLineItems", baseLine("acc1", "p1", {
        modelId: "m1", bulkAssetId: "b1", isKitChild: true, childKind: "ACCESSORY", parentLineItemId: "parent1", description: "Cable",
      }));
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.warehouseReturns.bundle, { orgId: ORG });
    const lines = res.projects[0].lines;
    expect(lines).toHaveLength(1); // accessory is NOT a separate top-level row
    expect(lines[0].lineItemId).toBe("parent1");
    expect(lines[0].accessories).toEqual([{ lineItemId: "acc1", description: "Cable", outstanding: 1 }]);
  });

  test("sub-hire and custom lines are display-only (unscannable)", async () => {
    const t = makeT();
    await member(t);
    await seedProject(t, "p1", {});
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", baseLine("sh1", "p1", { subHireId: "sh-order-1", description: "Sub-hire genny" }));
      await ctx.db.insert("projectLineItems", baseLine("cust1", "p1", { isCustomItem: true, description: "Custom rig" }));
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.warehouseReturns.bundle, { orgId: ORG });
    const lines = res.projects[0].lines;
    expect(lines.every((l) => l.scannable === false)).toBe(true);
    expect(lines.map((l) => l.kind).sort()).toEqual(["custom", "subhire"]);
  });

  test("org isolation: another org's CHECKED_OUT lines never appear", async () => {
    const t = makeT();
    await member(t, ORG);
    await seedProject(t, "pX", {}, OTHER);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", baseLine("liX", "pX", { description: "Other org gear" }, OTHER));
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.warehouseReturns.bundle, { orgId: ORG });
    expect(res.projects).toEqual([]);
  });

  test("viewer without warehouse:read is denied", async () => {
    const t = makeT();
    await member(t, ORG, "viewer");
    await expect(t.withIdentity(asUser(ORG)).query(api.warehouseReturns.bundle, { orgId: ORG })).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("warehouseReturns.unitsForLine", () => {
  test("expands only CHECKED_OUT units for the requested line, with asset tags resolved", async () => {
    const t = makeT();
    await member(t);
    await seedModel(t);
    await seedProject(t, "p1", {});
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "A-1", status: "CHECKED_OUT", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", baseLine("li1", "p1", { modelId: "m1" }));
      await ctx.db.insert("projectLineItemUnits", { id: "u1", organizationId: ORG, lineItemId: "li1", ordinal: 0, assetId: "a1", quantity: 1, status: "CHECKED_OUT", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItemUnits", { id: "u2", organizationId: ORG, lineItemId: "li1", ordinal: 1, assetId: "a1", quantity: 1, status: "RETURNED", createdAt: NOW, updatedAt: NOW });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.warehouseReturns.unitsForLine, { orgId: ORG, lineItemId: "li1" });
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ unitId: "u1", assetTag: "A-1" });
  });
});
