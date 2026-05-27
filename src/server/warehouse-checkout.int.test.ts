/**
 * Integration tests for checkout under the line-item fulfillment model
 * (Phase 3.2 of docs/designs/line-item-fulfillment-model.md).
 *
 * The invariant under test: scanning an asset to deploy creates a
 * ProjectLineItemUnit and rolls it up onto the order line. It must NEVER
 * split a qty-N line into N rows — the bug this whole rework fixes.
 *
 * `checkOutItems` gates on `requirePermission`, which needs a request
 * scope, so `@/lib/org-context` is mocked with a hoisted mutable context;
 * the real warehouse.ts logic then runs against the Postgres test DB.
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

import { checkOutItems } from "@/server/warehouse";

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

describe("checkOutItems — fulfillment model", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("scanning assets onto a qty-N line creates units, never splits the line", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const model = await createModelFixture(org.id);
    const project = await createProjectFixture(org.id);
    const line = await createLineItemFixture(org.id, project.id, model.id, {
      quantity: 5,
    });
    const a1 = await createAssetFixture(org.id, model.id, { assetTag: "A-1" });
    const a2 = await createAssetFixture(org.id, model.id, { assetTag: "A-2" });

    await checkOutItems(project.id, [
      { lineItemId: line.id, assetId: a1.id },
      { lineItemId: line.id, assetId: a2.id },
    ]);

    // The order line is still ONE row, quantity untouched — no split.
    const lineCount = await testPrisma.projectLineItem.count({
      where: { projectId: project.id },
    });
    expect(lineCount).toBe(1);

    const refreshed = await testPrisma.projectLineItem.findUniqueOrThrow({
      where: { id: line.id },
    });
    expect(refreshed.quantity).toBe(5);
    expect(refreshed.status).toBe("CHECKED_OUT");
    expect(refreshed.assignedQuantity).toBe(2);
    expect(refreshed.checkedOutQuantity).toBe(2);

    // Two unit rows, one per scanned asset, both checked out.
    const units = await testPrisma.projectLineItemUnit.findMany({
      where: { lineItemId: line.id },
      orderBy: { ordinal: "asc" },
    });
    expect(units).toHaveLength(2);
    expect(units.map((u) => u.assetId).sort()).toEqual([a1.id, a2.id].sort());
    expect(units.every((u) => u.status === "CHECKED_OUT")).toBe(true);
    expect(units.map((u) => u.ordinal).sort()).toEqual([1, 2]);

    // The physical assets are marked deployed.
    const assets = await testPrisma.asset.findMany({
      where: { id: { in: [a1.id, a2.id] } },
    });
    expect(assets.every((a) => a.status === "CHECKED_OUT")).toBe(true);
  });

  it("re-scanning an already-deployed asset is idempotent", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const model = await createModelFixture(org.id);
    const project = await createProjectFixture(org.id);
    const line = await createLineItemFixture(org.id, project.id, model.id, {
      quantity: 3,
    });
    const asset = await createAssetFixture(org.id, model.id, {
      assetTag: "DUP-1",
    });

    await checkOutItems(project.id, [{ lineItemId: line.id, assetId: asset.id }]);
    // Same scan again — must not create a second unit or throw.
    await checkOutItems(project.id, [{ lineItemId: line.id, assetId: asset.id }]);

    const units = await testPrisma.projectLineItemUnit.findMany({
      where: { lineItemId: line.id },
    });
    expect(units).toHaveLength(1);
    const refreshed = await testPrisma.projectLineItem.findUniqueOrThrow({
      where: { id: line.id },
    });
    expect(refreshed.assignedQuantity).toBe(1);
  });

  it("T&T preflight blocks when the failed asset lives on a unit (not line.assetId)", async () => {
    // Phase 4a regression guard. Pre-cutover, checkout's T&T preflight
    // scanned line.assetId + line.bulkAssetId. Post-cutover a prepped
    // asset lives on ProjectLineItemUnit and line.assetId is null —
    // without the unit-aware preflight, a prepped FAILED-T&T asset
    // would slip past the gate. The preflight now also reads units.
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const model = await createModelFixture(org.id);
    const project = await createProjectFixture(org.id);
    const line = await createLineItemFixture(org.id, project.id, model.id, {
      quantity: 1,
    });
    const failedAsset = await createAssetFixture(org.id, model.id, {
      assetTag: "TT-FAIL",
    });
    // FAILED T&T record on the asset.
    await testPrisma.testTagAsset.create({
      data: {
        organizationId: org.id,
        testTagId: `TT-${createId().slice(0, 6)}`,
        description: "Phase 4a preflight test",
        status: "FAILED",
        assetId: failedAsset.id,
        isActive: true,
      },
    });
    // Prep already created a unit for this line + asset. Line.assetId
    // stays null (the post-cutover shape).
    await testPrisma.projectLineItemUnit.create({
      data: {
        organizationId: org.id,
        lineItemId: line.id,
        ordinal: 1,
        assetId: failedAsset.id,
        quantity: 1,
        status: "CONFIRMED",
        prepStatus: "PACKED",
      },
    });

    // Caller does NOT pass assetId — the unit is supposed to carry it.
    // Without the fix, the preflight set is empty for this line and
    // the failed asset gets deployed silently.
    await expect(
      checkOutItems(project.id, [{ lineItemId: line.id }]),
    ).rejects.toMatchObject({ name: "TestTagBlockError" });
  });

  it("bulk checkout creates one bulk unit carrying the quantity", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const model = await createModelFixture(org.id);
    const project = await createProjectFixture(org.id);
    const bulk = await createBulkAssetFixture(org.id, model.id, {
      assetTag: "CABLE-BULK",
      total: 50,
    });
    const line = await createLineItemFixture(org.id, project.id, model.id, {
      quantity: 12,
      bulkAssetId: bulk.id,
    });

    await checkOutItems(project.id, [
      { lineItemId: line.id, quantity: 12 },
    ]);

    const units = await testPrisma.projectLineItemUnit.findMany({
      where: { lineItemId: line.id },
    });
    expect(units).toHaveLength(1);
    expect(units[0].bulkAssetId).toBe(bulk.id);
    expect(units[0].quantity).toBe(12);
    expect(units[0].status).toBe("CHECKED_OUT");

    const refreshed = await testPrisma.projectLineItem.findUniqueOrThrow({
      where: { id: line.id },
    });
    expect(refreshed.status).toBe("CHECKED_OUT");
    expect(refreshed.checkedOutQuantity).toBe(12);
  });

  it("deploy with quantity (deploy-tab path) expands prepped units and flips each asset", async () => {
    // Regression for the exact dev symptom: operator preps a 10x line
    // (10 units written with assetIds), then clicks Deploy in the
    // deploy tab. The UI sends `{ lineItemId, quantity: N }` — it has
    // no per-unit identity in the selection. Without expansion based
    // on the line's shape (not the item's), checkOutItems fell into
    // the "deploy whole line" branch that flipped line.status but
    // never marked any unit or asset CHECKED_OUT.
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const model = await createModelFixture(org.id);
    const project = await createProjectFixture(org.id);
    const line = await createLineItemFixture(org.id, project.id, model.id, {
      quantity: 3,
    });
    const a1 = await createAssetFixture(org.id, model.id, { assetTag: "DEP-1" });
    const a2 = await createAssetFixture(org.id, model.id, { assetTag: "DEP-2" });

    // Simulate prep: two PACKED units exist on the line, with assetIds.
    await testPrisma.projectLineItemUnit.create({
      data: {
        organizationId: org.id, lineItemId: line.id, ordinal: 1,
        assetId: a1.id, quantity: 1, status: "CONFIRMED", prepStatus: "PACKED",
      },
    });
    await testPrisma.projectLineItemUnit.create({
      data: {
        organizationId: org.id, lineItemId: line.id, ordinal: 2,
        assetId: a2.id, quantity: 1, status: "CONFIRMED", prepStatus: "PACKED",
      },
    });

    // Deploy tab's exact call: no item.assetId, quantity = unit count.
    await checkOutItems(project.id, [{ lineItemId: line.id, quantity: 2 }]);

    // Both units flipped to CHECKED_OUT.
    const units = await testPrisma.projectLineItemUnit.findMany({
      where: { lineItemId: line.id }, orderBy: { ordinal: "asc" },
    });
    expect(units).toHaveLength(2);
    expect(units.every((u) => u.status === "CHECKED_OUT")).toBe(true);

    // Physical assets flipped to CHECKED_OUT.
    const assets = await testPrisma.asset.findMany({
      where: { id: { in: [a1.id, a2.id] } },
    });
    expect(assets.every((a) => a.status === "CHECKED_OUT")).toBe(true);

    // Order line rollup reflects 2 of 3 deployed.
    const refreshed = await testPrisma.projectLineItem.findUniqueOrThrow({
      where: { id: line.id },
    });
    expect(refreshed.status).toBe("CHECKED_OUT");
    expect(refreshed.checkedOutQuantity).toBe(2);
  });

  it("partial-quantity deploy clamps to prepped units in ordinal order", async () => {
    // Deploy 3 of 10 prepped: only the first 3 ordinals deploy.
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };
    const model = await createModelFixture(org.id);
    const project = await createProjectFixture(org.id);
    const line = await createLineItemFixture(org.id, project.id, model.id, {
      quantity: 10,
    });
    const assets = [];
    for (let i = 0; i < 4; i++) {
      const a = await createAssetFixture(org.id, model.id, { assetTag: `PT-${i}` });
      assets.push(a);
      await testPrisma.projectLineItemUnit.create({
        data: {
          organizationId: org.id, lineItemId: line.id, ordinal: i + 1,
          assetId: a.id, quantity: 1, status: "CONFIRMED", prepStatus: "PACKED",
        },
      });
    }

    await checkOutItems(project.id, [{ lineItemId: line.id, quantity: 3 }]);

    const units = await testPrisma.projectLineItemUnit.findMany({
      where: { lineItemId: line.id }, orderBy: { ordinal: "asc" },
    });
    expect(units.slice(0, 3).every((u) => u.status === "CHECKED_OUT")).toBe(true);
    expect(units[3].status).toBe("CONFIRMED"); // 4th still prepped
    const allAssets = await testPrisma.asset.findMany({
      where: { id: { in: assets.map((a) => a.id) } },
      orderBy: { assetTag: "asc" },
    });
    expect(allAssets[0].status).toBe("CHECKED_OUT");
    expect(allAssets[1].status).toBe("CHECKED_OUT");
    expect(allAssets[2].status).toBe("CHECKED_OUT");
    expect(allAssets[3].status).toBe("AVAILABLE");
  });

  it("deploy with no units AND no line.assetId still flips the line (deploy-whole-line edge)", async () => {
    // The pre-existing "no asset assigned anywhere" path must still
    // work — a generic line with no prep just gets its status flipped.
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const model = await createModelFixture(org.id);
    const project = await createProjectFixture(org.id);
    const line = await createLineItemFixture(org.id, project.id, model.id, {
      quantity: 1,
    });

    await checkOutItems(project.id, [{ lineItemId: line.id }]);

    const refreshed = await testPrisma.projectLineItem.findUniqueOrThrow({
      where: { id: line.id },
    });
    expect(refreshed.status).toBe("CHECKED_OUT");
  });
});
