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
});
