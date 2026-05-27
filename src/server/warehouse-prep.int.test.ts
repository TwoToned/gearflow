/**
 * Integration tests for prep under the line-item fulfillment model
 * (Phase 3.5). Prep creates/marks a ProjectLineItemUnit (prepStatus PACKED)
 * instead of splitting the line — and a later checkout must reuse that same
 * unit, not create a second one.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
  createModelFixture,
  createAssetFixture,
} from "../../tests/helpers/integration";
import { createId } from "@paralleldrive/cuid2";

const h = vi.hoisted(() => ({
  ctx: { organizationId: "", userId: "", userName: "Tester" },
}));

vi.mock("@/lib/org-context", () => ({
  requirePermission: async () => h.ctx,
  getOrgContext: async () => h.ctx,
}));

import { checkOutItems } from "@/server/warehouse";
import { prepItemDirect } from "@/server/check-records";

async function createProjectFixture(orgId: string) {
  return testPrisma.project.create({
    data: {
      organizationId: orgId,
      projectNumber: `P-${createId().slice(0, 8)}`,
      name: "Test Project",
      taxRate: 0,
    },
  });
}

async function createLineItemFixture(
  orgId: string,
  projectId: string,
  modelId: string,
  quantity: number,
) {
  return testPrisma.projectLineItem.create({
    data: {
      organizationId: orgId,
      projectId,
      modelId,
      quantity,
      status: "CONFIRMED",
    },
  });
}

describe("prepItemDirect — fulfillment model", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("prepping an asset marks a PACKED unit, never splits the line", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const model = await createModelFixture(org.id);
    const project = await createProjectFixture(org.id);
    const line = await createLineItemFixture(org.id, project.id, model.id, 5);
    const asset = await createAssetFixture(org.id, model.id, {
      assetTag: "PREP-1",
    });

    await prepItemDirect(project.id, line.id, asset.id);

    expect(
      await testPrisma.projectLineItem.count({
        where: { projectId: project.id },
      }),
    ).toBe(1);

    const units = await testPrisma.projectLineItemUnit.findMany({
      where: { lineItemId: line.id },
    });
    expect(units).toHaveLength(1);
    expect(units[0].assetId).toBe(asset.id);
    expect(units[0].prepStatus).toBe("PACKED");
    expect(units[0].status).toBe("CONFIRMED");

    const refreshed = await testPrisma.projectLineItem.findUniqueOrThrow({
      where: { id: line.id },
    });
    expect(refreshed.quantity).toBe(5);
    expect(refreshed.status).toBe("PREPPED");
    expect(refreshed.packedQuantity).toBe(1);
  });

  it("checkout reuses the unit a prep already created — no duplicate", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const model = await createModelFixture(org.id);
    const project = await createProjectFixture(org.id);
    const line = await createLineItemFixture(org.id, project.id, model.id, 3);
    const asset = await createAssetFixture(org.id, model.id, {
      assetTag: "PREP-DEPLOY-1",
    });

    await prepItemDirect(project.id, line.id, asset.id);
    await checkOutItems(project.id, [
      { lineItemId: line.id, assetId: asset.id },
    ]);

    const units = await testPrisma.projectLineItemUnit.findMany({
      where: { lineItemId: line.id },
    });
    // Same unit, transitioned PACKED → CHECKED_OUT — not a second row.
    expect(units).toHaveLength(1);
    expect(units[0].status).toBe("CHECKED_OUT");

    const refreshed = await testPrisma.projectLineItem.findUniqueOrThrow({
      where: { id: line.id },
    });
    expect(refreshed.status).toBe("CHECKED_OUT");
    expect(refreshed.checkedOutQuantity).toBe(1);
  });
});
