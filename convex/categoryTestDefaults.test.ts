// @vitest-environment node
//
// UX Phase 14 (14b-5, D77): a category's optional default Test & tag class + interval, inherited by its OWN models, which
// can override. ONE resolver (`lib/categoryTestDefaults.ts`) feeds every registration path (the backfill, the per-asset
// registration, and the model edit's propagation). A parent category's default is NOT inherited by a subcategory's models.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { effectiveTestDefaults } from "./lib/categoryTestDefaults";
import { registerAssetTestTag } from "./lib/testtagBackfill";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const USER = "user_1";
const asUser = { subject: USER, orgId: ORG };
const NOW = Date.now();

describe("effectiveTestDefaults (pure)", () => {
  test("the model's own value wins per field; otherwise its category's; otherwise nothing", () => {
    expect(effectiveTestDefaults({}, { defaultEquipmentClass: "CLASS_II", defaultTestIntervalMonths: 6 })).toEqual({ equipmentClass: "CLASS_II", classFrom: "category", intervalMonths: 6, intervalFrom: "category" });
    expect(effectiveTestDefaults({ defaultEquipmentClass: "CLASS_I", testAndTagIntervalDays: 90 }, { defaultEquipmentClass: "CLASS_II", defaultTestIntervalMonths: 6 })).toEqual({ equipmentClass: "CLASS_I", classFrom: "model", intervalMonths: 3, intervalFrom: "model" });
    // Per field: a model that sets only its class still takes the category's interval.
    expect(effectiveTestDefaults({ defaultEquipmentClass: "CLASS_I" }, { defaultTestIntervalMonths: 12 })).toMatchObject({ equipmentClass: "CLASS_I", classFrom: "model", intervalMonths: 12, intervalFrom: "category" });
    expect(effectiveTestDefaults({}, null)).toEqual({ equipmentClass: null, classFrom: null, intervalMonths: null, intervalFrom: null });
    expect(effectiveTestDefaults({ testAndTagIntervalDays: 10 }, undefined).intervalMonths).toBe(1); // at least a month
  });
});

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

/** An owner, a parent category with defaults, a child category with none, and a T&T model + asset in each place. */
async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("categories", { id: "parent", organizationId: ORG, name: "Power", defaultEquipmentClass: "CLASS_II", defaultTestIntervalMonths: 6 } as never);
    await ctx.db.insert("categories", { id: "child", organizationId: ORG, name: "Leads", parentId: "parent" } as never);
    await ctx.db.insert("categories", { id: "foreign", organizationId: "org_2", name: "Theirs", defaultEquipmentClass: "LEAD_CORD_ASSEMBLY", defaultTestIntervalMonths: 1 } as never);
    const model = (id: string, extra: Record<string, unknown>) =>
      ctx.db.insert("models", { id, organizationId: ORG, name: id, isActive: true, requiresTestAndTag: true, updatedAt: 1, ...extra } as never);
    await model("m_inherit", { categoryId: "parent" });
    await model("m_override", { categoryId: "parent", defaultEquipmentClass: "CLASS_I", testAndTagIntervalDays: 365 });
    await model("m_sub", { categoryId: "child" });
    await model("m_none", {});
    await model("m_foreign", { categoryId: "foreign" });
    for (const id of ["m_inherit", "m_override", "m_sub", "m_none", "m_foreign"]) {
      await ctx.db.insert("assets", { id: `a_${id}`, organizationId: ORG, assetTag: `T-${id}`, modelId: id, status: "AVAILABLE", isActive: true, updatedAt: 1 } as never);
    }
  });
}
const tt = (t: T, modelId: string) => t.run(async (ctx) => (await ctx.db.query("testTagAssets").withIndex("by_assetId", (q) => q.eq("assetId", `a_${modelId}`)).first())!);

describe("registration reads the category default through the one resolver", () => {
  test("the backfill: a model inherits its OWN category's class and interval; its own value wins; a subcategory does NOT inherit the parent's; nothing set falls back", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(asUser).mutation(api.testTagAssetsWrites.backfillNative, { orgId: ORG, now: NOW });
    expect(await tt(t, "m_inherit")).toMatchObject({ equipmentClass: "CLASS_II", testIntervalMonths: 6 });
    expect(await tt(t, "m_override")).toMatchObject({ equipmentClass: "CLASS_I", testIntervalMonths: 12 });
    expect(await tt(t, "m_sub")).toMatchObject({ equipmentClass: "CLASS_I", testIntervalMonths: 3 }); // not the parent's
    expect(await tt(t, "m_none")).toMatchObject({ equipmentClass: "CLASS_I", testIntervalMonths: 3 });
  });

  test("another org's category is never read, even if a model carries its id", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(asUser).mutation(api.testTagAssetsWrites.backfillNative, { orgId: ORG, now: NOW });
    expect(await tt(t, "m_foreign")).toMatchObject({ equipmentClass: "CLASS_I", testIntervalMonths: 3 });
  });

  test("the per-asset registration reads no default from a category of another org (the loader is org-checked)", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await registerAssetTestTag(ctx, { organizationId: ORG, assetId: "a_m_foreign", assetTag: "T-m_foreign", modelId: "m_foreign" }, NOW);
      await registerAssetTestTag(ctx, { organizationId: ORG, assetId: "a_m_inherit", assetTag: "T-m_inherit", modelId: "m_inherit" }, NOW);
    });
    expect(await tt(t, "m_foreign")).toMatchObject({ equipmentClass: "CLASS_I", testIntervalMonths: 3 });
    expect(await tt(t, "m_inherit")).toMatchObject({ equipmentClass: "CLASS_II", testIntervalMonths: 6 });
  });
});

const modelDoc = (t: T, id: string) => t.run(async (ctx) => (await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).first())!);
const writeModel = (t: T, kind: "createNative" | "updateNative", over: Record<string, unknown>, auditId: string) =>
  t.withIdentity(asUser).mutation(api.modelWrites[kind], { orgId: ORG, now: NOW + 1, actor: { userId: USER, userName: "A" }, auditId, ...over } as never);

describe("a blank class means INHERIT: the model write stores no class unless one was chosen (D77 review)", () => {
  test("createNative with T&T on and no class stores none, so the category's class applies at registration", async () => {
    const t = makeT();
    await seed(t);
    await writeModel(t, "createNative", { id: "m_new", name: "New board", categoryId: "parent", requiresTestAndTag: true }, "c1");
    expect((await modelDoc(t, "m_new")).defaultEquipmentClass).toBeUndefined();
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "a_m_new", organizationId: ORG, assetTag: "T-new", modelId: "m_new", status: "AVAILABLE", isActive: true, updatedAt: 1 } as never);
    });
    await t.withIdentity(asUser).mutation(api.testTagAssetsWrites.backfillNative, { orgId: ORG, now: NOW });
    expect(await tt(t, "m_new")).toMatchObject({ equipmentClass: "CLASS_II", testIntervalMonths: 6 });
  });

  test("updateNative with no class stores none; one the caller chose is the model's own and wins", async () => {
    const t = makeT();
    await seed(t);
    await writeModel(t, "updateNative", { id: "m_inherit", name: "m_inherit", categoryId: "parent", requiresTestAndTag: true }, "u1");
    expect((await modelDoc(t, "m_inherit")).defaultEquipmentClass).toBeUndefined();
    await writeModel(t, "updateNative", { id: "m_inherit", name: "m_inherit", categoryId: "parent", requiresTestAndTag: true, defaultEquipmentClass: "CLASS_I" }, "u2");
    expect((await modelDoc(t, "m_inherit")).defaultEquipmentClass).toBe("CLASS_I");
  });

  test("a model that already stores a class keeps it as its own (no backfill)", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      const m = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", "m_override")).first();
      await ctx.db.patch(m!._id, { defaultEquipmentClass: "CLASS_I" });
    });
    await t.withIdentity(asUser).mutation(api.testTagAssetsWrites.backfillNative, { orgId: ORG, now: NOW });
    expect(await tt(t, "m_override")).toMatchObject({ equipmentClass: "CLASS_I" });
  });
});

describe("a model edit rewrites only the items that FOLLOW the model (D77 review)", () => {
  /** A model in `parent` (CLASS_II, 6 months) with two items: A follows it, B was set on its own. */
  async function seedFollow(t: T) {
    await seed(t);
    await t.withIdentity(asUser).mutation(api.testTagAssetsWrites.backfillNative, { orgId: ORG, now: NOW });
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "a_b", organizationId: ORG, assetTag: "T-b", modelId: "m_inherit", status: "AVAILABLE", isActive: true, updatedAt: 1 } as never);
      await ctx.db.insert("testTagAssets", { id: "tt_b", organizationId: ORG, testTagId: "T-b", description: "own", assetId: "a_b", equipmentClass: "LEAD_CORD_ASSEMBLY", applianceType: "POWER_BOARD", testIntervalMonths: 24, status: "CURRENT", isActive: true, createdAt: 1, updatedAt: 1 } as never);
    });
  }
  const itemB = (t: T) => t.run(async (ctx) => (await ctx.db.query("testTagAssets").withIndex("by_assetId", (q) => q.eq("assetId", "a_b")).first())!);

  test("the item that follows the model is updated; the overridden one is untouched (class, type and interval)", async () => {
    const t = makeT();
    await seedFollow(t);
    expect(await tt(t, "m_inherit")).toMatchObject({ equipmentClass: "CLASS_II", applianceType: "APPLIANCE", testIntervalMonths: 6 });
    await writeModel(t, "updateNative", { id: "m_inherit", name: "m_inherit", categoryId: "parent", requiresTestAndTag: true, defaultEquipmentClass: "CLASS_I", defaultApplianceType: "THREE_PHASE", testAndTagIntervalDays: 365 }, "u1");
    expect(await tt(t, "m_inherit")).toMatchObject({ equipmentClass: "CLASS_I", applianceType: "THREE_PHASE", testIntervalMonths: 12 });
    expect(await itemB(t)).toMatchObject({ equipmentClass: "LEAD_CORD_ASSEMBLY", applianceType: "POWER_BOARD", testIntervalMonths: 24 });
  });

  test("an edit that changes nothing about the T&T defaults rewrites no item at all (not even updatedAt)", async () => {
    const t = makeT();
    await seedFollow(t);
    const before = await tt(t, "m_inherit");
    await writeModel(t, "updateNative", { id: "m_inherit", name: "Renamed", categoryId: "parent", requiresTestAndTag: true }, "u1");
    expect((await tt(t, "m_inherit")).updatedAt).toBe(before.updatedAt);
    expect((await itemB(t)).updatedAt).toBe(1);
  });

  test("moving a model to a category with other defaults moves the followers, not the overridden item", async () => {
    const t = makeT();
    await seedFollow(t);
    await t.run(async (ctx) => { await ctx.db.insert("categories", { id: "cat2", organizationId: ORG, name: "Cat2", defaultEquipmentClass: "LEAD_CORD_ASSEMBLY", defaultTestIntervalMonths: 1 } as never); });
    await writeModel(t, "updateNative", { id: "m_inherit", name: "m_inherit", categoryId: "cat2", requiresTestAndTag: true }, "u1");
    expect(await tt(t, "m_inherit")).toMatchObject({ equipmentClass: "LEAD_CORD_ASSEMBLY", testIntervalMonths: 1 });
    expect(await itemB(t)).toMatchObject({ equipmentClass: "LEAD_CORD_ASSEMBLY", testIntervalMonths: 24 }); // B's own 24 is kept
  });
});
