// @vitest-environment node
//
// convex/checkItemsWrites.ts + the enriched assignmentsForModel/assignmentsForKit
// reads. Verifies CRUD + audit, the delete usage-guard (model/kit block), sortOrder
// assignment + idempotent add, reorder (no compression on drop), bulk-add dedup,
// per-row org re-check, RBAC (checkItem:*), and the enriched joins.
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
const asUser = { subject: USER, orgId: ORG, role: "admin" };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}
async function seedMember(t: T, role = "admin") {
  await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role }); });
}
const ci = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("checkItems").withIndex("by_cuid", (q) => q.eq("id", id)).first());
async function seedModel(t: T, id: string, org = ORG) { await t.run(async (ctx) => { await ctx.db.insert("models", { id, organizationId: org, name: "Model " + id }); }); }
async function seedKit(t: T, id: string, org = ORG) { await t.run(async (ctx) => { await ctx.db.insert("kits", { id, organizationId: org, assetTag: "KIT-" + id, name: "Kit " + id }); }); }
async function seedCheckItem(t: T, id: string, org = ORG) { await t.run(async (ctx) => { await ctx.db.insert("checkItems", { id, organizationId: org, label: "Chk " + id, type: "PASS_FAIL", createdAt: NOW, updatedAt: NOW }); }); }

describe("checkItem library writes", () => {
  test("create (dup-guarded) → update (set/clear) → delete", async () => {
    const t = makeT(); await seedMember(t);
    await t.withIdentity(asUser).mutation(api.checkItemsWrites.createCheckItemNative, { id: "c1", orgId: ORG, label: "Torque", type: "MEASUREMENT", measurementMin: 1, now: NOW, actor, auditId: "a1" });
    expect((await ci(t, "c1"))?.label).toBe("Torque");
    // dup id rejected
    await expect(t.withIdentity(asUser).mutation(api.checkItemsWrites.createCheckItemNative, { id: "c1", orgId: ORG, label: "x", now: NOW, actor, auditId: "a2" })).rejects.toThrow(/already exists/i);
    // update clears measurementMin (absent optional → undefined)
    await t.withIdentity(asUser).mutation(api.checkItemsWrites.updateCheckItemNative, { id: "c1", orgId: ORG, label: "Torque v2", type: "PASS_FAIL", now: NOW + 1, actor, auditId: "a3" });
    const upd = await ci(t, "c1");
    expect(upd?.label).toBe("Torque v2");
    expect(upd?.measurementMin).toBeUndefined();
    await t.withIdentity(asUser).mutation(api.checkItemsWrites.deleteCheckItemNative, { id: "c1", orgId: ORG, now: NOW + 2, actor, auditId: "a4" });
    expect(await ci(t, "c1")).toBeNull();
  });

  test("delete blocked while assigned to a model or kit", async () => {
    const t = makeT(); await seedMember(t); await seedCheckItem(t, "c1"); await seedModel(t, "mdl1");
    await t.run(async (ctx) => { await ctx.db.insert("modelCheckItems", { id: "mc1", organizationId: ORG, modelId: "mdl1", checkItemId: "c1", sortOrder: 0, createdAt: NOW }); });
    await expect(t.withIdentity(asUser).mutation(api.checkItemsWrites.deleteCheckItemNative, { id: "c1", orgId: ORG, now: NOW, actor, auditId: "a1" })).rejects.toThrow(/used by 1 model/i);
  });

  test("empty label + cross-org update rejected; viewer RBAC rejected", async () => {
    const t = makeT(); await seedMember(t); await seedCheckItem(t, "cX", OTHER);
    await expect(t.withIdentity(asUser).mutation(api.checkItemsWrites.createCheckItemNative, { id: "c9", orgId: ORG, label: "  ", now: NOW, actor, auditId: "a1" })).rejects.toThrow(/Label is required/i);
    await expect(t.withIdentity(asUser).mutation(api.checkItemsWrites.updateCheckItemNative, { id: "cX", orgId: ORG, label: "hijack", now: NOW, actor, auditId: "a2" })).rejects.toThrow(/not found/i);
    await t.run(async (ctx) => { const m = await ctx.db.query("members").withIndex("by_cuid", (q) => q.eq("id", "m1")).first(); if (m) await ctx.db.patch(m._id, { role: "viewer" }); });
    await expect(t.withIdentity({ subject: USER, orgId: ORG, role: "viewer" }).mutation(api.checkItemsWrites.createCheckItemNative, { id: "c9", orgId: ORG, label: "X", now: NOW, actor, auditId: "a3" })).rejects.toThrow(/Forbidden|permission/i);
  });

  // R-8.6.2 — a direct-mutation caller (bypassing checkItemSchema.parse() in the
  // browser hook) must still hit the same business-constraint bounds server-side.
  test("rejects a label over the 200-char bound", async () => {
    const t = makeT(); await seedMember(t);
    await expect(
      t.withIdentity(asUser).mutation(api.checkItemsWrites.createCheckItemNative, { id: "c1", orgId: ORG, label: "X".repeat(201), now: NOW, actor, auditId: "a1" }),
    ).rejects.toThrow(/label/);
  });

  test("rejects a description over the 1000-char bound", async () => {
    const t = makeT(); await seedMember(t);
    await expect(
      t.withIdentity(asUser).mutation(api.checkItemsWrites.createCheckItemNative, { id: "c1", orgId: ORG, label: "Torque", description: "X".repeat(1001), now: NOW, actor, auditId: "a1" }),
    ).rejects.toThrow(/description/);
  });

  test("rejects a category over the 100-char bound", async () => {
    const t = makeT(); await seedMember(t);
    await expect(
      t.withIdentity(asUser).mutation(api.checkItemsWrites.createCheckItemNative, { id: "c1", orgId: ORG, label: "Torque", category: "X".repeat(101), now: NOW, actor, auditId: "a1" }),
    ).rejects.toThrow(/category/);
  });

  test("rejects a measurementUnit over the 20-char bound", async () => {
    const t = makeT(); await seedMember(t);
    await expect(
      t.withIdentity(asUser).mutation(api.checkItemsWrites.createCheckItemNative, { id: "c1", orgId: ORG, label: "Torque", measurementUnit: "X".repeat(21), now: NOW, actor, auditId: "a1" }),
    ).rejects.toThrow(/measurementUnit/);
  });

  test("rejects a dropdownOptions entry with an empty label", async () => {
    const t = makeT(); await seedMember(t);
    await expect(
      t.withIdentity(asUser).mutation(api.checkItemsWrites.createCheckItemNative, {
        id: "c1", orgId: ORG, label: "Condition", type: "DROPDOWN",
        dropdownOptions: [{ label: "Good", isFail: false }, { label: "", isFail: true }],
        now: NOW, actor, auditId: "a1",
      }),
    ).rejects.toThrow(/dropdownOptions/);
  });

  // Same bound, enforced on updateCheckItemNative too (not just create).
  test("rejects a label over the 200-char bound on update", async () => {
    const t = makeT(); await seedMember(t); await seedCheckItem(t, "c1");
    await expect(
      t.withIdentity(asUser).mutation(api.checkItemsWrites.updateCheckItemNative, { id: "c1", orgId: ORG, label: "X".repeat(201), now: NOW, actor, auditId: "a1" }),
    ).rejects.toThrow(/label/);
  });
});

describe("model assignments", () => {
  test("add assigns next sortOrder + idempotent; reorder keeps positions on drop", async () => {
    const t = makeT(); await seedMember(t); await seedModel(t, "mdl1"); await seedCheckItem(t, "a"); await seedCheckItem(t, "b"); await seedCheckItem(t, "c");
    await t.withIdentity(asUser).mutation(api.checkItemsWrites.addCheckItemToModelNative, { id: "r1", orgId: ORG, modelId: "mdl1", checkItemId: "a", now: NOW, actor, auditId: "x1" });
    await t.withIdentity(asUser).mutation(api.checkItemsWrites.addCheckItemToModelNative, { id: "r2", orgId: ORG, modelId: "mdl1", checkItemId: "b", now: NOW, actor, auditId: "x2" });
    // idempotent re-add of "a" — no new row
    await t.withIdentity(asUser).mutation(api.checkItemsWrites.addCheckItemToModelNative, { id: "r1dup", orgId: ORG, modelId: "mdl1", checkItemId: "a", now: NOW, actor, auditId: "x3" });
    let rows = await t.withIdentity(asUser).query(api.modelCheckItems.assignmentsForModel, { orgId: ORG, modelId: "mdl1" });
    expect(rows.map((r) => r.checkItem.id)).toEqual(["a", "b"]);
    // reorder to [b, a] — but include an unknown id "c" (not assigned) → survivors keep index positions
    await t.withIdentity(asUser).mutation(api.checkItemsWrites.reorderModelCheckItemsNative, { orgId: ORG, modelId: "mdl1", orderedCheckItemIds: ["b", "c", "a"] });
    rows = await t.withIdentity(asUser).query(api.modelCheckItems.assignmentsForModel, { orgId: ORG, modelId: "mdl1" });
    expect(rows.map((r) => r.checkItem.id)).toEqual(["b", "a"]); // b@0, a@2 → sorted b,a
  });

  test("remove throws when not assigned; bulk-add dedups + counts", async () => {
    const t = makeT(); await seedMember(t); await seedModel(t, "m1"); await seedModel(t, "m2"); await seedCheckItem(t, "a"); await seedCheckItem(t, "b");
    await expect(t.withIdentity(asUser).mutation(api.checkItemsWrites.removeCheckItemFromModelNative, { orgId: ORG, modelId: "m1", checkItemId: "a", now: NOW, actor, auditId: "x1" })).rejects.toThrow(/not assigned/i);
    // pre-assign a→m1 so bulk dedups it
    await t.run(async (ctx) => { await ctx.db.insert("modelCheckItems", { id: "pre", organizationId: ORG, modelId: "m1", checkItemId: "a", sortOrder: 0, createdAt: NOW }); });
    const res = await t.withIdentity(asUser).mutation(api.checkItemsWrites.bulkAddCheckItemsToModelsNative, {
      orgId: ORG, modelIds: ["m1", "m2"], checkItemIds: ["a", "b"],
      rowIds: ["ra", "rb", "rc", "rd"], now: NOW, actor, auditId: "bulk",
    });
    // m1: a already there (skip) + b (new); m2: a + b (new) = 3 created
    expect(res.count).toBe(3);
    expect(res.modelNames.length).toBe(2);
  });
});

describe("kit assignments", () => {
  test("add + enriched read + remove", async () => {
    const t = makeT(); await seedMember(t); await seedKit(t, "k1"); await seedCheckItem(t, "a");
    await t.withIdentity(asUser).mutation(api.checkItemsWrites.addCheckItemToKitNative, { id: "kr1", orgId: ORG, kitId: "k1", checkItemId: "a", now: NOW, actor, auditId: "x1" });
    const rows = await t.withIdentity(asUser).query(api.kitCheckItems.assignmentsForKit, { orgId: ORG, kitId: "k1" });
    expect(rows.map((r) => r.checkItem.id)).toEqual(["a"]);
    await t.withIdentity(asUser).mutation(api.checkItemsWrites.removeCheckItemFromKitNative, { orgId: ORG, kitId: "k1", checkItemId: "a", now: NOW, actor, auditId: "x2" });
    const after = await t.withIdentity(asUser).query(api.kitCheckItems.assignmentsForKit, { orgId: ORG, kitId: "k1" });
    expect(after).toHaveLength(0);
  });

  test("assignmentsForModel excludes a foreign-org checkItem row", async () => {
    const t = makeT(); await seedMember(t); await seedModel(t, "m1"); await seedCheckItem(t, "mine"); await seedCheckItem(t, "theirs", OTHER);
    await t.run(async (ctx) => {
      await ctx.db.insert("modelCheckItems", { id: "r1", organizationId: ORG, modelId: "m1", checkItemId: "mine", sortOrder: 0, createdAt: NOW });
      // a stray row pointing at another org's checkItem — join must drop it
      await ctx.db.insert("modelCheckItems", { id: "r2", organizationId: ORG, modelId: "m1", checkItemId: "theirs", sortOrder: 1, createdAt: NOW });
    });
    const rows = await t.withIdentity(asUser).query(api.modelCheckItems.assignmentsForModel, { orgId: ORG, modelId: "m1" });
    expect(rows.map((r) => r.checkItem.id)).toEqual(["mine"]);
  });
});
