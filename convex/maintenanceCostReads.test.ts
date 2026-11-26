// @vitest-environment node
//
// UX Phase 14 (14b-3 review, HIGH 2 / MEDIUM 4): a maintenance record's labour (`cost`) is JOB cost. Every read that
// returns a maintenance row or sums its cost follows ONE rule, `canSeeJobCost` (`invoice:read` and not a `noFinancials`
// key), and hides it ABSENT, never zeroed: the asset page bundle, the record reads, and the project's operational costs.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const USER = "user_1";
const asUser = { subject: USER, orgId: ORG };
const asAgent = { subject: USER, orgId: ORG, akid: "key_1" };
const LABOUR = 4321;

async function seed(): Promise<T> {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("apiKeys", { id: "key_1", organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h", scopes: JSON.stringify(["*"]), isActive: true, actingUserId: USER, createdById: USER, noFinancials: true });
    await ctx.db.insert("assets", { id: "a1", organizationId: ORG, assetTag: "A-1", modelId: "mod", status: "AVAILABLE", isActive: true, updatedAt: 1 } as never);
    await ctx.db.insert("models", { id: "mod", organizationId: ORG, name: "Model", isActive: true, updatedAt: 1 } as never);
    await ctx.db.insert("maintenanceRecords", { id: "r1", organizationId: ORG, type: "REPAIR", title: "Fix desk", status: "COMPLETED", cost: LABOUR, projectId: "p1", createdAt: 1, updatedAt: 1 } as never);
    await ctx.db.insert("maintenanceRecordAssets", { id: "l1", maintenanceRecordId: "r1", assetId: "a1", kind: "LINK" });
  });
  return t;
}

describe("asset page bundle: maintenance labour", () => {
  const bundle = (t: T, who: typeof asUser | typeof asAgent) => t.withIdentity(who).query(api.assetDetail.bundle, { assetId: "a1", orgId: ORG });

  test("an owner reads the labour; a noFinancials key reads the record with NO cost key", async () => {
    const t = await seed();
    const mine = await bundle(t, asUser);
    expect(mine?.maintenanceRecords[0].cost).toBe(LABOUR);
    const theirs = await bundle(t, asAgent);
    expect(theirs?.maintenanceRecords).toHaveLength(1);
    expect(theirs?.maintenanceRecords[0].title).toBe("Fix desk");
    expect("cost" in theirs!.maintenanceRecords[0]).toBe(false);
    expect(JSON.stringify(theirs)).not.toContain(String(LABOUR));
  });

  test("a role without invoice:read (not a key) also loses it: the rule is job cost, not gear cost", async () => {
    const t = await seed();
    await t.run(async (ctx) => {
      const m = await ctx.db.query("members").first();
      await ctx.db.patch(m!._id, { role: "custom:legacy" });
    });
    const res = await bundle(t, asUser).catch(() => null);
    // A role that cannot even read assets is refused; one that can must not see the labour.
    if (res) expect("cost" in res.maintenanceRecords[0]).toBe(false);
  });
});

describe("project operational costs: maintenance labour", () => {
  const costs = (t: T, who: typeof asUser | typeof asAgent) => t.withIdentity(who).query(api.projectCosts.operationalCosts, { projectId: "p1", orgId: ORG });

  test("a noFinancials key gets the all-zero shape; an owner's total includes the labour", async () => {
    const t = await seed();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, name: "J", projectNumber: "P-1", status: "CONFIRMED", liveVersionId: "v-p1", total: 0, taxAmount: 0, updatedAt: 1 } as never);
    });
    expect((await costs(t, asUser)).maintenanceCostTotal).toBe(LABOUR);
    const hidden = await costs(t, asAgent);
    expect(hidden.maintenanceCostTotal).toBe(0);
    expect(hidden.counts.maintenanceRecords).toBe(0);
  });
});

describe("maintenanceRecords reads", () => {
  test("list / getById / recordDetail carry no cost key for a noFinancials key", async () => {
    const t = await seed();
    const a = t.withIdentity(asAgent);
    const list = await a.query(api.maintenanceRecords.list, { orgId: ORG });
    expect(JSON.stringify(list)).not.toContain(String(LABOUR));
    const one = await a.query(api.maintenanceRecords.getById, { id: "r1" });
    expect(one && "cost" in one).toBe(false);
    const detail = await a.query(api.maintenanceRecords.recordDetail, { orgId: ORG, id: "r1" });
    expect(JSON.stringify(detail)).not.toContain(String(LABOUR));
  });
});
