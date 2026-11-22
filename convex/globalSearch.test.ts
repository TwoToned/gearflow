// @vitest-environment node
//
// convex/globalSearch.ts: the client contact widen (WS9 #948), plus UX Phase 11
// (§6d.3): the per-type `groups` totals behind `Show all n in X ›`, the job
// number / asset tag normalisation the palette relies on, and the SERVER-SIDE
// role filter (Q4, a security fix — before it, any token for the org searched
// all 14 types, member row or not).
import { convexTest, type TestConvex } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { filterReadable, readableSearchTypes } from "./lib/searchResultResource";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const asUser = (orgId: string) => ({ subject: USER, orgId });

/** A test deployment where user_1 is a member of ORG with `role`. */
async function makeT(role = "member"): Promise<T> {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role });
  });
  return t;
}

const search = (t: T, query: string, orgId = ORG) =>
  t.withIdentity(asUser(orgId)).query(api.globalSearch.search, { orgId, query });

describe("globalSearch.search — client contact widen (WS9 #948)", () => {
  test("matches a client via a NON-primary contact's name, not just the client's own name", async () => {
    const t = await makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Acme Productions", isActive: true });
      await ctx.db.insert("clientContacts", { id: "cc1", organizationId: ORG, clientId: "c1", name: "Zendaya Rivers", isPrimary: false, sortOrder: 0 });
    });
    const { results } = await search(t, "Zendaya");
    expect(results.find((r) => r.type === "client" && r.id === "c1")).toBeDefined();
  });

  test("result subtitle prefers the resolved PRIMARY contact over the legacy embedded field", async () => {
    const t = await makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Acme Productions", contactName: "Legacy Name", isActive: true });
      await ctx.db.insert("clientContacts", { id: "cc1", organizationId: ORG, clientId: "c1", name: "Primary Person", isPrimary: true, sortOrder: 0 });
    });
    const { results } = await search(t, "Acme");
    expect(results.find((r) => r.type === "client" && r.id === "c1")?.subtitle).toBe("Primary Person");
  });

  test("a client with no contacts at all still matches by name (fully-optional contacts)", async () => {
    const t = await makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Bare Client Co", isActive: true });
    });
    const { results } = await search(t, "Bare Client");
    expect(results.find((r) => r.type === "client" && r.id === "c1")).toBeDefined();
  });
});

async function seedGear(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("models", { id: "mAura", organizationId: ORG, name: "Aura", isActive: true, createdAt: NOW, updatedAt: NOW });
    for (let i = 1; i <= 7; i++) {
      const tag = `AURA-0${i}`;
      await ctx.db.insert("assets", { id: `a${i}`, organizationId: ORG, modelId: "mAura", assetTag: tag, status: "AVAILABLE", isActive: true, createdAt: NOW, updatedAt: NOW });
    }
    await ctx.db.insert("clients", { id: "cPriya", organizationId: ORG, name: "Hilton Sydney", isActive: true });
    await ctx.db.insert("clientContacts", { id: "cc1", organizationId: ORG, clientId: "cPriya", name: "Priya Shah", isPrimary: true, sortOrder: 0 });
    await ctx.db.insert("projects", {
      id: "p2341", organizationId: ORG, projectNumber: "2341", name: "Hilton gala dinner", clientId: "cPriya",
      status: "CONFIRMED", isTemplate: false, createdAt: NOW, updatedAt: NOW,
    });
    // Another org's matching rows never surface.
    await ctx.db.insert("models", { id: "mOther", organizationId: OTHER, name: "Aura Other", isActive: true, createdAt: NOW, updatedAt: NOW });
  });
}

describe("globalSearch.search — palette matching (§6d.3)", () => {
  test("`#2341` and `2341` both find the job; `aura 01` finds AURA-01; `priya` finds the client via its contact", async () => {
    const t = await makeT();
    await seedGear(t);
    for (const q of ["#2341", "2341"]) {
      expect((await search(t, q)).results.some((r) => r.type === "project" && r.id === "p2341")).toBe(true);
    }
    expect((await search(t, "aura 01")).results.some((r) => r.type === "asset" && r.id === "a1")).toBe(true);
    expect((await search(t, "priya")).results.some((r) => r.type === "client" && r.id === "cPriya")).toBe(true);
  });

  test("`groups` counts every match of a type before the per-type LIMIT, readable types only", async () => {
    const t = await makeT();
    await seedGear(t);
    const { results, groups } = await search(t, "aura");
    expect(groups.find((g) => g.type === "asset")).toEqual({ type: "asset", total: 7, truncated: false });
    expect(groups.find((g) => g.type === "model")).toEqual({ type: "model", total: 1, truncated: false });
    expect(results.some((r) => r.id === "mOther")).toBe(false);
  });

  test("a too-short query returns empty results and groups", async () => {
    const t = await makeT();
    expect(await search(t, "a")).toEqual({ results: [], groups: [] });
  });

  test("a caller for another org is rejected", async () => {
    const t = await makeT();
    await expect(
      t.withIdentity(asUser(OTHER)).query(api.globalSearch.search, { orgId: ORG, query: "aura" }),
    ).rejects.toThrow(/organization mismatch/i);
  });
});

describe("globalSearch.search — the server filters by role (Q4, security fix)", () => {
  test("a token for the org with NO member row finds nothing", async () => {
    const t = convexTest(schema, modules);
    await seedGear(t);
    expect(await search(t, "aura")).toEqual({ results: [], groups: [] });
  });

  test("a role with no read permissions (an unknown legacy role) finds nothing", async () => {
    const t = await makeT("legacy-custom");
    await seedGear(t);
    expect(await search(t, "hilton")).toEqual({ results: [], groups: [] });
  });

  test("readable types follow the role check, one resource at a time (agent key narrowed to clients)", async () => {
    const t = await makeT("owner");
    await t.run(async (ctx) => {
      await ctx.db.insert("apiKeys", {
        id: "k1", organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h",
        scopes: JSON.stringify(["client:read"]), isActive: true, actingUserId: USER, createdById: USER,
      });
    });
    const types = await t
      .withIdentity({ subject: USER, orgId: ORG, akid: "k1" })
      .query(async (ctx) => [...(await readableSearchTypes(ctx, ORG))]);
    expect(types).toEqual(["client"]);
  });

  test("an owner sees the client with its job as a child", async () => {
    const t = await makeT("owner");
    await seedGear(t);
    const full = await search(t, "hilton");
    expect(full.results.map((r) => `${r.type}:${r.id}:${r.isChild ? "child" : "parent"}`)).toEqual([
      "client:cPriya:parent",
      "project:p2341:child",
    ]);
  });

  test("filterReadable: a readable parent keeps only readable children; an unreadable parent drops its children", () => {
    const rows = [
      { id: "c1", type: "client" as const },
      { id: "p1", type: "project" as const, isChild: true },
      { id: "m1", type: "model" as const },
      { id: "a1", type: "asset" as const, isChild: true },
      { id: "s1", type: "supplier" as const },
    ];
    const readable = new Set(["client", "asset", "supplier"] as const);
    expect(filterReadable(rows, readable).map((r) => r.id)).toEqual(["c1", "s1"]);
  });
});
