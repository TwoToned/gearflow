/**
 * Integration tests for check-in under the line-item fulfillment model
 * (Phase 3.4). Exercises the full deploy → return round-trip so checkout
 * and check-in are verified together — the eng review rated check-in the
 * highest-risk piece (a wrong rewrite strands an asset CHECKED_OUT).
 *
 * `@/lib/org-context` is mocked so the real warehouse.ts logic runs
 * against the Postgres test DB.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
  createModelFixture,
  createAssetFixture,
  createBulkAssetFixture,
} from "../../tests/helpers/integration";
import { createId } from "@paralleldrive/cuid2";

const h = vi.hoisted(() => ({
  ctx: { organizationId: "", userId: "", userName: "Tester" },
}));

vi.mock("@/lib/org-context", () => ({
  requirePermission: async () => h.ctx,
  getOrgContext: async () => h.ctx,
}));

import { checkOutItems, checkInItems } from "@/server/warehouse";

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
  overrides?: { quantity?: number; bulkAssetId?: string },
) {
  return testPrisma.projectLineItem.create({
    data: {
      organizationId: orgId,
      projectId,
      modelId,
      quantity: overrides?.quantity ?? 1,
      bulkAssetId: overrides?.bulkAssetId ?? null,
      status: "CONFIRMED",
    },
  });
}

describe("checkInItems — fulfillment model round-trip", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("deploy two, return one then the other — counters track partial state", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const model = await createModelFixture(org.id);
    const project = await createProjectFixture(org.id);
    const line = await createLineItemFixture(org.id, project.id, model.id, {
      quantity: 3,
    });
    const a1 = await createAssetFixture(org.id, model.id, { assetTag: "RT-1" });
    const a2 = await createAssetFixture(org.id, model.id, { assetTag: "RT-2" });

    await checkOutItems(project.id, [
      { lineItemId: line.id, assetId: a1.id },
      { lineItemId: line.id, assetId: a2.id },
    ]);

    // Return the first unit.
    await checkInItems(project.id, [
      { lineItemId: line.id, assetId: a1.id, returnCondition: "GOOD" },
    ]);

    let refreshed = await testPrisma.projectLineItem.findUniqueOrThrow({
      where: { id: line.id },
    });
    // One unit back, one still out — line stays CHECKED_OUT.
    expect(refreshed.status).toBe("CHECKED_OUT");
    expect(refreshed.checkedOutQuantity).toBe(1);
    expect(refreshed.returnedQuantity).toBe(1);
    expect(
      (await testPrisma.asset.findUniqueOrThrow({ where: { id: a1.id } }))
        .status,
    ).toBe("AVAILABLE");

    // Return the second.
    await checkInItems(project.id, [
      { lineItemId: line.id, assetId: a2.id, returnCondition: "GOOD" },
    ]);

    refreshed = await testPrisma.projectLineItem.findUniqueOrThrow({
      where: { id: line.id },
    });
    expect(refreshed.status).toBe("RETURNED");
    expect(refreshed.checkedOutQuantity).toBe(0);
    expect(refreshed.returnedQuantity).toBe(2);

    const units = await testPrisma.projectLineItemUnit.findMany({
      where: { lineItemId: line.id },
    });
    expect(units.every((u) => u.status === "RETURNED")).toBe(true);
  });

  it("a damaged return sends the asset to maintenance and counts the damage", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const model = await createModelFixture(org.id);
    const project = await createProjectFixture(org.id);
    const line = await createLineItemFixture(org.id, project.id, model.id, {
      quantity: 1,
    });
    const asset = await createAssetFixture(org.id, model.id, {
      assetTag: "DMG-1",
    });

    await checkOutItems(project.id, [{ lineItemId: line.id, assetId: asset.id }]);
    await checkInItems(project.id, [
      { lineItemId: line.id, assetId: asset.id, returnCondition: "DAMAGED" },
    ]);

    expect(
      (await testPrisma.asset.findUniqueOrThrow({ where: { id: asset.id } }))
        .status,
    ).toBe("IN_MAINTENANCE");
    const refreshed = await testPrisma.projectLineItem.findUniqueOrThrow({
      where: { id: line.id },
    });
    expect(refreshed.damagedQuantity).toBe(1);
    expect(refreshed.status).toBe("RETURNED");
  });

  it("bulk return accumulates from partial to fully returned", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const model = await createModelFixture(org.id);
    const project = await createProjectFixture(org.id);
    const bulk = await createBulkAssetFixture(org.id, model.id, {
      assetTag: "BULK-RT",
      total: 30,
    });
    const line = await createLineItemFixture(org.id, project.id, model.id, {
      quantity: 10,
      bulkAssetId: bulk.id,
    });

    await checkOutItems(project.id, [{ lineItemId: line.id, quantity: 10 }]);
    await checkInItems(project.id, [
      { lineItemId: line.id, returnCondition: "GOOD", quantity: 4 },
    ]);

    let refreshed = await testPrisma.projectLineItem.findUniqueOrThrow({
      where: { id: line.id },
    });
    expect(refreshed.status).toBe("CHECKED_OUT");
    expect(refreshed.returnedQuantity).toBe(4);
    expect(refreshed.checkedOutQuantity).toBe(6);

    await checkInItems(project.id, [
      { lineItemId: line.id, returnCondition: "GOOD", quantity: 6 },
    ]);
    refreshed = await testPrisma.projectLineItem.findUniqueOrThrow({
      where: { id: line.id },
    });
    expect(refreshed.status).toBe("RETURNED");
    expect(refreshed.returnedQuantity).toBe(10);
  });
});
