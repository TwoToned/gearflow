/**
 * Regression test for the sub-hire grouping bug (issue #3):
 *
 *   "I have a sub-hire order with things I've put into groups/categories.
 *    When I add a new thing to the sub-hire order, the things that were
 *    already in the groups/categories get moved back OUT of them."
 *
 * Root cause: `generateSubHireLineItems` deletes + recreates every project
 * line item for a sub-hire on each add/edit and resolves placement ONLY from
 * the sub-hire entity's target fields / order-default — never from the
 * projectLineItem's own groupId/categoryId. `moveLineItemToGroup` used to patch only the
 * projectLineItem, so the manual placement was lost on the next regenerate.
 *
 * The fix makes `moveLineItemToGroup` write the placement back to the
 * originating sub-hire item/group's target* fields (mirroring
 * `moveSubHireGroupToCategory`), which is what regeneration reads.
 *
 * NOTE: assertions read the sub-hire item back from Convex directly. In this
 * worktree the shared-dev Convex→Prisma readback is not wired, so a
 * `testPrisma` read would NOT reflect a Convex-only write (this is the same
 * reason the category-slots int suite has known-red Prisma-readback
 * assertions). Reading Convex is the reliable path.
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

import { moveLineItemToGroup } from "@/server/project-groups";

// ── Fixtures ────────────────────────────────────────────────────────────────

async function createSupplierFixture(orgId: string) {
  return testPrisma.supplier.create({ data: { organizationId: orgId, name: "Supplier" } });
}
async function createProjectFixture(orgId: string) {
  return testPrisma.project.create({
    data: { organizationId: orgId, projectNumber: `P-${createId().slice(0, 6)}`, name: "Test Project" },
  });
}
async function createCategoryFixture(orgId: string, projectId: string, name = "Cat", sortOrder = 0) {
  return testPrisma.projectCategory.create({
    data: { organizationId: orgId, projectId, name, sortOrder },
  });
}
async function createProjectGroupFixture(orgId: string, projectId: string, categoryId: string) {
  return testPrisma.projectGroup.create({
    data: { organizationId: orgId, projectId, categoryId, title: "PG", sortOrder: 0 },
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
async function createSubHireItemFixture(subHireId: string, orgId: string) {
  return testPrisma.subHireItem.create({
    data: { subHireId, description: "Hazer", quantity: 1 },
  });
}
/** Materialise the standalone sub-hire ProjectLineItem that generateSubHireLineItems would create. */
async function createSubHireLineItem(
  orgId: string,
  projectId: string,
  subHireId: string,
  subHireItemId: string,
) {
  return testPrisma.projectLineItem.create({
    data: {
      organizationId: orgId,
      projectId,
      subHireId,
      subHireItemId,
      isKitChild: false,
      description: "Hazer",
    },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("moveLineItemToGroup — persists placement back to the sub-hire item (issue #3)", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
    h.recalcSpy.mockClear();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("writes targetGroupId + targetCategoryId to the sub-hire item when moved into a project group", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const supplier = await createSupplierFixture(org.id);
    const project = await createProjectFixture(org.id);
    const cat = await createCategoryFixture(org.id, project.id);
    const pg = await createProjectGroupFixture(org.id, project.id, cat.id);
    const subHire = await createSubHireFixture(org.id, supplier.id, user.id, project.id);
    const item = await createSubHireItemFixture(subHire.id, org.id);
    const line = await createSubHireLineItem(org.id, project.id, subHire.id, item.id);

    await moveLineItemToGroup({
      lineItemId: line.id,
      targetGroupId: pg.id,
      targetCategoryId: cat.id,
    });

    const convex = await getConvexClient();
    const itemAfter = await convex.query(api.subHireItems.getById, { id: item.id });
    expect(itemAfter).not.toBeNull();
    // Without the fix these stay null and the next regenerate reverts the item
    // to the order default — "moved back OUT" of the group.
    expect(itemAfter!.targetGroupId).toBe(pg.id);
    expect(itemAfter!.targetCategoryId).toBe(cat.id);
  });

  it("writes targetCategoryId (and clears targetGroupId) when moved into a bare category", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const supplier = await createSupplierFixture(org.id);
    const project = await createProjectFixture(org.id);
    const cat = await createCategoryFixture(org.id, project.id);
    const subHire = await createSubHireFixture(org.id, supplier.id, user.id, project.id);
    const item = await createSubHireItemFixture(subHire.id, org.id);
    const line = await createSubHireLineItem(org.id, project.id, subHire.id, item.id);

    await moveLineItemToGroup({
      lineItemId: line.id,
      targetGroupId: null,
      targetCategoryId: cat.id,
    });

    const convex = await getConvexClient();
    const itemAfter = await convex.query(api.subHireItems.getById, { id: item.id });
    expect(itemAfter).not.toBeNull();
    expect(itemAfter!.targetCategoryId).toBe(cat.id);
    expect(itemAfter!.targetGroupId ?? null).toBeNull();
  });

  it("does not touch sub-hire targets for a non-sub-hire line item", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const project = await createProjectFixture(org.id);
    const cat = await createCategoryFixture(org.id, project.id);
    const pg = await createProjectGroupFixture(org.id, project.id, cat.id);
    // Plain own-stock line — no subHireId/subHireItemId.
    const line = await testPrisma.projectLineItem.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        isKitChild: false,
        description: "Own-stock item",
      },
    });

    // Should simply move the line item without error (no sub-hire write-back).
    await expect(
      moveLineItemToGroup({ lineItemId: line.id, targetGroupId: pg.id, targetCategoryId: cat.id }),
    ).resolves.toBeTruthy();
  });
});
