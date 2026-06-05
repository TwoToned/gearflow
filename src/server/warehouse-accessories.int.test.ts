/**
 * Integration tests for the warehouse accessory cascade (Phase E).
 *
 * Permanent accessories travel with their parent. When the parent asset line
 * is checked out, its accessory child lines must flip through the unit path
 * (serialised child asset → CHECKED_OUT; bulk child → a CHECKED_OUT unit).
 * On check-in they return with the parent. Scanning an accessory directly
 * resolves to "scan the parent".
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createId } from "@paralleldrive/cuid2";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
  createModelFixture,
  createAssetFixture,
  createBulkAssetFixture,
} from "../../tests/helpers/integration";

const h = vi.hoisted(() => ({
  ctx: { organizationId: "", userId: "", userName: "Tester" },
}));
vi.mock("@/lib/org-context", () => ({
  requirePermission: async () => h.ctx,
  getOrgContext: async () => h.ctx,
}));
vi.mock("@/lib/activity-log", () => ({ logActivity: vi.fn(async () => {}) }));

import { addLineItem } from "@/server/line-items";
import { checkOutItems, checkInItems, lookupAssetForScan } from "@/server/warehouse";
import { completeCheckAndStore } from "@/server/check-records";

async function seed() {
  const org = await createOrgFixture();
  const user = await createUserFixture(org.id);
  h.ctx.organizationId = org.id;
  h.ctx.userId = user.id;
  const model = await createModelFixture(org.id);
  const location = await testPrisma.location.create({
    data: { organizationId: org.id, name: "Venue", isDefault: false },
  });
  await testPrisma.location.create({
    data: { organizationId: org.id, name: "Warehouse", isDefault: true },
  });
  const project = await testPrisma.project.create({
    data: {
      id: createId(),
      organizationId: org.id,
      projectNumber: `P-${createId().slice(0, 6)}`,
      name: "Gig",
      locationId: location.id,
    },
  });
  return { org, user, model, project, location };
}

/** Add a light with 1 serialised + 1 bulk accessory; return ids. */
async function lightWithAccessoriesOnProject(s: Awaited<ReturnType<typeof seed>>) {
  const { org, user, model, project } = s;
  const light = await createAssetFixture(org.id, model.id, { assetTag: `LIGHT-${createId().slice(0, 4)}` });
  const cable = await createAssetFixture(org.id, model.id, { assetTag: `IEC-${createId().slice(0, 4)}` });
  const clamps = await createBulkAssetFixture(org.id, model.id, { assetTag: `CLAMP-${createId().slice(0, 4)}`, total: 50 });
  await testPrisma.asset.update({ where: { id: cable.id }, data: { parentAssetId: light.id } });
  await testPrisma.assetBulkChild.create({
    data: { organizationId: org.id, parentAssetId: light.id, bulkAssetId: clamps.id, quantity: 2, addedById: user.id },
  });
  const parent = await addLineItem(project.id, { type: "EQUIPMENT", modelId: model.id, assetId: light.id, quantity: 1 }, true);
  return { light, cable, clamps, parentLineId: (parent as { id: string }).id };
}

describe("warehouse accessory cascade (Phase E)", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("checking out the parent checks out its accessories", async () => {
    const s = await seed();
    const { light, cable, clamps, parentLineId } = await lightWithAccessoriesOnProject(s);

    await checkOutItems(s.project.id, [{ lineItemId: parentLineId, assetId: light.id }]);

    const cableAsset = await testPrisma.asset.findUnique({ where: { id: cable.id } });
    expect(cableAsset?.status).toBe("CHECKED_OUT");

    // The serialised + bulk accessory child lines each have a CHECKED_OUT unit.
    const childLines = await testPrisma.projectLineItem.findMany({
      where: { parentLineItemId: parentLineId, childKind: "ACCESSORY" },
      include: { units: true },
    });
    expect(childLines).toHaveLength(2);
    for (const cl of childLines) {
      expect(cl.units.some((u) => u.status === "CHECKED_OUT")).toBe(true);
    }
    const bulkUnit = childLines.find((c) => c.bulkAssetId === clamps.id)?.units[0];
    expect(bulkUnit?.quantity).toBe(2);
  });

  it("checking in the parent returns its accessories", async () => {
    const s = await seed();
    const { light, cable, parentLineId } = await lightWithAccessoriesOnProject(s);
    await checkOutItems(s.project.id, [{ lineItemId: parentLineId, assetId: light.id }]);

    await checkInItems(s.project.id, [{ lineItemId: parentLineId, assetId: light.id, returnCondition: "GOOD" }]);

    const cableAsset = await testPrisma.asset.findUnique({ where: { id: cable.id } });
    expect(cableAsset?.status).toBe("AVAILABLE");
    const childLines = await testPrisma.projectLineItem.findMany({
      where: { parentLineItemId: parentLineId, childKind: "ACCESSORY" },
      include: { units: true },
    });
    for (const cl of childLines) {
      expect(cl.units.every((u) => u.status === "RETURNED")).toBe(true);
    }
  });

  it("a DAMAGED return sends the serialised accessory to maintenance", async () => {
    const s = await seed();
    const { light, cable, parentLineId } = await lightWithAccessoriesOnProject(s);
    await checkOutItems(s.project.id, [{ lineItemId: parentLineId, assetId: light.id }]);

    await checkInItems(s.project.id, [{ lineItemId: parentLineId, assetId: light.id, returnCondition: "DAMAGED" }]);

    const cableAsset = await testPrisma.asset.findUnique({ where: { id: cable.id } });
    expect(cableAsset?.status).toBe("IN_MAINTENANCE");
  });

  it("expands + deploys accessories when a specific asset is assigned to a model-level line at scan time", async () => {
    const s = await seed();
    const { org, model, user, project } = s;
    const light = await createAssetFixture(org.id, model.id, { assetTag: "LIGHT-SCAN" });
    const cable = await createAssetFixture(org.id, model.id, { assetTag: "IEC-SCAN" });
    await testPrisma.asset.update({ where: { id: cable.id }, data: { parentAssetId: light.id } });
    void user;

    // Model-level line — NO specific asset at add time, so no accessory children yet.
    const parent = await addLineItem(project.id, { type: "EQUIPMENT", modelId: model.id, quantity: 1 }, true);
    const parentLineId = (parent as { id: string }).id;
    expect(await testPrisma.projectLineItem.count({ where: { parentLineItemId: parentLineId } })).toBe(0);

    // Warehouse assigns the specific light at deploy → accessories materialise + deploy.
    await checkOutItems(project.id, [{ lineItemId: parentLineId, assetId: light.id }]);

    const children = await testPrisma.projectLineItem.findMany({
      where: { parentLineItemId: parentLineId, childKind: "ACCESSORY" },
      include: { units: true },
    });
    expect(children).toHaveLength(1);
    expect(children[0].assetId).toBe(cable.id);
    const cableAsset = await testPrisma.asset.findUnique({ where: { id: cable.id } });
    expect(cableAsset?.status).toBe("CHECKED_OUT");

    // Idempotent: re-scan doesn't duplicate the accessory line.
    await checkOutItems(project.id, [{ lineItemId: parentLineId, assetId: light.id }]);
    expect(await testPrisma.projectLineItem.count({ where: { parentLineItemId: parentLineId, childKind: "ACCESSORY" } })).toBe(1);
  });

  it("check-and-store returns the parent's accessories with it", async () => {
    const s = await seed();
    const { light, cable, clamps, parentLineId } = await lightWithAccessoriesOnProject(s);
    await checkOutItems(s.project.id, [{ lineItemId: parentLineId, assetId: light.id }]);

    // Returning the parent via the check-and-store flow (not the plain return
    // tab) must still cascade to the accessory children.
    const checkItem = await testPrisma.checkItem.create({
      data: { organizationId: s.org.id, label: "Visual", type: "PASS_FAIL" },
    });
    await completeCheckAndStore({
      projectId: s.project.id,
      lineItemId: parentLineId,
      assetId: light.id,
      condition: "GOOD",
      checks: [{ checkItemId: checkItem.id, result: "PASS", photos: [] }],
    });

    const cableAsset = await testPrisma.asset.findUnique({ where: { id: cable.id } });
    expect(cableAsset?.status).toBe("AVAILABLE");
    const childLines = await testPrisma.projectLineItem.findMany({
      where: { parentLineItemId: parentLineId, childKind: "ACCESSORY" },
      include: { units: true },
    });
    expect(childLines).toHaveLength(2);
    for (const cl of childLines) {
      expect(cl.units.length).toBeGreaterThan(0);
      expect(cl.units.every((u) => u.status === "RETURNED")).toBe(true);
    }
    void clamps;
  });

  it("scanning an accessory resolves to 'scan the parent'", async () => {
    const s = await seed();
    const { light, cable } = await lightWithAccessoriesOnProject(s);

    const result = (await lookupAssetForScan(
      s.project.id,
      (await testPrisma.asset.findUnique({ where: { id: cable.id }, select: { assetTag: true } }))!.assetTag,
      "checkout",
    )) as { type: string; parentAssetId: string | null; reason: string };

    expect(result.type).toBe("asset_child");
    expect(result.parentAssetId).toBe(light.id);
    expect(result.reason).toBe("asset_is_accessory");
  });
});
