// @vitest-environment node
//
// convex/projectVersionsEquipment.ts (#1080/#1101) — the Equipment tab's
// version-viewing bundle-assembly read. Covers: a full-fidelity capture
// (project group + sub-hire group/item + categorySlot ordering + a
// referenced-only supplier resolve) round-trips through `bundle`; an older
// snapshot with none of the four new entity types degrades to empty arrays
// rather than erroring; and cross-org IDOR on both the snapshot row and the
// resolved reference data.
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const actor = { userId: USER, userName: "Alice" };
const asUser = (orgId: string) => ({ subject: USER, orgId });

const modules = import.meta.glob("./**/*.ts");

function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seedMember(t: ReturnType<typeof makeT>, role = "owner", orgId = ORG, userId = USER) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: `m_${userId}_${orgId}`, organizationId: orgId, userId, role });
  });
}

/** A project with one category, one project group + line item, one sub-hire
 *  (with a group + item) categorized into the same category, and a custom
 *  standalone line item — all combined into ONE categorySlots order
 *  (0: project group, 1: sub-hire group, 2: standalone item) so the
 *  interleaving is real, not "groups happen to sort first". */
async function seedProjectWithSubHire(t: ReturnType<typeof makeT>, orgId = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id: "p1", organizationId: orgId, projectNumber: "RVLT-2026-0087", name: "Gig",
      status: "QUOTING", isTemplate: false, revision: 1,
      subtotal: 100, discountAmount: 0, taxAmount: 10, total: 110, taxRate: 10,
      createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projectCategories", { id: "c1", organizationId: orgId, projectId: "p1", name: "Lighting", sortOrder: 0 });
    await ctx.db.insert("projectGroups", { id: "g1", organizationId: orgId, projectId: "p1", categoryId: "c1", title: "MA3 kit", quantity: 1, price: 500, sortOrder: 0 });
    await ctx.db.insert("projectLineItems", {
      id: "l1", organizationId: orgId, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT",
      isKitChild: false, isOptional: false, description: "MA3", quantity: 1, unitPrice: 500, lineTotal: 500,
      groupId: "g1", sortOrder: 0,
    });
    await ctx.db.insert("projectLineItems", {
      id: "l2", organizationId: orgId, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT",
      isKitChild: false, isOptional: false, isCustomItem: true, description: "Gaffer tape", quantity: 2, unitPrice: 10, lineTotal: 20,
      categoryId: "c1", sortOrder: 0,
    });
    await ctx.db.insert("suppliers", { id: "sup1", organizationId: orgId, name: "ACME Rigging" });
    await ctx.db.insert("subHires", {
      id: "sh1", organizationId: orgId, supplierId: "sup1", projectId: "p1", createdById: USER,
      orderNumber: "SH-001", status: "CONFIRMED", createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("subHireGroups", { id: "shg1", subHireId: "sh1", title: "Truss package", sortOrder: 0, quantity: 1, cost: 300, charge: 400, targetCategoryId: "c1" });
    await ctx.db.insert("subHireItems", { id: "shi1", subHireId: "sh1", groupId: "shg1", description: "6m truss", quantity: 2, unitCost: 50, unitCharge: 75, sortOrder: 0 });
    await ctx.db.insert("categorySlots", { id: "cs1", projectCategoryId: "c1", sortOrder: 0, projectGroupId: "g1" });
    await ctx.db.insert("categorySlots", { id: "cs2", projectCategoryId: "c1", sortOrder: 1, subHireGroupId: "shg1" });
    await ctx.db.insert("categorySlots", { id: "cs3", projectCategoryId: "c1", sortOrder: 2, lineItemId: "l2" });
  });
}

const saveVersion = (t: ReturnType<typeof makeT>, orgId = ORG) =>
  t.withIdentity(asUser(orgId)).mutation(api.projectVersionsWrites.saveVersionNative, {
    id: "qSave", organizationId: orgId, projectId: "p1", actor, auditId: "aSave", now: NOW,
  } as never);

async function findSnapshotId(t: ReturnType<typeof makeT>, orgId = ORG): Promise<string> {
  const snapshot = await t.run(async (ctx) =>
    ctx.db.query("projectSnapshots").withIndex("by_projectId", (q) => q.eq("projectId", "p1")).first(),
  );
  if (!snapshot || snapshot.organizationId !== orgId) throw new Error("no snapshot");
  return snapshot.id;
}

describe("projectVersionsEquipment.bundle", () => {
  test("a full-fidelity capture round-trips categories/groups/subHires/categorySlots and resolves the referenced supplier", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectWithSubHire(t);
    await saveVersion(t);
    const snapshotId = await findSnapshotId(t);

    const bundle = await t
      .withIdentity(asUser(ORG))
      .query(api.projectVersionsEquipment.bundle, { projectId: "p1", orgId: ORG, snapshotId });

    expect(bundle).not.toBeNull();
    expect(bundle!.categories).toHaveLength(1);
    expect(bundle!.groups).toHaveLength(1);
    expect(bundle!.lineItems).toHaveLength(2);
    expect(bundle!.subHires).toHaveLength(1);
    expect(bundle!.subHireGroups).toHaveLength(1);
    expect(bundle!.subHireItems).toHaveLength(1);
    expect(bundle!.categorySlots).toHaveLength(3);
    expect(bundle!.units).toEqual([]);
    // Referenced-only resolve: the sub-hire's supplier, by id, from CURRENT suppliers.
    expect(bundle!.suppliers).toHaveLength(1);
    expect((bundle!.suppliers[0] as { name: string }).name).toBe("ACME Rigging");
  });

  test("an older snapshot with none of the four new entity types degrades to empty arrays, not an error", async () => {
    const t = makeT();
    await seedMember(t);
    // Seed a project WITHOUT the sub-hire/categorySlot fixtures, capture it —
    // this is what every pre-#1101 snapshot looks like.
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", {
        id: "p1", organizationId: ORG, projectNumber: "RVLT-2026-0088", name: "Old Gig",
        status: "QUOTING", isTemplate: false, revision: 1,
        subtotal: 0, discountAmount: 0, taxAmount: 0, total: 0, taxRate: 0,
        createdAt: NOW, updatedAt: NOW,
      });
    });
    await saveVersion(t);
    const snapshotId = await findSnapshotId(t);

    const bundle = await t
      .withIdentity(asUser(ORG))
      .query(api.projectVersionsEquipment.bundle, { projectId: "p1", orgId: ORG, snapshotId });

    expect(bundle).not.toBeNull();
    expect(bundle!.subHires).toEqual([]);
    expect(bundle!.subHireGroups).toEqual([]);
    expect(bundle!.subHireItems).toEqual([]);
    expect(bundle!.categorySlots).toEqual([]);
  });

  test("IDOR: a snapshot belonging to another org returns null even with a guessed snapshotId", async () => {
    const t = makeT();
    await seedMember(t, "owner", ORG);
    await seedMember(t, "owner", OTHER, "user_2");
    await seedProjectWithSubHire(t, OTHER);
    await t.withIdentity({ subject: "user_2", orgId: OTHER }).mutation(api.projectVersionsWrites.saveVersionNative, {
      id: "qOther", organizationId: OTHER, projectId: "p1", actor: { userId: "user_2", userName: "Bob" }, auditId: "aOther", now: NOW,
    } as never);
    const otherSnapshot = await t.run(async (ctx) =>
      ctx.db.query("projectSnapshots").withIndex("by_projectId", (q) => q.eq("projectId", "p1")).first(),
    );
    expect(otherSnapshot).not.toBeNull();

    const bundle = await t
      .withIdentity(asUser(ORG))
      .query(api.projectVersionsEquipment.bundle, { projectId: "p1", orgId: ORG, snapshotId: otherSnapshot!.id });
    expect(bundle).toBeNull();
  });

  test("a viewer with no project:read permission in this org is rejected", async () => {
    const t = makeT();
    await seedProjectWithSubHire(t);
    await expect(
      t.withIdentity(asUser(ORG)).query(api.projectVersionsEquipment.bundle, { projectId: "p1", orgId: ORG, snapshotId: "whatever" }),
    ).rejects.toThrow();
  });
});
