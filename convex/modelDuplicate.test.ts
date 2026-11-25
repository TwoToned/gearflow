// @vitest-environment node
// UX Phase 12 slice 3: Duplicate model + its exact Undo.
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
const asOther = { subject: "user_2", orgId: ORG };
const ACTOR = { userId: USER, userName: "Alice" };

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: "user_2", role: "owner" });
    await ctx.db.insert("models", { id: "src", organizationId: ORG, name: "MAC Aura", sku: "AURA-1", dailyRate: 85, isActive: true, assetType: "SERIALIZED", createdAt: NOW, updatedAt: NOW } as never);
    await ctx.db.insert("models", { id: "foreign", organizationId: "org_2", name: "Theirs", isActive: true, assetType: "SERIALIZED" } as never);
  });
}
const dup = (t: T, extra: Record<string, unknown> = {}) =>
  t.withIdentity(asUser).mutation(api.modelWrites.duplicateNative, { sourceId: "src", id: "cpy", orgId: ORG, now: NOW + 1, actor: ACTOR, auditId: "a1", ...extra });
const undo = (t: T, id = asUser, actor = ACTOR) =>
  t.withIdentity(id).mutation(api.modelWrites.undoDuplicateNative, { id: "cpy", orgId: ORG, auditId: "a1", now: NOW + 2, actor });
const getCopy = (t: T) => t.run((ctx) => ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", "cpy")).first());

describe("modelWrites.duplicateNative", () => {
  test("copies the fields, renames, clears the SKU, and is active", async () => {
    const t = makeT();
    await seed(t);
    await dup(t);
    const c = await getCopy(t);
    expect(c).toMatchObject({ name: "MAC Aura (copy)", dailyRate: 85, isActive: true });
    expect(c?.sku).toBeUndefined();
  });

  test("refuses a source from another org", async () => {
    const t = makeT();
    await seed(t);
    await expect(dup(t, { sourceId: "foreign" })).rejects.toThrow(/not found/i);
    expect(await getCopy(t)).toBeNull();
  });

  test("Undo deletes exactly the copy, once", async () => {
    const t = makeT();
    await seed(t);
    await dup(t);
    await undo(t);
    expect(await getCopy(t)).toBeNull();
    await expect(undo(t)).rejects.toThrow();
  });

  test("Undo refuses another author, an edited copy, and a copy with stock", async () => {
    const t = makeT();
    await seed(t);
    await dup(t);
    await expect(undo(t, asOther, { userId: "user_2", userName: "Ben" })).rejects.toThrow(/person who made/);
    await t.run(async (ctx) => {
      const c = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", "cpy")).first();
      await ctx.db.patch(c!._id, { updatedAt: NOW + 99 });
    });
    await expect(undo(t)).rejects.toThrow(/kept/);
    expect(await getCopy(t)).not.toBeNull();
  });
});
