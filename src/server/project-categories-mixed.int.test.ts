/**
 * Integration test for the Phase 5b extension of getProjectCategories:
 * the new mixedGroups[] array interleaves project groups and sub-hire
 * groups per category, ordered by CategorySlot.sortOrder with a fallback
 * to the per-table sortOrder for groups that don't have a slot row yet.
 *
 * Regression coverage: categories with no sub-hire groups continue to
 * behave identically (existing consumers untouched).
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
}));

vi.mock("@/lib/org-context", () => ({
  requirePermission: async () => h.ctx,
  getOrgContext: async () => h.ctx,
}));

import { getProjectCategories } from "@/server/project-categories";

// ── Fixtures ────────────────────────────────────────────────────────────────

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
async function createGroupFixture(
  orgId: string,
  projectId: string,
  categoryId: string,
  title = "PG",
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
      title: opts.title ?? "SHG",
      targetCategoryId: opts.targetCategoryId ?? null,
      sortOrder: opts.sortOrder ?? 0,
    },
  });
}

type CategoryWithMixed = {
  id: string;
  name: string;
  mixedGroups: Array<
    | { kind: "project"; sortOrder: number; projectGroupId: string }
    | { kind: "subHire"; sortOrder: number; subHireGroupId: string }
  >;
};

describe("getProjectCategories.mixedGroups — Phase 5b", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("interleaves project groups and sub-hire groups by CategorySlot.sortOrder", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };
    const supplier = await createSupplierFixture(org.id);
    const project = await createProjectFixture(org.id);
    const cat = await createCategoryFixture(org.id, project.id);
    const pg = await createGroupFixture(org.id, project.id, cat.id, "PG", 0);
    const subHire = await createSubHireFixture(org.id, supplier.id, user.id, project.id);
    const shg = await createSubHireGroupFixture(subHire.id, { targetCategoryId: cat.id, sortOrder: 0 });

    // Cross-type slot order: sub-hire FIRST, project group SECOND.
    await testPrisma.categorySlot.createMany({
      data: [
        { projectCategoryId: cat.id, sortOrder: 0, subHireGroupId: shg.id },
        { projectCategoryId: cat.id, sortOrder: 1, projectGroupId: pg.id },
      ],
    });

    const result = (await getProjectCategories(project.id)) as CategoryWithMixed[];
    const target = result.find((c) => c.id === cat.id);
    expect(target).toBeDefined();
    expect(target!.mixedGroups).toEqual([
      { kind: "subHire", sortOrder: 0, subHireGroupId: shg.id },
      { kind: "project", sortOrder: 1, projectGroupId: pg.id },
    ]);
  });

  it("falls back to per-table sortOrder when a group has no CategorySlot row", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };
    const supplier = await createSupplierFixture(org.id);
    const project = await createProjectFixture(org.id);
    const cat = await createCategoryFixture(org.id, project.id);
    const pg = await createGroupFixture(org.id, project.id, cat.id, "PG", 5);
    const subHire = await createSubHireFixture(org.id, supplier.id, user.id, project.id);
    const shg = await createSubHireGroupFixture(subHire.id, { targetCategoryId: cat.id, sortOrder: 2 });

    // No CategorySlot rows — both groups fall back to their own sortOrder.
    const result = (await getProjectCategories(project.id)) as CategoryWithMixed[];
    const target = result.find((c) => c.id === cat.id);
    expect(target!.mixedGroups).toEqual([
      { kind: "subHire", sortOrder: 2, subHireGroupId: shg.id },
      { kind: "project", sortOrder: 5, projectGroupId: pg.id },
    ]);
  });

  it("does not regress categories with no sub-hire groups (existing consumers)", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };
    const project = await createProjectFixture(org.id);
    const cat = await createCategoryFixture(org.id, project.id);
    const pgA = await createGroupFixture(org.id, project.id, cat.id, "A", 0);
    const pgB = await createGroupFixture(org.id, project.id, cat.id, "B", 1);

    const result = (await getProjectCategories(project.id)) as CategoryWithMixed[];
    const target = result.find((c) => c.id === cat.id);
    expect(target!.mixedGroups).toEqual([
      { kind: "project", sortOrder: 0, projectGroupId: pgA.id },
      { kind: "project", sortOrder: 1, projectGroupId: pgB.id },
    ]);
  });

  it("ignores sub-hire groups whose targetCategoryId points elsewhere", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };
    const supplier = await createSupplierFixture(org.id);
    const project = await createProjectFixture(org.id);
    const catA = await createCategoryFixture(org.id, project.id, "A", 0);
    const catB = await createCategoryFixture(org.id, project.id, "B", 1);
    const subHire = await createSubHireFixture(org.id, supplier.id, user.id, project.id);
    // Sub-hire group placed in catB.
    await createSubHireGroupFixture(subHire.id, { targetCategoryId: catB.id });

    const result = (await getProjectCategories(project.id)) as CategoryWithMixed[];
    const a = result.find((c) => c.id === catA.id);
    const b = result.find((c) => c.id === catB.id);
    expect(a!.mixedGroups).toHaveLength(0);
    expect(b!.mixedGroups).toHaveLength(1);
    expect(b!.mixedGroups[0].kind).toBe("subHire");
  });
});

// ── Fix C — verify kit + line item placement by groupId/categoryId ──────────

describe("getProjectCategories — line item placement (Fix C regression)", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("renders a kit parent (kitId set, groupId set) INSIDE its group's lineItems", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };
    const project = await createProjectFixture(org.id);
    const cat = await createCategoryFixture(org.id, project.id, "Audio");
    const pg = await createGroupFixture(org.id, project.id, cat.id, "PA System");

    // Seed a minimal Kit so the kit FK is satisfied without the full
    // addKitLineItem path. We're testing the QUERY, not the create.
    const kit = await testPrisma.kit.create({
      data: {
        organizationId: org.id,
        name: "Test Kit",
        assetTag: "K-TEST",
      },
    });
    // Kit parent line item — kitId set, groupId set, categoryId set.
    const kitParent = await testPrisma.projectLineItem.create({
      data: {
        organizationId: org.id, projectId: project.id,
        kitId: kit.id, groupId: pg.id, categoryId: cat.id,
        description: `${kit.assetTag} - ${kit.name}`,
        quantity: 1, type: "EQUIPMENT", isKitChild: false,
      },
    });

    type CatWithLineItems = CategoryWithMixed & {
      groups: Array<{ id: string; lineItems?: Array<{ id: string }> }>;
      lineItems?: Array<{ id: string }>;
    };
    const result = (await getProjectCategories(project.id)) as CatWithLineItems[];
    const renderedCat = result.find((c) => c.id === cat.id);
    expect(renderedCat).toBeDefined();
    const renderedGroup = renderedCat!.groups.find((g) => g.id === pg.id);
    expect(renderedGroup).toBeDefined();
    const groupItems = renderedGroup!.lineItems ?? [];
    expect(groupItems.map((i) => i.id)).toContain(kitParent.id);
    // Should NOT appear in cat.lineItems (which is groupId=null only).
    const standalone = renderedCat!.lineItems ?? [];
    expect(standalone.map((i) => i.id)).not.toContain(kitParent.id);
  });

  it("renders a category-scoped item (categoryId set, groupId null) in cat.lineItems", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };
    const project = await createProjectFixture(org.id);
    const cat = await createCategoryFixture(org.id, project.id, "Audio");

    const item = await testPrisma.projectLineItem.create({
      data: {
        organizationId: org.id, projectId: project.id,
        categoryId: cat.id, // groupId intentionally null
        description: "Loose mic", quantity: 1, type: "EQUIPMENT",
      },
    });

    type CatWithLineItems = CategoryWithMixed & {
      lineItems?: Array<{ id: string }>;
    };
    const result = (await getProjectCategories(project.id)) as CatWithLineItems[];
    const renderedCat = result.find((c) => c.id === cat.id);
    const standalone = renderedCat!.lineItems ?? [];
    expect(standalone.map((i) => i.id)).toContain(item.id);
  });
});
