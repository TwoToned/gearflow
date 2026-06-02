/**
 * Integration tests for custom field definitions (Wave 3).
 *
 * Invariants under test:
 *   - (organizationId, entityType, fieldKey) is unique
 *   - the same fieldKey can exist for different entity types
 *   - the same fieldKey can exist in different orgs
 *   - isActive filtering works (form reads only active defs)
 *   - definitions order by sortOrder
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
} from "../../tests/helpers/integration";

async function createDef(
  orgId: string,
  opts: {
    fieldKey: string;
    entityType?: "ASSET" | "BULK_ASSET" | "KIT" | "PROJECT";
    label?: string;
    isActive?: boolean;
    sortOrder?: number;
  },
) {
  return testPrisma.customFieldDefinition.create({
    data: {
      organizationId: orgId,
      entityType: opts.entityType ?? "ASSET",
      label: opts.label ?? opts.fieldKey,
      fieldKey: opts.fieldKey,
      fieldType: "TEXT",
      isActive: opts.isActive ?? true,
      sortOrder: opts.sortOrder ?? 0,
    },
  });
}

describe("CustomFieldDefinition", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("enforces unique (org, entityType, fieldKey)", async () => {
    const org = await createOrgFixture();
    await createDef(org.id, { fieldKey: "rigNumber" });
    await expect(
      createDef(org.id, { fieldKey: "rigNumber" }),
    ).rejects.toThrow();
  });

  it("allows the same fieldKey for different entity types", async () => {
    const org = await createOrgFixture();
    await createDef(org.id, { fieldKey: "ref", entityType: "ASSET" });
    // Different entity type → no collision
    const kitDef = await createDef(org.id, { fieldKey: "ref", entityType: "KIT" });
    expect(kitDef.id).toBeTruthy();
  });

  it("allows the same fieldKey in different orgs", async () => {
    const orgA = await createOrgFixture();
    const orgB = await createOrgFixture();
    await createDef(orgA.id, { fieldKey: "rigNumber" });
    const bDef = await createDef(orgB.id, { fieldKey: "rigNumber" });
    expect(bDef.id).toBeTruthy();
  });

  it("filters by isActive — the form only reads active definitions", async () => {
    const org = await createOrgFixture();
    await createDef(org.id, { fieldKey: "active1", isActive: true });
    await createDef(org.id, { fieldKey: "hidden1", isActive: false });
    await createDef(org.id, { fieldKey: "active2", isActive: true });

    const activeDefs = await testPrisma.customFieldDefinition.findMany({
      where: { organizationId: org.id, entityType: "ASSET", isActive: true },
    });
    expect(activeDefs).toHaveLength(2);
    expect(activeDefs.map((d) => d.fieldKey).sort()).toEqual(["active1", "active2"]);
  });

  it("orders by sortOrder", async () => {
    const org = await createOrgFixture();
    await createDef(org.id, { fieldKey: "third", sortOrder: 2 });
    await createDef(org.id, { fieldKey: "first", sortOrder: 0 });
    await createDef(org.id, { fieldKey: "second", sortOrder: 1 });

    const defs = await testPrisma.customFieldDefinition.findMany({
      where: { organizationId: org.id, entityType: "ASSET" },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    expect(defs.map((d) => d.fieldKey)).toEqual(["first", "second", "third"]);
  });

  it("cascades on org delete", async () => {
    const org = await createOrgFixture();
    await createDef(org.id, { fieldKey: "rigNumber" });
    await testPrisma.organization.delete({ where: { id: org.id } });
    const remaining = await testPrisma.customFieldDefinition.findMany({
      where: { organizationId: org.id },
    });
    expect(remaining).toHaveLength(0);
  });
});
