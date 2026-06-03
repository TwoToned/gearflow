/**
 * Integration tests S1 + S2 from the cross-type unification test plan
 * (~/.gstack/projects/TwoToned-gearflow/jayden-main-test-plan-20260603-164457.md).
 *
 * S1 — Schema migration safety:
 *   - the migration backfill pulls a NULL-category SubHireGroup's placement
 *     from its synthetic parent ProjectLineItem.categoryId
 *   - a SubHireGroup with no synthetic parent stays uncategorised (NULL)
 *
 * S2 — CategorySlot invariants (DB-enforced):
 *   - XOR: exactly one of projectGroupId / subHireGroupId must be set
 *   - UNIQUE(projectCategoryId, sortOrder) across the mixed group list
 *   - UNIQUE(projectGroupId) and UNIQUE(subHireGroupId) — no double-slotting
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
} from "../../tests/helpers/integration";
import { createId } from "@paralleldrive/cuid2";

// ── Local fixtures (promote to tests/helpers/integration.ts when S3+ reuse them) ──

async function createSupplierFixture(orgId: string, name = "Test Supplier") {
  return testPrisma.supplier.create({
    data: { organizationId: orgId, name },
  });
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
 * The exact backfill UPDATE from migration 20260603164500_add_category_slot,
 * step 1. Re-run here against a fixture so a future rewrite of the backfill
 * that breaks placement inheritance is caught.
 */
async function runBackfillStep1() {
  return testPrisma.$executeRawUnsafe(`
    UPDATE "sub_hire_group" sg
    SET "targetCategoryId" = pli."categoryId"
    FROM "project_line_item" pli
    WHERE pli."subHireGroupId" = sg.id
      AND pli."isKitChild" = false
      AND sg."targetCategoryId" IS NULL
      AND pli."categoryId" IS NOT NULL
  `);
}

describe("S1 — migration backfill safety", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("backfills a NULL-category sub-hire group from its synthetic parent line item", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    const supplier = await createSupplierFixture(org.id);
    const project = await createProjectFixture(org.id);
    const category = await createCategoryFixture(org.id, project.id);
    const subHire = await createSubHireFixture(org.id, supplier.id, user.id, project.id);

    // Sub-hire group starts uncategorised...
    const shGroup = await createSubHireGroupFixture(subHire.id, { targetCategoryId: null });

    // ...but its synthetic parent line item already lives in `category`.
    await testPrisma.projectLineItem.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        subHireGroupId: shGroup.id,
        categoryId: category.id,
        isKitChild: false,
        description: "Sub-hire group parent",
      },
    });

    await runBackfillStep1();

    const after = await testPrisma.subHireGroup.findUniqueOrThrow({ where: { id: shGroup.id } });
    expect(after.targetCategoryId).toBe(category.id);
  });

  it("leaves a sub-hire group uncategorised when it has no synthetic parent", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    const supplier = await createSupplierFixture(org.id);
    const project = await createProjectFixture(org.id);
    const subHire = await createSubHireFixture(org.id, supplier.id, user.id, project.id);
    const shGroup = await createSubHireGroupFixture(subHire.id, { targetCategoryId: null });

    await runBackfillStep1();

    const after = await testPrisma.subHireGroup.findUniqueOrThrow({ where: { id: shGroup.id } });
    expect(after.targetCategoryId).toBeNull();
  });

  it("does not overwrite an already-categorised sub-hire group", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    const supplier = await createSupplierFixture(org.id);
    const project = await createProjectFixture(org.id);
    const catA = await createCategoryFixture(org.id, project.id, "A", 0);
    const catB = await createCategoryFixture(org.id, project.id, "B", 1);
    const subHire = await createSubHireFixture(org.id, supplier.id, user.id, project.id);

    // Group is already pinned to catA; its parent line item is in catB.
    const shGroup = await createSubHireGroupFixture(subHire.id, { targetCategoryId: catA.id });
    await testPrisma.projectLineItem.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        subHireGroupId: shGroup.id,
        categoryId: catB.id,
        isKitChild: false,
        description: "Parent in B",
      },
    });

    await runBackfillStep1();

    const after = await testPrisma.subHireGroup.findUniqueOrThrow({ where: { id: shGroup.id } });
    expect(after.targetCategoryId).toBe(catA.id); // unchanged — backfill only touches NULLs
  });
});

describe("S2 — CategorySlot invariants", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  async function scaffold() {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id, "owner");
    const supplier = await createSupplierFixture(org.id);
    const project = await createProjectFixture(org.id);
    const category = await createCategoryFixture(org.id, project.id);
    const group = await createGroupFixture(org.id, project.id, category.id);
    const subHire = await createSubHireFixture(org.id, supplier.id, user.id, project.id);
    const shGroup = await createSubHireGroupFixture(subHire.id, { targetCategoryId: category.id });
    return { org, project, category, group, shGroup };
  }

  it("accepts a slot pointing at exactly one project group", async () => {
    const { category, group } = await scaffold();
    const slot = await testPrisma.categorySlot.create({
      data: { projectCategoryId: category.id, sortOrder: 0, projectGroupId: group.id },
    });
    expect(slot.projectGroupId).toBe(group.id);
    expect(slot.subHireGroupId).toBeNull();
  });

  it("accepts a slot pointing at exactly one sub-hire group", async () => {
    const { category, shGroup } = await scaffold();
    const slot = await testPrisma.categorySlot.create({
      data: { projectCategoryId: category.id, sortOrder: 0, subHireGroupId: shGroup.id },
    });
    expect(slot.subHireGroupId).toBe(shGroup.id);
    expect(slot.projectGroupId).toBeNull();
  });

  it("rejects a slot that points at BOTH a project group and a sub-hire group (XOR)", async () => {
    const { category, group, shGroup } = await scaffold();
    await expect(
      testPrisma.categorySlot.create({
        data: {
          projectCategoryId: category.id,
          sortOrder: 0,
          projectGroupId: group.id,
          subHireGroupId: shGroup.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a slot that points at NEITHER group (XOR)", async () => {
    const { category } = await scaffold();
    await expect(
      testPrisma.categorySlot.create({
        data: { projectCategoryId: category.id, sortOrder: 0 },
      }),
    ).rejects.toThrow();
  });

  it("rejects two slots with the same (projectCategoryId, sortOrder)", async () => {
    const { org, project, category, group } = await scaffold();
    const group2 = await createGroupFixture(org.id, project.id, category.id, "Group 2", 1);
    await testPrisma.categorySlot.create({
      data: { projectCategoryId: category.id, sortOrder: 0, projectGroupId: group.id },
    });
    await expect(
      testPrisma.categorySlot.create({
        data: { projectCategoryId: category.id, sortOrder: 0, projectGroupId: group2.id },
      }),
    ).rejects.toThrow();
  });

  it("rejects double-slotting the same project group", async () => {
    const { category, group } = await scaffold();
    await testPrisma.categorySlot.create({
      data: { projectCategoryId: category.id, sortOrder: 0, projectGroupId: group.id },
    });
    await expect(
      testPrisma.categorySlot.create({
        data: { projectCategoryId: category.id, sortOrder: 1, projectGroupId: group.id },
      }),
    ).rejects.toThrow();
  });

  it("rejects double-slotting the same sub-hire group", async () => {
    const { category, shGroup } = await scaffold();
    await testPrisma.categorySlot.create({
      data: { projectCategoryId: category.id, sortOrder: 0, subHireGroupId: shGroup.id },
    });
    await expect(
      testPrisma.categorySlot.create({
        data: { projectCategoryId: category.id, sortOrder: 1, subHireGroupId: shGroup.id },
      }),
    ).rejects.toThrow();
  });

  it("allows the same sortOrder in two different categories", async () => {
    const { org, project, category, group } = await scaffold();
    const catB = await createCategoryFixture(org.id, project.id, "B", 1);
    const groupB = await createGroupFixture(org.id, project.id, catB.id, "Group B");
    await testPrisma.categorySlot.create({
      data: { projectCategoryId: category.id, sortOrder: 0, projectGroupId: group.id },
    });
    const slotB = await testPrisma.categorySlot.create({
      data: { projectCategoryId: catB.id, sortOrder: 0, projectGroupId: groupB.id },
    });
    expect(slotB.sortOrder).toBe(0);
  });
});
