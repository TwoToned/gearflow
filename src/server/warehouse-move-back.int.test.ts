/**
 * Integration tests for the "move back a stage" reverse actions
 * (undeployItems / unreturnItems). Each mirrors its forward mutation in
 * reverse: units + asset status flip back, so a misclick can be corrected.
 *
 * Like the other warehouse int tests, `@/lib/org-context` is mocked so the
 * real server-action logic runs against the Postgres test DB + dev Convex.
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

import { checkOutItems, checkInItems, undeployItems, unreturnItems } from "@/server/warehouse";
import { prepItemDirect } from "@/server/check-records";

async function createProjectFixture(orgId: string) {
  return testPrisma.project.create({
    data: { organizationId: orgId, projectNumber: `P-${createId().slice(0, 8)}`, name: "Test Project", taxRate: 0 },
  });
}
async function createLineItemFixture(orgId: string, projectId: string, modelId: string, quantity: number) {
  return testPrisma.projectLineItem.create({
    data: { organizationId: orgId, projectId, modelId, quantity, status: "CONFIRMED" },
  });
}

describe("warehouse move-back (reverse a stage)", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("un-deploy sends a deployed unit back to Prepped and frees its asset", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const model = await createModelFixture(org.id);
    const project = await createProjectFixture(org.id);
    const line = await createLineItemFixture(org.id, project.id, model.id, 1);
    const asset = await createAssetFixture(org.id, model.id, { assetTag: "MB-1" });

    await prepItemDirect(project.id, line.id, asset.id);
    await checkOutItems(project.id, [{ lineItemId: line.id, assetId: asset.id }]);

    // Deployed.
    let unit = await testPrisma.projectLineItemUnit.findFirstOrThrow({ where: { lineItemId: line.id } });
    expect(unit.status).toBe("CHECKED_OUT");
    expect((await testPrisma.asset.findUniqueOrThrow({ where: { id: asset.id } })).status).toBe("CHECKED_OUT");

    // Move back to Prepped.
    await undeployItems(project.id, [{ lineItemId: line.id, assetId: asset.id, quantity: 1 }]);

    unit = await testPrisma.projectLineItemUnit.findFirstOrThrow({ where: { lineItemId: line.id } });
    expect(unit.status).toBe("CONFIRMED");
    expect(unit.prepStatus).toBe("PACKED");
    const refreshed = await testPrisma.projectLineItem.findUniqueOrThrow({ where: { id: line.id } });
    expect(refreshed.checkedOutQuantity).toBe(0);
    expect(refreshed.packedQuantity).toBe(1);
    // Asset is available again for another job.
    expect((await testPrisma.asset.findUniqueOrThrow({ where: { id: asset.id } })).status).toBe("AVAILABLE");
  });

  it("un-return sends a returned unit back to Deployed", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const model = await createModelFixture(org.id);
    const project = await createProjectFixture(org.id);
    const line = await createLineItemFixture(org.id, project.id, model.id, 1);
    const asset = await createAssetFixture(org.id, model.id, { assetTag: "MB-2" });

    await prepItemDirect(project.id, line.id, asset.id);
    await checkOutItems(project.id, [{ lineItemId: line.id, assetId: asset.id }]);
    await checkInItems(project.id, [{ lineItemId: line.id, assetId: asset.id, returnCondition: "GOOD" }]);

    let unit = await testPrisma.projectLineItemUnit.findFirstOrThrow({ where: { lineItemId: line.id } });
    expect(unit.status).toBe("RETURNED");

    await unreturnItems(project.id, [{ lineItemId: line.id, assetId: asset.id, quantity: 1 }]);

    unit = await testPrisma.projectLineItemUnit.findFirstOrThrow({ where: { lineItemId: line.id } });
    expect(unit.status).toBe("CHECKED_OUT");
    expect(unit.returnedQuantity).toBe(0);
    expect((await testPrisma.asset.findUniqueOrThrow({ where: { id: asset.id } })).status).toBe("CHECKED_OUT");
  });

  it("un-deploy only moves the requested count of a multi-unit line", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const model = await createModelFixture(org.id);
    const project = await createProjectFixture(org.id);
    const line = await createLineItemFixture(org.id, project.id, model.id, 3);
    const assets = [];
    for (let i = 0; i < 3; i++) {
      const a = await createAssetFixture(org.id, model.id, { assetTag: `MB3-${i}` });
      assets.push(a);
      await prepItemDirect(project.id, line.id, a.id);
    }
    await checkOutItems(project.id, [
      { lineItemId: line.id, assetId: assets[0].id },
      { lineItemId: line.id, assetId: assets[1].id },
      { lineItemId: line.id, assetId: assets[2].id },
    ]);

    // Move 1 of 3 back to Prepped.
    await undeployItems(project.id, [{ lineItemId: line.id, quantity: 1 }]);

    const units = await testPrisma.projectLineItemUnit.findMany({ where: { lineItemId: line.id } });
    expect(units.filter((u) => u.status === "CHECKED_OUT")).toHaveLength(2);
    expect(units.filter((u) => u.status === "CONFIRMED")).toHaveLength(1);
    const refreshed = await testPrisma.projectLineItem.findUniqueOrThrow({ where: { id: line.id } });
    expect(refreshed.checkedOutQuantity).toBe(2);
  });
});
