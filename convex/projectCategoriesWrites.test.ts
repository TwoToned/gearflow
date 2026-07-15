// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";

const modules = import.meta.glob("./**/*.ts");
// Mount the rate limiter (enforceBrowserWriteLimit) + sharded counter (other convex
// modules in the same test glob need it), matching lineItemWrites.test.ts.
function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const asUser = (orgId: string) => ({ subject: USER, orgId });
const ACTOR = { userId: USER, userName: "Alice" };

async function member(t: ReturnType<typeof convexTest>, role: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role });
  });
}

describe("projectCategoriesWrites.createCategoryNative", () => {
  const args = { id: "c1", orgId: ORG, projectId: "p1", name: "Audio", now: NOW, actor: ACTOR, auditId: "log1" };

  test("member creates a category (sortOrder max+1) + CREATE audit", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectCategories", { id: "existing", organizationId: ORG, projectId: "p1", name: "Lights", sortOrder: 3 });
    });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.projectCategoriesWrites.createCategoryNative, args);
    expect(res.sortOrder).toBe(4); // max(3)+1
    await t.run(async (ctx) => {
      const cat = await ctx.db.query("projectCategories").withIndex("by_cuid", (q) => q.eq("id", "c1")).first();
      expect(cat?.name).toBe("Audio");
      expect(cat?.sortOrder).toBe(4);
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("created");
      expect(log?.entityType).toBe("project");
      expect(log?.entityId).toBe("p1");
      expect(log?.summary).toBe('Created category "Audio"');
    });
  });

  test("first category gets sortOrder 0", async () => {
    const t = makeT();
    await member(t, "member");
    const res = await t.withIdentity(asUser(ORG)).mutation(api.projectCategoriesWrites.createCategoryNative, args);
    expect(res.sortOrder).toBe(0);
  });

  test("a duplicate submit (same cuid) is idempotent — no second row/audit", async () => {
    const t = makeT();
    await member(t, "member");
    await t.withIdentity(asUser(ORG)).mutation(api.projectCategoriesWrites.createCategoryNative, args);
    await t.withIdentity(asUser(ORG)).mutation(api.projectCategoriesWrites.createCategoryNative, { ...args, auditId: "log2" });
    await t.run(async (ctx) => {
      const cats = await ctx.db.query("projectCategories").withIndex("by_cuid", (q) => q.eq("id", "c1")).collect();
      expect(cats).toHaveLength(1);
      const log2 = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log2")).first();
      expect(log2).toBeNull();
    });
  });

  test("rejects an empty name", async () => {
    const t = makeT();
    await member(t, "member");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectCategoriesWrites.createCategoryNative, { ...args, name: "" }),
    ).rejects.toThrow(/name is required/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectCategoriesWrites.createCategoryNative, args),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("projectCategoriesWrites.updateCategoryNative", () => {
  const args = { id: "c1", orgId: ORG, name: "Renamed", now: NOW, actor: ACTOR, auditId: "log1" };

  test("member renames + UPDATE audit (old name) + collab event (new name)", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectCategories", { id: "c1", organizationId: ORG, projectId: "p1", name: "Audio", sortOrder: 0 });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.projectCategoriesWrites.updateCategoryNative, args);
    await t.run(async (ctx) => {
      const cat = await ctx.db.query("projectCategories").withIndex("by_cuid", (q) => q.eq("id", "c1")).first();
      expect(cat?.name).toBe("Renamed");
      expect(cat?.updatedAt).toBe(NOW);
      // Audit uses the PRE-patch name (parity with the deleted server action).
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("updated");
      expect(log?.entityName).toBe("Audio");
      expect(log?.summary).toBe('Updated category "Audio"');
      // Collaboration activity event uses the NEW name.
      const events = await ctx.db.query("activityEvents").collect();
      expect(events).toHaveLength(1);
      expect(events[0].action).toBe("category_updated");
      expect(events[0].targetType).toBe("category");
      expect(events[0].targetId).toBe("c1");
      expect(events[0].summary).toBe('renamed a category to "Renamed"');
    });
  });

  test("a sortOrder-only update writes NO collab event", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectCategories", { id: "c1", organizationId: ORG, projectId: "p1", name: "Audio", sortOrder: 0 });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.projectCategoriesWrites.updateCategoryNative, { id: "c1", orgId: ORG, sortOrder: 7, now: NOW, actor: ACTOR, auditId: "log1" });
    await t.run(async (ctx) => {
      const cat = await ctx.db.query("projectCategories").withIndex("by_cuid", (q) => q.eq("id", "c1")).first();
      expect(cat?.sortOrder).toBe(7);
      const events = await ctx.db.query("activityEvents").collect();
      expect(events).toHaveLength(0);
    });
  });

  test("cross-org category is rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectCategories", { id: "c1", organizationId: "org_other", projectId: "p9", name: "Theirs", sortOrder: 0 });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectCategoriesWrites.updateCategoryNative, args),
    ).rejects.toThrow(/Category not found/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectCategoriesWrites.updateCategoryNative, args),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("projectCategoriesWrites.deleteCategoryNative", () => {
  const args = { id: "c1", orgId: ORG, now: NOW, actor: ACTOR, auditId: "log1" };

  // Category c1 with a group g1, a slot per each, and two lines: one in the group,
  // one directly in the category. Both must move to uncategorized; groups+slots gone.
  async function seedCascade(t: ReturnType<typeof makeT>) {
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectCategories", { id: "c1", organizationId: ORG, projectId: "p1", name: "Audio", sortOrder: 0 });
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: ORG, projectId: "p1", categoryId: "c1", title: "Mics", sortOrder: 0 });
      await ctx.db.insert("categorySlots", { id: "slCat", projectCategoryId: "c1", sortOrder: 0 });
      await ctx.db.insert("categorySlots", { id: "slGrp", projectCategoryId: "c1", projectGroupId: "g1", sortOrder: 1 });
      await ctx.db.insert("projectLineItems", { id: "liInGroup", organizationId: ORG, projectId: "p1", groupId: "g1", categoryId: "c1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false });
      await ctx.db.insert("projectLineItems", { id: "liInCat", organizationId: ORG, projectId: "p1", categoryId: "c1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false });
    });
  }

  test("member cascade-deletes groups+slots, null-outs affected lines, DELETE audit (N=2)", async () => {
    const t = makeT();
    await seedCascade(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.projectCategoriesWrites.deleteCategoryNative, args);
    expect(res.movedLineItems).toBe(2);
    await t.run(async (ctx) => {
      // Category + group gone.
      expect(await ctx.db.query("projectCategories").withIndex("by_cuid", (q) => q.eq("id", "c1")).first()).toBeNull();
      expect(await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g1")).first()).toBeNull();
      // Both slots gone.
      const slots = await ctx.db.query("categorySlots").withIndex("by_projectCategoryId", (q) => q.eq("projectCategoryId", "c1")).collect();
      expect(slots).toHaveLength(0);
      // Lines survive but are now uncategorized.
      const l1 = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "liInGroup")).first();
      const l2 = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "liInCat")).first();
      expect(l1?.categoryId).toBeUndefined();
      expect(l1?.groupId).toBeUndefined();
      expect(l2?.categoryId).toBeUndefined();
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("deleted");
      expect(log?.summary).toBe('Deleted category "Audio" — 2 items moved to uncategorized');
    });
  });

  test("cross-org category is rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectCategories", { id: "c1", organizationId: "org_other", projectId: "p9", name: "Theirs", sortOrder: 0 });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectCategoriesWrites.deleteCategoryNative, args),
    ).rejects.toThrow(/Category not found/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectCategoriesWrites.deleteCategoryNative, args),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("projectCategoriesWrites.reorderCategoriesNative", () => {
  test("member reorders (sortOrder = index), org-scoped, NO audit", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectCategories", { id: "c1", organizationId: ORG, projectId: "p1", name: "A", sortOrder: 0 });
      await ctx.db.insert("projectCategories", { id: "c2", organizationId: ORG, projectId: "p1", name: "B", sortOrder: 1 });
      await ctx.db.insert("projectCategories", { id: "cOther", organizationId: "org_other", projectId: "p9", name: "X", sortOrder: 5 });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.projectCategoriesWrites.reorderCategoriesNative, {
      orgId: ORG,
      orderedIds: ["c2", "c1", "cOther"],
      now: NOW,
      actor: ACTOR,
    });
    await t.run(async (ctx) => {
      const c1 = await ctx.db.query("projectCategories").withIndex("by_cuid", (q) => q.eq("id", "c1")).first();
      const c2 = await ctx.db.query("projectCategories").withIndex("by_cuid", (q) => q.eq("id", "c2")).first();
      const other = await ctx.db.query("projectCategories").withIndex("by_cuid", (q) => q.eq("id", "cOther")).first();
      expect(c2?.sortOrder).toBe(0);
      expect(c1?.sortOrder).toBe(1);
      expect(other?.sortOrder).toBe(5); // cross-org row untouched
      // No audit rows for a reorder (parity).
      const logs = await ctx.db.query("activityLogs").collect();
      expect(logs).toHaveLength(0);
    });
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectCategoriesWrites.reorderCategoriesNative, { orgId: ORG, orderedIds: [], now: NOW, actor: ACTOR }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});
