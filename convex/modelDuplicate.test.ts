// @vitest-environment node
// UX Phase 12 slice 3: Duplicate model + its exact Undo, and every guard on that Undo.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";

const modules = import.meta.glob("./**/*.ts");
function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
type T = ReturnType<typeof makeT>;
const ORG = "org_1";
const OTHER = "org_2";
const NOW = 1_700_000_000_000;
type Who = { userId: string; userName: string };
const OWNER: Who = { userId: "user_1", userName: "Alice" };
const MANAGER: Who = { userId: "user_2", userName: "Ben" }; // model:create + update, NOT delete
const VIEWER: Who = { userId: "user_3", userName: "Cy" };
const STRANGER: Who = { userId: "user_9", userName: "Zed" }; // owner of ANOTHER org
const idOf = (w: Who, orgId = ORG) => ({ subject: w.userId, orgId });

async function seed(t: T) {
  await t.run(async (ctx) => {
    for (const [w, role, org] of [[OWNER, "owner", ORG], [MANAGER, "manager", ORG], [VIEWER, "viewer", ORG], [STRANGER, "owner", OTHER]] as const) {
      await ctx.db.insert("members", { id: `m-${w.userId}`, organizationId: org, userId: w.userId, role });
    }
    await ctx.db.insert("models", {
      id: "src", organizationId: ORG, name: "MAC Aura", sku: "AURA-1", dailyRate: 85, isActive: true, assetType: "SERIALIZED",
      image: "https://files.example/aura.png", saleStockQuantity: 7, reorderLevel: 2, createdAt: NOW, updatedAt: NOW,
    } as never);
    await ctx.db.insert("models", { id: "foreign", organizationId: OTHER, name: "Theirs", isActive: true, assetType: "SERIALIZED" } as never);
  });
}
const dup = (t: T, who: Who = OWNER, extra: Record<string, unknown> = {}) =>
  t.withIdentity(idOf(who)).mutation(api.modelWrites.duplicateNative, { sourceId: "src", id: "cpy", orgId: ORG, now: NOW + 1, actor: who, auditId: "a1", ...extra });
const undo = (t: T, who: Who = OWNER, extra: Record<string, unknown> = {}) =>
  t.withIdentity(idOf(who, (extra.orgId as string) ?? ORG)).mutation(api.modelWrites.undoDuplicateNative, { id: "cpy", orgId: ORG, auditId: "a1", now: NOW + 2, actor: who, ...extra });
const getModel = (t: T, id = "cpy") => t.run((ctx) => ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const expectKept = async (t: T) => {
  await expect(undo(t)).rejects.toThrow(/kept/);
  expect(await getModel(t)).not.toBeNull();
};

describe("modelWrites.duplicateNative", () => {
  test("copies the model's own fields: new name, no SKU, no sale-stock pool, shared image URL", async () => {
    const t = makeT();
    await seed(t);
    await dup(t);
    const c = await getModel(t);
    expect(c).toMatchObject({ name: "MAC Aura (copy)", dailyRate: 85, isActive: true, image: "https://files.example/aura.png" });
    expect(c?.sku).toBeUndefined();
    expect(c?.saleStockQuantity).toBeUndefined(); // no phantom stock
    expect(c?.reorderLevel).toBeUndefined();
    expect((await getModel(t, "src"))).toMatchObject({ saleStockQuantity: 7, reorderLevel: 2 }); // the source is untouched
  });

  test("refuses a source from another org, and a viewer", async () => {
    const t = makeT();
    await seed(t);
    await expect(dup(t, OWNER, { sourceId: "foreign" })).rejects.toThrow(/not found/i);
    await expect(dup(t, VIEWER)).rejects.toThrow(/insufficient permissions/i);
    expect(await getModel(t)).toBeNull();
  });
});

describe("modelWrites.undoDuplicateNative", () => {
  test("deletes exactly the copy, once", async () => {
    const t = makeT();
    await seed(t);
    await dup(t);
    await undo(t);
    expect(await getModel(t)).toBeNull();
    expect(await getModel(t, "src")).not.toBeNull();
    await expect(undo(t)).rejects.toThrow(/already undone/);
  });

  test("a manager (model:create, no model:delete) can undo their own duplicate", async () => {
    const t = makeT();
    await seed(t);
    await dup(t, MANAGER);
    await undo(t, MANAGER);
    expect(await getModel(t)).toBeNull();
  });

  test("needs model:create: a viewer is refused and the copy stays", async () => {
    const t = makeT();
    await seed(t);
    await dup(t);
    await expect(undo(t, VIEWER)).rejects.toThrow(/insufficient permissions/i);
    expect(await getModel(t)).not.toBeNull();
  });

  test("another org can't reach it (its own org, or by naming this org)", async () => {
    const t = makeT();
    await seed(t);
    await dup(t);
    await expect(undo(t, STRANGER, { orgId: OTHER })).rejects.toThrow(/not found/i);
    await expect(undo(t, STRANGER)).rejects.toThrow(); // names ORG but is not a member of it
    expect(await getModel(t)).not.toBeNull();
  });

  test("a wrong audit id, and another entity's audit id, are refused", async () => {
    const t = makeT();
    await seed(t);
    await dup(t);
    await expect(undo(t, OWNER, { auditId: "nope" })).rejects.toThrow(/not found/i);
    // a second copy's audit row can't be used to delete the first
    await t.withIdentity(idOf(OWNER)).mutation(api.modelWrites.duplicateNative, { sourceId: "src", id: "cpy2", orgId: ORG, now: NOW + 1, actor: OWNER, auditId: "a2" });
    await expect(undo(t, OWNER, { auditId: "a2" })).rejects.toThrow(/not found/i);
    expect(await getModel(t)).not.toBeNull();
    expect(await getModel(t, "cpy2")).not.toBeNull();
  });

  test("the source's own id is refused: the Undo can only ever delete the copy its audit row names", async () => {
    const t = makeT();
    await seed(t);
    await dup(t);
    await expect(undo(t, OWNER, { id: "src" })).rejects.toThrow(/not found/i);
    expect(await getModel(t, "src")).not.toBeNull();
  });

  test("another user's undo is refused", async () => {
    const t = makeT();
    await seed(t);
    await dup(t, OWNER);
    await expect(undo(t, MANAGER)).rejects.toThrow(/person who made/);
    expect(await getModel(t)).not.toBeNull();
  });

  test("outside the 10-minute server-clock window it is refused", async () => {
    const t = makeT();
    await seed(t);
    await dup(t);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "a1")).first();
      const d = row!.details as { duplicate: Record<string, unknown> };
      await ctx.db.patch(row!._id, { details: { duplicate: { ...d.duplicate, serverSavedAt: Date.now() - 11 * 60 * 1000 } } });
    });
    await expect(undo(t)).rejects.toThrow(/within 10 minutes/);
    expect(await getModel(t)).not.toBeNull();
  });

  describe("a copy that has been edited or used is KEPT", () => {
    const patchCopy = (t: T, patch: Record<string, unknown>) =>
      t.run(async (ctx) => { const c = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", "cpy")).first(); await ctx.db.patch(c!._id, patch as never); });

    test("edited since", async () => {
      const t = makeT();
      await seed(t);
      await dup(t);
      await patchCopy(t, { updatedAt: NOW + 99 });
      await expectKept(t);
    });

    const dependents: Record<string, (t: T) => Promise<unknown>> = {
      "an asset row": (t) => t.run((ctx) => ctx.db.insert("assets", { id: "a-1", organizationId: ORG, modelId: "cpy", assetTag: "C-1", status: "AVAILABLE", isActive: true } as never)),
      "a bulk asset row": (t) =>
        t.run((ctx) => ctx.db.insert("bulkAssets", { id: "b-1", organizationId: ORG, modelId: "cpy", assetTag: "CB-1", totalQuantity: 3, availableQuantity: 3, status: "ACTIVE", isActive: true, createdAt: NOW, updatedAt: NOW } as never)),
      "a project line": (t) =>
        t.run((ctx) => ctx.db.insert("projectLineItems", { versionId: "v1", lineageId: "l-1", id: "l-1", organizationId: ORG, projectId: "p1", modelId: "cpy", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, quantity: 1, sortOrder: 1 } as never)),
      "a sub-hire item": (t) =>
        t.run((ctx) => ctx.db.insert("subHireItems", { id: "sh-1", subHireId: "sh1", modelId: "cpy", description: "Hired in", quantity: 1, unitCost: 1, unitCharge: 2, pricingType: "FLAT", duration: 1, discount: 0 } as never)),
    };
    test.each(Object.keys(dependents))("%s", async (name) => {
      const t = makeT();
      await seed(t);
      await dup(t);
      await dependents[name](t);
      await expectKept(t);
    });
  });
});
