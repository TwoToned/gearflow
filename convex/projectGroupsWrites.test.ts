// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";

const modules = import.meta.glob("./**/*.ts");
// Mount the rate limiter (enforceBrowserWriteLimit) + sharded counter (other convex
// modules in the same test glob need it), matching projectCategoriesWrites.test.ts.
function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const asUser = (orgId: string) => ({ subject: USER, orgId });
const ACTOR = { userId: USER, userName: "Alice" };

async function member(t: ReturnType<typeof convexTest>, role: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role });
  });
}

/** A minimal project so recalcProjectTotals has a row to sweep + patch. */
async function seedProject(t: ReturnType<typeof makeT>, id = "p1", orgId = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id, organizationId: orgId, projectNumber: `P-${id}`, name: "Gig", status: "QUOTED",
      total: 999,
    });
  });
}

/** Seed the target project + category rows the move/create org-validation now requires. */
async function seedProjectAndCategories(t: ReturnType<typeof makeT>, cats: string[] = ["cat1", "cat2"], projectId = "p1", orgId = ORG) {
  await seedProject(t, projectId, orgId);
  await t.run(async (ctx) => {
    for (const c of cats) {
      await ctx.db.insert("projectCategories", { id: c, organizationId: orgId, projectId, name: c, sortOrder: 0 });
    }
  });
}

// ─── createGroupNative ────────────────────────────────────────────────────────
describe("projectGroupsWrites.createGroupNative", () => {
  const args = { id: "g1", orgId: ORG, projectId: "p1", categoryId: "cat1", title: "Mics", now: NOW, actor: ACTOR, auditId: "log1" };

  test("member creates a group (sortOrder max+1 in bucket) + CREATE audit + suggestedPrice 0", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProjectAndCategories(t);
    await t.run(async (ctx) => {
      // Same (project,category) bucket → contributes to max; other-category ignored.
      await ctx.db.insert("projectGroups", { id: "existing", organizationId: ORG, projectId: "p1", categoryId: "cat1", title: "Lights", sortOrder: 3 });
      await ctx.db.insert("projectGroups", { id: "otherCat", organizationId: ORG, projectId: "p1", categoryId: "cat2", title: "X", sortOrder: 9 });
    });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.createGroupNative, args);
    expect(res.sortOrder).toBe(4); // max(3)+1 within cat1
    await t.run(async (ctx) => {
      const g = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g1")).first();
      expect(g?.title).toBe("Mics");
      expect(g?.sortOrder).toBe(4);
      expect(g?.suggestedPrice).toBe(0);
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("created");
      expect(log?.entityId).toBe("p1");
      expect(log?.summary).toBe('Created group "Mics"');
    });
  });

  test("first group in a bucket gets sortOrder 0 (uncategorized bucket)", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.createGroupNative, { ...args, categoryId: undefined });
    expect(res.sortOrder).toBe(0);
  });

  test("a duplicate submit (same cuid) is idempotent — no second row/audit", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProjectAndCategories(t);
    await t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.createGroupNative, args);
    await t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.createGroupNative, { ...args, auditId: "log2" });
    await t.run(async (ctx) => {
      const gs = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g1")).collect();
      expect(gs).toHaveLength(1);
      const log2 = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log2")).first();
      expect(log2).toBeNull();
    });
  });

  test("rejects an empty title", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.createGroupNative, { ...args, title: "" }),
    ).rejects.toThrow(/title is required/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.createGroupNative, args),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

// ─── updateGroupNative ────────────────────────────────────────────────────────
describe("projectGroupsWrites.updateGroupNative", () => {
  // Group g1 with one model-backed line (dailyRate 100 × qty 2) → suggested 200 @ rentalQty 1.
  async function seedGroupWithLine(t: ReturnType<typeof makeT>) {
    await member(t, "member");
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: ORG, projectId: "p1", categoryId: "cat1", title: "Mics", sortOrder: 0, suggestedPrice: 0 });
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "SM58", dailyRate: 100, weeklyRate: 500 });
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", groupId: "g1", modelId: "m1", quantity: 2, isKitChild: false, isCustomItem: false, status: "CONFIRMED", type: "EQUIPMENT" });
    });
  }

  test("member renames + UPDATE audit (pre-patch title) + recalc + collab (group_updated)", async () => {
    const t = makeT();
    await seedGroupWithLine(t);
    await t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.updateGroupNative, {
      id: "g1", orgId: ORG, title: "Renamed", now: NOW, actor: ACTOR, auditId: "log1",
    });
    await t.run(async (ctx) => {
      const g = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g1")).first();
      expect(g?.title).toBe("Renamed");
      expect(g?.updatedAt).toBe(NOW);
      // Rename does NOT touch rental settings → suggestedPrice stays 0 (not recomputed).
      expect(g?.suggestedPrice).toBe(0);
      // Audit uses the PRE-patch title.
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.entityName).toBe("Mics");
      expect(log?.summary).toBe('Updated group "Mics"');
      // Recalc ran (project total overwritten — grouped gear w/ no price bills 0 → tax base 0 → 0).
      const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(project?.total).toBe(0);
      // Collab event on a non-sortOrder change, uses the PRE-patch title.
      const events = await ctx.db.query("activityEvents").collect();
      expect(events).toHaveLength(1);
      expect(events[0].action).toBe("group_updated");
      expect(events[0].targetType).toBe("group");
      expect(events[0].targetId).toBe("g1");
      expect(events[0].summary).toBe('updated group "Mics"');
    });
  });

  // #943: group-level rentalPeriod/rentalQuantity retired — suggestedPrice is now
  // derived purely from the PROJECT's rentalStartDate/rentalEndDate (best-price
  // capped), so nothing on updateGroupNative itself can make it stale anymore.
  // It's recomputed when a line is added/merged into the group and when the
  // project's rental dates change (recalcAutoPricedLinesNative).
  test("a quantity update does not touch suggestedPrice (nothing on this mutation derives it anymore)", async () => {
    const t = makeT();
    await seedGroupWithLine(t);
    await t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.updateGroupNative, {
      id: "g1", orgId: ORG, quantity: 3, now: NOW, actor: ACTOR, auditId: "log1",
    });
    await t.run(async (ctx) => {
      const g = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g1")).first();
      expect(g?.quantity).toBe(3);
      expect(g?.suggestedPrice).toBe(0); // unchanged — only line adds / date recalcs touch it
    });
  });

  test("a sortOrder-only update writes NO collab event (and no suggested recompute)", async () => {
    const t = makeT();
    await seedGroupWithLine(t);
    await t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.updateGroupNative, {
      id: "g1", orgId: ORG, sortOrder: 7, now: NOW, actor: ACTOR, auditId: "log1",
    });
    await t.run(async (ctx) => {
      const g = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g1")).first();
      expect(g?.sortOrder).toBe(7);
      expect(g?.suggestedPrice).toBe(0); // unchanged
      const events = await ctx.db.query("activityEvents").collect();
      expect(events).toHaveLength(0);
    });
  });

  test("cross-org group is rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: "org_other", projectId: "p9", title: "Theirs", sortOrder: 0 });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.updateGroupNative, { id: "g1", orgId: ORG, title: "X", now: NOW, actor: ACTOR, auditId: "log1" }),
    ).rejects.toThrow(/Group not found/i);
  });

  test("sets a Xero coding override, then clears it back to inherit", async () => {
    const t = makeT();
    await seedGroupWithLine(t);
    await t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.updateGroupNative, {
      id: "g1", orgId: ORG, xeroAccountCode: "8888-GROUP", xeroTaxType: "ZERORATED", now: NOW, actor: ACTOR, auditId: "log1",
    });
    await t.run(async (ctx) => {
      const g = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g1")).first();
      expect(g?.xeroAccountCode).toBe("8888-GROUP");
      expect(g?.xeroTaxType).toBe("ZERORATED");
    });

    // Sending "" (not omitting the key) clears it back to inherit -- matches
    // how the edit dialog always sends the raw field value, never `|| undefined`.
    await t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.updateGroupNative, {
      id: "g1", orgId: ORG, xeroAccountCode: "", xeroTaxType: "", now: NOW, actor: ACTOR, auditId: "log2",
    });
    await t.run(async (ctx) => {
      const g = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g1")).first();
      expect(g?.xeroAccountCode).toBeUndefined();
      expect(g?.xeroTaxType).toBeUndefined();
    });
  });

  test("rejects an over-length Xero account code (R-8.6.2)", async () => {
    const t = makeT();
    await seedGroupWithLine(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.updateGroupNative, {
        id: "g1", orgId: ORG, xeroAccountCode: "x".repeat(51), now: NOW, actor: ACTOR, auditId: "log1",
      }),
    ).rejects.toThrow(/xeroAccountCode/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.updateGroupNative, { id: "g1", orgId: ORG, title: "X", now: NOW, actor: ACTOR, auditId: "log1" }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

// ─── updateGroupPriceNative ───────────────────────────────────────────────────
describe("projectGroupsWrites.updateGroupPriceNative", () => {
  async function seedPricedGroup(t: ReturnType<typeof makeT>) {
    await member(t, "member");
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: ORG, projectId: "p1", title: "Mics", quantity: 2, sortOrder: 0 });
    });
  }

  test("member sets price → patch + audit + recalc reflects the group bundle price", async () => {
    const t = makeT();
    await seedPricedGroup(t);
    await t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.updateGroupPriceNative, {
      id: "g1", orgId: ORG, price: 150, now: NOW, actor: ACTOR, auditId: "log1",
    });
    await t.run(async (ctx) => {
      const g = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g1")).first();
      expect(g?.price).toBe(150);
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.summary).toBe('Set price on group "Mics" to $150.00');
      // Bundle price 150 × quantity 2 = 300, + 10% tax = 330.
      const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(project?.total).toBe(330);
    });
  });

  test("member sets price + discount together → both patch, recalc reflects the discounted total (#883)", async () => {
    const t = makeT();
    await seedPricedGroup(t);
    await t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.updateGroupPriceNative, {
      id: "g1", orgId: ORG, price: 150, discount: 50, now: NOW, actor: ACTOR, auditId: "log1",
    });
    await t.run(async (ctx) => {
      const g = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g1")).first();
      expect(g?.price).toBe(150);
      expect(g?.discount).toBe(50);
      // Bundle 150 × 2 - 50 discount = 250, + 10% tax = 275.
      const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(project?.total).toBe(275);
    });
  });

  test("omitting discount leaves the existing discount untouched", async () => {
    const t = makeT();
    await seedPricedGroup(t);
    await t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.updateGroupPriceNative, {
      id: "g1", orgId: ORG, price: 150, discount: 50, now: NOW, actor: ACTOR, auditId: "log1",
    });
    await t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.updateGroupPriceNative, {
      id: "g1", orgId: ORG, price: 200, now: NOW + 1, actor: ACTOR, auditId: "log2",
    });
    await t.run(async (ctx) => {
      const g = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g1")).first();
      expect(g?.price).toBe(200);
      expect(g?.discount).toBe(50);
    });
  });

  // #1012 — the ENTRY shape of the discount rides with the amount so quote/
  // invoice PDFs can print a priced group's discount as "10%" rather than
  // "-$30.00". Display only: `discount` stays the number recalc reads.
  test("stores discountMode alongside the resolved discount", async () => {
    const t = makeT();
    await seedPricedGroup(t);
    await t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.updateGroupPriceNative, {
      id: "g1", orgId: ORG, price: 150, discount: 30, discountMode: "%", now: NOW, actor: ACTOR, auditId: "log1",
    });
    await t.run(async (ctx) => {
      const g = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g1")).first();
      expect(g?.discount).toBe(30);
      expect(g?.discountMode).toBe("%");
      // The mode is inert for money: 150 × 2 − 30 = 270, + 10% tax = 297.
      const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(project?.total).toBe(297);
    });
  });

  test("drops a stale discountMode when the discount is zeroed", async () => {
    const t = makeT();
    await seedPricedGroup(t);
    await t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.updateGroupPriceNative, {
      id: "g1", orgId: ORG, price: 150, discount: 30, discountMode: "%", now: NOW, actor: ACTOR, auditId: "log1",
    });
    await t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.updateGroupPriceNative, {
      id: "g1", orgId: ORG, price: 150, discount: 0, now: NOW + 1, actor: ACTOR, auditId: "log2",
    });
    await t.run(async (ctx) => {
      const g = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g1")).first();
      expect(g?.discount).toBe(0);
      expect(g?.discountMode).toBeUndefined();
    });
  });

  test("rejects a non-finite discount (NaN/Infinity would poison recalc)", async () => {
    const t = makeT();
    await seedPricedGroup(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.updateGroupPriceNative, {
        id: "g1", orgId: ORG, price: 150, discount: Number.NaN, now: NOW, actor: ACTOR, auditId: "log1",
      }),
    ).rejects.toThrow(/finite/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.updateGroupPriceNative, { id: "g1", orgId: ORG, price: 10, now: NOW, actor: ACTOR, auditId: "log1" }),
    ).rejects.toThrow(/insufficient permissions/i);
  });

  test("rejects a non-finite price (NaN/Infinity would poison recalc → project.total NaN)", async () => {
    const t = makeT();
    await seedPricedGroup(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.updateGroupPriceNative, {
        id: "g1", orgId: ORG, price: Number.NaN, now: NOW, actor: ACTOR, auditId: "log1",
      }),
    ).rejects.toThrow(/finite/i);
    // The group price + project.total are untouched by the rejected write.
    await t.run(async (ctx) => {
      const g = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g1")).first();
      expect(g?.price ?? null).toBeNull();
    });
  });
});

// ─── deleteGroupNative ────────────────────────────────────────────────────────
describe("projectGroupsWrites.deleteGroupNative", () => {
  async function seedForDelete(t: ReturnType<typeof makeT>) {
    await member(t, "member");
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: ORG, projectId: "p1", categoryId: "cat1", title: "Mics", sortOrder: 0 });
      await ctx.db.insert("categorySlots", { id: "slGrp", projectCategoryId: "cat1", projectGroupId: "g1", sortOrder: 0 });
      // Two grouped lines — both move to standalone (groupId cleared, categoryId kept).
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", groupId: "g1", categoryId: "cat1", quantity: 1, lineTotal: 20, isKitChild: false, isCustomItem: false, status: "CONFIRMED", type: "EQUIPMENT" });
      await ctx.db.insert("projectLineItems", { id: "li2", organizationId: ORG, projectId: "p1", groupId: "g1", categoryId: "cat1", quantity: 1, lineTotal: 30, isKitChild: false, isCustomItem: false, status: "CONFIRMED", type: "EQUIPMENT" });
    });
  }

  test("null-outs groupId (keeps categoryId), deletes slots + group, N=2 in audit, recalc", async () => {
    const t = makeT();
    await seedForDelete(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.deleteGroupNative, { id: "g1", orgId: ORG, now: NOW, actor: ACTOR, auditId: "log1" });
    expect(res.movedLineItems).toBe(2);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g1")).first()).toBeNull();
      const slots = await ctx.db.query("categorySlots").withIndex("by_projectGroupId", (q) => q.eq("projectGroupId", "g1")).collect();
      expect(slots).toHaveLength(0);
      const l1 = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(l1?.groupId).toBeUndefined();
      expect(l1?.categoryId).toBe("cat1"); // categoryId preserved → standalone-in-category
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.summary).toBe('Deleted group "Mics" — 2 items moved to standalone');
      // Now-standalone lines bill 20 + 30 = 50, + 10% tax = 55.
      const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(project?.total).toBe(55);
    });
  });

  test("cross-org group is rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: "org_other", projectId: "p9", title: "Theirs", sortOrder: 0 });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.deleteGroupNative, { id: "g1", orgId: ORG, now: NOW, actor: ACTOR, auditId: "log1" }),
    ).rejects.toThrow(/Group not found/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.deleteGroupNative, { id: "g1", orgId: ORG, now: NOW, actor: ACTOR, auditId: "log1" }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

// ─── reorderGroupsNative ──────────────────────────────────────────────────────
describe("projectGroupsWrites.reorderGroupsNative", () => {
  test("member reorders (sortOrder = index), org-scoped, NO audit", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: ORG, projectId: "p1", title: "A", sortOrder: 0 });
      await ctx.db.insert("projectGroups", { id: "g2", organizationId: ORG, projectId: "p1", title: "B", sortOrder: 1 });
      await ctx.db.insert("projectGroups", { id: "gOther", organizationId: "org_other", projectId: "p9", title: "X", sortOrder: 5 });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.reorderGroupsNative, {
      orgId: ORG, orderedIds: ["g2", "g1", "gOther"], now: NOW, actor: ACTOR,
    });
    await t.run(async (ctx) => {
      const g1 = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g1")).first();
      const g2 = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g2")).first();
      const other = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "gOther")).first();
      expect(g2?.sortOrder).toBe(0);
      expect(g1?.sortOrder).toBe(1);
      expect(other?.sortOrder).toBe(5); // cross-org row untouched
      const logs = await ctx.db.query("activityLogs").collect();
      expect(logs).toHaveLength(0);
    });
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.reorderGroupsNative, { orgId: ORG, orderedIds: [], now: NOW, actor: ACTOR }),
    ).rejects.toThrow(/insufficient permissions/i);
  });

  // Gap fix: reorderGroupsNative previously never called assertLifecycleGuard,
  // so a locked project's groups could be silently reordered. Mirrors the
  // equivalent lineItemWrites.reorderNative coverage.
  test("rejects on an ON_SITE project without justification, succeeds with one", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "ON_SITE", isTemplate: false, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: ORG, projectId: "p1", title: "A", sortOrder: 0 });
      await ctx.db.insert("projectGroups", { id: "g2", organizationId: ORG, projectId: "p1", title: "B", sortOrder: 1 });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.reorderGroupsNative, {
        orgId: ORG, orderedIds: ["g2", "g1"], now: NOW, actor: ACTOR,
      }),
    ).rejects.toThrow(/JUSTIFICATION_REQUIRED/i);
    await t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.reorderGroupsNative, {
      orgId: ORG, orderedIds: ["g2", "g1"], now: NOW + 1, actor: ACTOR,
      justification: "Client requested a change while on site today.",
    });
    await t.run(async (ctx) => {
      const g2 = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g2")).first();
      expect(g2?.sortOrder).toBe(0);
    });
  });

  test("rejects on a HARD_LOCKED (COMPLETED) project with no open FULL unlock session", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "COMPLETED", isTemplate: false, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: ORG, projectId: "p1", title: "A", sortOrder: 0 });
      await ctx.db.insert("projectGroups", { id: "g2", organizationId: ORG, projectId: "p1", title: "B", sortOrder: 1 });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.reorderGroupsNative, {
        orgId: ORG, orderedIds: ["g2", "g1"], now: NOW, actor: ACTOR, justification: "Doesn't matter — HARD_LOCKED needs a session, not a reason.",
      }),
    ).rejects.toThrow(/PROJECT_LOCKED/i);
  });
});

// ─── moveLineItemNative (single) ──────────────────────────────────────────────
describe("projectGroupsWrites.moveLineItemNative", () => {
  test("sub-hire write-back + BOTH-groups suggested-price recompute", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProjectAndCategories(t);
    await t.run(async (ctx) => {
      // Model dailyRate 100. Source group g1 holds the sub-hire line (qty 2), target g2 empty.
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "SM58", dailyRate: 100 });
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: ORG, projectId: "p1", categoryId: "cat1", title: "Src", sortOrder: 0, suggestedPrice: 200 });
      await ctx.db.insert("projectGroups", { id: "g2", organizationId: ORG, projectId: "p1", categoryId: "cat2", title: "Dst", sortOrder: 0, suggestedPrice: 0 });
      // Sub-hire chain: subHire → subHireGroup → line derived from it.
      await ctx.db.insert("subHires", { id: "sh1", organizationId: ORG, supplierId: "sup1", createdById: USER, projectId: "p1", orderNumber: "SO-1" });
      await ctx.db.insert("subHireGroups", { id: "shg1", subHireId: "sh1", title: "SubGrp", sortOrder: 0 });
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", groupId: "g1", categoryId: "cat1", modelId: "m1", quantity: 2, subHireId: "sh1", subHireGroupId: "shg1", isKitChild: false, isCustomItem: false, status: "CONFIRMED", type: "EQUIPMENT" });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.moveLineItemNative, {
      lineItemId: "li1", orgId: ORG, targetGroupId: "g2", targetCategoryId: "cat2", now: NOW, actor: ACTOR, auditId: "log1",
    });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(li?.groupId).toBe("g2");
      expect(li?.categoryId).toBe("cat2");
      // Sub-hire write-back onto the originating group's target* fields.
      const shg = await ctx.db.query("subHireGroups").withIndex("by_cuid", (q) => q.eq("id", "shg1")).first();
      expect(shg?.targetGroupId).toBe("g2");
      expect(shg?.targetCategoryId).toBe("cat2");
      // BOTH groups' suggested prices recomputed: source now empty (0), dest now 200.
      const g1 = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g1")).first();
      const g2 = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g2")).first();
      expect(g1?.suggestedPrice).toBe(0);
      expect(g2?.suggestedPrice).toBe(200);
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.summary).toBe("Moved line item to group");
    });
  });

  test("move to standalone (null target) clears groupId + categoryId; audit says standalone", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: ORG, projectId: "p1", categoryId: "cat1", title: "Src", sortOrder: 0, suggestedPrice: 0 });
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", groupId: "g1", categoryId: "cat1", quantity: 1, isKitChild: false, status: "CONFIRMED", type: "EQUIPMENT" });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.moveLineItemNative, {
      lineItemId: "li1", orgId: ORG, targetGroupId: null, targetCategoryId: null, now: NOW, actor: ACTOR, auditId: "log1",
    });
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(li?.groupId).toBeUndefined();
      expect(li?.categoryId).toBeUndefined();
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.summary).toBe("Moved line item to standalone");
    });
  });

  test("rejects a cross-org / cross-project target group (no dangling reference)", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", isKitChild: false, status: "CONFIRMED", type: "EQUIPMENT" });
      // A group in ANOTHER org — must not be assignable as a target.
      await ctx.db.insert("projectGroups", { id: "gForeign", organizationId: "org_other", projectId: "p9", title: "Theirs", sortOrder: 0 });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.moveLineItemNative, { lineItemId: "li1", orgId: ORG, targetGroupId: "gForeign", targetCategoryId: null, now: NOW, actor: ACTOR, auditId: "log1" }),
    ).rejects.toThrow(/Group not found/i);
    // The line was NOT moved.
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(li?.groupId).toBeUndefined();
    });
  });

  test("cross-org line is rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: "org_other", projectId: "p9", isKitChild: false });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.moveLineItemNative, { lineItemId: "li1", orgId: ORG, targetGroupId: null, targetCategoryId: null, now: NOW, actor: ACTOR, auditId: "log1" }),
    ).rejects.toThrow(/Line item not found/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.moveLineItemNative, { lineItemId: "li1", orgId: ORG, targetGroupId: null, targetCategoryId: null, now: NOW, actor: ACTOR, auditId: "log1" }),
    ).rejects.toThrow(/insufficient permissions/i);
  });

  // categorySlot bookkeeping — a line item only shares the combined
  // groups+line-items order (FEATUREDOCS/47) while it's standalone in a
  // category, so every move must keep that slot in sync.
  test("landing standalone in a category mints a categorySlot there", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProjectAndCategories(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", isKitChild: false, status: "CONFIRMED", type: "EQUIPMENT" });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.moveLineItemNative, {
      lineItemId: "li1", orgId: ORG, targetGroupId: null, targetCategoryId: "cat1", now: NOW, actor: ACTOR, auditId: "log1",
    });
    await t.run(async (ctx) => {
      const slot = await ctx.db.query("categorySlots").withIndex("by_lineItemId", (q) => q.eq("lineItemId", "li1")).first();
      expect(slot?.projectCategoryId).toBe("cat1");
    });
  });

  test("landing inside a group clears any existing standalone categorySlot", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProjectAndCategories(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: ORG, projectId: "p1", categoryId: "cat1", title: "Dst", sortOrder: 0 });
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", categoryId: "cat1", isKitChild: false, status: "CONFIRMED", type: "EQUIPMENT" });
      await ctx.db.insert("categorySlots", { id: "slLi", projectCategoryId: "cat1", lineItemId: "li1", sortOrder: 0 });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.moveLineItemNative, {
      lineItemId: "li1", orgId: ORG, targetGroupId: "g1", targetCategoryId: "cat1", now: NOW, actor: ACTOR, auditId: "log1",
    });
    await t.run(async (ctx) => {
      const slot = await ctx.db.query("categorySlots").withIndex("by_lineItemId", (q) => q.eq("lineItemId", "li1")).first();
      expect(slot).toBeNull();
    });
  });

  test("moving between categories drops the old category's slot and mints one in the new category", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProjectAndCategories(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", categoryId: "cat1", isKitChild: false, status: "CONFIRMED", type: "EQUIPMENT" });
      await ctx.db.insert("categorySlots", { id: "slLi", projectCategoryId: "cat1", lineItemId: "li1", sortOrder: 0 });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.moveLineItemNative, {
      lineItemId: "li1", orgId: ORG, targetGroupId: null, targetCategoryId: "cat2", now: NOW, actor: ACTOR, auditId: "log1",
    });
    await t.run(async (ctx) => {
      const slots = await ctx.db.query("categorySlots").withIndex("by_lineItemId", (q) => q.eq("lineItemId", "li1")).collect();
      expect(slots).toHaveLength(1);
      expect(slots[0].projectCategoryId).toBe("cat2");
    });
  });
});

// ─── moveLineItemsNative (bulk) ───────────────────────────────────────────────
describe("projectGroupsWrites.moveLineItemsNative", () => {
  test("skips isKitChild + recomputes suggested for every distinct source group + destination", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProjectAndCategories(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "SM58", dailyRate: 100 });
      // Two source groups (g1 with li1, g2 with li2), destination g3.
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: ORG, projectId: "p1", categoryId: "cat1", title: "S1", sortOrder: 0, suggestedPrice: 100 });
      await ctx.db.insert("projectGroups", { id: "g2", organizationId: ORG, projectId: "p1", categoryId: "cat1", title: "S2", sortOrder: 1, suggestedPrice: 100 });
      await ctx.db.insert("projectGroups", { id: "g3", organizationId: ORG, projectId: "p1", categoryId: "cat2", title: "Dst", sortOrder: 0, suggestedPrice: 0 });
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", groupId: "g1", categoryId: "cat1", modelId: "m1", quantity: 1, isKitChild: false, status: "CONFIRMED", type: "EQUIPMENT" });
      await ctx.db.insert("projectLineItems", { id: "li2", organizationId: ORG, projectId: "p1", groupId: "g2", categoryId: "cat1", modelId: "m1", quantity: 1, isKitChild: false, status: "CONFIRMED", type: "EQUIPMENT" });
      // Kit child — must be skipped, never moved.
      await ctx.db.insert("projectLineItems", { id: "liChild", organizationId: ORG, projectId: "p1", groupId: "g1", modelId: "m1", quantity: 1, isKitChild: true, status: "CONFIRMED", type: "EQUIPMENT" });
    });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.moveLineItemsNative, {
      lineItemIds: ["li1", "li2", "liChild"], orgId: ORG, targetGroupId: "g3", targetCategoryId: "cat2", now: NOW, actor: ACTOR, auditId: "log1",
    });
    expect(res.moved).toBe(2);
    expect(res.skipped).toBe(1); // liChild
    await t.run(async (ctx) => {
      const li1 = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      const li2 = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li2")).first();
      const child = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "liChild")).first();
      expect(li1?.groupId).toBe("g3");
      expect(li2?.groupId).toBe("g3");
      expect(child?.groupId).toBe("g1"); // untouched
      // Sources drained → 0; destination now holds two ×100 → 200.
      const g1 = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g1")).first();
      const g2 = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g2")).first();
      const g3 = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g3")).first();
      expect(g1?.suggestedPrice).toBe(0);
      expect(g2?.suggestedPrice).toBe(0);
      expect(g3?.suggestedPrice).toBe(200);
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.summary).toBe("Moved 2 line items to group");
    });
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectGroupsWrites.moveLineItemsNative, { lineItemIds: ["li1"], orgId: ORG, targetGroupId: null, targetCategoryId: null, now: NOW, actor: ACTOR, auditId: "log1" }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});
