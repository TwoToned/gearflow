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
import { checkOutItems, checkInItems } from "@/server/warehouse";
import { addModelBulkAccessory } from "@/server/model-accessories";
import {
  getBulkCheckInTotals,
  checkInBulkTotals,
} from "@/server/bulk-checkin";

async function seed() {
  const org = await createOrgFixture();
  const user = await createUserFixture(org.id);
  h.ctx.organizationId = org.id;
  h.ctx.userId = user.id;
  const lightModel = await createModelFixture(org.id);
  const venue = await testPrisma.location.create({
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
      name: "Accessory-heavy gig",
      locationId: venue.id,
    },
  });
  return { org, user, lightModel, project };
}

async function clampsAcrossTwoLines(
  s: Awaited<ReturnType<typeof seed>>,
  aQty: number,
  bQty: number,
) {
  const { org, project } = s;
  const clampModel = await createModelFixture(org.id);
  const clamps = await createBulkAssetFixture(org.id, clampModel.id, {
    assetTag: `CLAMP-${createId().slice(0, 4)}`,
    total: 100,
  });

  const mkLine = async (n: number) => {
    const model = await createModelFixture(org.id);
    await addModelBulkAccessory(model.id, { bulkAssetId: clamps.id, quantity: 1 });
    const lights = await Promise.all(
      Array.from({ length: n }, () =>
        createAssetFixture(org.id, model.id, { assetTag: `L-${createId().slice(0, 5)}` }),
      ),
    );
    const line = await addLineItem(project.id, { type: "EQUIPMENT", modelId: model.id, quantity: n }, true);
    const lineId = (line as { id: string }).id;
    await checkOutItems(project.id, lights.map((l) => ({ lineItemId: lineId, assetId: l.id })));
    return { lineId, lights };
  };

  const lineA = await mkLine(aQty);
  const lineB = await mkLine(bQty);
  return { clamps, clampKey: `bulk:${clamps.id}`, lineA, lineB };
}

function outstandingFor(totals: Awaited<ReturnType<typeof getBulkCheckInTotals>>, key: string) {
  return totals.find((t) => t.key === key)?.totalDue ?? 0;
}

describe("bulk check-in totals", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("aggregates a bulk accessory across multiple parent lines into one total", async () => {
    const s = await seed();
    const { clampKey } = await clampsAcrossTwoLines(s, 2, 3);

    const totals = await getBulkCheckInTotals(s.project.id);
    const clamp = totals.find((t) => t.key === clampKey);
    expect(clamp).toBeTruthy();
    expect(clamp).toMatchObject({ kind: "BULK", totalDue: 5, childCount: 2 });
  });

  it("a partial aggregate return distributes deterministically across child lines", async () => {
    const s = await seed();
    const { clampKey, lineA, lineB } = await clampsAcrossTwoLines(s, 2, 3);

    const res = await checkInBulkTotals(s.project.id, [
      { key: clampKey, quantity: 3, condition: "GOOD" },
    ]);
    expect(res.returned).toEqual([{ key: clampKey, quantity: 3, condition: "GOOD" }]);

    const childA = await testPrisma.projectLineItem.findFirst({
      where: { parentLineItemId: lineA.lineId, childKind: "ACCESSORY" },
      include: { units: true },
    });
    const childB = await testPrisma.projectLineItem.findFirst({
      where: { parentLineItemId: lineB.lineId, childKind: "ACCESSORY" },
      include: { units: true },
    });
    expect(childA?.units[0]).toMatchObject({ returnedQuantity: 2, status: "RETURNED" });
    expect(childB?.units[0]).toMatchObject({ returnedQuantity: 1, status: "CHECKED_OUT" });

    expect(outstandingFor(await getBulkCheckInTotals(s.project.id), clampKey)).toBe(2);
  });

  it("rejects an over-return and leaves all child lines untouched", async () => {
    const s = await seed();
    const { clampKey } = await clampsAcrossTwoLines(s, 2, 3);

    await expect(
      checkInBulkTotals(s.project.id, [{ key: clampKey, quantity: 6, condition: "GOOD" }]),
    ).rejects.toThrow(/only 5 currently deployed/i);

    expect(outstandingFor(await getBulkCheckInTotals(s.project.id), clampKey)).toBe(5);
  });

  it("empty and zero-quantity submits are safe no-ops", async () => {
    const s = await seed();
    const { clampKey } = await clampsAcrossTwoLines(s, 2, 3);

    expect((await checkInBulkTotals(s.project.id, [])).returned).toEqual([]);
    expect((await checkInBulkTotals(s.project.id, [{ key: clampKey, quantity: 0 }])).returned).toEqual([]);

    expect(outstandingFor(await getBulkCheckInTotals(s.project.id), clampKey)).toBe(5);
  });

  it("repeated partial returns accumulate without ever over-returning", async () => {
    const s = await seed();
    const { clampKey } = await clampsAcrossTwoLines(s, 2, 3);

    await checkInBulkTotals(s.project.id, [{ key: clampKey, quantity: 2, condition: "GOOD" }]);
    await checkInBulkTotals(s.project.id, [{ key: clampKey, quantity: 2, condition: "GOOD" }]);
    expect(outstandingFor(await getBulkCheckInTotals(s.project.id), clampKey)).toBe(1);

    await checkInBulkTotals(s.project.id, [{ key: clampKey, quantity: 1, condition: "GOOD" }]);
    const totals = await getBulkCheckInTotals(s.project.id);
    expect(totals.find((t) => t.key === clampKey)).toBeUndefined();

    await expect(
      checkInBulkTotals(s.project.id, [{ key: clampKey, quantity: 1, condition: "GOOD" }]),
    ).rejects.toThrow(/only 0 currently deployed/i);
  });

  it("aggregates serialised accessories by model and returns them one at a time", async () => {
    const s = await seed();
    const { org, lightModel, project } = s;
    const cableModel = await createModelFixture(org.id);
    const lightA = await createAssetFixture(org.id, lightModel.id, { assetTag: `LA-${createId().slice(0, 4)}` });
    const lightB = await createAssetFixture(org.id, lightModel.id, { assetTag: `LB-${createId().slice(0, 4)}` });
    const cableA = await createAssetFixture(org.id, cableModel.id, { assetTag: `CA-${createId().slice(0, 4)}` });
    const cableB = await createAssetFixture(org.id, cableModel.id, { assetTag: `CB-${createId().slice(0, 4)}` });
    await testPrisma.asset.update({ where: { id: cableA.id }, data: { parentAssetId: lightA.id } });
    await testPrisma.asset.update({ where: { id: cableB.id }, data: { parentAssetId: lightB.id } });

    const line = await addLineItem(project.id, { type: "EQUIPMENT", modelId: lightModel.id, quantity: 2 }, true);
    const lineId = (line as { id: string }).id;
    await checkOutItems(project.id, [
      { lineItemId: lineId, assetId: lightA.id },
      { lineItemId: lineId, assetId: lightB.id },
    ]);

    const key = `serial:${cableModel.id}`;
    const totals = await getBulkCheckInTotals(project.id);
    expect(totals.find((t) => t.key === key)).toMatchObject({ kind: "SERIALIZED", totalDue: 2, childCount: 2 });

    await checkInBulkTotals(project.id, [{ key, quantity: 1, condition: "GOOD" }]);

    const statuses = await Promise.all(
      [cableA.id, cableB.id].map((id) =>
        testPrisma.asset.findUnique({ where: { id }, select: { status: true } }).then((a) => a?.status),
      ),
    );
    expect(statuses.filter((x) => x === "AVAILABLE")).toHaveLength(1);
    expect(statuses.filter((x) => x === "CHECKED_OUT")).toHaveLength(1);
    expect(outstandingFor(await getBulkCheckInTotals(project.id), key)).toBe(1);
  });

  it("the existing per-parent check-in path still returns a parent's own accessory", async () => {
    const s = await seed();
    const { org, lightModel, project } = s;
    const cableModel = await createModelFixture(org.id);
    const light = await createAssetFixture(org.id, lightModel.id, { assetTag: `L-${createId().slice(0, 4)}` });
    const cable = await createAssetFixture(org.id, cableModel.id, { assetTag: `IEC-${createId().slice(0, 4)}` });
    await testPrisma.asset.update({ where: { id: cable.id }, data: { parentAssetId: light.id } });

    const line = await addLineItem(project.id, { type: "EQUIPMENT", modelId: lightModel.id, assetId: light.id, quantity: 1 }, true);
    const lineId = (line as { id: string }).id;
    await checkOutItems(project.id, [{ lineItemId: lineId, assetId: light.id }]);

    await checkInItems(project.id, [{ lineItemId: lineId, assetId: light.id, returnCondition: "GOOD" }]);

    const cableAsset = await testPrisma.asset.findUnique({ where: { id: cable.id } });
    expect(cableAsset?.status).toBe("AVAILABLE");
    expect(await getBulkCheckInTotals(project.id)).toEqual([]);
  });

  it("aggregates and returns a custom item", async () => {
    const s = await seed();
    const { org, project } = s;

    const customLine = await testPrisma.projectLineItem.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        type: "EQUIPMENT",
        isCustomItem: true,
        description: "Custom stage element",
        quantity: 1,
        checkedOutQuantity: 1,
        status: "CHECKED_OUT",
        sortOrder: 0,
      },
    });

    const totals = await getBulkCheckInTotals(project.id);
    const customKey = `custom:${customLine.id}`;
    expect(totals.find((t) => t.key === customKey)).toMatchObject({ kind: "SERIALIZED", itemType: "CUSTOM", totalDue: 1 });

    await checkInBulkTotals(project.id, [{ key: customKey, quantity: 1, condition: "GOOD" }]);

    const updated = await testPrisma.projectLineItem.findUnique({ where: { id: customLine.id } });
    expect(updated?.status).toBe("RETURNED");
  });

  it("aggregates and returns a sub-hire item", async () => {
    const s = await seed();
    const { org, project } = s;

    const supplier = await testPrisma.supplier.create({
      data: { organizationId: org.id, name: "Test Supplier" },
    });
    const subHire = await testPrisma.subHire.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        createdById: h.ctx.userId,
        orderNumber: `SH-${createId().slice(0, 6)}`,
        status: "CONFIRMED",
        totalCost: 100,
        totalCharge: 150,
      },
    });

    const genModel = await createModelFixture(org.id, { name: "Generator" });
    const subHireLine = await testPrisma.projectLineItem.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        type: "EQUIPMENT",
        modelId: genModel.id,
        subHireId: subHire.id,
        quantity: 1,
        checkedOutQuantity: 1,
        status: "CHECKED_OUT",
        sortOrder: 0,
      },
    });

    const totals = await getBulkCheckInTotals(project.id);
    const subHireKey = `subhire:${subHireLine.id}`;
    expect(totals.find((t) => t.key === subHireKey)).toMatchObject({ kind: "SERIALIZED", itemType: "SUBHIRE", totalDue: 1 });

    await checkInBulkTotals(project.id, [{ key: subHireKey, quantity: 1, condition: "GOOD" }]);

    const updated = await testPrisma.projectLineItem.findUnique({ where: { id: subHireLine.id } });
    expect(updated?.status).toBe("RETURNED");
  });

  it("a partial sub-hire return keeps the line CHECKED_OUT and the remainder visible", async () => {
    const s = await seed();
    const { org, project } = s;

    const supplier = await testPrisma.supplier.create({
      data: { organizationId: org.id, name: "Partial Supplier" },
    });
    const subHire = await testPrisma.subHire.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        createdById: h.ctx.userId,
        orderNumber: `SH-${createId().slice(0, 6)}`,
        status: "CONFIRMED",
        totalCost: 100,
        totalCharge: 150,
      },
    });

    const genModel = await createModelFixture(org.id, { name: "Generator" });
    const subHireLine = await testPrisma.projectLineItem.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        type: "EQUIPMENT",
        modelId: genModel.id,
        subHireId: subHire.id,
        quantity: 5,
        checkedOutQuantity: 5,
        status: "CHECKED_OUT",
        sortOrder: 0,
      },
    });

    const subHireKey = `subhire:${subHireLine.id}`;
    expect(outstandingFor(await getBulkCheckInTotals(project.id), subHireKey)).toBe(5);

    // Return 3 of 5 — line must stay CHECKED_OUT with 2 still outstanding.
    await checkInBulkTotals(project.id, [{ key: subHireKey, quantity: 3, condition: "GOOD" }]);

    const afterPartial = await testPrisma.projectLineItem.findUnique({ where: { id: subHireLine.id } });
    expect(afterPartial).toMatchObject({ status: "CHECKED_OUT", returnedQuantity: 3 });
    expect(outstandingFor(await getBulkCheckInTotals(project.id), subHireKey)).toBe(2);

    // Return the remaining 2 — now it flips to RETURNED and drops off the totals.
    await checkInBulkTotals(project.id, [{ key: subHireKey, quantity: 2, condition: "GOOD" }]);

    const afterFull = await testPrisma.projectLineItem.findUnique({ where: { id: subHireLine.id } });
    expect(afterFull).toMatchObject({ status: "RETURNED", returnedQuantity: 5 });
    expect(
      (await getBulkCheckInTotals(project.id)).find((t) => t.key === subHireKey),
    ).toBeUndefined();
  });

  it("handles mixed-type batch returns (accessory + custom + sub-hire)", async () => {
    const s = await seed();
    const { org, lightModel, project } = s;

    // Accessory
    const clampModel = await createModelFixture(org.id);
    const clamps = await createBulkAssetFixture(org.id, clampModel.id, {
      assetTag: `CLAMP-${createId().slice(0, 4)}`,
      total: 100,
    });
    await addModelBulkAccessory(lightModel.id, { bulkAssetId: clamps.id, quantity: 1 });
    const light = await createAssetFixture(org.id, lightModel.id, { assetTag: `L-${createId().slice(0, 4)}` });
    const line = await addLineItem(project.id, { type: "EQUIPMENT", modelId: lightModel.id, assetId: light.id, quantity: 1 }, true);
    const lineId = (line as { id: string }).id;
    await checkOutItems(project.id, [{ lineItemId: lineId, assetId: light.id }]);

    // Custom item
    const customLine = await testPrisma.projectLineItem.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        type: "EQUIPMENT",
        isCustomItem: true,
        description: "Custom piece",
        quantity: 1,
        checkedOutQuantity: 1,
        status: "CHECKED_OUT",
        sortOrder: 1,
      },
    });

    // Sub-hire item
    const supplier = await testPrisma.supplier.create({
      data: { organizationId: org.id, name: "Supplier" },
    });
    const subHire = await testPrisma.subHire.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        createdById: h.ctx.userId,
        orderNumber: `SH-${createId().slice(0, 6)}`,
        status: "CONFIRMED",
        totalCost: 100,
        totalCharge: 150,
      },
    });
    const subHireLine = await testPrisma.projectLineItem.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        type: "EQUIPMENT",
        subHireId: subHire.id,
        quantity: 1,
        checkedOutQuantity: 1,
        status: "CHECKED_OUT",
        sortOrder: 2,
      },
    });

    const totals = await getBulkCheckInTotals(project.id);
    // Light + clamp accessory + custom + sub-hire
    expect(totals).toHaveLength(4);
    const lightKey = `asset:${light.id}`;

    await checkInBulkTotals(project.id, [
      { key: lightKey, quantity: 1, condition: "GOOD" },
      { key: `bulk:${clamps.id}`, quantity: 1, condition: "GOOD" },
      { key: `custom:${customLine.id}`, quantity: 1, condition: "GOOD" },
      { key: `subhire:${subHireLine.id}`, quantity: 1, condition: "GOOD" },
    ]);

    // Accessory returned
    const accessoryChild = await testPrisma.projectLineItem.findFirst({
      where: { parentLineItemId: lineId, childKind: "ACCESSORY" },
    });
    expect(accessoryChild?.status).toBe("RETURNED");

    // Light returned
    const updatedLine = await testPrisma.projectLineItem.findUnique({
      where: { id: lineId },
    });
    expect(updatedLine?.status).toBe("RETURNED");

    // Custom returned
    const updatedCustom = await testPrisma.projectLineItem.findUnique({
      where: { id: customLine.id },
    });
    expect(updatedCustom?.status).toBe("RETURNED");

    // Sub-hire returned
    const updatedSubHire = await testPrisma.projectLineItem.findUnique({
      where: { id: subHireLine.id },
    });
    expect(updatedSubHire?.status).toBe("RETURNED");

    // All checked in — totals should be empty
    expect(await getBulkCheckInTotals(project.id)).toEqual([]);
  });
});
