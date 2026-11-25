// @vitest-environment node
// UX Phase 12 (Q-S1 / S5): an archived model takes no NEW lines on any add path, and
// existing lines are untouched.
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
const USER = "user_1";
const NOW = 1_700_000_000_000;
const asUser = { subject: USER, orgId: ORG };
const ACTOR = { userId: USER, userName: "Alice" };

async function seed(t: T, archived: boolean) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("models", { id: "mdl1", organizationId: ORG, name: "MAC Aura", dailyRate: 85, isActive: !archived, assetType: "SERIALIZED" } as never);
    await ctx.db.insert("models", { id: "mdl2", organizationId: ORG, name: "Other", isActive: true, assetType: "SERIALIZED" } as never);
    await ctx.db.insert("projects", { liveVersionId: "v-p1", id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "QUOTED", isTemplate: false, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("projectVersions", { id: "v-p1", organizationId: ORG, projectId: "p1", number: 1, contentState: "ready", createdAt: NOW, createdById: USER });
    await ctx.db.insert("projectLineItems", { versionId: "v-p1", lineageId: "old", id: "old", organizationId: ORG, projectId: "p1", modelId: "mdl1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, quantity: 1, sortOrder: 1 });
  });
}

const addArgs = (modelId: string) => ({
  id: "new1", organizationId: ORG, projectId: "p1", fields: { type: "EQUIPMENT" as const, modelId, description: "Fixture", quantity: 1, unitPrice: 10 },
  includeAccessories: false, allowOverbook: true, actor: ACTOR, auditId: "log1", now: NOW,
});

describe("MODEL_ARCHIVED", () => {
  test("addNative refuses an archived model, accepts an active one", async () => {
    const t = makeT();
    await seed(t, true);
    await expect(t.withIdentity(asUser).mutation(api.lineItemWrites.addNative, addArgs("mdl1"))).rejects.toThrow(/archived/);
    const line = await t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "new1")).first());
    expect(line).toBeNull();
    await t.withIdentity(asUser).mutation(api.lineItemWrites.addNative, addArgs("mdl2"));
  });

  test("an existing line on the archived model is untouched and still editable", async () => {
    const t = makeT();
    await seed(t, true);
    const old = await t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "old")).first());
    expect(old?.modelId).toBe("mdl1");
    await t.withIdentity(asUser).mutation(api.lineItemWrites.patchNative, {
      id: "old", orgId: ORG, set: { quantity: 2 }, clear: [], entityName: "Fixture", allowOverbook: true, actor: ACTOR, auditId: "p1", now: NOW,
    });
    const after = await t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "old")).first());
    expect(after?.quantity).toBe(2);
  });

  test("patchNative refuses SWAPPING a line onto an archived model", async () => {
    const t = makeT();
    await seed(t, true);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { versionId: "v-p1", lineageId: "other", id: "other", organizationId: ORG, projectId: "p1", modelId: "mdl2", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, quantity: 1, sortOrder: 2 });
    });
    await expect(
      t.withIdentity(asUser).mutation(api.lineItemWrites.patchNative, { id: "other", orgId: ORG, set: { modelId: "mdl1" }, clear: [], entityName: "Fixture", allowOverbook: true, actor: ACTOR, auditId: "p2", now: NOW }),
    ).rejects.toThrow(/archived/);
  });

  test("the smart add refuses an archived model", async () => {
    const t = makeT();
    await seed(t, true);
    await expect(
      t.withIdentity(asUser).mutation(api.lineItemWrites.addLineItemSmartNative, {
        id: "new2", organizationId: ORG, projectId: "p1", fields: { type: "EQUIPMENT", modelId: "mdl1", quantity: 1 },
        allowOverbook: true, forceSeparate: false, includeAccessories: false, actor: ACTOR, auditId: "log2", now: NOW,
      }),
    ).rejects.toThrow(/archived/);
  });

  test("the warehouse quick add refuses an archived model and inserts no line", async () => {
    const t = makeT();
    await seed(t, true);
    await expect(
      t.withIdentity(asUser).mutation(api.warehouseWrites.quickAddAndCheckOut, { orgId: ORG, projectId: "p1", modelId: "mdl1", now: NOW, actor: ACTOR }),
    ).rejects.toThrow(/archived/);
    const lines = await t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_modelId", (q) => q.eq("modelId", "mdl1")).collect());
    expect(lines.map((l) => l.id)).toEqual(["old"]); // only the pre-existing line
  });

  test("a packing case for an archived model is refused", async () => {
    const t = makeT();
    await seed(t, true);
    await t.run((ctx) => ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "mdl1", assetTag: "A-1", status: "AVAILABLE", isActive: true } as never));
    await expect(
      t.withIdentity(asUser).mutation(api.projectContainersWrites.createNative, {
        id: "c1", orgId: ORG, projectId: "p1", kind: "ASSET", assetId: "a1", modelId: "mdl1", label: "LX-01", now: NOW, actor: ACTOR, auditId: "c-log",
      }),
    ).rejects.toThrow(/archived/);
  });

  test("a sub-hire item for an archived model is refused, an active one is accepted", async () => {
    const t = makeT();
    await seed(t, true);
    await t.run((ctx) => ctx.db.insert("subHires", { id: "sh1", organizationId: ORG, supplierId: "s1", createdById: USER, orderNumber: "SH-1", status: "DRAFT" } as never));
    const item = (modelId: string, id: string) => ({
      id, orgId: ORG, subHireId: "sh1", modelId, description: "Fixture", quantity: 1, unitCost: 10, unitCharge: 20,
      pricingType: "FLAT" as const, duration: 1, discount: 0, now: NOW, actor: ACTOR, auditId: `${id}-log`,
    });
    await expect(t.withIdentity(asUser).mutation(api.subHiresWrites.addSubHireItemNative, item("mdl1", "i1"))).rejects.toThrow(/archived/);
    await t.withIdentity(asUser).mutation(api.subHiresWrites.addSubHireItemNative, item("mdl2", "i2"));
  });
});
