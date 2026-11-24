// @vitest-environment node
//
// globalSearch.search's role filter, in place (UX Phase 11 review). Every
// built-in role reads all 14 result types, so role fixtures that each lack a
// resource or two are added to the live role table for this file. Pinned:
//   • the server drops an unreadable type, as a parent and as a child (remove
//     either `readable.has` check in `filterReadable` and a test fails);
//   • a readable record under an unreadable parent keeps its own top-level row
//     (the child dedupe counts only readable parents).
import { convexTest, type TestConvex } from "convex-test";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { rolePermissions } from "./lib/permissionsCore";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const NO_CLIENTS = "test-no-clients";
const NO_JOBS_OR_LOCATIONS = "test-no-jobs-or-locations";
const NO_MODELS = "test-no-models";
const NO_KITS = "test-no-kits";

beforeAll(() => {
  rolePermissions[NO_CLIENTS] = { ...rolePermissions.member, client: [] };
  rolePermissions[NO_JOBS_OR_LOCATIONS] = { ...rolePermissions.member, project: [], location: [] };
  rolePermissions[NO_MODELS] = { ...rolePermissions.member, model: [] };
  rolePermissions[NO_KITS] = { ...rolePermissions.member, kit: [] };
});
afterAll(() => {
  delete rolePermissions[NO_CLIENTS];
  delete rolePermissions[NO_JOBS_OR_LOCATIONS];
  delete rolePermissions[NO_MODELS];
  delete rolePermissions[NO_KITS];
});

async function makeT(role: string): Promise<T> {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role });
    await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Hilton Sydney", isActive: true });
    await ctx.db.insert("projects", {
      id: "p1", organizationId: ORG, projectNumber: "2341", name: "Hilton gala dinner", clientId: "c1",
      status: "CONFIRMED", isTemplate: false, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "Aura", isActive: true, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("locations", { id: "l1", organizationId: ORG, name: "Hilton store room" });
    await ctx.db.insert("assets", {
      id: "a1", organizationId: ORG, modelId: "m1", assetTag: "AURA-01", status: "AVAILABLE", isActive: true,
      locationId: "l1", createdAt: NOW, updatedAt: NOW,
    });
  });
  return t;
}

const search = (t: T) => t.withIdentity({ subject: USER, orgId: ORG }).query(api.globalSearch.search, { orgId: ORG, query: "hilton" });
const rows = (r: { results: { type: string; id: string; isChild?: boolean }[] }) =>
  r.results.map((x) => `${x.type}:${x.id}${x.isChild ? ":child" : ""}`).sort();

describe("globalSearch.search — role filter in place", () => {
  test("a member sees the client with its job, and the location with its asset", async () => {
    const t = await makeT("member");
    expect(rows(await search(t))).toEqual(["asset:a1:child", "client:c1", "location:l1", "project:p1:child"]);
  });

  test("an unreadable CHILD type is dropped under a readable parent; an unreadable PARENT takes its children", async () => {
    const t = await makeT(NO_JOBS_OR_LOCATIONS);
    const r = await search(t);
    // No job under the client; no location, and so no orphaned asset row from under it.
    expect(rows(r)).toEqual(["client:c1"]);
    expect(r.groups.map((g) => g.type)).toEqual(["client"]);
  });

  test("a readable job under an unreadable client is not lost: it stands on its own", async () => {
    const t = await makeT(NO_CLIENTS);
    expect(rows(await search(t))).toEqual(["asset:a1:child", "location:l1", "project:p1"]);
  });
});

describe("globalSearch.search — the child dedupe counts only READABLE model and kit parents", () => {
  const searchFor = (t: T, query: string) => t.withIdentity({ subject: USER, orgId: ORG }).query(api.globalSearch.search, { orgId: ORG, query });

  async function withKit(role: string): Promise<T> {
    const t = await makeT(role);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m2", organizationId: ORG, name: "Truss", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("assets", { id: "a2", organizationId: ORG, modelId: "m2", assetTag: "RIG-02", status: "AVAILABLE", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "RIG-K1", name: "Rig kit", isActive: true, createdAt: NOW, updatedAt: NOW } as never);
      await ctx.db.insert("kitSerializedItems", { id: "ki1", organizationId: ORG, kitId: "k1", assetId: "a2", sortOrder: 0, addedById: USER });
    });
    return t;
  }

  test("model: a member sees the asset under its model; without `model` the asset stands on its own", async () => {
    expect(rows(await searchFor(await makeT("member"), "aura"))).toEqual(["asset:a1:child", "model:m1"]);
    expect(rows(await searchFor(await makeT(NO_MODELS), "aura"))).toEqual(["asset:a1"]);
  });

  test("kit: a member sees the asset under its kit; without `kit` the asset stands on its own", async () => {
    expect(rows(await searchFor(await withKit("member"), "rig"))).toEqual(["asset:a2:child", "kit:k1"]);
    expect(rows(await searchFor(await withKit(NO_KITS), "rig"))).toEqual(["asset:a2"]);
  });
});
