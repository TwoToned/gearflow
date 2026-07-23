// @vitest-environment node
//
// convex/modelBulkAccessoriesWrites.ts — browser-direct model-level bulk-accessory
// writes. Verifies: per-row org re-check on model + bulk asset + accessory row, the
// dup guard + sortOrder computation at the boundary, quantity validation, RBAC
// (model:update), cross-tenant rejection, and atomic audit.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const actor = { userId: USER, userName: "Alice" };
const asUser = { subject: USER, orgId: ORG };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seed(t: T, opts: { modelOrg?: string; bulkOrg?: string } = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("models", { id: "mdl", organizationId: opts.modelOrg ?? ORG, name: "IMX6A" });
    await ctx.db.insert("bulkAssets", { id: "ba1", organizationId: opts.bulkOrg ?? ORG, modelId: "mc", assetTag: "MICON-1" });
    await ctx.db.insert("bulkAssets", { id: "ba2", organizationId: opts.bulkOrg ?? ORG, modelId: "cl", assetTag: "CLAMP-1" });
  });
}

const add = (t: T, over: Record<string, unknown> = {}, id: { subject: string; orgId: string; role?: string } = asUser) =>
  t.withIdentity(id).mutation(api.modelBulkAccessoriesWrites.addNative, {
    id: "acc1", modelId: "mdl", orgId: ORG, bulkAssetId: "ba1", quantity: 1, now: NOW, actor, auditId: "a1", ...over,
  });

const listAcc = (t: T) =>
  t.run(async (ctx) => ctx.db.query("modelBulkAccessories").withIndex("by_modelId", (q) => q.eq("modelId", "mdl")).collect());

describe("modelBulkAccessoriesWrites", () => {
  test("add assigns sortOrder, remove deletes, both audit", async () => {
    const t = makeT(); await seed(t);
    await add(t, { id: "acc1", bulkAssetId: "ba1" });
    await add(t, { id: "acc2", bulkAssetId: "ba2", quantity: 2, auditId: "a2" });
    const rows = (await listAcc(t)).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    expect(rows.map((r) => [r.bulkAssetId, r.sortOrder])).toEqual([["ba1", 0], ["ba2", 1]]);
    expect(rows.find((r) => r.id === "acc1")?.addedById).toBe(USER);

    await t.withIdentity(asUser).mutation(api.modelBulkAccessoriesWrites.removeNative, {
      modelId: "mdl", orgId: ORG, accessoryId: "acc1", now: NOW + 1, actor, auditId: "a3",
    });
    expect((await listAcc(t)).map((r) => r.id)).toEqual(["acc2"]);

    const logs = await t.run(async (ctx) =>
      ctx.db.query("activityLogs").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect(),
    );
    expect(logs.filter((l) => /default accessory/i.test(l.summary ?? "")).length).toBe(3);
  });

  test("rejects a duplicate bulk asset on the same model", async () => {
    const t = makeT(); await seed(t);
    await add(t, { id: "acc1", bulkAssetId: "ba1" });
    await expect(add(t, { id: "acc2", bulkAssetId: "ba1", auditId: "a2" })).rejects.toThrow(/already a default/i);
  });

  test("rejects a non-positive / non-integer quantity", async () => {
    const t = makeT(); await seed(t);
    await expect(add(t, { quantity: 0 })).rejects.toThrow(/at least 1/i);
    await expect(add(t, { quantity: 1.5 })).rejects.toThrow(/whole number/i);
  });

  test("rejects an over-long note at the boundary", async () => {
    const t = makeT(); await seed(t);
    await expect(add(t, { notes: "x".repeat(501) })).rejects.toThrow(/500 characters/i);
  });

  // R-8.6.2 — a direct-mutation caller (bypassing modelBulkAccessorySchema.parse() in
  // the browser hook) must still hit the same business-constraint bounds server-side.
  test("rejects an empty bulkAssetId before the DB lookup", async () => {
    const t = makeT(); await seed(t);
    await expect(add(t, { bulkAssetId: "" })).rejects.toThrow(/bulkAssetId/);
  });

  test("rejects a model in another org", async () => {
    const t = makeT(); await seed(t, { modelOrg: OTHER });
    await expect(add(t)).rejects.toThrow(/Model not found/i);
  });

  test("rejects a bulk asset in another org", async () => {
    const t = makeT(); await seed(t, { bulkOrg: OTHER });
    await expect(add(t)).rejects.toThrow(/Bulk asset not found/i);
  });

  test("remove rejects an accessory whose org/model doesn't match", async () => {
    const t = makeT(); await seed(t);
    // An accessory row in another org sharing nothing with the caller.
    await t.run(async (ctx) => {
      await ctx.db.insert("modelBulkAccessories", { id: "accX", organizationId: OTHER, modelId: "mdl", bulkAssetId: "ba1", quantity: 1, addedById: "x" });
    });
    await expect(
      t.withIdentity(asUser).mutation(api.modelBulkAccessoriesWrites.removeNative, {
        modelId: "mdl", orgId: ORG, accessoryId: "accX", now: NOW, actor, auditId: "a9",
      }),
    ).rejects.toThrow(/not on this model/i);
  });

  test("rejects a member without model:update permission", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      const m = await ctx.db.query("members").withIndex("by_cuid", (q) => q.eq("id", "m1")).first();
      if (m) await ctx.db.patch(m._id, { role: "viewer" });
    });
    await expect(add(t, {}, { subject: USER, orgId: ORG, role: "viewer" })).rejects.toThrow(/Forbidden|permission/i);
  });
});
