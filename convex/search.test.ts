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

// NOTE: every `models` fixture sets `manufacturer` (even ""). Real Convex tolerates a
// search over an absent optional searchField (unmatched, no error), but convex-test's
// mock `evaluateSearchFilter` calls `.split()` on the raw value and throws on undefined
// — so the two-index models query needs the field present in tests only.
describe("search.models", () => {
  test("matches by name, is org-scoped, and honours the query", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "Shure SM58", manufacturer: "", isActive: true, createdAt: NOW });
      await ctx.db.insert("models", { id: "m2", organizationId: ORG, name: "Sennheiser MD421", manufacturer: "", isActive: true, createdAt: NOW });
      await ctx.db.insert("models", { id: "m3", organizationId: OTHER, name: "Shure SM7B", manufacturer: "", isActive: true, createdAt: NOW });
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
        await ctx.db.insert("models", { id: `m${i}`, organizationId: ORG, name: `Widget ${i}`, manufacturer: "", isActive: true, createdAt: NOW });
      }
    });
    const hits = await t.withIdentity(asUser(ORG)).query(api.search.models, { orgId: ORG, query: "Widget", limit: 2 });
    expect(hits.length).toBe(2);
  });

  test("matches by manufacturer too, merged + deduped with name hits", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "SM58", manufacturer: "Shure", isActive: true, createdAt: NOW });
      await ctx.db.insert("models", { id: "m2", organizationId: ORG, name: "Shure clone", manufacturer: "Generic", isActive: true, createdAt: NOW });
    });
    // "Shure" matches m1 by manufacturer AND m2 by name → both, deduped.
    const hits = await t.withIdentity(asUser(ORG)).query(api.search.models, { orgId: ORG, query: "Shure" });
    expect(hits.map((m) => m.id).sort()).toEqual(["m1", "m2"]);
  });
});

describe("search.kits — tag or name, prep excluded", () => {
  test("matches by assetTag or name (merged) and excludes prep kits by default", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "KIT-001", name: "Audio Rig", isActive: true, isPrep: false, createdAt: NOW });
      await ctx.db.insert("kits", { id: "k2", organizationId: ORG, assetTag: "AUDIO-99", name: "Spare", isActive: true, isPrep: false, createdAt: NOW });
      await ctx.db.insert("kits", { id: "kp", organizationId: ORG, assetTag: "KIT-PREP", name: "Audio Prep", isActive: true, isPrep: true, createdAt: NOW });
    });
    // "Audio" matches k1 (name) + kp (name) + k2 (tag AUDIO-99) — but kp is prep → excluded.
    const hits = await t.withIdentity(asUser(ORG)).query(api.search.kits, { orgId: ORG, query: "Audio" });
    expect(hits.map((k) => k.id).sort()).toEqual(["k1", "k2"]);

    // "KIT-001" matches by tag.
    const byTag = await t.withIdentity(asUser(ORG)).query(api.search.kits, { orgId: ORG, query: "KIT-001" });
    expect(byTag.map((k) => k.id)).toEqual(["k1"]);

    // includePrep surfaces the prep kit.
    const withPrep = await t.withIdentity(asUser(ORG)).query(api.search.kits, { orgId: ORG, query: "Audio", includePrep: true });
    expect(withPrep.map((k) => k.id).sort()).toEqual(["k1", "k2", "kp"]);
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
