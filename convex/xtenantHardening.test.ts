// @vitest-environment node
//
// Regression tests for the Phase-3 cross-tenant hardening pass:
//  (1) the `listBy<FK>` read queries now org-filter global-index results (a member of
//      org A supplying a foreign FK must NOT receive org B's rows);
//  (2) the client-minted-id createNative mutations now dup-guard by_cuid.
// Representative coverage of each class (the fix is identical across all sites).
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const A = "org_A";
const B = "org_B";
const USER = "user_1";
const asA = { subject: USER, orgId: A, role: "admin" };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}
async function member(t: T, org: string, role = "admin") {
  await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m-" + org, organizationId: org, userId: USER, role }); });
}

describe("read-leak org filter", () => {
  test("projectManagers.listByProject excludes a foreign-org row sharing the projectId", async () => {
    const t = makeT(); await member(t, A);
    await t.run(async (ctx) => {
      // Same projectId cuid appears in BOTH orgs (the collision the global by_projectId index exposes).
      await ctx.db.insert("projectManagers", { id: "pmA", organizationId: A, projectId: "p1", userId: USER });
      await ctx.db.insert("projectManagers", { id: "pmB", organizationId: B, projectId: "p1", userId: "victim" });
    });
    const rows = await t.withIdentity(asA).query(api.projectManagers.listByProject, { orgId: A, projectId: "p1" });
    expect(rows.map((r) => r.id)).toEqual(["pmA"]); // org B's row NOT leaked
  });

  test("assets.listByModel excludes a foreign-org asset sharing the modelId", async () => {
    const t = makeT(); await member(t, A);
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "aA", organizationId: A, assetTag: "A1", modelId: "m1" });
      await ctx.db.insert("assets", { id: "aB", organizationId: B, assetTag: "B1", modelId: "m1" });
    });
    const rows = await t.withIdentity(asA).query(api.assets.listByModel, { orgId: A, modelId: "m1" });
    expect(rows.map((r) => r.id)).toEqual(["aA"]);
  });

  test("subHires.listByProject excludes a foreign-org sub-hire sharing the projectId", async () => {
    const t = makeT(); await member(t, A);
    await t.run(async (ctx) => {
      await ctx.db.insert("subHires", { id: "shA", organizationId: A, projectId: "p1", supplierId: "s", createdById: USER, orderNumber: "SH-A" });
      await ctx.db.insert("subHires", { id: "shB", organizationId: B, projectId: "p1", supplierId: "s", createdById: "victim", orderNumber: "SH-B" });
    });
    const rows = await t.withIdentity(asA).query(api.subHires.listByProject, { orgId: A, projectId: "p1" });
    expect(rows.map((r) => r.id)).toEqual(["shA"]);
  });
});

describe("read-leak org filter — agent identity (R-8.4.3, #998)", () => {
  // Same class of bug, the API/MCP path: `assets.listByModel` migrated from
  // `requireOrgRead` to `requireOrgReadFor(ctx, orgId, "asset")` in the Phase 2
  // read bootstrap (#998), which makes it agent-reachable for the first time.
  // The `by_modelId` index it reads is GLOBAL — the org re-check inside the
  // handler is what stops a cross-tenant leak, and that re-check has to hold
  // for an agent token exactly as it does for a user token above. `asset:read`
  // is the narrowest scope that can even reach this query — proves the leak
  // can't be reached by under-scoping either.
  const KEY = "key_1";
  const asAgentA = { subject: USER, orgId: A, akid: KEY };

  async function agentMember(t: T, org: string, role = "admin") {
    await member(t, org, role);
    await t.run(async (ctx) => {
      await ctx.db.insert("apiKeys", {
        id: KEY, organizationId: org, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h",
        scopes: JSON.stringify(["asset:read"]), isActive: true, actingUserId: USER, createdById: USER,
      });
    });
  }

  test("assets.listByModel excludes a foreign-org asset sharing the modelId, for an agent token", async () => {
    const t = makeT(); await agentMember(t, A);
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "aA", organizationId: A, assetTag: "A1", modelId: "m1" });
      await ctx.db.insert("assets", { id: "aB", organizationId: B, assetTag: "B1", modelId: "m1" });
    });
    const rows = await t.withIdentity(asAgentA).query(api.assets.listByModel, { orgId: A, modelId: "m1" });
    expect(rows.map((r) => r.id)).toEqual(["aA"]);
  });

  test("...and organizationId in the request naming the OTHER org doesn't widen it either", async () => {
    const t = makeT(); await agentMember(t, A);
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "aA", organizationId: A, assetTag: "A1", modelId: "m1" });
      await ctx.db.insert("assets", { id: "aB", organizationId: B, assetTag: "B1", modelId: "m1" });
    });
    // The agent's own orgId (from the key) is A; asking for B outright is a
    // hard org mismatch the guard rejects before the query even runs.
    await expect(
      t.withIdentity(asAgentA).query(api.assets.listByModel, { orgId: B, modelId: "m1" }),
    ).rejects.toThrow(/organization mismatch/i);
  });
});

describe("create dup-guard", () => {
  test("clientWrites.createNative rejects a colliding cuid (idempotency + cross-org DoS guard)", async () => {
    const t = makeT(); await member(t, A);
    const actor = { userId: USER, userName: "A" };
    await t.withIdentity(asA).mutation(api.clientWrites.createNative, { id: "c1", organizationId: A, name: "Acme", actor, auditId: "x1" });
    await expect(
      t.withIdentity(asA).mutation(api.clientWrites.createNative, { id: "c1", organizationId: A, name: "Dup", actor, auditId: "x2" }),
    ).rejects.toThrow(/already exists/i);
  });
});
