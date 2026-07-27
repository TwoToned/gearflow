// @vitest-environment node
//
// Resolver tests for the org-wide returns-station scan resolution (issue #944 WS5).
// Covers: single active deployment, kit-member guard, accessory-child guard,
// asset with >1 active deployment (disambiguation), bulk tag out on multiple
// projects (per-project prompt), whole-kit resolution, retired/no-deployment
// exceptions, unknown tag, and org isolation.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_other";
const USER = "user_1";
const NOW = 1_700_000_000_000;
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

async function seedProject(t: T, id: string, orgId = ORG, name = "Gig") {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id, organizationId: orgId, projectNumber: `P-${id}`, name, status: "CHECKED_OUT",
      total: 0,
    });
  });
}

async function seedModel(t: T, id = "m1", orgId = ORG, name = "PAR Can") {
  await t.run(async (ctx) => {
    await ctx.db.insert("models", { id, organizationId: orgId, name, createdAt: NOW, updatedAt: NOW });
  });
}

const baseLine = (id: string, projectId: string, extra: Record<string, unknown>, orgId = ORG) => ({
  id, organizationId: orgId, projectId, type: "EQUIPMENT" as const, quantity: 1, sortOrder: 0,
  status: "CHECKED_OUT" as const, checkedOutQuantity: 1, isKitChild: false, createdAt: NOW, updatedAt: NOW, ...extra,
});

describe("returnsLookup.resolve", () => {
  test("anonymous caller rejected", async () => {
    const t = makeT();
    await expect(t.query(api.returnsLookup.resolve, { orgId: ORG, value: "A-1" })).rejects.toThrow(/Unauthorized/i);
  });

  test("unknown tag → not_found", async () => {
    const t = makeT();
    await member(t);
    const res = await t.withIdentity(asUser(ORG)).query(api.returnsLookup.resolve, { orgId: ORG, value: "no-such-tag" });
    expect(res).toEqual({ kind: "not_found" });
  });

  test("resolves a single active serialised deployment", async () => {
    const t = makeT();
    await member(t);
    await seedModel(t);
    await seedProject(t, "p1");
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "A-1", status: "CHECKED_OUT", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", baseLine("li1", "p1", { modelId: "m1", assetId: "a1" }));
      await ctx.db.insert("projectLineItemUnits", { id: "u1", organizationId: ORG, lineItemId: "li1", ordinal: 0, assetId: "a1", quantity: 1, status: "CHECKED_OUT", createdAt: NOW, updatedAt: NOW });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.returnsLookup.resolve, { orgId: ORG, value: "A-1" });
    expect(res).toMatchObject({ kind: "asset", assetId: "a1", lineItemId: "li1", unitId: "u1", projectId: "p1" });
  });

  test("kit member scan guards to 'scan the kit'", async () => {
    const t = makeT();
    await member(t);
    await seedModel(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "K-1", name: "Lighting Kit", status: "CHECKED_OUT", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "A-1", status: "CHECKED_OUT", kitId: "k1", isActive: true, createdAt: NOW, updatedAt: NOW });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.returnsLookup.resolve, { orgId: ORG, value: "A-1" });
    expect(res).toMatchObject({ kind: "guard_kit_member", assetId: "a1", kitId: "k1", kitAssetTag: "K-1" });
  });

  test("accessory child scan guards to 'returns with its parent'", async () => {
    const t = makeT();
    await member(t);
    await seedModel(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "parent1", organizationId: ORG, modelId: "m1", assetTag: "PARENT-1", status: "CHECKED_OUT", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("assets", { id: "child1", organizationId: ORG, modelId: "m1", assetTag: "CHILD-1", status: "CHECKED_OUT", parentAssetId: "parent1", isActive: true, createdAt: NOW, updatedAt: NOW });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.returnsLookup.resolve, { orgId: ORG, value: "CHILD-1" });
    expect(res).toMatchObject({ kind: "guard_accessory_child", assetId: "child1", parentAssetId: "parent1", parentAssetTag: "PARENT-1" });
  });

  test("retired asset → exception, never blocks the dock", async () => {
    const t = makeT();
    await member(t);
    await seedModel(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "A-1", status: "RETIRED", isActive: true, createdAt: NOW, updatedAt: NOW });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.returnsLookup.resolve, { orgId: ORG, value: "A-1" });
    expect(res).toEqual({ kind: "exception", reason: "retired", assetId: "a1", assetTag: "A-1", assetName: "PAR Can" });
  });

  test("asset with no active deployment → exception", async () => {
    const t = makeT();
    await member(t);
    await seedModel(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "A-1", status: "AVAILABLE", isActive: true, createdAt: NOW, updatedAt: NOW });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.returnsLookup.resolve, { orgId: ORG, value: "A-1" });
    expect(res).toMatchObject({ kind: "exception", reason: "no_active_deployment" });
  });

  test("asset with >1 active deployment → asset_multi disambiguation (never auto-pick)", async () => {
    const t = makeT();
    await member(t);
    await seedModel(t);
    await seedProject(t, "p1", ORG, "Job A");
    await seedProject(t, "p2", ORG, "Job B");
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "A-1", status: "CHECKED_OUT", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", baseLine("li1", "p1", { modelId: "m1", assetId: "a1" }));
      await ctx.db.insert("projectLineItemUnits", { id: "u1", organizationId: ORG, lineItemId: "li1", ordinal: 0, assetId: "a1", quantity: 1, status: "CHECKED_OUT", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", baseLine("li2", "p2", { modelId: "m1", assetId: "a1" }));
      await ctx.db.insert("projectLineItemUnits", { id: "u2", organizationId: ORG, lineItemId: "li2", ordinal: 0, assetId: "a1", quantity: 1, status: "CHECKED_OUT", createdAt: NOW, updatedAt: NOW });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.returnsLookup.resolve, { orgId: ORG, value: "A-1" });
    expect(res.kind).toBe("asset_multi");
    if (res.kind === "asset_multi") {
      expect(res.deployments).toHaveLength(2);
      expect(res.deployments.map((d) => d.projectId).sort()).toEqual(["p1", "p2"]);
    }
  });

  test("bulk tag out on a single project resolves directly", async () => {
    const t = makeT();
    await member(t);
    await seedModel(t);
    await seedProject(t, "p1");
    await t.run(async (ctx) => {
      await ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, modelId: "m1", assetTag: "B-1", status: "ACTIVE", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", baseLine("li1", "p1", { modelId: "m1", bulkAssetId: "b1" }));
      await ctx.db.insert("projectLineItemUnits", { id: "u1", organizationId: ORG, lineItemId: "li1", ordinal: 0, bulkAssetId: "b1", quantity: 5, returnedQuantity: 0, status: "CHECKED_OUT", createdAt: NOW, updatedAt: NOW });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.returnsLookup.resolve, { orgId: ORG, value: "B-1" });
    expect(res).toMatchObject({ kind: "bulk", bulkAssetId: "b1", projectId: "p1", outstanding: 5 });
  });

  test("bulk tag out on multiple projects → bulk_multi per-project prompt", async () => {
    const t = makeT();
    await member(t);
    await seedModel(t);
    await seedProject(t, "p1", ORG, "Job A");
    await seedProject(t, "p2", ORG, "Job B");
    await t.run(async (ctx) => {
      await ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, modelId: "m1", assetTag: "B-1", status: "ACTIVE", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", baseLine("li1", "p1", { modelId: "m1", bulkAssetId: "b1" }));
      await ctx.db.insert("projectLineItemUnits", { id: "u1", organizationId: ORG, lineItemId: "li1", ordinal: 0, bulkAssetId: "b1", quantity: 3, returnedQuantity: 0, status: "CHECKED_OUT", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", baseLine("li2", "p2", { modelId: "m1", bulkAssetId: "b1" }));
      await ctx.db.insert("projectLineItemUnits", { id: "u2", organizationId: ORG, lineItemId: "li2", ordinal: 0, bulkAssetId: "b1", quantity: 7, returnedQuantity: 2, status: "CHECKED_OUT", createdAt: NOW, updatedAt: NOW });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.returnsLookup.resolve, { orgId: ORG, value: "B-1" });
    expect(res.kind).toBe("bulk_multi");
    if (res.kind === "bulk_multi") {
      expect(res.deployments).toHaveLength(2);
      const byProject = new Map(res.deployments.map((d) => [d.projectId, d.outstanding]));
      expect(byProject.get("p1")).toBe(3);
      expect(byProject.get("p2")).toBe(5); // 7 - 2 returned
    }
  });

  test("kit tag resolves to whole-kit return", async () => {
    const t = makeT();
    await member(t);
    await seedProject(t, "p1");
    await t.run(async (ctx) => {
      await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "K-1", name: "Lighting Kit", status: "CHECKED_OUT", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", baseLine("li1", "p1", { kitId: "k1", isKitChild: false }));
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.returnsLookup.resolve, { orgId: ORG, value: "K-1" });
    expect(res).toMatchObject({ kind: "kit", kitId: "k1", lineItemId: "li1", projectId: "p1" });
  });

  test("org isolation: a tag from another org never resolves", async () => {
    const t = makeT();
    await member(t, ORG);
    await seedModel(t, "m1", OTHER);
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "a1", organizationId: OTHER, modelId: "m1", assetTag: "A-1", status: "CHECKED_OUT", isActive: true, createdAt: NOW, updatedAt: NOW });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.returnsLookup.resolve, { orgId: ORG, value: "A-1" });
    expect(res).toEqual({ kind: "not_found" });
  });
});
