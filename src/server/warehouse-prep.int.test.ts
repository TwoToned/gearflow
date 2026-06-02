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
import { prepItemDirect, pullItem, deprepItem } from "@/server/check-records";

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

  it("prep on a PULLED line transitions line.prepStatus to PACKED", async () => {
    // Regression for the warehouse-UI symptom: operator clicks Pull
    // (line.prepStatus → PULLED), opens the check form, completes the
    // check, prep runs — and the line was stuck at PULLED forever
    // because syncLineItemRollup never derived prepStatus from units.
    // The deploy tab filters `prepStatus === "PACKED"`, so the line
    // never moved off the prep tab.
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const model = await createModelFixture(org.id);
    const project = await createProjectFixture(org.id);
    const line = await createLineItemFixture(org.id, project.id, model.id, 10);
    const asset = await createAssetFixture(org.id, model.id, {
      assetTag: "PREP-PULL-1",
    });

    // Step 1: operator clicks Pull on the line.
    await pullItem(project.id, line.id);
    let refreshed = await testPrisma.projectLineItem.findUniqueOrThrow({
      where: { id: line.id },
    });
    expect(refreshed.prepStatus).toBe("PULLED");

    // Step 2: operator scans the first asset tag, completes the check,
    // prep runs for that single unit. Without the fix this leaves the
    // line at PULLED; with the fix the line promotes to PACKED.
    await prepItemDirect(project.id, line.id, asset.id);

    refreshed = await testPrisma.projectLineItem.findUniqueOrThrow({
      where: { id: line.id },
    });
    expect(refreshed.prepStatus).toBe("PACKED");
    expect(refreshed.packedQuantity).toBe(1);
    expect(refreshed.quantity).toBe(10);

    const units = await testPrisma.projectLineItemUnit.findMany({
      where: { lineItemId: line.id },
    });
    expect(units).toHaveLength(1);
    expect(units[0].assetId).toBe(asset.id);
    expect(units[0].prepStatus).toBe("PACKED");
  });

  it("deprepping a fully-prepped multi-unit line removes its assigned units", async () => {
    // Regression for the user-reported symptom: prep 10x line (10
    // units created with asset ids), then click Deprep. Old behaviour
    // only flipped line.prepStatus — units stayed around with their
    // asset ids, asset shown as "still assigned" in the project view
    // and the warehouse couldn't re-prep onto different assets.
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const model = await createModelFixture(org.id);
    const project = await createProjectFixture(org.id);
    const line = await createLineItemFixture(org.id, project.id, model.id, 3);
    const a1 = await createAssetFixture(org.id, model.id, { assetTag: "DP-1" });
    const a2 = await createAssetFixture(org.id, model.id, { assetTag: "DP-2" });
    const a3 = await createAssetFixture(org.id, model.id, { assetTag: "DP-3" });

    // Prep all 3 units.
    await prepItemDirect(project.id, line.id, a1.id);
    await prepItemDirect(project.id, line.id, a2.id);
    await prepItemDirect(project.id, line.id, a3.id);

    let units = await testPrisma.projectLineItemUnit.findMany({
      where: { lineItemId: line.id },
    });
    expect(units).toHaveLength(3);

    // Deprep all 3 in one call (matches the UI's "deprep selected" path).
    await deprepItem(project.id, line.id, 3);

    units = await testPrisma.projectLineItemUnit.findMany({
      where: { lineItemId: line.id },
    });
    expect(units).toHaveLength(0);

    const refreshed = await testPrisma.projectLineItem.findUniqueOrThrow({
      where: { id: line.id },
    });
    expect(refreshed.prepStatus).toBe("PENDING");
    expect(refreshed.assignedQuantity).toBe(0);
    expect(refreshed.packedQuantity).toBe(0);
    expect(refreshed.quantity).toBe(3);

    // Assets weren't affected — they were never marked CHECKED_OUT
    // during prep, so they should still be AVAILABLE.
    const assets = await testPrisma.asset.findMany({
      where: { id: { in: [a1.id, a2.id, a3.id] } },
    });
    expect(assets.every((a) => a.status === "AVAILABLE")).toBe(true);
  });

  it("partial deprep keeps remaining prepped units and stays PACKED", async () => {
    // Deprep 1 of 3 prepped → line still PACKED (2 units left).
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const model = await createModelFixture(org.id);
    const project = await createProjectFixture(org.id);
    const line = await createLineItemFixture(org.id, project.id, model.id, 3);
    const assets = [];
    for (let i = 0; i < 3; i++) {
      const a = await createAssetFixture(org.id, model.id, { assetTag: `PD-${i}` });
      assets.push(a);
      await prepItemDirect(project.id, line.id, a.id);
    }

    await deprepItem(project.id, line.id, 1);

    const units = await testPrisma.projectLineItemUnit.findMany({
      where: { lineItemId: line.id }, orderBy: { ordinal: "asc" },
    });
    expect(units).toHaveLength(2);

    const refreshed = await testPrisma.projectLineItem.findUniqueOrThrow({
      where: { id: line.id },
    });
    // 2 units still PACKED → line remains PACKED via rollup derivation.
    expect(refreshed.prepStatus).toBe("PACKED");
    expect(refreshed.packedQuantity).toBe(2);
  });

  it("operator-set FLAGGED_FAULTY survives a later unit pack", async () => {
    // completeCheckAndFlag is the operator override — a later
    // unit-rollup must not silently wipe it back to PACKED.
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: user.id, userName: "Tester" };

    const model = await createModelFixture(org.id);
    const project = await createProjectFixture(org.id);
    const line = await createLineItemFixture(org.id, project.id, model.id, 1);
    const asset = await createAssetFixture(org.id, model.id, {
      assetTag: "PREP-FLAG-1",
    });

    // Simulate the operator flagging the line.
    await testPrisma.projectLineItem.update({
      where: { id: line.id },
      data: { prepStatus: "FLAGGED_FAULTY" },
    });

    // A later prep on a different unit (or a stray rollup) must not
    // overwrite the flag.
    await prepItemDirect(project.id, line.id, asset.id);

    const refreshed = await testPrisma.projectLineItem.findUniqueOrThrow({
      where: { id: line.id },
    });
    expect(refreshed.prepStatus).toBe("FLAGGED_FAULTY");
  });
});
