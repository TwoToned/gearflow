/**
 * Integration tests S8 + S10 from the cross-type unification test plan
 * (~/.gstack/projects/TwoToned-gearflow/jayden-main-test-plan-20260603-164457.md).
 *
 * S8 — moveSubHireGroupToCategory does NOT trigger the full
 *      syncSubHireToProject regenerate cascade (Finding 6.1):
 *        - ProjectLineItem rows for the sub-hire keep the same IDs
 *          (no delete+insert).
 *        - recalculateProjectTotals is called exactly once.
 *
 * S10 — Cross-org / cross-FK validation (Finding 5.2):
 *        - Moving a sub-hire group to a category that belongs to a
 *          DIFFERENT org throws (NOT a 200 cross-org write).
 *        - createCategoryAndPlaceGroup rejects a slot pointing at a
 *          group that lives in a different project.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
} from "../../tests/helpers/integration";
import { createId } from "@paralleldrive/cuid2";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

// Mock org-context BEFORE importing the module under test so all
// requirePermission calls resolve to our test context.
const h = vi.hoisted(() => ({
  ctx: { organizationId: "", userId: "", userName: "Tester" },
  recalcSpy: vi.fn<(projectId: string) => Promise<void>>(),
}));

vi.mock("@/lib/org-context", () => ({
  requirePermission: async () => h.ctx,
  getOrgContext: async () => h.ctx,
}));

vi.mock("@/server/line-items", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/line-items")>();
  return {
    ...actual,
    recalculateProjectTotals: h.recalcSpy,
  };
});

import {
  moveSubHireGroupToCategory,
  moveProjectGroupToCategory,
  getUncategorizedProjectGroups,
  reorderMixedGroupsInCategory,
  createCategoryAndPlaceGroup,
  getUncategorizedSubHireGroups,
} from "@/server/category-slots";

// ── Fixtures ────────────────────────────────────────────────────────────────

async function createSupplierFixture(orgId: string, name = "Supplier") {
  return testPrisma.supplier.create({ data: { organizationId: orgId, name } });
}
async function createProjectFixture(orgId: string) {
  return testPrisma.project.create({
    data: {
      organizationId: orgId,
      projectNumber: `P-${createId().slice(0, 6)}`,
      name: "Test Project",
    },
  });
}
async function createCategoryFixture(orgId: string, projectId: string, name = "Cat", sortOrder = 0) {
  return testPrisma.projectCategory.create({
    data: { organizationId: orgId, projectId, name, sortOrder },
  });
}
async function createGroupFixture(
  orgId: string,
  projectId: string,
  categoryId: string,
  title = "Group",
  sortOrder = 0,
) {
  return testPrisma.projectGroup.create({
    data: { organizationId: orgId, projectId, categoryId, title, sortOrder },
  });
}
async function createSubHireFixture(orgId: string, supplierId: string, userId: string, projectId: string) {
  return testPrisma.subHire.create({
    data: {
      organizationId: orgId,
      supplierId,
      createdById: userId,
      projectId,
      orderNumber: `SO-${createId().slice(0, 6)}`,
    },
  });
}
async function createSubHireGroupFixture(
  subHireId: string,
  opts: { title?: string; targetCategoryId?: string | null; sortOrder?: number } = {},
) {
  return testPrisma.subHireGroup.create({
    data: {
      subHireId,
      title: opts.title ?? "SH Group",
      targetCategoryId: opts.targetCategoryId ?? null,
      sortOrder: opts.sortOrder ?? 0,
    },
  });
}

/**
 * Materialise the synthetic parent ProjectLineItem that the real-app
 * `syncSubHireToProject` would have created. Our tests assert it stays
 * around (just moves category) — we don't recreate it here.
 */
async function createSyntheticParentLineItem(
  orgId: string,
  projectId: string,
  subHireGroupId: string,
  categoryId: string | null,
) {
  return testPrisma.projectLineItem.create({
    data: {
      organizationId: orgId,
      projectId,
      subHireGroupId,
      categoryId,
      isKitChild: false,
      description: "Sub-hire group parent",
    },
  });
}

// ── S8 ──────────────────────────────────────────────────────────────────────

describe("S8 — moveSubHireGroupToCategory skips regenerate cascade", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
    h.recalcSpy.mockClear();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("does NOT delete + recreate the synthetic parent line item", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const supplier = await createSupplierFixture(org.id);
    const project = await createProjectFixture(org.id);
    const catA = await createCategoryFixture(org.id, project.id, "A", 0);
    const catB = await createCategoryFixture(org.id, project.id, "B", 1);
    const subHire = await createSubHireFixture(org.id, supplier.id, user.id, project.id);
    const shGroup = await createSubHireGroupFixture(subHire.id, { targetCategoryId: catA.id });
    const parentBefore = await createSyntheticParentLineItem(org.id, project.id, shGroup.id, catA.id);

    await moveSubHireGroupToCategory({ groupId: shGroup.id, categoryId: catB.id });

    const parentAfter = await testPrisma.projectLineItem.findUnique({
      where: { id: parentBefore.id },
    });
    expect(parentAfter).not.toBeNull();
    expect(parentAfter!.id).toBe(parentBefore.id);
    expect(parentAfter!.categoryId).toBe(catB.id);

    const allLineItemsForGroup = await testPrisma.projectLineItem.count({
      where: { subHireGroupId: shGroup.id },
    });
    expect(allLineItemsForGroup).toBe(1);

    const groupAfter = await testPrisma.subHireGroup.findUniqueOrThrow({ where: { id: shGroup.id } });
    expect(groupAfter.targetCategoryId).toBe(catB.id);
  });

  it("calls recalculateProjectTotals exactly once per move", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const supplier = await createSupplierFixture(org.id);
    const project = await createProjectFixture(org.id);
    const catA = await createCategoryFixture(org.id, project.id, "A", 0);
    const catB = await createCategoryFixture(org.id, project.id, "B", 1);
    const subHire = await createSubHireFixture(org.id, supplier.id, user.id, project.id);
    const shGroup = await createSubHireGroupFixture(subHire.id, { targetCategoryId: catA.id });
    await createSyntheticParentLineItem(org.id, project.id, shGroup.id, catA.id);

    await moveSubHireGroupToCategory({ groupId: shGroup.id, categoryId: catB.id });
    expect(h.recalcSpy).toHaveBeenCalledTimes(1);
    expect(h.recalcSpy).toHaveBeenCalledWith(project.id);
  });

  it("creates a CategorySlot row in the destination and removes the old one", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const supplier = await createSupplierFixture(org.id);
    const project = await createProjectFixture(org.id);
    const catA = await createCategoryFixture(org.id, project.id, "A", 0);
    const catB = await createCategoryFixture(org.id, project.id, "B", 1);
    const subHire = await createSubHireFixture(org.id, supplier.id, user.id, project.id);
    const shGroup = await createSubHireGroupFixture(subHire.id, { targetCategoryId: catA.id });
    await createSyntheticParentLineItem(org.id, project.id, shGroup.id, catA.id);

    // Pre-existing slot in catA (simulates the unified rendering having
    // recorded a sort position before the move).
    await testPrisma.categorySlot.create({
      data: { projectCategoryId: catA.id, sortOrder: 0, subHireGroupId: shGroup.id },
    });

    await moveSubHireGroupToCategory({ groupId: shGroup.id, categoryId: catB.id });

    const convex = await getConvexClient();
    const slotsForGroup = await convex.query(api.categorySlots.listBySubHireGroupId, {
      subHireGroupId: shGroup.id,
    });
    expect(slotsForGroup).toHaveLength(1);
    expect(slotsForGroup[0].projectCategoryId).toBe(catB.id);
  });

  it("supports moving to uncategorised (categoryId = null)", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const supplier = await createSupplierFixture(org.id);
    const project = await createProjectFixture(org.id);
    const catA = await createCategoryFixture(org.id, project.id, "A", 0);
    const subHire = await createSubHireFixture(org.id, supplier.id, user.id, project.id);
    const shGroup = await createSubHireGroupFixture(subHire.id, { targetCategoryId: catA.id });
    await createSyntheticParentLineItem(org.id, project.id, shGroup.id, catA.id);
    await testPrisma.categorySlot.create({
      data: { projectCategoryId: catA.id, sortOrder: 0, subHireGroupId: shGroup.id },
    });

    await moveSubHireGroupToCategory({ groupId: shGroup.id, categoryId: null });

    const groupAfter = await testPrisma.subHireGroup.findUniqueOrThrow({ where: { id: shGroup.id } });
    expect(groupAfter.targetCategoryId).toBeNull();

    const convex = await getConvexClient();
    const slots = await convex.query(api.categorySlots.listBySubHireGroupId, {
      subHireGroupId: shGroup.id,
    });
    expect(slots).toHaveLength(0);
  });
});

// ── S10 ─────────────────────────────────────────────────────────────────────

describe("S10 — cross-org / cross-FK validation", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
    h.recalcSpy.mockClear();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("rejects moveSubHireGroupToCategory when destination category is in another org", async () => {
    const orgA = await createOrgFixture({ slug: "org-a" });
    const orgB = await createOrgFixture({ slug: "org-b" });
    const userA = await createUserFixture(orgA.id, "owner");
    h.ctx = { organizationId: orgA.id, userId: userA.id, userName: "A" };

    const supplierA = await createSupplierFixture(orgA.id);
    const projectA = await createProjectFixture(orgA.id);
    const subHire = await createSubHireFixture(orgA.id, supplierA.id, userA.id, projectA.id);
    const shGroup = await createSubHireGroupFixture(subHire.id);

    // Category in orgB — should be unreachable.
    const projectB = await createProjectFixture(orgB.id);
    const catBOther = await createCategoryFixture(orgB.id, projectB.id, "B-cat");

    await expect(
      moveSubHireGroupToCategory({ groupId: shGroup.id, categoryId: catBOther.id }),
    ).rejects.toThrow(/destination category not found/i);

    // And nothing should have been written.
    const groupAfter = await testPrisma.subHireGroup.findUniqueOrThrow({ where: { id: shGroup.id } });
    expect(groupAfter.targetCategoryId).toBeNull();
  });

  it("rejects moveSubHireGroupToCategory when group belongs to another org", async () => {
    const orgA = await createOrgFixture({ slug: "org-a" });
    const orgB = await createOrgFixture({ slug: "org-b" });
    const userA = await createUserFixture(orgA.id, "owner");
    h.ctx = { organizationId: orgA.id, userId: userA.id, userName: "A" };

    const supplierB = await createSupplierFixture(orgB.id);
    const userB = await createUserFixture(orgB.id, "owner");
    const projectB = await createProjectFixture(orgB.id);
    const subHireB = await createSubHireFixture(orgB.id, supplierB.id, userB.id, projectB.id);
    const shGroupB = await createSubHireGroupFixture(subHireB.id);

    const projectA = await createProjectFixture(orgA.id);
    const catA = await createCategoryFixture(orgA.id, projectA.id);

    await expect(
      moveSubHireGroupToCategory({ groupId: shGroupB.id, categoryId: catA.id }),
    ).rejects.toThrow(/sub-hire group not found/i);
  });

  it("rejects createCategoryAndPlaceGroup when slot points at a group in another project", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const projectA = await createProjectFixture(org.id);
    const projectB = await createProjectFixture(org.id);
    const catA = await createCategoryFixture(org.id, projectA.id, "A");
    const groupInA = await createGroupFixture(org.id, projectA.id, catA.id);

    // Trying to create a category in projectB but placing groupInA inside
    // — should fail because groupInA doesn't belong to projectB.
    await expect(
      createCategoryAndPlaceGroup({
        projectId: projectB.id,
        name: "New cat",
        slot: { projectGroupId: groupInA.id },
      }),
    ).rejects.toThrow(/project group not found in this project/i);

    // No category should have leaked into projectB.
    const projectBCats = await testPrisma.projectCategory.findMany({ where: { projectId: projectB.id } });
    expect(projectBCats).toHaveLength(0);
  });

  it("getUncategorizedSubHireGroups only returns groups for the requested project", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };
    const supplier = await createSupplierFixture(org.id);

    const projectA = await createProjectFixture(org.id);
    const projectB = await createProjectFixture(org.id);

    const subHireA = await createSubHireFixture(org.id, supplier.id, user.id, projectA.id);
    const subHireB = await createSubHireFixture(org.id, supplier.id, user.id, projectB.id);

    const shInA = await createSubHireGroupFixture(subHireA.id, { title: "in-a", targetCategoryId: null });
    await createSubHireGroupFixture(subHireB.id, { title: "in-b", targetCategoryId: null });

    const result = await getUncategorizedSubHireGroups(projectA.id);
    const titles = (result as Array<{ id: string; title: string }>).map((g) => g.title);
    expect(titles).toEqual([shInA.title]);
  });
});

// ── reorder smoke (S11 quick check) ─────────────────────────────────────────

describe("reorderMixedGroupsInCategory — basic sort write", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("writes CategorySlot.sortOrder for a mixed pg-/shg- list", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };
    const supplier = await createSupplierFixture(org.id);
    const project = await createProjectFixture(org.id);
    const cat = await createCategoryFixture(org.id, project.id);
    const pg = await createGroupFixture(org.id, project.id, cat.id);
    const subHire = await createSubHireFixture(org.id, supplier.id, user.id, project.id);
    const shg = await createSubHireGroupFixture(subHire.id, { targetCategoryId: cat.id });

    await reorderMixedGroupsInCategory({
      categoryId: cat.id,
      orderedIds: [`shg-${shg.id}`, `pg-${pg.id}`],
    });

    const convex = await getConvexClient();
    const rawSlots = await convex.query(api.categorySlots.list, { projectCategoryId: cat.id });
    const slots = [...rawSlots].sort((a, b) => a.sortOrder - b.sortOrder);
    expect(slots).toHaveLength(2);
    expect(slots[0].subHireGroupId).toBe(shg.id);
    expect(slots[0].sortOrder).toBe(0);
    expect(slots[1].projectGroupId).toBe(pg.id);
    expect(slots[1].sortOrder).toBe(1);
  });
});

// ── /review F1 — cross-org slot ID validation in reorder ───────────────────

describe("reorderMixedGroupsInCategory — cross-org slot ID validation (/review F1)", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("rejects a pg- slot ID that belongs to a project group in another org", async () => {
    const orgA = await createOrgFixture({ slug: "org-a" });
    const orgB = await createOrgFixture({ slug: "org-b" });
    const userA = await createUserFixture(orgA.id, "owner");
    h.ctx = { organizationId: orgA.id, userId: userA.id, userName: "A" };

    const projectA = await createProjectFixture(orgA.id);
    const catA = await createCategoryFixture(orgA.id, projectA.id);

    // Other org's project group — must NOT be slottable into orgA's category.
    const projectB = await createProjectFixture(orgB.id);
    const catB = await createCategoryFixture(orgB.id, projectB.id);
    const pgB = await createGroupFixture(orgB.id, projectB.id, catB.id);

    await expect(
      reorderMixedGroupsInCategory({
        categoryId: catA.id,
        orderedIds: [`pg-${pgB.id}`],
      }),
    ).rejects.toThrow(/project groups do not belong/i);

    // No CategorySlot row should have been written in orgA's category.
    const slots = await testPrisma.categorySlot.findMany({
      where: { projectCategoryId: catA.id },
    });
    expect(slots).toHaveLength(0);
  });

  it("rejects an shg- slot ID that belongs to a sub-hire group in another org", async () => {
    const orgA = await createOrgFixture({ slug: "org-a" });
    const orgB = await createOrgFixture({ slug: "org-b" });
    const userA = await createUserFixture(orgA.id, "owner");
    h.ctx = { organizationId: orgA.id, userId: userA.id, userName: "A" };

    const projectA = await createProjectFixture(orgA.id);
    const catA = await createCategoryFixture(orgA.id, projectA.id);

    const supplierB = await createSupplierFixture(orgB.id);
    const userB = await createUserFixture(orgB.id, "owner");
    const projectB = await createProjectFixture(orgB.id);
    const subHireB = await createSubHireFixture(orgB.id, supplierB.id, userB.id, projectB.id);
    const shgB = await createSubHireGroupFixture(subHireB.id);

    await expect(
      reorderMixedGroupsInCategory({
        categoryId: catA.id,
        orderedIds: [`shg-${shgB.id}`],
      }),
    ).rejects.toThrow(/sub-hire groups do not belong/i);
  });

  it("rejects a pg- slot ID from a project in the same org but different project", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const projectA = await createProjectFixture(org.id);
    const catA = await createCategoryFixture(org.id, projectA.id);

    const projectB = await createProjectFixture(org.id);
    const catB = await createCategoryFixture(org.id, projectB.id);
    const pgB = await createGroupFixture(org.id, projectB.id, catB.id);

    // Same org, different project — should still be rejected because
    // the parsed group's projectId !== category.projectId.
    await expect(
      reorderMixedGroupsInCategory({
        categoryId: catA.id,
        orderedIds: [`pg-${pgB.id}`],
      }),
    ).rejects.toThrow(/project groups do not belong/i);
  });
});

// ── S11 — concurrent reorder atomicity ──────────────────────────────────────

describe("S11 — reorderMixedGroupsInCategory under concurrent load", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  async function seedFourGroups() {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };
    const supplier = await createSupplierFixture(org.id);
    const project = await createProjectFixture(org.id);
    const cat = await createCategoryFixture(org.id, project.id);
    const pg1 = await createGroupFixture(org.id, project.id, cat.id, "PG1", 0);
    const pg2 = await createGroupFixture(org.id, project.id, cat.id, "PG2", 1);
    const subHire = await createSubHireFixture(org.id, supplier.id, user.id, project.id);
    const shg1 = await createSubHireGroupFixture(subHire.id, { title: "SHG1", targetCategoryId: cat.id, sortOrder: 0 });
    const shg2 = await createSubHireGroupFixture(subHire.id, { title: "SHG2", targetCategoryId: cat.id, sortOrder: 1 });
    return { cat, ids: { pg1: pg1.id, pg2: pg2.id, shg1: shg1.id, shg2: shg2.id } };
  }

  it("two concurrent reorders on the same category both complete (no deadlock)", async () => {
    const { cat, ids } = await seedFourGroups();

    const orderA = [`pg-${ids.pg1}`, `pg-${ids.pg2}`, `shg-${ids.shg1}`, `shg-${ids.shg2}`];
    const orderB = [`shg-${ids.shg2}`, `shg-${ids.shg1}`, `pg-${ids.pg2}`, `pg-${ids.pg1}`];

    const results = await Promise.allSettled([
      reorderMixedGroupsInCategory({ categoryId: cat.id, orderedIds: orderA }),
      reorderMixedGroupsInCategory({ categoryId: cat.id, orderedIds: orderB }),
    ]);

    // Both calls must complete — deadlock would surface as one or both
    // being rejected with a deadlock detected error.
    const rejected = results.filter((r) => r.status === "rejected");
    if (rejected.length > 0) {
      const reasons = rejected.map((r) =>
        r.status === "rejected" ? (r.reason as Error).message : "",
      );
      throw new Error(`Expected both reorders to succeed; rejected: ${reasons.join(" | ")}`);
    }
  });

  it("after two concurrent reorders the final state matches one of the requested orderings", async () => {
    const { cat, ids } = await seedFourGroups();

    const orderA = [`pg-${ids.pg1}`, `pg-${ids.pg2}`, `shg-${ids.shg1}`, `shg-${ids.shg2}`];
    const orderB = [`shg-${ids.shg2}`, `shg-${ids.shg1}`, `pg-${ids.pg2}`, `pg-${ids.pg1}`];

    await Promise.allSettled([
      reorderMixedGroupsInCategory({ categoryId: cat.id, orderedIds: orderA }),
      reorderMixedGroupsInCategory({ categoryId: cat.id, orderedIds: orderB }),
    ]);

    const convex = await getConvexClient();
    const rawSlots = await convex.query(api.categorySlots.list, { projectCategoryId: cat.id });
    const slots = [...rawSlots].sort((a, b) => a.sortOrder - b.sortOrder);
    const finalOrder = slots.map((s) =>
      s.projectGroupId ? `pg-${s.projectGroupId}` : `shg-${s.subHireGroupId}`,
    );

    expect(finalOrder).toHaveLength(4);
    const matchesA = JSON.stringify(finalOrder) === JSON.stringify(orderA);
    const matchesB = JSON.stringify(finalOrder) === JSON.stringify(orderB);
    if (!matchesA && !matchesB) {
      throw new Error(
        `Final order ${JSON.stringify(finalOrder)} does not match either reorder request. Expected one of: ${JSON.stringify(orderA)} or ${JSON.stringify(orderB)}`,
      );
    }
  });
});

// ── /review F2 — concurrent moveSubHireGroupToCategory advisory lock ───────

describe("moveSubHireGroupToCategory — concurrent move serialization (/review F2)", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
    h.recalcSpy.mockClear();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("two concurrent moves of the same group both complete without UNIQUE violation", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };
    const supplier = await createSupplierFixture(org.id);
    const project = await createProjectFixture(org.id);
    const catA = await createCategoryFixture(org.id, project.id, "A", 0);
    const catB = await createCategoryFixture(org.id, project.id, "B", 1);
    const subHire = await createSubHireFixture(org.id, supplier.id, user.id, project.id);
    const shg = await createSubHireGroupFixture(subHire.id, { targetCategoryId: catA.id });
    await createSyntheticParentLineItem(org.id, project.id, shg.id, catA.id);

    // Pre-existing slot in catA — both concurrent moves will delete it and
    // try to create a new one in catB, racing on
    // UNIQUE(projectCategoryId, sortOrder).
    await testPrisma.categorySlot.create({
      data: { projectCategoryId: catA.id, sortOrder: 0, subHireGroupId: shg.id },
    });

    const results = await Promise.allSettled([
      moveSubHireGroupToCategory({ groupId: shg.id, categoryId: catB.id }),
      moveSubHireGroupToCategory({ groupId: shg.id, categoryId: catB.id }),
    ]);

    const rejected = results.filter((r) => r.status === "rejected");
    if (rejected.length > 0) {
      const reasons = rejected.map((r) =>
        r.status === "rejected" ? (r.reason as Error).message : "",
      );
      throw new Error(`Expected both moves to succeed; rejected: ${reasons.join(" | ")}`);
    }

    // Final state: exactly one slot for the group, in catB.
    const convex = await getConvexClient();
    const slots = await convex.query(api.categorySlots.listBySubHireGroupId, {
      subHireGroupId: shg.id,
    });
    expect(slots).toHaveLength(1);
    expect(slots[0].projectCategoryId).toBe(catB.id);
  });
});

// ── S15 — inline create-category-and-place ──────────────────────────────────

describe("S15 — createCategoryAndPlaceGroup atomic create + place", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("creates the category at the end of the project's category list (8E.c)", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };
    const supplier = await createSupplierFixture(org.id);
    const project = await createProjectFixture(org.id);
    await createCategoryFixture(org.id, project.id, "First", 0);
    await createCategoryFixture(org.id, project.id, "Second", 1);
    const subHire = await createSubHireFixture(org.id, supplier.id, user.id, project.id);
    const shg = await createSubHireGroupFixture(subHire.id, { targetCategoryId: null });

    await createCategoryAndPlaceGroup({
      projectId: project.id,
      name: "Inline-created",
      slot: { subHireGroupId: shg.id },
    });

    const convex = await getConvexClient();
    const allCats = await convex.query(api.projectCategories.listByProject, {
      projectId: project.id,
      orgId: org.id,
    });
    const cats = [...allCats].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    expect(cats.map((c) => c.name)).toEqual(["First", "Second", "Inline-created"]);
    expect(cats[cats.length - 1].sortOrder).toBe(2);
  });

  it("places the sub-hire group inside the new category atomically (all-or-nothing)", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };
    const supplier = await createSupplierFixture(org.id);
    const project = await createProjectFixture(org.id);
    const subHire = await createSubHireFixture(org.id, supplier.id, user.id, project.id);
    const shg = await createSubHireGroupFixture(subHire.id, { targetCategoryId: null });

    await createCategoryAndPlaceGroup({
      projectId: project.id,
      name: "Audio",
      slot: { subHireGroupId: shg.id },
    });

    const convex = await getConvexClient();
    const allCats = await convex.query(api.projectCategories.listByProject, {
      projectId: project.id,
      orgId: org.id,
    });
    const cat = allCats.find((c) => c.name === "Audio")!;
    expect(cat).toBeDefined();
    const groupAfter = await testPrisma.subHireGroup.findUniqueOrThrow({ where: { id: shg.id } });
    expect(groupAfter.targetCategoryId).toBe(cat.id);
    const slotList = await convex.query(api.categorySlots.listBySubHireGroupId, {
      subHireGroupId: shg.id,
    });
    const slot = slotList[0]!;
    expect(slot.projectCategoryId).toBe(cat.id);
    expect(slot.sortOrder).toBe(0);
  });

  it("places a project group via the same atomic path", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };
    const project = await createProjectFixture(org.id);
    const sourceCat = await createCategoryFixture(org.id, project.id, "Source", 0);
    const pg = await createGroupFixture(org.id, project.id, sourceCat.id);

    await createCategoryAndPlaceGroup({
      projectId: project.id,
      name: "New",
      slot: { projectGroupId: pg.id },
    });

    const convex = await getConvexClient();
    const allCats = await convex.query(api.projectCategories.listByProject, {
      projectId: project.id,
      orgId: org.id,
    });
    const newCat = allCats.find((c) => c.name === "New")!;
    expect(newCat).toBeDefined();
    const pgAfter = await convex.query(api.projectGroups.getById, { id: pg.id });
    expect(pgAfter!.categoryId).toBe(newCat.id);
    const slotList = await convex.query(api.categorySlots.listByProjectGroupId, {
      projectGroupId: pg.id,
    });
    const slot = slotList[0]!;
    expect(slot.projectCategoryId).toBe(newCat.id);
  });
});

// ── Fix A — moveProjectGroupToCategory ──────────────────────────────────────

describe("moveProjectGroupToCategory — happy path + invariants", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
    h.recalcSpy.mockClear();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("moves the group, line items, and CategorySlot to the destination category", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const project = await createProjectFixture(org.id);
    const catA = await createCategoryFixture(org.id, project.id, "A", 0);
    const catB = await createCategoryFixture(org.id, project.id, "B", 1);
    const pg = await createGroupFixture(org.id, project.id, catA.id, "PG", 0);
    // Seed a line item in the group so we can assert it follows.
    const item = await testPrisma.projectLineItem.create({
      data: {
        organizationId: org.id, projectId: project.id,
        groupId: pg.id, categoryId: catA.id,
        description: "Item", quantity: 1,
      },
    });
    // Seed the existing CategorySlot in catA so we can assert it moves.
    await testPrisma.categorySlot.create({
      data: { projectCategoryId: catA.id, projectGroupId: pg.id, sortOrder: 0 },
    });

    const result = await moveProjectGroupToCategory({
      groupId: pg.id, categoryId: catB.id,
    });
    expect(result).toMatchObject({ success: true });

    const convex = await getConvexClient();
    const pgAfter = await convex.query(api.projectGroups.getById, { id: pg.id });
    expect(pgAfter!.categoryId).toBe(catB.id);

    const itemAfter = await testPrisma.projectLineItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(itemAfter.categoryId).toBe(catB.id);

    const slots = await convex.query(api.categorySlots.listByProjectGroupId, {
      projectGroupId: pg.id,
    });
    expect(slots).toHaveLength(1);
    expect(slots[0].projectCategoryId).toBe(catB.id);

    expect(h.recalcSpy).toHaveBeenCalledTimes(1);
    expect(h.recalcSpy).toHaveBeenCalledWith(project.id);
  });

  it("is a no-op when destination equals current category (returns noop:true)", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const project = await createProjectFixture(org.id);
    const catA = await createCategoryFixture(org.id, project.id, "A", 0);
    const pg = await createGroupFixture(org.id, project.id, catA.id, "PG", 0);

    const result = await moveProjectGroupToCategory({
      groupId: pg.id, categoryId: catA.id,
    });
    expect(result).toMatchObject({ success: true, noop: true });
    // Should NOT call recalc when nothing moved.
    expect(h.recalcSpy).not.toHaveBeenCalled();
  });

  it("appends the slot to the end of the destination's slot list", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const project = await createProjectFixture(org.id);
    const catA = await createCategoryFixture(org.id, project.id, "A", 0);
    const catB = await createCategoryFixture(org.id, project.id, "B", 1);

    // Pre-populate catB with two existing slots (sortOrder 0 and 1).
    const pgInB1 = await createGroupFixture(org.id, project.id, catB.id, "B1", 0);
    const pgInB2 = await createGroupFixture(org.id, project.id, catB.id, "B2", 1);
    await testPrisma.categorySlot.create({
      data: { projectCategoryId: catB.id, projectGroupId: pgInB1.id, sortOrder: 0 },
    });
    await testPrisma.categorySlot.create({
      data: { projectCategoryId: catB.id, projectGroupId: pgInB2.id, sortOrder: 1 },
    });

    // Move pg from A → B; should land at sortOrder 2.
    const pg = await createGroupFixture(org.id, project.id, catA.id, "PG", 0);
    await moveProjectGroupToCategory({ groupId: pg.id, categoryId: catB.id });

    const convex = await getConvexClient();
    const slots = await convex.query(api.categorySlots.listByProjectGroupId, {
      projectGroupId: pg.id,
    });
    const slot = slots[0]!;
    expect(slot.projectCategoryId).toBe(catB.id);
    expect(slot.sortOrder).toBe(2);
  });
});

describe("moveProjectGroupToCategory — cross-org / cross-project rejection", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("rejects a destination category that belongs to another org", async () => {
    const orgA = await createOrgFixture({ slug: "org-a" });
    const orgB = await createOrgFixture({ slug: "org-b" });
    const userA = await createUserFixture(orgA.id, "owner");
    h.ctx = { organizationId: orgA.id, userId: userA.id, userName: "A" };

    const projA = await createProjectFixture(orgA.id);
    const catA = await createCategoryFixture(orgA.id, projA.id, "A");
    const pg = await createGroupFixture(orgA.id, projA.id, catA.id, "PG");

    const projB = await createProjectFixture(orgB.id);
    const catB = await createCategoryFixture(orgB.id, projB.id, "B-other-org");

    await expect(
      moveProjectGroupToCategory({ groupId: pg.id, categoryId: catB.id }),
    ).rejects.toThrow(/destination category not found/i);

    // Nothing should have written.
    const pgAfter = await testPrisma.projectGroup.findUniqueOrThrow({ where: { id: pg.id } });
    expect(pgAfter.categoryId).toBe(catA.id);
  });

  it("rejects a destination category in the same org but a different project", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const projA = await createProjectFixture(org.id);
    const catA = await createCategoryFixture(org.id, projA.id, "A");
    const pg = await createGroupFixture(org.id, projA.id, catA.id, "PG");

    const projB = await createProjectFixture(org.id);
    const catBSameOrgDiffProj = await createCategoryFixture(org.id, projB.id, "B");

    await expect(
      moveProjectGroupToCategory({ groupId: pg.id, categoryId: catBSameOrgDiffProj.id }),
    ).rejects.toThrow(/across projects/i);
  });

  it("rejects when the group itself belongs to another org", async () => {
    const orgA = await createOrgFixture({ slug: "org-a" });
    const orgB = await createOrgFixture({ slug: "org-b" });
    const userA = await createUserFixture(orgA.id, "owner");
    h.ctx = { organizationId: orgA.id, userId: userA.id, userName: "A" };

    const projB = await createProjectFixture(orgB.id);
    const catB = await createCategoryFixture(orgB.id, projB.id, "B");
    const pgInB = await createGroupFixture(orgB.id, projB.id, catB.id, "PG-other-org");

    const projA = await createProjectFixture(orgA.id);
    const catA = await createCategoryFixture(orgA.id, projA.id, "A");

    await expect(
      moveProjectGroupToCategory({ groupId: pgInB.id, categoryId: catA.id }),
    ).rejects.toThrow(/project group not found/i);
  });
});

describe("moveProjectGroupToCategory — concurrent move advisory lock", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("two concurrent moves of the same group both complete without UNIQUE violation", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const project = await createProjectFixture(org.id);
    const catA = await createCategoryFixture(org.id, project.id, "A", 0);
    const catB = await createCategoryFixture(org.id, project.id, "B", 1);
    const pg = await createGroupFixture(org.id, project.id, catA.id, "PG", 0);
    await testPrisma.categorySlot.create({
      data: { projectCategoryId: catA.id, projectGroupId: pg.id, sortOrder: 0 },
    });

    const results = await Promise.allSettled([
      moveProjectGroupToCategory({ groupId: pg.id, categoryId: catB.id }),
      moveProjectGroupToCategory({ groupId: pg.id, categoryId: catB.id }),
    ]);

    const rejected = results.filter((r) => r.status === "rejected");
    if (rejected.length > 0) {
      const reasons = rejected.map((r) =>
        r.status === "rejected" ? (r.reason as Error).message : "",
      );
      throw new Error(`Expected both moves to succeed; rejected: ${reasons.join(" | ")}`);
    }

    // Final state: exactly one slot for the group, in catB.
    const convex = await getConvexClient();
    const slots = await convex.query(api.categorySlots.listByProjectGroupId, {
      projectGroupId: pg.id,
    });
    expect(slots).toHaveLength(1);
    expect(slots[0].projectCategoryId).toBe(catB.id);
    const pgAfter = await convex.query(api.projectGroups.getById, { id: pg.id });
    expect(pgAfter!.categoryId).toBe(catB.id);
  });
});

// ── v0.9.4.0 — uncategorised project groups ─────────────────────────────────

describe("moveProjectGroupToCategory — null destination (move to Uncategorised)", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
    h.recalcSpy.mockClear();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("moves a categorised group to Uncategorised: clears categoryId, drops slot, syncs line items", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };
    const project = await createProjectFixture(org.id);
    const catA = await createCategoryFixture(org.id, project.id, "A", 0);
    const pg = await createGroupFixture(org.id, project.id, catA.id, "PG", 0);
    const item = await testPrisma.projectLineItem.create({
      data: {
        organizationId: org.id, projectId: project.id,
        groupId: pg.id, categoryId: catA.id,
        description: "Item", quantity: 1,
      },
    });
    await testPrisma.categorySlot.create({
      data: { projectCategoryId: catA.id, projectGroupId: pg.id, sortOrder: 0 },
    });

    const result = await moveProjectGroupToCategory({
      groupId: pg.id, categoryId: null,
    });
    expect(result).toMatchObject({ success: true });

    const convex = await getConvexClient();
    const pgAfter = await convex.query(api.projectGroups.getById, { id: pg.id });
    // Convex represents absent optional fields as undefined (not null).
    expect(pgAfter!.categoryId ?? null).toBeNull();

    const itemAfter = await testPrisma.projectLineItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(itemAfter.categoryId).toBeNull();

    const slots = await convex.query(api.categorySlots.listByProjectGroupId, {
      projectGroupId: pg.id,
    });
    expect(slots).toHaveLength(0);

    expect(h.recalcSpy).toHaveBeenCalledTimes(1);
  });

  it("moves an uncategorised group INTO a category: creates a fresh slot at the end", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };
    const project = await createProjectFixture(org.id);
    const cat = await createCategoryFixture(org.id, project.id, "Audio", 0);

    // Pre-populate the destination with two existing slots so we can
    // assert the new one lands at sortOrder 2.
    const pgInCat1 = await createGroupFixture(org.id, project.id, cat.id, "X1", 0);
    const pgInCat2 = await createGroupFixture(org.id, project.id, cat.id, "X2", 1);
    await testPrisma.categorySlot.create({
      data: { projectCategoryId: cat.id, projectGroupId: pgInCat1.id, sortOrder: 0 },
    });
    await testPrisma.categorySlot.create({
      data: { projectCategoryId: cat.id, projectGroupId: pgInCat2.id, sortOrder: 1 },
    });

    // Seed the orphan project group (categoryId = null) directly.
    const orphan = await testPrisma.projectGroup.create({
      data: {
        organizationId: org.id, projectId: project.id,
        categoryId: null, title: "Orphan", sortOrder: 0,
      },
    });

    await moveProjectGroupToCategory({ groupId: orphan.id, categoryId: cat.id });

    const convex = await getConvexClient();
    const orphanAfter = await convex.query(api.projectGroups.getById, { id: orphan.id });
    expect(orphanAfter!.categoryId).toBe(cat.id);

    const slotList = await convex.query(api.categorySlots.listByProjectGroupId, {
      projectGroupId: orphan.id,
    });
    const slot = slotList[0]!;
    expect(slot.projectCategoryId).toBe(cat.id);
    expect(slot.sortOrder).toBe(2);
  });

  it("is a no-op when an already-uncategorised group is moved to null again", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };
    const project = await createProjectFixture(org.id);
    const orphan = await testPrisma.projectGroup.create({
      data: {
        organizationId: org.id, projectId: project.id,
        categoryId: null, title: "Orphan", sortOrder: 0,
      },
    });

    const result = await moveProjectGroupToCategory({
      groupId: orphan.id, categoryId: null,
    });
    expect(result).toMatchObject({ success: true, noop: true });
    expect(h.recalcSpy).not.toHaveBeenCalled();
  });
});

describe("getUncategorizedProjectGroups", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("returns project groups with null categoryId for the requested project, scoped to org", async () => {
    const orgA = await createOrgFixture({ slug: "org-a" });
    const orgB = await createOrgFixture({ slug: "org-b" });
    const userA = await createUserFixture(orgA.id, "owner");
    h.ctx = { organizationId: orgA.id, userId: userA.id, userName: "A" };

    const projectA = await createProjectFixture(orgA.id);
    const catA = await createCategoryFixture(orgA.id, projectA.id, "A");
    // Mix of one categorised + one orphan in our project — only the
    // orphan should come back.
    await createGroupFixture(orgA.id, projectA.id, catA.id, "PG-in-cat");
    const orphanInA = await testPrisma.projectGroup.create({
      data: {
        organizationId: orgA.id, projectId: projectA.id,
        categoryId: null, title: "Orphan-A", sortOrder: 0,
      },
    });

    // Second project in same org — its orphan must NOT leak in.
    const projectA2 = await createProjectFixture(orgA.id);
    await testPrisma.projectGroup.create({
      data: {
        organizationId: orgA.id, projectId: projectA2.id,
        categoryId: null, title: "Orphan-A2", sortOrder: 0,
      },
    });

    // Other org's orphan must NOT leak in.
    const projectB = await createProjectFixture(orgB.id);
    await testPrisma.projectGroup.create({
      data: {
        organizationId: orgB.id, projectId: projectB.id,
        categoryId: null, title: "Orphan-B", sortOrder: 0,
      },
    });

    const result = await getUncategorizedProjectGroups(projectA.id);
    const titles = (result as Array<{ id: string; title: string }>).map((g) => g.title);
    expect(titles).toEqual([orphanInA.title]);
  });
});
