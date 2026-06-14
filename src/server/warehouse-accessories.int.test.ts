/**
 * Integration tests for the warehouse accessory cascade (Phase E).
 *
 * Permanent accessories travel with their parent. When the parent asset line
 * is checked out, its accessory child lines must flip through the unit path
 * (serialised child asset → CHECKED_OUT; bulk child → a CHECKED_OUT unit).
 * On check-in they return with the parent. Scanning an accessory directly
 * resolves to "scan the parent".
 *
 * PER-UNIT MODEL (FEATUREDOCS/48, Stage 2): accessories are no longer one
 * aggregate unit per line — each parent unit (handheld) carries its OWN
 * accessory unit, tied via parentUnitAssetId. The bulk-shape assertions here
 * were updated to match (one unit per parent, each quantity = per-unit demand,
 * returned/excluded independently). Asset-status + line-level assertions are
 * unchanged. NOTE: this whole file drives checkOutItems/checkInItems, which
 * mirror to Convex — it must be run in a Convex-enabled env (the per-unit
 * primitives are covered Convex-free in accessory-per-unit.int.test.ts +
 * accessory-deprep.int.test.ts).
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
import { completeCheckAndStore, completeCheckAndDeprep } from "@/server/check-records";
import { addModelBulkAccessory } from "@/server/model-accessories";
import { isUniqueViolation, createAccessoryChildIfAbsent } from "@/lib/line-item-fulfillment";

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

  it("a DAMAGED check-and-store sends the serialised accessory to maintenance", async () => {
    const s = await seed();
    const { light, cable, parentLineId } = await lightWithAccessoriesOnProject(s);
    await checkOutItems(s.project.id, [{ lineItemId: parentLineId, assetId: light.id }]);

    // Guards against the check-and-store call site hard-coding GOOD: the
    // condition must thread through to the accessory cascade.
    const checkItem = await testPrisma.checkItem.create({
      data: { organizationId: s.org.id, label: "Visual", type: "PASS_FAIL" },
    });
    await completeCheckAndStore({
      projectId: s.project.id,
      lineItemId: parentLineId,
      assetId: light.id,
      condition: "DAMAGED",
      checks: [{ checkItemId: checkItem.id, result: "FAIL", photos: [] }],
    });

    const cableAsset = await testPrisma.asset.findUnique({ where: { id: cable.id } });
    expect(cableAsset?.status).toBe("IN_MAINTENANCE");
  });

  it("de-prepping the parent resets its accessories' prepStatus", async () => {
    const s = await seed();
    const { light, clamps, parentLineId } = await lightWithAccessoriesOnProject(s);
    await checkOutItems(s.project.id, [{ lineItemId: parentLineId, assetId: light.id }]);
    await checkInItems(s.project.id, [{ lineItemId: parentLineId, assetId: light.id, returnCondition: "GOOD" }]);

    // Simulate the parent + accessories still sitting in the deploy-staging
    // board (PACKED) after the return — deprep should clear them.
    await testPrisma.projectLineItem.update({
      where: { id: parentLineId },
      data: { prepStatus: "PACKED" },
    });
    await testPrisma.projectLineItem.updateMany({
      where: { parentLineItemId: parentLineId, childKind: "ACCESSORY" },
      data: { prepStatus: "PACKED" },
    });

    const checkItem = await testPrisma.checkItem.create({
      data: { organizationId: s.org.id, label: "Visual", type: "PASS_FAIL" },
    });
    await completeCheckAndDeprep({
      projectId: s.project.id,
      lineItemId: parentLineId,
      assetId: light.id,
      checks: [{ checkItemId: checkItem.id, result: "PASS", photos: [] }],
    });

    const childLines = await testPrisma.projectLineItem.findMany({
      where: { parentLineItemId: parentLineId, childKind: "ACCESSORY" },
    });
    expect(childLines).toHaveLength(2);
    for (const cl of childLines) {
      expect(cl.prepStatus).toBe("PENDING");
    }
    // Distinguish bulk vs serialised — the updateMany must reach both, not just
    // the serialised child (a stray assetId filter would skip the bulk one).
    const bulkChild = childLines.find((c) => c.bulkAssetId === clamps.id);
    expect(bulkChild?.prepStatus).toBe("PENDING");
    // The parent itself is depreped too.
    const parent = await testPrisma.projectLineItem.findUnique({ where: { id: parentLineId } });
    expect(parent?.prepStatus).toBe("PENDING");
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

describe("multi-quantity parent accessory isolation", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  /**
   * One model-level line (quantity 2) with two physical units, each carrying its
   * own serialised cable: light A → cable A (parentAssetId A), light B → cable B.
   * Returns the parent line id + the four assets.
   */
  async function twoLightsEachWithACable(s: Awaited<ReturnType<typeof seed>>) {
    const { org, model, project } = s;
    const cableModel = await createModelFixture(org.id);
    const lightA = await createAssetFixture(org.id, model.id, { assetTag: `LIGHT-A-${createId().slice(0, 4)}` });
    const lightB = await createAssetFixture(org.id, model.id, { assetTag: `LIGHT-B-${createId().slice(0, 4)}` });
    const cableA = await createAssetFixture(org.id, cableModel.id, { assetTag: `CABLE-A-${createId().slice(0, 4)}` });
    const cableB = await createAssetFixture(org.id, cableModel.id, { assetTag: `CABLE-B-${createId().slice(0, 4)}` });
    await testPrisma.asset.update({ where: { id: cableA.id }, data: { parentAssetId: lightA.id } });
    await testPrisma.asset.update({ where: { id: cableB.id }, data: { parentAssetId: lightB.id } });

    const parent = await addLineItem(project.id, { type: "EQUIPMENT", modelId: model.id, quantity: 2 }, true);
    const parentLineId = (parent as { id: string }).id;
    // Deploy both units — each assignment expands + deploys its own accessory.
    await checkOutItems(project.id, [
      { lineItemId: parentLineId, assetId: lightA.id },
      { lineItemId: parentLineId, assetId: lightB.id },
    ]);
    return { lightA, lightB, cableA, cableB, parentLineId };
  }

  const status = (id: string) => testPrisma.asset.findUnique({ where: { id }, select: { status: true } }).then((a) => a?.status);

  it("returning one unit returns only THAT unit's serialised accessory", async () => {
    const s = await seed();
    const { lightA, cableA, cableB, parentLineId } = await twoLightsEachWithACable(s);
    expect(await status(cableA.id)).toBe("CHECKED_OUT");
    expect(await status(cableB.id)).toBe("CHECKED_OUT");

    await checkInItems(s.project.id, [{ lineItemId: parentLineId, assetId: lightA.id, returnCondition: "GOOD" }]);

    expect(await status(cableA.id)).toBe("AVAILABLE");
    // The whole point: light B is still out, so its cable must NOT be returned.
    expect(await status(cableB.id)).toBe("CHECKED_OUT");
  });

  it("a DAMAGED single-unit return doesn't send the sibling's accessory to maintenance", async () => {
    const s = await seed();
    const { lightA, cableA, cableB, parentLineId } = await twoLightsEachWithACable(s);

    await checkInItems(s.project.id, [{ lineItemId: parentLineId, assetId: lightA.id, returnCondition: "DAMAGED" }]);

    expect(await status(cableA.id)).toBe("IN_MAINTENANCE");
    expect(await status(cableB.id)).toBe("CHECKED_OUT");
  });

  it("a MISSING single-unit return marks only that unit's accessory LOST", async () => {
    const s = await seed();
    const { lightA, cableA, cableB, parentLineId } = await twoLightsEachWithACable(s);

    await checkInItems(s.project.id, [{ lineItemId: parentLineId, assetId: lightA.id, returnCondition: "MISSING" }]);

    expect(await status(cableA.id)).toBe("LOST");
    expect(await status(cableB.id)).toBe("CHECKED_OUT");
  });

  it("a mixed-condition batch return routes each unit's accessory independently", async () => {
    const s = await seed();
    const { lightA, lightB, cableA, cableB, parentLineId } = await twoLightsEachWithACable(s);

    // returnCondition is per-item — a regression that resolved it once per call
    // would mis-route one sibling.
    await checkInItems(s.project.id, [
      { lineItemId: parentLineId, assetId: lightA.id, returnCondition: "GOOD" },
      { lineItemId: parentLineId, assetId: lightB.id, returnCondition: "DAMAGED" },
    ]);

    expect(await status(cableA.id)).toBe("AVAILABLE");
    expect(await status(cableB.id)).toBe("IN_MAINTENANCE");
  });

  it("whole-line return (no assetId) still returns every accessory", async () => {
    const s = await seed();
    const { cableA, cableB, parentLineId } = await twoLightsEachWithACable(s);

    await checkInItems(s.project.id, [{ lineItemId: parentLineId, returnCondition: "GOOD" }]);

    expect(await status(cableA.id)).toBe("AVAILABLE");
    expect(await status(cableB.id)).toBe("AVAILABLE");
  });

  it("bulk accessory demand scales with units and returns per-unit", async () => {
    const s = await seed();
    const { org, model, project } = s;
    const clampModel = await createModelFixture(org.id);
    const clamps = await createBulkAssetFixture(org.id, clampModel.id, { assetTag: `CLAMP-${createId().slice(0, 4)}`, total: 50 });
    // Every asset of the light model ships 1 clamp.
    await addModelBulkAccessory(model.id, { bulkAssetId: clamps.id, quantity: 1 });

    const lightA = await createAssetFixture(org.id, model.id, { assetTag: `LA-${createId().slice(0, 4)}` });
    const lightB = await createAssetFixture(org.id, model.id, { assetTag: `LB-${createId().slice(0, 4)}` });
    const parent = await addLineItem(project.id, { type: "EQUIPMENT", modelId: model.id, quantity: 2 }, true);
    const parentLineId = (parent as { id: string }).id;
    await checkOutItems(project.id, [
      { lineItemId: parentLineId, assetId: lightA.id },
      { lineItemId: parentLineId, assetId: lightB.id },
    ]);

    // Per-parent-unit model: the bulk child line's demand is still 2, but it is
    // now backed by ONE unit per light (each quantity 1, tied via
    // parentUnitAssetId), not a single aggregate unit of quantity 2.
    const bulkChild = await testPrisma.projectLineItem.findFirst({
      where: { parentLineItemId: parentLineId, childKind: "ACCESSORY", bulkAssetId: clamps.id },
      include: { units: true },
    });
    expect(bulkChild?.quantity).toBe(2);
    expect(bulkChild?.units).toHaveLength(2);
    expect(bulkChild?.units.every((u) => u.quantity === 1)).toBe(true);
    expect(new Set(bulkChild?.units.map((u) => u.parentUnitAssetId))).toEqual(
      new Set([lightA.id, lightB.id]),
    );

    const unitFor = async (parentAssetId: string) =>
      testPrisma.projectLineItemUnit.findFirstOrThrow({
        where: { lineItemId: bulkChild!.id, parentUnitAssetId: parentAssetId },
      });

    // Return light A → only ITS clamp unit comes back; light B's stays out.
    await checkInItems(project.id, [{ lineItemId: parentLineId, assetId: lightA.id, returnCondition: "GOOD" }]);
    expect((await unitFor(lightA.id)).status).toBe("RETURNED");
    expect((await unitFor(lightA.id)).returnedQuantity).toBe(1);
    expect((await unitFor(lightB.id)).status).toBe("CHECKED_OUT");

    // Return light B → both clamp units returned.
    await checkInItems(project.id, [{ lineItemId: parentLineId, assetId: lightB.id, returnCondition: "GOOD" }]);
    expect((await unitFor(lightB.id)).status).toBe("RETURNED");
  });

  it("a double check-in of the same unit does not over-return the bulk accessory", async () => {
    const s = await seed();
    const { org, model, project } = s;
    const clampModel = await createModelFixture(org.id);
    const clamps = await createBulkAssetFixture(org.id, clampModel.id, { assetTag: `DC-${createId().slice(0, 4)}`, total: 50 });
    await addModelBulkAccessory(model.id, { bulkAssetId: clamps.id, quantity: 1 });
    const lightA = await createAssetFixture(org.id, model.id, { assetTag: `DA-${createId().slice(0, 4)}` });
    const lightB = await createAssetFixture(org.id, model.id, { assetTag: `DB-${createId().slice(0, 4)}` });
    const parent = await addLineItem(project.id, { type: "EQUIPMENT", modelId: model.id, quantity: 2 }, true);
    const parentLineId = (parent as { id: string }).id;
    await checkOutItems(project.id, [
      { lineItemId: parentLineId, assetId: lightA.id },
      { lineItemId: parentLineId, assetId: lightB.id },
    ]);
    const bulkChild = await testPrisma.projectLineItem.findFirstOrThrow({
      where: { parentLineItemId: parentLineId, childKind: "ACCESSORY", bulkAssetId: clamps.id },
    });
    const unitFor = async (parentAssetId: string) =>
      testPrisma.projectLineItemUnit.findFirstOrThrow({
        where: { lineItemId: bulkChild.id, parentUnitAssetId: parentAssetId },
      });

    // First return of light A: its clamp unit comes back.
    await checkInItems(project.id, [{ lineItemId: parentLineId, assetId: lightA.id, returnCondition: "GOOD" }]);
    expect((await unitFor(lightA.id)).status).toBe("RETURNED");
    expect((await unitFor(lightA.id)).returnedQuantity).toBe(1);

    // Retry / double-scan light A — its unit is already RETURNED (guarded flip),
    // so nothing changes and light B's clamp stays out.
    await checkInItems(project.id, [{ lineItemId: parentLineId, assetId: lightA.id, returnCondition: "GOOD" }]);
    expect((await unitFor(lightA.id)).returnedQuantity).toBe(1); // still 1, not doubled
    expect((await unitFor(lightB.id)).status).toBe("CHECKED_OUT");
  });

  it("expansion is idempotent under a re-scan (no duplicate child rows)", async () => {
    const s = await seed();
    const { lightA, parentLineId } = await twoLightsEachWithACable(s);
    // Re-deploy light A (idempotent scan) — must not duplicate its cable child.
    await checkOutItems(s.project.id, [{ lineItemId: parentLineId, assetId: lightA.id }]);
    const serialChildren = await testPrisma.projectLineItem.count({
      where: { parentLineItemId: parentLineId, childKind: "ACCESSORY", assetId: { not: null } },
    });
    expect(serialChildren).toBe(2); // cable A + cable B, not 3
  });

  it("check-and-store on one unit isolates the sibling's accessory", async () => {
    const s = await seed();
    const { lightA, cableA, cableB, parentLineId } = await twoLightsEachWithACable(s);
    // The returnedAssetId scoping must hold through completeCheckAndStore too,
    // not just checkInItems.
    const checkItem = await testPrisma.checkItem.create({
      data: { organizationId: s.org.id, label: "Visual", type: "PASS_FAIL" },
    });
    await completeCheckAndStore({
      projectId: s.project.id,
      lineItemId: parentLineId,
      assetId: lightA.id,
      condition: "GOOD",
      checks: [{ checkItemId: checkItem.id, result: "PASS", photos: [] }],
    });
    expect(await status(cableA.id)).toBe("AVAILABLE");
    expect(await status(cableB.id)).toBe("CHECKED_OUT");
  });

  it("deprep on one unit only clears that unit's accessory from staging", async () => {
    const s = await seed();
    const { lightA, lightB, cableA, cableB, parentLineId } = await twoLightsEachWithACable(s);
    // Return both units, then force both cable child lines back to PACKED to
    // simulate them lingering on the deploy-staging board.
    await checkInItems(s.project.id, [
      { lineItemId: parentLineId, assetId: lightA.id, returnCondition: "GOOD" },
      { lineItemId: parentLineId, assetId: lightB.id, returnCondition: "GOOD" },
    ]);
    await testPrisma.projectLineItem.updateMany({
      where: { parentLineItemId: parentLineId, childKind: "ACCESSORY" },
      data: { prepStatus: "PACKED" },
    });
    // The parent line must read PACKED for the deprep precondition.
    await testPrisma.projectLineItem.update({ where: { id: parentLineId }, data: { prepStatus: "PACKED" } });
    const checkItem = await testPrisma.checkItem.create({
      data: { organizationId: s.org.id, label: "Visual", type: "PASS_FAIL" },
    });
    // Deprep light A only.
    await completeCheckAndDeprep({
      projectId: s.project.id,
      lineItemId: parentLineId,
      assetId: lightA.id,
      checks: [{ checkItemId: checkItem.id, result: "PASS", photos: [] }],
    });
    const childOf = async (assetId: string) =>
      (await testPrisma.projectLineItem.findFirst({ where: { parentLineItemId: parentLineId, assetId } }))?.prepStatus;
    expect(await childOf(cableA.id)).toBe("PENDING"); // A's cable depreped
    expect(await childOf(cableB.id)).toBe("PACKED"); // B's cable untouched
  });

  it("returning a unit that carries none of a bulk accessory leaves the bulk out", async () => {
    const s = await seed();
    const { org, model, project } = s;
    const clampModel = await createModelFixture(org.id);
    const clamps = await createBulkAssetFixture(org.id, clampModel.id, { assetTag: `CL-${createId().slice(0, 4)}`, total: 50 });
    const lightA = await createAssetFixture(org.id, model.id, { assetTag: `LA-${createId().slice(0, 4)}` });
    const lightB = await createAssetFixture(org.id, model.id, { assetTag: `LB-${createId().slice(0, 4)}` });
    // Only light A ships a clamp (asset-level), light B ships nothing.
    await testPrisma.assetBulkChild.create({
      data: { organizationId: org.id, parentAssetId: lightA.id, bulkAssetId: clamps.id, quantity: 1, addedById: s.user.id },
    });
    const parent = await addLineItem(project.id, { type: "EQUIPMENT", modelId: model.id, quantity: 2 }, true);
    const parentLineId = (parent as { id: string }).id;
    await checkOutItems(project.id, [
      { lineItemId: parentLineId, assetId: lightA.id },
      { lineItemId: parentLineId, assetId: lightB.id },
    ]);

    const bulkChild = await testPrisma.projectLineItem.findFirst({
      where: { parentLineItemId: parentLineId, childKind: "ACCESSORY", bulkAssetId: clamps.id },
    });
    expect(bulkChild?.quantity).toBe(1); // demand = 1 (only light A)

    // Returning light B (which carries no clamp) must not return the clamp.
    await checkInItems(project.id, [{ lineItemId: parentLineId, assetId: lightB.id, returnCondition: "GOOD" }]);
    let unit = await testPrisma.projectLineItemUnit.findFirst({ where: { lineItemId: bulkChild!.id } });
    expect(unit?.returnedQuantity).toBe(0);
    expect(unit?.status).toBe("CHECKED_OUT");

    // Returning light A returns it.
    await checkInItems(project.id, [{ lineItemId: parentLineId, assetId: lightA.id, returnCondition: "GOOD" }]);
    unit = await testPrisma.projectLineItemUnit.findFirst({ where: { lineItemId: bulkChild!.id } });
    expect(unit?.returnedQuantity).toBe(1);
    expect(unit?.status).toBe("RETURNED");
  });
});

describe("createAccessoryChildIfAbsent — savepoint recovery against live Prisma", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("swallows a duplicate via SAVEPOINT and leaves the transaction usable", async () => {
    const s = await seed();
    const { org, model, project } = s;
    const asset = await createAssetFixture(org.id, model.id, { assetTag: `SP-${createId().slice(0, 4)}` });
    const parent = await testPrisma.projectLineItem.create({
      data: { organizationId: org.id, projectId: project.id, type: "EQUIPMENT", quantity: 1 },
      select: { id: true },
    });
    const data = {
      organizationId: org.id,
      projectId: project.id,
      type: "EQUIPMENT" as const,
      modelId: model.id,
      assetId: asset.id,
      quantity: 1,
      isKitChild: true,
      childKind: "ACCESSORY" as const,
      parentLineItemId: parent.id,
      sortOrder: 0,
    };

    await testPrisma.$transaction(async (tx) => {
      const id1 = await createAccessoryChildIfAbsent(tx, data);
      expect(id1).not.toBeNull();
      // Same (parentLineItemId, assetId) → the partial unique index fires. The
      // helper must ROLLBACK TO SAVEPOINT and return null WITHOUT poisoning tx.
      const id2 = await createAccessoryChildIfAbsent(tx, { ...data, sortOrder: 1 });
      expect(id2).toBeNull();
      // This query proves the transaction is still alive (not Postgres 25P02 /
      // Prisma "transaction aborted") and that no duplicate row was written.
      const count = await tx.projectLineItem.count({
        where: { parentLineItemId: parent.id, childKind: "ACCESSORY" },
      });
      expect(count).toBe(1);
    });
  });
});

describe("isUniqueViolation", () => {
  it("matches Prisma P2002 and raw Postgres 23505 and duplicate-key messages", () => {
    expect(isUniqueViolation({ code: "P2002" })).toBe(true);
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation(new Error('duplicate key value violates unique constraint "x"'))).toBe(true);
  });
  it("does not match unrelated errors", () => {
    expect(isUniqueViolation({ code: "P2025" })).toBe(false);
    expect(isUniqueViolation(new Error("connection refused"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe("includeAccessories=false", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("addLineItem with includeAccessories=false creates no accessory children", async () => {
    const s = await seed();
    const { org, model, project } = s;
    const light = await createAssetFixture(org.id, model.id, { assetTag: `LIGHT-${createId().slice(0, 4)}` });
    const cable = await createAssetFixture(org.id, model.id, { assetTag: `IEC-${createId().slice(0, 4)}` });
    await testPrisma.asset.update({ where: { id: cable.id }, data: { parentAssetId: light.id } });

    // includeAccessories=false → accessories must NOT expand.
    const parent = await addLineItem(project.id, { type: "EQUIPMENT", modelId: model.id, assetId: light.id, quantity: 1 }, true, false, false);
    const parentLineId = (parent as { id: string }).id;

    const children = await testPrisma.projectLineItem.findMany({
      where: { parentLineItemId: parentLineId, childKind: "ACCESSORY" },
    });
    expect(children).toHaveLength(0);
  });

  it("checkOutItems with includeAccessories=false does not cascade to accessories", async () => {
    const s = await seed();
    const { org, model, project } = s;
    const light = await createAssetFixture(org.id, model.id, { assetTag: `LIGHT-${createId().slice(0, 4)}` });
    const cable = await createAssetFixture(org.id, model.id, { assetTag: `IEC-${createId().slice(0, 4)}` });
    await testPrisma.asset.update({ where: { id: cable.id }, data: { parentAssetId: light.id } });

    // Add line with accessories included, so children exist.
    const parent = await addLineItem(project.id, { type: "EQUIPMENT", modelId: model.id, assetId: light.id, quantity: 1 }, true);
    const parentLineId = (parent as { id: string }).id;
    expect(await testPrisma.projectLineItem.count({
      where: { parentLineItemId: parentLineId, childKind: "ACCESSORY" },
    })).toBe(1);

    // checkOutItems with includeAccessories=false must skip the accessory cascade.
    await checkOutItems(s.project.id, [{ lineItemId: parentLineId, assetId: light.id }], false);

    // The parent should be checked out...
    const parentLine = await testPrisma.projectLineItem.findUnique({ where: { id: parentLineId } });
    expect(parentLine?.status).toBe("CHECKED_OUT");
    // ...but the accessory child's asset should NOT be checked out.
    const cableAsset = await testPrisma.asset.findUnique({ where: { id: cable.id } });
    expect(cableAsset?.status).toBe("AVAILABLE");
    // And the child line should have no CHECKED_OUT units.
    const childLines = await testPrisma.projectLineItem.findMany({
      where: { parentLineItemId: parentLineId, childKind: "ACCESSORY" },
      include: { units: true },
    });
    expect(childLines).toHaveLength(1);
    expect(childLines[0].units.every((u) => u.status === "CONFIRMED")).toBe(true);
  });

  it("addLineItem with includeAccessories=true (default) still creates accessories (smoke test)", async () => {
    const s = await seed();
    const { org, model, project } = s;
    const light = await createAssetFixture(org.id, model.id, { assetTag: `SMOKE-${createId().slice(0, 4)}` });
    const cable = await createAssetFixture(org.id, model.id, { assetTag: `SMOKE-CBL-${createId().slice(0, 4)}` });
    await testPrisma.asset.update({ where: { id: cable.id }, data: { parentAssetId: light.id } });

    const parent = await addLineItem(project.id, { type: "EQUIPMENT", modelId: model.id, assetId: light.id, quantity: 1 }, true);
    const parentLineId = (parent as { id: string }).id;

    const children = await testPrisma.projectLineItem.findMany({
      where: { parentLineItemId: parentLineId, childKind: "ACCESSORY" },
    });
    expect(children).toHaveLength(1);
    expect(children[0].assetId).toBe(cable.id);
  });
});
