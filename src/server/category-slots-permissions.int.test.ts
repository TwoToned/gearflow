/**
 * Integration test S9 from the cross-type unification test plan — the
 * permission seam for cross-type writes.
 *
 * moveSubHireGroupToCategory and reorderMixedGroupsInCategory each
 * require BOTH project:manage_line_items AND subHire:update (Finding
 * 5.1). Without either, the action must throw and no DB write may
 * occur. With both, the action must succeed.
 *
 * Separate file from category-slots.int.test.ts because that file's
 * vi.mock returns the test context unconditionally — we need a more
 * sophisticated mock that fails based on (resource, action) pair so
 * each individual permission can be selectively withheld.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
} from "../../tests/helpers/integration";
import { createId } from "@paralleldrive/cuid2";

const h = vi.hoisted(() => ({
  ctx: { organizationId: "", userId: "", userName: "Tester" },
  failOn: new Set<string>(),
}));

vi.mock("@/lib/org-context", () => ({
  requirePermission: async (resource: string, action: string) => {
    const key = `${resource}:${action}`;
    if (h.failOn.has(key)) {
      throw new Error(`Forbidden: missing ${key}`);
    }
    return h.ctx;
  },
  getOrgContext: async () => h.ctx,
}));

vi.mock("@/server/line-items", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/line-items")>();
  return {
    ...actual,
    recalculateProjectTotals: vi.fn<(projectId: string) => Promise<void>>(),
  };
});

import {
  moveSubHireGroupToCategory,
  reorderMixedGroupsInCategory,
} from "@/server/category-slots";

// ── Fixtures (compact — mirror the main test file shape) ────────────────────

async function createSupplierFixture(orgId: string) {
  return testPrisma.supplier.create({ data: { organizationId: orgId, name: "Sup" } });
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
async function createGroupFixture(orgId: string, projectId: string, categoryId: string) {
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
async function createSubHireGroupFixture(subHireId: string, targetCategoryId: string | null) {
  return testPrisma.subHireGroup.create({
    data: { subHireId, title: "SHG", targetCategoryId, sortOrder: 0 },
  });
}

// ── Scenarios ───────────────────────────────────────────────────────────────

describe("S9 — moveSubHireGroupToCategory permission seam", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
    h.failOn = new Set();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  async function setup() {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };
    const supplier = await createSupplierFixture(org.id);
    const project = await createProjectFixture(org.id);
    const catA = await createCategoryFixture(org.id, project.id, "A", 0);
    const catB = await createCategoryFixture(org.id, project.id, "B", 1);
    const subHire = await createSubHireFixture(org.id, supplier.id, user.id, project.id);
    const shg = await createSubHireGroupFixture(subHire.id, catA.id);
    return { catA, catB, shg };
  }

  it("rejects when project:manage_line_items is missing", async () => {
    const { catB, shg } = await setup();
    h.failOn = new Set(["project:manage_line_items"]);

    await expect(
      moveSubHireGroupToCategory({ groupId: shg.id, categoryId: catB.id }),
    ).rejects.toThrow(/Forbidden.*project:manage_line_items/);

    const groupAfter = await testPrisma.subHireGroup.findUniqueOrThrow({ where: { id: shg.id } });
    expect(groupAfter.targetCategoryId).not.toBe(catB.id); // no write happened
  });

  it("rejects when subHire:update is missing (cross-type write needs both)", async () => {
    const { catB, shg } = await setup();
    h.failOn = new Set(["subHire:update"]);

    await expect(
      moveSubHireGroupToCategory({ groupId: shg.id, categoryId: catB.id }),
    ).rejects.toThrow(/Forbidden.*subHire:update/);

    const groupAfter = await testPrisma.subHireGroup.findUniqueOrThrow({ where: { id: shg.id } });
    expect(groupAfter.targetCategoryId).not.toBe(catB.id);
  });

  it("succeeds when both permissions are held", async () => {
    const { catB, shg } = await setup();
    h.failOn = new Set(); // both held

    await moveSubHireGroupToCategory({ groupId: shg.id, categoryId: catB.id });

    const groupAfter = await testPrisma.subHireGroup.findUniqueOrThrow({ where: { id: shg.id } });
    expect(groupAfter.targetCategoryId).toBe(catB.id);
  });
});

describe("S9 — reorderMixedGroupsInCategory permission seam", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
    h.failOn = new Set();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  async function setup() {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };
    const supplier = await createSupplierFixture(org.id);
    const project = await createProjectFixture(org.id);
    const cat = await createCategoryFixture(org.id, project.id);
    const pg = await createGroupFixture(org.id, project.id, cat.id);
    const subHire = await createSubHireFixture(org.id, supplier.id, user.id, project.id);
    const shg = await createSubHireGroupFixture(subHire.id, cat.id);
    return { cat, pg, shg };
  }

  it("rejects when project:manage_line_items is missing", async () => {
    const { cat, pg, shg } = await setup();
    h.failOn = new Set(["project:manage_line_items"]);

    await expect(
      reorderMixedGroupsInCategory({
        categoryId: cat.id,
        orderedIds: [`shg-${shg.id}`, `pg-${pg.id}`],
      }),
    ).rejects.toThrow(/Forbidden.*project:manage_line_items/);

    const slots = await testPrisma.categorySlot.findMany({ where: { projectCategoryId: cat.id } });
    expect(slots).toHaveLength(0); // no write happened
  });

  it("rejects when subHire:update is missing", async () => {
    const { cat, pg, shg } = await setup();
    h.failOn = new Set(["subHire:update"]);

    await expect(
      reorderMixedGroupsInCategory({
        categoryId: cat.id,
        orderedIds: [`shg-${shg.id}`, `pg-${pg.id}`],
      }),
    ).rejects.toThrow(/Forbidden.*subHire:update/);

    const slots = await testPrisma.categorySlot.findMany({ where: { projectCategoryId: cat.id } });
    expect(slots).toHaveLength(0);
  });

  it("succeeds when both permissions are held", async () => {
    const { cat, pg, shg } = await setup();

    await reorderMixedGroupsInCategory({
      categoryId: cat.id,
      orderedIds: [`shg-${shg.id}`, `pg-${pg.id}`],
    });

    const slots = await testPrisma.categorySlot.findMany({
      where: { projectCategoryId: cat.id },
      orderBy: { sortOrder: "asc" },
    });
    expect(slots).toHaveLength(2);
    expect(slots[0].subHireGroupId).toBe(shg.id);
    expect(slots[1].projectGroupId).toBe(pg.id);
  });
});
