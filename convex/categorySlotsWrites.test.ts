// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";

const modules = import.meta.glob("./**/*.ts");
// Mount the rate limiter (enforceBrowserWriteLimit) + sharded counter (other convex
// modules in the same test glob need it), matching projectGroupsWrites.test.ts.
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
      id, organizationId: orgId, projectNumber: `P-${id}`, name: "Gig", status: "CONFIRMED",
      total: 999,
    });
  });
}

async function seedCategory(t: ReturnType<typeof makeT>, id: string, projectId = "p1", orgId = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projectCategories", { id, organizationId: orgId, projectId, name: id, sortOrder: 0 });
  });
}

// ─── moveSubHireGroupToCategory ───────────────────────────────────────────────
describe("categorySlotsWrites.moveSubHireGroupToCategory", () => {
  // moveSubHireGroupToCategory requires subHire:update (manager+, not plain member).
  async function seedSubHireGroup(t: ReturnType<typeof makeT>, opts?: { subHireOrg?: string; subHireProject?: string }) {
    await member(t, "manager");
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("subHires", {
        id: "sh1", organizationId: opts?.subHireOrg ?? ORG, supplierId: "sup1", createdById: USER,
        projectId: opts?.subHireProject ?? "p1", orderNumber: "SO-1",
      });
      await ctx.db.insert("subHireGroups", { id: "shg1", subHireId: "sh1", title: "SubGrp", sortOrder: 0 });
      // Top-level synthetic parent line for the sub-hire group.
      await ctx.db.insert("projectLineItems", {
        id: "li1", organizationId: ORG, projectId: "p1", subHireId: "sh1", subHireGroupId: "shg1",
        quantity: 1, isKitChild: false, status: "CONFIRMED", type: "EQUIPMENT",
      });
    });
  }

  test("places the group into a category: shg.targetCategoryId + slot + line sync + audit", async () => {
    const t = makeT();
    await seedSubHireGroup(t);
    await seedCategory(t, "cat1");
    await t.withIdentity(asUser(ORG)).mutation(api.categorySlotsWrites.moveSubHireGroupToCategory, {
      groupId: "shg1", orgId: ORG, categoryId: "cat1", slotId: "sl1", now: NOW, actor: ACTOR, auditId: "log1",
    });
    await t.run(async (ctx) => {
      const shg = await ctx.db.query("subHireGroups").withIndex("by_cuid", (q) => q.eq("id", "shg1")).first();
      expect(shg?.targetCategoryId).toBe("cat1");
      const slots = await ctx.db.query("categorySlots").withIndex("by_subHireGroupId", (q) => q.eq("subHireGroupId", "shg1")).collect();
      expect(slots).toHaveLength(1);
      expect(slots[0].projectCategoryId).toBe("cat1");
      expect(slots[0].sortOrder).toBe(0);
      // Synthetic parent line's categoryId synced.
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(li?.categoryId).toBe("cat1");
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.summary).toBe("Moved sub-hire group to category cat1");
    });
  });

  test("moving to uncategorised (null) clears targetCategoryId + removes the slot", async () => {
    const t = makeT();
    await seedSubHireGroup(t);
    await seedCategory(t, "cat1");
    await t.run(async (ctx) => {
      await ctx.db.patch(
        (await ctx.db.query("subHireGroups").withIndex("by_cuid", (q) => q.eq("id", "shg1")).first())!._id,
        { targetCategoryId: "cat1" },
      );
      await ctx.db.insert("categorySlots", { id: "slOld", projectCategoryId: "cat1", subHireGroupId: "shg1", sortOrder: 0 });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.categorySlotsWrites.moveSubHireGroupToCategory, {
      groupId: "shg1", orgId: ORG, categoryId: null, slotId: "sl1", now: NOW, actor: ACTOR, auditId: "log1",
    });
    await t.run(async (ctx) => {
      const shg = await ctx.db.query("subHireGroups").withIndex("by_cuid", (q) => q.eq("id", "shg1")).first();
      expect(shg?.targetCategoryId).toBeUndefined();
      const slots = await ctx.db.query("categorySlots").withIndex("by_subHireGroupId", (q) => q.eq("subHireGroupId", "shg1")).collect();
      expect(slots).toHaveLength(0);
    });
  });

  test("cross-org sub-hire group is rejected", async () => {
    const t = makeT();
    await seedSubHireGroup(t, { subHireOrg: "org_other" });
    await seedCategory(t, "cat1");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.categorySlotsWrites.moveSubHireGroupToCategory, {
        groupId: "shg1", orgId: ORG, categoryId: "cat1", slotId: "sl1", now: NOW, actor: ACTOR, auditId: "log1",
      }),
    ).rejects.toThrow(/Sub-hire group not found/i);
  });

  test("cross-project target category is rejected (no dangling reference)", async () => {
    const t = makeT();
    await seedSubHireGroup(t); // sub-hire on project p1
    // Category belongs to a DIFFERENT project (same org).
    await seedProject(t, "p2");
    await seedCategory(t, "catP2", "p2");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.categorySlotsWrites.moveSubHireGroupToCategory, {
        groupId: "shg1", orgId: ORG, categoryId: "catP2", slotId: "sl1", now: NOW, actor: ACTOR, auditId: "log1",
      }),
    ).rejects.toThrow(/across projects/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.categorySlotsWrites.moveSubHireGroupToCategory, {
        groupId: "shg1", orgId: ORG, categoryId: null, slotId: "sl1", now: NOW, actor: ACTOR, auditId: "log1",
      }),
    ).rejects.toThrow(/insufficient permissions/i);
  });

  // Gap fix: moveSubHireGroupToCategory previously never called assertLifecycleGuard.
  test("rejects on an ON_SITE project without justification, succeeds with one", async () => {
    const t = makeT();
    await seedSubHireGroup(t);
    await seedCategory(t, "cat1");
    await t.run(async (ctx) => {
      await ctx.db.patch((await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first())!._id, { status: "ON_SITE" });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.categorySlotsWrites.moveSubHireGroupToCategory, {
        groupId: "shg1", orgId: ORG, categoryId: "cat1", slotId: "sl1", now: NOW, actor: ACTOR, auditId: "log1",
      }),
    ).rejects.toThrow(/JUSTIFICATION_REQUIRED/i);
    await t.withIdentity(asUser(ORG)).mutation(api.categorySlotsWrites.moveSubHireGroupToCategory, {
      groupId: "shg1", orgId: ORG, categoryId: "cat1", slotId: "sl1", now: NOW + 1, actor: ACTOR, auditId: "log1",
      justification: "Client requested a change while on site today.",
    });
    await t.run(async (ctx) => {
      const shg = await ctx.db.query("subHireGroups").withIndex("by_cuid", (q) => q.eq("id", "shg1")).first();
      expect(shg?.targetCategoryId).toBe("cat1");
    });
  });
});

// ─── moveProjectGroupToCategory ───────────────────────────────────────────────
describe("categorySlotsWrites.moveProjectGroupToCategory", () => {
  async function seedProjectGroup(t: ReturnType<typeof makeT>) {
    await member(t, "member");
    await seedProject(t);
    await seedCategory(t, "cat1");
    await seedCategory(t, "cat2");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: ORG, projectId: "p1", categoryId: "cat1", title: "Mics", sortOrder: 0 });
      await ctx.db.insert("projectLineItems", {
        id: "li1", organizationId: ORG, projectId: "p1", groupId: "g1", categoryId: "cat1",
        quantity: 1, isKitChild: false, status: "CONFIRMED", type: "EQUIPMENT",
      });
      await ctx.db.insert("categorySlots", { id: "slOld", projectCategoryId: "cat1", projectGroupId: "g1", sortOrder: 0 });
    });
  }

  test("moves group to another category: group.categoryId + line sync + slot rehome + audit", async () => {
    const t = makeT();
    await seedProjectGroup(t);
    await t.withIdentity(asUser(ORG)).mutation(api.categorySlotsWrites.moveProjectGroupToCategory, {
      groupId: "g1", orgId: ORG, categoryId: "cat2", slotId: "slNew", now: NOW, actor: ACTOR, auditId: "log1",
    });
    await t.run(async (ctx) => {
      const g = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g1")).first();
      expect(g?.categoryId).toBe("cat2");
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(li?.categoryId).toBe("cat2");
      const slots = await ctx.db.query("categorySlots").withIndex("by_projectGroupId", (q) => q.eq("projectGroupId", "g1")).collect();
      expect(slots).toHaveLength(1);
      expect(slots[0].projectCategoryId).toBe("cat2");
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.summary).toBe("Moved project group to category cat2");
    });
  });

  test("moving to uncategorised (null) clears categoryId", async () => {
    const t = makeT();
    await seedProjectGroup(t);
    await t.withIdentity(asUser(ORG)).mutation(api.categorySlotsWrites.moveProjectGroupToCategory, {
      groupId: "g1", orgId: ORG, categoryId: null, slotId: "slNew", now: NOW, actor: ACTOR, auditId: "log1",
    });
    await t.run(async (ctx) => {
      const g = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g1")).first();
      expect(g?.categoryId).toBeUndefined();
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(li?.categoryId).toBeUndefined();
      const slots = await ctx.db.query("categorySlots").withIndex("by_projectGroupId", (q) => q.eq("projectGroupId", "g1")).collect();
      expect(slots).toHaveLength(0);
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.summary).toBe("Moved project group to uncategorised");
    });
  });

  test("no-op when already in the destination (no audit written)", async () => {
    const t = makeT();
    await seedProjectGroup(t); // g1 already in cat1
    const res = await t.withIdentity(asUser(ORG)).mutation(api.categorySlotsWrites.moveProjectGroupToCategory, {
      groupId: "g1", orgId: ORG, categoryId: "cat1", slotId: "slNew", now: NOW, actor: ACTOR, auditId: "log1",
    });
    expect(res.noop).toBe(true);
    await t.run(async (ctx) => {
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log).toBeNull();
    });
  });

  test("cross-project target category is rejected", async () => {
    const t = makeT();
    await seedProjectGroup(t);
    await seedProject(t, "p2");
    await seedCategory(t, "catP2", "p2");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.categorySlotsWrites.moveProjectGroupToCategory, {
        groupId: "g1", orgId: ORG, categoryId: "catP2", slotId: "slNew", now: NOW, actor: ACTOR, auditId: "log1",
      }),
    ).rejects.toThrow(/across projects/i);
  });

  test("cross-org group is rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: "org_other", projectId: "p9", title: "Theirs", sortOrder: 0 });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.categorySlotsWrites.moveProjectGroupToCategory, {
        groupId: "g1", orgId: ORG, categoryId: null, slotId: "slNew", now: NOW, actor: ACTOR, auditId: "log1",
      }),
    ).rejects.toThrow(/Project group not found/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.categorySlotsWrites.moveProjectGroupToCategory, {
        groupId: "g1", orgId: ORG, categoryId: null, slotId: "slNew", now: NOW, actor: ACTOR, auditId: "log1",
      }),
    ).rejects.toThrow(/insufficient permissions/i);
  });

  // Gap fix: moveProjectGroupToCategory previously never called assertLifecycleGuard.
  test("rejects on a HARD_LOCKED (COMPLETED) project with no open FULL unlock session", async () => {
    const t = makeT();
    await seedProjectGroup(t);
    await t.run(async (ctx) => {
      await ctx.db.patch((await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first())!._id, { status: "COMPLETED" });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.categorySlotsWrites.moveProjectGroupToCategory, {
        groupId: "g1", orgId: ORG, categoryId: "cat2", slotId: "slNew", now: NOW, actor: ACTOR, auditId: "log1",
        justification: "Doesn't matter — HARD_LOCKED needs a session, not a reason.",
      }),
    ).rejects.toThrow(/PROJECT_LOCKED/i);
  });
});

// ─── reorderMixedGroupsInCategory ─────────────────────────────────────────────
describe("categorySlotsWrites.reorderMixedGroupsInCategory", () => {
  // reorderMixedGroupsInCategory requires subHire:update (manager+, not plain member).
  async function seedMixed(t: ReturnType<typeof makeT>) {
    await member(t, "manager");
    await seedProject(t);
    await seedCategory(t, "cat1");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: ORG, projectId: "p1", categoryId: "cat1", title: "PG", sortOrder: 0 });
      await ctx.db.insert("subHires", { id: "sh1", organizationId: ORG, supplierId: "sup1", createdById: USER, projectId: "p1", orderNumber: "SO-1" });
      await ctx.db.insert("subHireGroups", { id: "shg1", subHireId: "sh1", title: "SHG", sortOrder: 0 });
      await ctx.db.insert("categorySlots", { id: "slPg", projectCategoryId: "cat1", projectGroupId: "g1", sortOrder: 0 });
      await ctx.db.insert("categorySlots", { id: "slShg", projectCategoryId: "cat1", subHireGroupId: "shg1", sortOrder: 1 });
    });
  }

  test("rewrites slot sortOrder = position for the mixed list (pg + shg)", async () => {
    const t = makeT();
    await seedMixed(t);
    // Reorder: sub-hire group first, project group second.
    await t.withIdentity(asUser(ORG)).mutation(api.categorySlotsWrites.reorderMixedGroupsInCategory, {
      orgId: ORG, categoryId: "cat1",
      items: [{ prefixedId: "shg-shg1", newSlotId: "n1" }, { prefixedId: "pg-g1", newSlotId: "n2" }],
      now: NOW, actor: ACTOR,
    });
    await t.run(async (ctx) => {
      const pgSlot = (await ctx.db.query("categorySlots").withIndex("by_projectGroupId", (q) => q.eq("projectGroupId", "g1")).collect())[0];
      const shgSlot = (await ctx.db.query("categorySlots").withIndex("by_subHireGroupId", (q) => q.eq("subHireGroupId", "shg1")).collect())[0];
      expect(shgSlot.sortOrder).toBe(0);
      expect(pgSlot.sortOrder).toBe(1);
    });
  });

  test("mints a slot for a group that has none yet", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t);
    await seedCategory(t, "cat1");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: ORG, projectId: "p1", categoryId: "cat1", title: "PG", sortOrder: 0 });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.categorySlotsWrites.reorderMixedGroupsInCategory, {
      orgId: ORG, categoryId: "cat1",
      items: [{ prefixedId: "pg-g1", newSlotId: "nMint" }],
      now: NOW, actor: ACTOR,
    });
    await t.run(async (ctx) => {
      const slot = await ctx.db.query("categorySlots").withIndex("by_cuid", (q) => q.eq("id", "nMint")).first();
      expect(slot?.projectGroupId).toBe("g1");
      expect(slot?.sortOrder).toBe(0);
    });
  });

  test("rejects a cross-project sub-hire group", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t);
    await seedCategory(t, "cat1");
    await t.run(async (ctx) => {
      // Sub-hire on a DIFFERENT project.
      await ctx.db.insert("subHires", { id: "sh1", organizationId: ORG, supplierId: "sup1", createdById: USER, projectId: "pOther", orderNumber: "SO-1" });
      await ctx.db.insert("subHireGroups", { id: "shg1", subHireId: "sh1", title: "SHG", sortOrder: 0 });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.categorySlotsWrites.reorderMixedGroupsInCategory, {
        orgId: ORG, categoryId: "cat1",
        items: [{ prefixedId: "shg-shg1", newSlotId: "n1" }],
        now: NOW, actor: ACTOR,
      }),
    ).rejects.toThrow(/do not belong to this project/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.categorySlotsWrites.reorderMixedGroupsInCategory, {
        orgId: ORG, categoryId: "cat1", items: [{ prefixedId: "pg-g1", newSlotId: "n1" }], now: NOW, actor: ACTOR,
      }),
    ).rejects.toThrow(/insufficient permissions/i);
  });

  // Gap fix: reorderMixedGroupsInCategory previously never called assertLifecycleGuard.
  test("rejects on an ON_SITE project without justification, succeeds with one", async () => {
    const t = makeT();
    await seedMixed(t);
    await t.run(async (ctx) => {
      await ctx.db.patch((await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first())!._id, { status: "ON_SITE" });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.categorySlotsWrites.reorderMixedGroupsInCategory, {
        orgId: ORG, categoryId: "cat1",
        items: [{ prefixedId: "shg-shg1", newSlotId: "n1" }, { prefixedId: "pg-g1", newSlotId: "n2" }],
        now: NOW, actor: ACTOR,
      }),
    ).rejects.toThrow(/JUSTIFICATION_REQUIRED/i);
    await t.withIdentity(asUser(ORG)).mutation(api.categorySlotsWrites.reorderMixedGroupsInCategory, {
      orgId: ORG, categoryId: "cat1",
      items: [{ prefixedId: "shg-shg1", newSlotId: "n1" }, { prefixedId: "pg-g1", newSlotId: "n2" }],
      now: NOW + 1, actor: ACTOR,
      justification: "Client requested a change while on site today.",
    });
    await t.run(async (ctx) => {
      const shgSlot = (await ctx.db.query("categorySlots").withIndex("by_subHireGroupId", (q) => q.eq("subHireGroupId", "shg1")).collect())[0];
      expect(shgSlot.sortOrder).toBe(0);
    });
  });
});

// ─── createCategoryAndPlaceGroup ──────────────────────────────────────────────
describe("categorySlotsWrites.createCategoryAndPlaceGroup", () => {
  const base = { categoryId: "catNew", slotId: "slNew", orgId: ORG, projectId: "p1", name: "New Cat", now: NOW, actor: ACTOR, auditId: "log1" };

  test("creates the category + places a project group atomically", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await t.run(async (ctx) => {
      // Existing category so create-at-end computes sortOrder 1.
      await ctx.db.insert("projectCategories", { id: "cat0", organizationId: ORG, projectId: "p1", name: "cat0", sortOrder: 0 });
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: ORG, projectId: "p1", title: "Mics", sortOrder: 0 });
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", groupId: "g1", quantity: 1, isKitChild: false, status: "CONFIRMED", type: "EQUIPMENT" });
    });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.categorySlotsWrites.createCategoryAndPlaceGroup, {
      ...base, slot: { projectGroupId: "g1" },
    });
    expect(res.id).toBe("catNew");
    expect(res.sortOrder).toBe(1);
    await t.run(async (ctx) => {
      const cat = await ctx.db.query("projectCategories").withIndex("by_cuid", (q) => q.eq("id", "catNew")).first();
      expect(cat?.name).toBe("New Cat");
      const slot = await ctx.db.query("categorySlots").withIndex("by_cuid", (q) => q.eq("id", "slNew")).first();
      expect(slot?.projectCategoryId).toBe("catNew");
      expect(slot?.projectGroupId).toBe("g1");
      expect(slot?.sortOrder).toBe(0);
      const g = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "g1")).first();
      expect(g?.categoryId).toBe("catNew");
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(li?.categoryId).toBe("catNew");
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("created");
      expect(log?.summary).toBe('Created category "New Cat" and placed a group inside');
    });
  });

  test("creates the category + places a sub-hire group atomically", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("subHires", { id: "sh1", organizationId: ORG, supplierId: "sup1", createdById: USER, projectId: "p1", orderNumber: "SO-1" });
      await ctx.db.insert("subHireGroups", { id: "shg1", subHireId: "sh1", title: "SHG", sortOrder: 0 });
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", subHireId: "sh1", subHireGroupId: "shg1", quantity: 1, isKitChild: false, status: "CONFIRMED", type: "EQUIPMENT" });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.categorySlotsWrites.createCategoryAndPlaceGroup, {
      ...base, slot: { subHireGroupId: "shg1" },
    });
    await t.run(async (ctx) => {
      const shg = await ctx.db.query("subHireGroups").withIndex("by_cuid", (q) => q.eq("id", "shg1")).first();
      expect(shg?.targetCategoryId).toBe("catNew");
      const slot = await ctx.db.query("categorySlots").withIndex("by_cuid", (q) => q.eq("id", "slNew")).first();
      expect(slot?.subHireGroupId).toBe("shg1");
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first();
      expect(li?.categoryId).toBe("catNew");
    });
  });

  test("rejects a slot referencing both group kinds (XOR)", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.categorySlotsWrites.createCategoryAndPlaceGroup, {
        ...base, slot: { projectGroupId: "g1", subHireGroupId: "shg1" },
      }),
    ).rejects.toThrow(/exactly one/i);
  });

  test("rejects a cross-project project group", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: ORG, projectId: "pOther", title: "Elsewhere", sortOrder: 0 });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.categorySlotsWrites.createCategoryAndPlaceGroup, {
        ...base, slot: { projectGroupId: "g1" },
      }),
    ).rejects.toThrow(/not found in this project/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.categorySlotsWrites.createCategoryAndPlaceGroup, {
        ...base, slot: { projectGroupId: "g1" },
      }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});
