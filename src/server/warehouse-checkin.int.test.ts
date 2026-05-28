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

import {
  checkOutItems,
  checkInItems,
  lookupAssetForScan,
} from "@/server/warehouse";
import { completeCheckAndStore } from "@/server/check-records";

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

  it("returning a line with no asset specified returns every out unit", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const model = await createModelFixture(org.id);
    const project = await createProjectFixture(org.id);
    const line = await createLineItemFixture(org.id, project.id, model.id, {
      quantity: 2,
    });
    const a1 = await createAssetFixture(org.id, model.id, { assetTag: "WL-1" });
    const a2 = await createAssetFixture(org.id, model.id, { assetTag: "WL-2" });

    await checkOutItems(project.id, [
      { lineItemId: line.id, assetId: a1.id },
      { lineItemId: line.id, assetId: a2.id },
    ]);
    // "Return whole line" — no assetId given.
    await checkInItems(project.id, [
      { lineItemId: line.id, returnCondition: "GOOD" },
    ]);

    const units = await testPrisma.projectLineItemUnit.findMany({
      where: { lineItemId: line.id },
    });
    expect(units.every((u) => u.status === "RETURNED")).toBe(true);
    const assets = await testPrisma.asset.findMany({
      where: { id: { in: [a1.id, a2.id] } },
    });
    expect(assets.every((a) => a.status === "AVAILABLE")).toBe(true);
  });

  it("checks in a kit-child line (asset on the line, no unit row)", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const model = await createModelFixture(org.id);
    const project = await createProjectFixture(org.id);
    const asset = await createAssetFixture(org.id, model.id, {
      assetTag: "KIT-CHILD-1",
      status: "CHECKED_OUT",
    });
    // A kit child: asset pinned to the line directly, deployed, no unit row.
    const child = await testPrisma.projectLineItem.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        modelId: model.id,
        quantity: 1,
        isKitChild: true,
        assetId: asset.id,
        status: "CHECKED_OUT",
      },
    });

    await checkInItems(project.id, [
      { lineItemId: child.id, assetId: asset.id, returnCondition: "GOOD" },
    ]);

    expect(
      (await testPrisma.asset.findUniqueOrThrow({ where: { id: asset.id } }))
        .status,
    ).toBe("AVAILABLE");
    expect(
      (
        await testPrisma.projectLineItem.findUniqueOrThrow({
          where: { id: child.id },
        })
      ).status,
    ).toBe("RETURNED");
  });

  it("lookupAssetForScan resolves a deployed asset for check-in via its unit", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const model = await createModelFixture(org.id);
    const project = await createProjectFixture(org.id);
    const line = await createLineItemFixture(org.id, project.id, model.id, {
      quantity: 1,
    });
    const asset = await createAssetFixture(org.id, model.id, {
      assetTag: "SCAN-1",
    });

    // Before deployment: nothing to check in.
    const before = (await lookupAssetForScan(
      project.id,
      "SCAN-1",
      "checkin",
    )) as { reason: string | null };
    expect(before.reason).toBe("not_checked_out");

    await checkOutItems(project.id, [
      { lineItemId: line.id, assetId: asset.id },
    ]);

    // After deployment: resolves to the line + asset, ready to return.
    const after = (await lookupAssetForScan(
      project.id,
      "SCAN-1",
      "checkin",
    )) as { reason: string | null; lineItemId: string | null; assetId: string | null };
    expect(after.reason).toBeNull();
    expect(after.lineItemId).toBe(line.id);
    expect(after.assetId).toBe(asset.id);
  });

  it("completeCheckAndStore on a multi-unit line returns every unit + asset", async () => {
    // The bug from deep review: completeCheckAndStore hand-rolled its
    // own checkin logic — only incremented line.returnedQuantity and
    // flipped line.status. On a multi-unit serialised line the units
    // and physical assets stayed CHECKED_OUT forever. Fix delegates
    // to returnLineUnits (the same code path checkInItems uses).
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const model = await createModelFixture(org.id);
    const project = await createProjectFixture(org.id);
    const line = await createLineItemFixture(org.id, project.id, model.id, {
      quantity: 3,
    });
    const a1 = await createAssetFixture(org.id, model.id, { assetTag: "RX-1" });
    const a2 = await createAssetFixture(org.id, model.id, { assetTag: "RX-2" });
    const a3 = await createAssetFixture(org.id, model.id, { assetTag: "RX-3" });

    // Deploy all 3.
    await checkOutItems(project.id, [
      { lineItemId: line.id, assetId: a1.id },
      { lineItemId: line.id, assetId: a2.id },
      { lineItemId: line.id, assetId: a3.id },
    ]);

    // Need a CheckItem so completeCheckAndStore's `checks` array is
    // valid (the schema requires >= 1).
    const checkItem = await testPrisma.checkItem.create({
      data: {
        organizationId: org.id,
        label: "Visual inspection",
        type: "PASS_FAIL",
      },
    });
    const checks = [{
      checkItemId: checkItem.id,
      result: "PASS" as const,
      photos: [],
    }];

    // Pre-cutover the warehouse UI calls this once per unit (queue of
    // N check forms). Each call should flip exactly one unit + asset.
    await completeCheckAndStore({
      projectId: project.id,
      lineItemId: line.id,
      assetId: a1.id,
      checks,
      condition: "GOOD",
    });
    await completeCheckAndStore({
      projectId: project.id,
      lineItemId: line.id,
      assetId: a2.id,
      checks,
      condition: "DAMAGED",
    });
    await completeCheckAndStore({
      projectId: project.id,
      lineItemId: line.id,
      assetId: a3.id,
      checks,
      condition: "MISSING",
    });

    // Units all RETURNED with the correct condition.
    const units = await testPrisma.projectLineItemUnit.findMany({
      where: { lineItemId: line.id },
      orderBy: { ordinal: "asc" },
    });
    expect(units.every((u) => u.status === "RETURNED")).toBe(true);

    // Assets transitioned per their return condition.
    const a1After = await testPrisma.asset.findUniqueOrThrow({ where: { id: a1.id } });
    const a2After = await testPrisma.asset.findUniqueOrThrow({ where: { id: a2.id } });
    const a3After = await testPrisma.asset.findUniqueOrThrow({ where: { id: a3.id } });
    expect(a1After.status).toBe("AVAILABLE");        // GOOD
    expect(a2After.status).toBe("IN_MAINTENANCE");   // DAMAGED
    expect(a3After.status).toBe("LOST");             // MISSING

    // Line rolled up properly.
    const refreshed = await testPrisma.projectLineItem.findUniqueOrThrow({
      where: { id: line.id },
    });
    expect(refreshed.status).toBe("RETURNED");
    expect(refreshed.returnedQuantity).toBe(3);
    expect(refreshed.checkedOutQuantity).toBe(0);
  });
});
