// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

const ORG = "org_1";
const OTHER = "org_2";
const asUser = (orgId: string) => ({ subject: "user_1", orgId });
const NOW = 1_700_000_000_000;

describe("search.models", () => {
  test("matches by name, is org-scoped, and honours the query", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "Shure SM58", isActive: true, createdAt: NOW });
      await ctx.db.insert("models", { id: "m2", organizationId: ORG, name: "Sennheiser MD421", isActive: true, createdAt: NOW });
      await ctx.db.insert("models", { id: "m3", organizationId: OTHER, name: "Shure SM7B", isActive: true, createdAt: NOW });
    });

    const hits = await t.withIdentity(asUser(ORG)).query(api.search.models, { orgId: ORG, query: "Shure" });
    expect(hits.map((m) => m.id)).toEqual(["m1"]); // m3 is another org

    const empty = await t.withIdentity(asUser(ORG)).query(api.search.models, { orgId: ORG, query: "" });
    expect(empty.map((m) => m.id).sort()).toEqual(["m1", "m2"]); // bounded recent, org-scoped
  });

  test("respects the limit clamp", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < 5; i++) {
        await ctx.db.insert("models", { id: `m${i}`, organizationId: ORG, name: `Widget ${i}`, isActive: true, createdAt: NOW });
      }
    });
    const hits = await t.withIdentity(asUser(ORG)).query(api.search.models, { orgId: ORG, query: "Widget", limit: 2 });
    expect(hits.length).toBe(2);
  });
});

describe("search.assets — tag or serial", () => {
  test("matches by asset tag or serial number, merged + deduped", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "CAM-001", serialNumber: "SN-ABC", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("assets", { id: "a2", organizationId: ORG, modelId: "m1", assetTag: "LENS-050", serialNumber: "CAM-XYZ", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
    });
    // "CAM" matches a1 by tag and a2 by serial → both, deduped.
    const hits = await t.withIdentity(asUser(ORG)).query(api.search.assets, { orgId: ORG, query: "CAM" });
    expect(hits.map((a) => a.id).sort()).toEqual(["a1", "a2"]);

    const byTag = await t.withIdentity(asUser(ORG)).query(api.search.assets, { orgId: ORG, query: "LENS" });
    expect(byTag.map((a) => a.id)).toEqual(["a2"]);
  });
});

describe("search.projects — excludes templates", () => {
  test("templates are filtered out unless includeTemplates", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P-1", name: "Festival Main Stage", status: "CONFIRMED", isTemplate: false, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projects", { id: "p2", organizationId: ORG, projectNumber: "T-1", name: "Festival Template", status: "CONFIRMED", isTemplate: true, createdAt: NOW, updatedAt: NOW });
    });
    const hits = await t.withIdentity(asUser(ORG)).query(api.search.projects, { orgId: ORG, query: "Festival" });
    expect(hits.map((p) => p.id)).toEqual(["p1"]);

    const withTemplates = await t
      .withIdentity(asUser(ORG))
      .query(api.search.projects, { orgId: ORG, query: "Festival", includeTemplates: true });
    expect(withTemplates.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
  });
});

describe("search — auth", () => {
  test("a user token for another org cannot read this org's search", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Acme", isActive: true, createdAt: NOW, updatedAt: NOW });
    });
    await expect(
      t.withIdentity(asUser(OTHER)).query(api.search.clients, { orgId: ORG, query: "Acme" }),
    ).rejects.toThrow();
  });
});
