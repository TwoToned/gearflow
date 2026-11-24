// @vitest-environment node
//
// The job page (`projectDetail.bundle`, also MCP `get_project` and Mira) and the
// warehouse page (`warehouseDetail.bundle`) carry the project row, so its
// JOB-LEVEL cost and margin follow the job-cost rule (owner ruling 2026-11-24,
// `canSeeJobCost`: invoice:read and not a noFinancials key) — absent, never
// zeroed, for everyone else.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1", USER = "user_1", KEY = "key_1";
const asUser = { subject: USER, orgId: ORG };
const asAgent = { subject: USER, orgId: ORG, akid: KEY };
const JOB_COST = ["serviceCostTotal", "labourCostTotal", "margin"];

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

async function seed(role: string, key?: { noFinancials: boolean; scopes?: string[] }): Promise<T> {
  const t = makeT();
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role });
    await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
    if (key) {
      await ctx.db.insert("apiKeys", {
        id: KEY, organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h",
        scopes: JSON.stringify(key.scopes ?? ["*"]), isActive: true, actingUserId: USER, createdById: USER, noFinancials: key.noFinancials,
      });
    }
    await ctx.db.insert("projects", {
      id: "p1", organizationId: ORG, projectNumber: "2341", name: "Launch", status: "CONFIRMED", isTemplate: false, liveVersionId: "v1",
      total: 5000, subtotal: 4545, serviceCostTotal: 650, labourCostTotal: 300, margin: 4050, equipmentRevenue: 4000,
    } as never);
    await ctx.db.insert("projectVersions", { id: "v1", organizationId: ORG, projectId: "p1", number: 1, contentState: "ready", createdAt: 1, createdById: USER } as never);
  });
  return t;
}

const bundles = async (t: T, who = asUser) => {
  const c = t.withIdentity(who);
  const detail = (await c.query(api.projectDetail.bundle, { projectId: "p1", orgId: ORG }))!.project as Record<string, unknown>;
  const warehouse = (await c.query(api.warehouseDetail.bundle, { projectId: "p1", orgId: ORG }))!.project as Record<string, unknown>;
  return [detail, warehouse];
};

describe("the job and warehouse bundles follow the job-cost rule", () => {
  test("a member with invoice:read gets job cost and margin on both", async () => {
    for (const p of await bundles(await seed("member"))) expect(p).toMatchObject({ serviceCostTotal: 650, labourCostTotal: 300, margin: 4050 });
  });

  test("the built-in warehouse and viewer roles HOLD invoice:read (permissionsCore), so they see it too", async () => {
    for (const role of ["warehouse", "viewer"]) {
      for (const p of await bundles(await seed(role))) expect(p, role).toMatchObject({ margin: 4050 });
    }
  });

  test("a caller without invoice:read (a key scoped to project only) gets the three ABSENT; the rest of the row stays", async () => {
    for (const p of await bundles(await seed("owner", { noFinancials: false, scopes: ["project:read"] }), asAgent)) {
      for (const f of JOB_COST) expect(p, f).not.toHaveProperty(f);
      expect(p).toMatchObject({ id: "p1", total: 5000, equipmentRevenue: 4000 });
    }
  });

  test("a noFinancials key, even as an owner with every scope, gets the three ABSENT", async () => {
    for (const p of await bundles(await seed("owner", { noFinancials: true }), asAgent)) {
      for (const f of JOB_COST) expect(p, f).not.toHaveProperty(f);
    }
  });
});
