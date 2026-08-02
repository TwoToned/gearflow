// @vitest-environment node
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
const USER = "user_1";
const NOW = 1_700_000_000_000;
const asUser = (orgId: string) => ({ subject: USER, orgId });
const ACTOR = { userId: USER, userName: "Alice" };

async function member(t: ReturnType<typeof convexTest>, role: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role });
  });
}

// ─── saveGroupAsTemplateNative ────────────────────────────────────────────────
describe("groupTemplatesWrites.saveGroupAsTemplateNative", () => {
  async function seedGroup(t: ReturnType<typeof makeT>, orgId = ORG) {
    await t.run(async (ctx) => {
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: orgId, projectId: "p1", title: "Stage Rig", sortOrder: 0 });
      // model line (templatable), kit line (templatable), free-text line (dropped), kit-child (dropped)
      await ctx.db.insert("projectLineItems", { id: "liModel", organizationId: orgId, projectId: "p1", groupId: "g1", modelId: "m1", quantity: 2, sortOrder: 0, isKitChild: false, status: "CONFIRMED", type: "EQUIPMENT" });
      await ctx.db.insert("projectLineItems", { id: "liKit", organizationId: orgId, projectId: "p1", groupId: "g1", kitId: "k1", quantity: 1, sortOrder: 1, isKitChild: false, status: "CONFIRMED", type: "EQUIPMENT" });
      await ctx.db.insert("projectLineItems", { id: "liFree", organizationId: orgId, projectId: "p1", groupId: "g1", description: "Labour", quantity: 1, sortOrder: 2, isKitChild: false, status: "CONFIRMED", type: "EQUIPMENT" });
      await ctx.db.insert("projectLineItems", { id: "liChild", organizationId: orgId, projectId: "p1", groupId: "g1", modelId: "m9", quantity: 1, sortOrder: 3, isKitChild: true, status: "CONFIRMED", type: "EQUIPMENT" });
    });
  }
  const args = { templateId: "tpl1", orgId: ORG, groupId: "g1", name: "Stage Kit", description: "reusable", now: NOW, actor: ACTOR, auditId: "log1" };

  test("member saves group → template + only model/kit items + CREATE audit", async () => {
    const t = makeT();
    await member(t, "member");
    await seedGroup(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.groupTemplatesWrites.saveGroupAsTemplateNative, args);
    expect(res.id).toBe("tpl1");
    await t.run(async (ctx) => {
      const tpl = await ctx.db.query("groupTemplates").withIndex("by_cuid", (q) => q.eq("id", "tpl1")).first();
      expect(tpl?.name).toBe("Stage Kit");
      const items = (await ctx.db.query("groupTemplateItems").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect())
        .filter((it) => it.templateId === "tpl1")
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      expect(items).toHaveLength(2); // free-text + kit-child dropped
      expect(items[0].modelId).toBe("m1");
      expect(items[0].quantity).toBe(2);
      expect(items[1].kitId).toBe("k1");
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("CREATE");
      expect(log?.summary).toBe('Saved group "Stage Rig" as template "Stage Kit"');
    });
  });

  test("throws when the group has no model/kit-backed items", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: ORG, projectId: "p1", title: "Empty", sortOrder: 0 });
      await ctx.db.insert("projectLineItems", { id: "liFree", organizationId: ORG, projectId: "p1", groupId: "g1", description: "Labour", quantity: 1, sortOrder: 0, isKitChild: false, status: "CONFIRMED", type: "EQUIPMENT" });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.groupTemplatesWrites.saveGroupAsTemplateNative, args),
    ).rejects.toThrow(/no model- or kit-backed items/i);
  });

  test("cross-org group rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await seedGroup(t, "org_other");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.groupTemplatesWrites.saveGroupAsTemplateNative, args),
    ).rejects.toThrow(/Group not found/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await seedGroup(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.groupTemplatesWrites.saveGroupAsTemplateNative, args),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

// ─── updateTemplateNative ─────────────────────────────────────────────────────
describe("groupTemplatesWrites.updateTemplateNative", () => {
  async function seedTemplate(t: ReturnType<typeof makeT>, orgId = ORG) {
    await t.run(async (ctx) => {
      await ctx.db.insert("groupTemplates", { id: "tpl1", organizationId: orgId, name: "Old", description: "old desc", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("groupTemplateItems", { id: "it1", organizationId: orgId, templateId: "tpl1", modelId: "m1", quantity: 1, sortOrder: 0 });
    });
  }

  test("member renames + UPDATE audit", async () => {
    const t = makeT();
    await member(t, "member");
    await seedTemplate(t);
    await t.withIdentity(asUser(ORG)).mutation(api.groupTemplatesWrites.updateTemplateNative, {
      templateId: "tpl1", orgId: ORG, name: "New Name", description: "new desc", now: NOW + 1, actor: ACTOR, auditId: "log1",
    });
    await t.run(async (ctx) => {
      const tpl = await ctx.db.query("groupTemplates").withIndex("by_cuid", (q) => q.eq("id", "tpl1")).first();
      expect(tpl?.name).toBe("New Name");
      expect(tpl?.description).toBe("new desc");
      expect(tpl?.updatedAt).toBe(NOW + 1);
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("UPDATE");
      expect(log?.summary).toBe('Updated group template "New Name"');
    });
  });

  test("items replace-all removes old items and inserts the new set", async () => {
    const t = makeT();
    await member(t, "member");
    await seedTemplate(t);
    await t.withIdentity(asUser(ORG)).mutation(api.groupTemplatesWrites.updateTemplateNative, {
      templateId: "tpl1", orgId: ORG,
      items: [{ kitId: "k9", quantity: 3 }],
      now: NOW + 1, actor: ACTOR, auditId: "log1",
    });
    await t.run(async (ctx) => {
      const items = (await ctx.db.query("groupTemplateItems").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect())
        .filter((it) => it.templateId === "tpl1");
      expect(items).toHaveLength(1);
      expect(items[0].kitId).toBe("k9");
      expect(items[0].quantity).toBe(3);
      // Old model item is gone.
      const old = await ctx.db.query("groupTemplateItems").withIndex("by_cuid", (q) => q.eq("id", "it1")).first();
      expect(old).toBeNull();
    });
  });

  test("cross-org template rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await seedTemplate(t, "org_other");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.groupTemplatesWrites.updateTemplateNative, { templateId: "tpl1", orgId: ORG, name: "X", now: NOW, actor: ACTOR, auditId: "log1" }),
    ).rejects.toThrow(/Group template not found/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await seedTemplate(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.groupTemplatesWrites.updateTemplateNative, { templateId: "tpl1", orgId: ORG, name: "X", now: NOW, actor: ACTOR, auditId: "log1" }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

// ─── deleteTemplateNative ─────────────────────────────────────────────────────
describe("groupTemplatesWrites.deleteTemplateNative", () => {
  async function seedTemplate(t: ReturnType<typeof makeT>, orgId = ORG) {
    await t.run(async (ctx) => {
      await ctx.db.insert("groupTemplates", { id: "tpl1", organizationId: orgId, name: "Doomed", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("groupTemplateItems", { id: "it1", organizationId: orgId, templateId: "tpl1", modelId: "m1", quantity: 1, sortOrder: 0 });
      await ctx.db.insert("groupTemplateItems", { id: "it2", organizationId: orgId, templateId: "tpl1", kitId: "k1", quantity: 1, sortOrder: 1 });
    });
  }
  const args = { templateId: "tpl1", orgId: ORG, now: NOW, actor: ACTOR, auditId: "log1" };

  test("member cascade-deletes children + parent + DELETE audit", async () => {
    const t = makeT();
    await member(t, "member");
    await seedTemplate(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.groupTemplatesWrites.deleteTemplateNative, args);
    expect(res.ok).toBe(true);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("groupTemplates").withIndex("by_cuid", (q) => q.eq("id", "tpl1")).first()).toBeNull();
      const items = (await ctx.db.query("groupTemplateItems").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect())
        .filter((it) => it.templateId === "tpl1");
      expect(items).toHaveLength(0);
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("DELETE");
      expect(log?.summary).toBe('Deleted group template "Doomed"');
    });
  });

  test("cross-org template rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await seedTemplate(t, "org_other");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.groupTemplatesWrites.deleteTemplateNative, args),
    ).rejects.toThrow(/Group template not found/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await seedTemplate(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.groupTemplatesWrites.deleteTemplateNative, args),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

// ─── applyNative (the keystone parity test) ───────────────────────────────────
describe("groupTemplatesWrites.applyNative", () => {
  // template = 1 model item (m1 ×2) + 1 kit item (k1 ×1). Project p1 seeded with a
  // stale total + one standalone line so we can prove recalc swept the project.
  async function seedBase(
    t: ReturnType<typeof makeT>,
    opts: { kitStatus?: "AVAILABLE" | "CHECKED_OUT" | "IN_MAINTENANCE" | "RETIRED" | "INCOMPLETE"; projectDates?: boolean } = {},
  ) {
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("groupTemplates", { id: "tpl1", organizationId: ORG, name: "Show Rig", description: "d", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("groupTemplateItems", { id: "it1", organizationId: ORG, templateId: "tpl1", modelId: "m1", quantity: 2, sortOrder: 0 });
      await ctx.db.insert("groupTemplateItems", { id: "it2", organizationId: ORG, templateId: "tpl1", kitId: "k1", quantity: 1, sortOrder: 1 });
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "Speaker", dailyRate: 100, weeklyRate: 500 });
      await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "K1", name: "Rack", status: opts.kitStatus ?? "AVAILABLE" });
      // projectCategory the args reference (categoryId "cat1") — applyNative now
      // org-validates that FK, so it must exist in the org/project.
      await ctx.db.insert("projectCategories", { id: "cat1", organizationId: ORG, projectId: "p1", name: "Cat", sortOrder: 0, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projects", {
        id: "p1", organizationId: ORG, projectNumber: "P-1", name: "Gig", status: "CONFIRMED",
        total: 999, taxRate: 10,
        ...(opts.projectDates ? { rentalStartDate: NOW, rentalEndDate: NOW + 86_400_000 } : {}),
      });
      // Pre-existing standalone (ungrouped) line — bills into equipmentRevenue so
      // project.total is non-zero and proves recalc ran over the whole project.
      await ctx.db.insert("projectLineItems", { id: "liStandalone", organizationId: ORG, projectId: "p1", quantity: 1, lineTotal: 50, sortOrder: 0, isKitChild: false, isCustomItem: false, status: "CONFIRMED", type: "EQUIPMENT" });
    });
  }
  const args = {
    templateId: "tpl1", orgId: ORG, projectId: "p1", categoryId: "cat1", title: "Main Rig",
    groupId: "grpNew", modelLineIds: ["mLine1"], kitLineIds: ["kLine1"],
    now: NOW + 5, actor: ACTOR, auditId: "log1",
  };

  test("(a) model+kit applied → group + priced model line + expanded kit + recalc + collab", async () => {
    const t = makeT();
    await seedBase(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.groupTemplatesWrites.applyNative, args);
    expect(res.groupId).toBe("grpNew");
    expect(res.kitWarnings).toEqual([]);
    await t.run(async (ctx) => {
      // Group created (suggested price = dailyRate 100 × qty 2 × rentalQty 1 = 200).
      const group = await ctx.db.query("projectGroups").withIndex("by_cuid", (q) => q.eq("id", "grpNew")).first();
      expect(group?.title).toBe("Main Rig");
      expect(group?.suggestedPrice).toBe(200);
      // Model line priced by DAILY rate.
      const mLine = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "mLine1")).first();
      expect(mLine?.modelId).toBe("m1");
      expect(mLine?.unitPrice).toBe(100);
      expect(mLine?.lineTotal).toBe(200);
      expect(mLine?.groupId).toBe("grpNew");
      // Kit parent line expanded via createKitLineItemCore.
      const kLine = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "kLine1")).first();
      expect(kLine?.kitId).toBe("k1");
      expect(kLine?.groupId).toBe("grpNew");
      // Totals recalced: standalone 50 + tax 10% = 55, and stale 999 overwritten.
      const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(project?.total).toBe(55);
      expect(project?.updatedAt).toBe(NOW + 5);
      // Collab feed event.
      const events = await ctx.db.query("activityEvents").collect();
      expect(events).toHaveLength(1);
      expect(events[0].action).toBe("template_applied");
      expect(events[0].targetId).toBe("grpNew");
      expect(events[0].summary).toBe('imported 2 items from template "Show Rig" into "Main Rig"');
      // Audit.
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.summary).toBe('Applied template "Show Rig" as group "Main Rig" with 2 item(s)');
    });
  });

  test("(b) IN_MAINTENANCE kit skipped with a warning; model line still created", async () => {
    const t = makeT();
    await seedBase(t, { kitStatus: "IN_MAINTENANCE" });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.groupTemplatesWrites.applyNative, args);
    expect(res.kitWarnings).toHaveLength(1);
    expect(res.kitWarnings[0]).toMatch(/K1: kit is in maintenance/i);
    await t.run(async (ctx) => {
      // Model line landed (partial success).
      const mLine = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "mLine1")).first();
      expect(mLine?.lineTotal).toBe(200);
      // No kit parent line.
      const kLine = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "kLine1")).first();
      expect(kLine).toBeNull();
      // Audit summary reflects the skip.
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.summary).toMatch(/skipped 1 kit item/i);
    });
  });

  test("(c) dated double-booked kit skipped with a warning; model line still created", async () => {
    const t = makeT();
    await seedBase(t, { projectDates: true });
    // Another overlapping project already books kit k1 (a non-child kit parent line).
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p2", organizationId: ORG, projectNumber: "P-2", name: "Other", status: "CONFIRMED", rentalStartDate: NOW, rentalEndDate: NOW + 86_400_000 });
      await ctx.db.insert("projectLineItems", { id: "liOtherKit", organizationId: ORG, projectId: "p2", kitId: "k1", quantity: 1, sortOrder: 0, isKitChild: false, status: "CONFIRMED", type: "EQUIPMENT" });
    });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.groupTemplatesWrites.applyNative, args);
    expect(res.kitWarnings).toHaveLength(1);
    expect(res.kitWarnings[0]).toMatch(/already booked on P-2/i);
    await t.run(async (ctx) => {
      const mLine = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "mLine1")).first();
      // #943: this fixture's project has a 2-day rental window (projectDates: true) —
      // the derived blended charge now correctly bills across BOTH days ($100/day ×
      // 2 days = $200/unit × qty 2 = $400), where the old rate×quantity formula
      // silently ignored the date range entirely (always billed as 1 day).
      expect(mLine?.lineTotal).toBe(400);
      const kLine = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "kLine1")).first();
      expect(kLine).toBeNull();
    });
  });

  test("cross-org template rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("groupTemplates", { id: "tpl1", organizationId: "org_other", name: "Theirs", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P-1", name: "Gig", status: "CONFIRMED" });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.groupTemplatesWrites.applyNative, args),
    ).rejects.toThrow(/Group template not found/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.groupTemplatesWrites.applyNative, args),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});
