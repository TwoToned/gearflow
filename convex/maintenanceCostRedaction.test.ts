// @vitest-environment node
//
// UX Phase 14 (14b-3, D76): a maintenance record's `cost` is its LABOUR, which is job cost. For a `noFinancials` key
// it is ABSENT (never zeroed) from every read that returns it, and ordering by it must not leak it.
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

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("apiKeys", { id: "key_1", organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h", scopes: JSON.stringify(["*"]), isActive: true, actingUserId: USER, createdById: USER, noFinancials: true });
    // Created oldest-first; the labour is in the OPPOSITE order (the newest is the cheapest), so a leak by sort is visible.
    for (const [i, cost] of [[1, 300], [2, 200], [3, 100]] as const) {
      await ctx.db.insert("maintenanceRecords", { id: `r${i}`, organizationId: ORG, type: "REPAIR", title: `Job ${i}`, status: "SCHEDULED", cost, createdAt: i * 1000, updatedAt: i * 1000 } as never);
    }
  });
}

describe("maintenance labour cost on reads", () => {
  test("a user sees it on every read; a noFinancials key sees the key ABSENT on every read", async () => {
    const t = makeT();
    await seed(t);
    const u = t.withIdentity(asUser);
    const k = t.withIdentity(asAgent);
    expect((await u.query(api.maintenanceRecords.getById, { id: "r1" }))?.cost).toBe(300);
    expect((await u.query(api.maintenanceRecords.recordDetail, { orgId: ORG, id: "r1" }))?.cost).toBe(300);
    expect((await u.query(api.maintenanceRecords.list, { orgId: ORG })).every((r) => r.cost != null)).toBe(true);
    expect((await u.query(api.maintenanceRecords.recordsPage, { orgId: ORG })).records.every((r) => r.cost != null)).toBe(true);

    expect(await k.query(api.maintenanceRecords.getById, { id: "r1" })).not.toHaveProperty("cost");
    expect(await k.query(api.maintenanceRecords.recordDetail, { orgId: ORG, id: "r1" })).not.toHaveProperty("cost");
    for (const r of await k.query(api.maintenanceRecords.list, { orgId: ORG })) expect(r).not.toHaveProperty("cost");
    for (const r of (await k.query(api.maintenanceRecords.recordsPage, { orgId: ORG })).records) expect(r).not.toHaveProperty("cost");
  });

  test("a hidden cost is not a sort key: ordering by it gives the same order as by creation, whatever the costs are", async () => {
    const t = makeT();
    await seed(t);
    const k = t.withIdentity(asAgent);
    const ids = async (sortBy: string) => (await k.query(api.maintenanceRecords.recordsPage, { orgId: ORG, sortBy, sortOrder: "asc" })).records.map((r) => r.id);
    expect(await ids("cost")).toEqual(await ids("createdAt")); // not r3, r2, r1 (the cost order)
    const u = t.withIdentity(asUser);
    const byCost = (await u.query(api.maintenanceRecords.recordsPage, { orgId: ORG, sortBy: "cost", sortOrder: "asc" })).records.map((r) => r.id);
    expect(byCost).toEqual(["r3", "r2", "r1"]); // a user still sorts by it
  });
});
