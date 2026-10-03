// @vitest-environment node
//
// Category price rollup, write side: `updateCategoryNative`'s `pricingDisplay`
// switch, plus the parity assertion `projectCategoriesWrites.ts`'s inlined
// `storedPricingDisplay` promises.
//
// The inline exists for the same reason `getUserColor` is inlined in that file
// (and checked by collaborationColors.test.ts): Convex production modules don't
// import from `src/`. This file is what stops the two copies of the default
// reading from drifting.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import {
  toCategoryPricingDisplay,
  CATEGORY_PRICING_DISPLAYS,
} from "../src/lib/category-pricing-display";

const modules = import.meta.glob("./**/*.ts");
function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const asUser = (orgId: string) => ({ subject: USER, orgId });
const ACTOR = { userId: USER, userName: "Alice" };

async function seed(t: ReturnType<typeof makeT>, pricingDisplay?: "ITEMISED" | "ROLLUP") {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "member" });
    await ctx.db.insert("projects", {
      id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig",
      status: "QUOTED", isTemplate: false, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projectCategories", {
      id: "c1", organizationId: ORG, projectId: "p1", name: "Lighting",
      sortOrder: 0, ...(pricingDisplay ? { pricingDisplay } : {}),
    });
  });
}

function readCategory(t: ReturnType<typeof makeT>) {
  return t.run((ctx) =>
    ctx.db.query("projectCategories").withIndex("by_cuid", (q) => q.eq("id", "c1")).first(),
  );
}

describe("storedPricingDisplay parity", () => {
  // The Convex copy is a one-liner (`value === "ROLLUP" ? "ROLLUP" : "ITEMISED"`),
  // so this asserts the SHARED module agrees on every input the stored field can
  // actually hold, plus the junk an untrusted boundary could hand either one.
  test("the src module's default reading matches the inlined Convex one", () => {
    const convexCopy = (value: unknown) => (value === "ROLLUP" ? "ROLLUP" : "ITEMISED");
    const inputs: unknown[] = [
      ...CATEGORY_PRICING_DISPLAYS, undefined, null, "", "rollup", "ROLLUP ", 0, 1, true, {}, [],
    ];
    for (const value of inputs) {
      expect(toCategoryPricingDisplay(value)).toBe(convexCopy(value));
    }
  });
});

describe("updateCategoryNative — pricingDisplay", () => {
  test("switches a category to ROLLUP and audits the transition", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(asUser(ORG)).mutation(api.projectCategoriesWrites.updateCategoryNative, {
      id: "c1", orgId: ORG, pricingDisplay: "ROLLUP", now: NOW, actor: ACTOR, auditId: "log1",
    });

    expect((await readCategory(t))?.pricingDisplay).toBe("ROLLUP");
    const log = await t.run((ctx) =>
      ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first(),
    );
    // "Updated category X" alone would leave no trace of WHAT changed on a
    // switch that changes what every client-facing document shows.
    expect(log?.summary).toContain("ITEMISED -> ROLLUP");
    expect(log?.metadata).toMatchObject({ pricingDisplay: { from: "ITEMISED", to: "ROLLUP" } });
  });

  test("switches back to ITEMISED as an explicit stored value", async () => {
    const t = makeT();
    await seed(t, "ROLLUP");
    await t.withIdentity(asUser(ORG)).mutation(api.projectCategoriesWrites.updateCategoryNative, {
      id: "c1", orgId: ORG, pricingDisplay: "ITEMISED", now: NOW, actor: ACTOR, auditId: "log1",
    });
    expect((await readCategory(t))?.pricingDisplay).toBe("ITEMISED");
  });

  test("omitting pricingDisplay leaves it untouched (a rename is not a reset)", async () => {
    const t = makeT();
    await seed(t, "ROLLUP");
    await t.withIdentity(asUser(ORG)).mutation(api.projectCategoriesWrites.updateCategoryNative, {
      id: "c1", orgId: ORG, name: "Lighting & Rigging", now: NOW, actor: ACTOR, auditId: "log1",
    });
    const cat = await readCategory(t);
    expect(cat?.name).toBe("Lighting & Rigging");
    expect(cat?.pricingDisplay).toBe("ROLLUP");
  });

  test("a no-op switch doesn't claim a transition in the audit", async () => {
    const t = makeT();
    await seed(t, "ROLLUP");
    await t.withIdentity(asUser(ORG)).mutation(api.projectCategoriesWrites.updateCategoryNative, {
      id: "c1", orgId: ORG, pricingDisplay: "ROLLUP", now: NOW, actor: ACTOR, auditId: "log1",
    });
    const log = await t.run((ctx) =>
      ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first(),
    );
    expect(log?.summary).not.toContain("->");
  });

  // by_cuid is a GLOBAL index: a caller in another org must not be able to flip
  // this category's documents to hide their prices (R-8.4.3).
  test("rejects a caller from another organization", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m2", organizationId: OTHER, userId: USER, role: "member" });
    });
    await expect(
      t.withIdentity(asUser(OTHER)).mutation(api.projectCategoriesWrites.updateCategoryNative, {
        id: "c1", orgId: OTHER, pricingDisplay: "ROLLUP", now: NOW, actor: ACTOR, auditId: "log1",
      }),
    ).rejects.toThrow(/Category not found/);
    expect((await readCategory(t))?.pricingDisplay).toBeUndefined();
  });
});
