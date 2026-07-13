// @vitest-environment node
//
// Per-item org re-check on the reorder* mutations (Phase 3 security baseline). These
// service-gated array mutations fetch rows by the GLOBAL by_cuid index and patch
// sortOrder; without an org re-check a caller could reorder ANOTHER org's rows. Each
// now takes `orgId` and skips a row whose organizationId differs. (Surfaced by the
// independent adversarial re-audit; fixed to match reorderNative's guard.)
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_other";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const makeT = () => convexTest(schema, modules);
type T = ReturnType<typeof makeT>;

const sortOrder = (t: T, table: "projectLineItems" | "projectGroups" | "projectCategories" | "modelMedia", id: string) =>
  t.run(async (ctx) => (await ctx.db.query(table).withIndex("by_cuid", (q) => q.eq("id", id)).unique())?.sortOrder);

describe("reorder* mutations — per-item org re-check (no cross-tenant reorder)", () => {
  test("reorderLineItems: patches in-org, skips a cross-org id", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li_a", organizationId: ORG, projectId: "p1", sortOrder: 0 });
      await ctx.db.insert("projectLineItems", { id: "li_b", organizationId: OTHER, projectId: "p9", sortOrder: 0 });
    });
    await t.withIdentity(SERVICE).mutation(api.projectLineItems.reorderLineItems, {
      orgId: ORG,
      items: [{ id: "li_a", sortOrder: 5 }, { id: "li_b", sortOrder: 99 }],
      now: NOW,
    });
    expect(await sortOrder(t, "projectLineItems", "li_a")).toBe(5); // in-org applied
    expect(await sortOrder(t, "projectLineItems", "li_b")).toBe(0); // cross-org untouched
  });

  test("projectGroups.reorder + projectCategories.reorder skip cross-org", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectGroups", { id: "g_x", organizationId: OTHER, projectId: "p9", title: "X", sortOrder: 0 });
      await ctx.db.insert("projectCategories", { id: "c_x", organizationId: OTHER, projectId: "p9", name: "X", sortOrder: 0 });
    });
    await t.withIdentity(SERVICE).mutation(api.projectGroups.reorder, { orgId: ORG, orderedIds: ["g_x"], now: NOW });
    await t.withIdentity(SERVICE).mutation(api.projectCategories.reorder, { orgId: ORG, orderedIds: ["c_x"], now: NOW });
    expect(await sortOrder(t, "projectGroups", "g_x")).toBe(0);
    expect(await sortOrder(t, "projectCategories", "c_x")).toBe(0);
  });

  test("modelMedia.reorder skips a cross-org id", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("modelMedia", { id: "mm_x", organizationId: OTHER, modelId: "m9", fileId: "f9", sortOrder: 0 });
    });
    await t.withIdentity(SERVICE).mutation(api.modelMedia.reorder, { orgId: ORG, orderedIds: ["mm_x"] });
    expect(await sortOrder(t, "modelMedia", "mm_x")).toBe(0);
  });

  test("categorySlots.reorderSlots no-ops for a cross-org category", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      // category belongs to OTHER org; a slot exists under it.
      await ctx.db.insert("projectCategories", { id: "cat_x", organizationId: OTHER, projectId: "p9", name: "X", sortOrder: 0 });
      await ctx.db.insert("categorySlots", { id: "slot_x", projectCategoryId: "cat_x", projectGroupId: "g1", sortOrder: 0 });
    });
    await t.withIdentity(SERVICE).mutation(api.categorySlots.reorderSlots, {
      orgId: ORG, // caller is org_1, category is org_other → no-op
      categoryId: "cat_x",
      items: [{ kind: "projectGroup", groupId: "g1", sortOrder: 7, newSlotId: "slot_x" }],
      now: NOW,
    });
    const slot = await t.run(async (ctx) => ctx.db.query("categorySlots").withIndex("by_cuid", (q) => q.eq("id", "slot_x")).unique());
    expect(slot?.sortOrder).toBe(0); // untouched — cross-org category rejected
  });
});
