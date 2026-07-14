// @vitest-environment node
//
// assets.bulkAddTags — bulk APPEND tags to N assets in one call (powers the
// assets bulk-bar "Add tags"). Verifies: union/append (not replace) semantics,
// idempotent dedup, per-row org re-check (skips other-org ids), input
// normalization (trim/dedup/drop-empty), and non-service rejection.
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
const ORG = "org_1";
const OTHER = "org_other";
const SERVICE = { subject: "gearflow-service", svc: true };

const seed = (t: ReturnType<typeof makeT>) =>
  t.run(async (ctx) => {
    await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "a1", status: "AVAILABLE", isActive: true, tags: ["existing"] });
    await ctx.db.insert("assets", { id: "a2", organizationId: ORG, modelId: "m1", assetTag: "a2", status: "AVAILABLE", isActive: true }); // no tags
    await ctx.db.insert("assets", { id: "ax", organizationId: OTHER, modelId: "m1", assetTag: "ax", status: "AVAILABLE", isActive: true, tags: ["secret"] });
  });

const tagsOf = (t: ReturnType<typeof makeT>, id: string) =>
  t.run(async (ctx) => {
    const doc = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    return (doc?.tags ?? []).slice().sort();
  });

describe("assets.bulkAddTags", () => {
  test("appends (unions) tags without dropping existing, deduped per asset", async () => {
    const t = makeT();
    await seed(t);
    // Add "blue" + "existing" to both. a1 already has "existing" (deduped, not
    // duplicated); a2 has no tags so it gets both.
    const n = await t.withIdentity(SERVICE).mutation(api.assets.bulkAddTags, {
      organizationId: ORG,
      ids: ["a1", "a2"],
      tags: ["blue", "existing"],
    });
    expect(n).toBe(2);
    expect(await tagsOf(t, "a1")).toEqual(["blue", "existing"]); // "existing" kept, "blue" appended
    expect(await tagsOf(t, "a2")).toEqual(["blue", "existing"]); // both appended
  });

  test("per-row org re-check — an other-org id is skipped and untouched", async () => {
    const t = makeT();
    await seed(t);
    const n = await t.withIdentity(SERVICE).mutation(api.assets.bulkAddTags, {
      organizationId: ORG,
      ids: ["a1", "ax"], // ax belongs to OTHER
      tags: ["blue"],
    });
    expect(n).toBe(1); // only a1 counted
    expect(await tagsOf(t, "a1")).toEqual(["blue", "existing"]);
    expect(await tagsOf(t, "ax")).toEqual(["secret"]); // untouched
  });

  test("normalizes input (trim, dedup, drop empty); all-empty is a no-op", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(SERVICE).mutation(api.assets.bulkAddTags, {
      organizationId: ORG,
      ids: ["a2"],
      tags: ["  blue  ", "blue", ""],
    });
    expect(await tagsOf(t, "a2")).toEqual(["blue"]);

    const n = await t.withIdentity(SERVICE).mutation(api.assets.bulkAddTags, {
      organizationId: ORG,
      ids: ["a2"],
      tags: ["   ", ""],
    });
    expect(n).toBe(0); // nothing to add
  });

  test("rejects a non-service (browser) caller", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.withIdentity({ subject: "u1", orgId: ORG }).mutation(api.assets.bulkAddTags, {
        organizationId: ORG,
        ids: ["a1"],
        tags: ["blue"],
      }),
    ).rejects.toThrow();
  });
});
