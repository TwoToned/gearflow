/**
 * Integration tests for the Bulk Check-In Totals screen (Roadmap Phase 1.3).
 *
 * Accessory children deployed across the whole project are aggregated into
 * per-identity totals ("5 clamps due back"); the operator returns a counted
 * quantity in one action and the count is distributed deterministically back
 * across the underlying child line items. These tests prove aggregation across
 * parents, partial-return distribution, over-return rejection, empty/repeat
 * safety, and that the existing per-parent check-in path still works.
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
import { checkOutItems, checkInItems } from "@/server/warehouse";
import { addModelBulkAccessory } from "@/server/model-accessories";
import {
  getBulkCheckInTotals,
  checkInBulkAccessoryTotals,
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

/**
 * Two separate parent lines of DISTINCT models (so `addLineItem`'s same-model
 * merge doesn't collapse them), where every unit of either model ships one
 * clamp — the SAME shared bulk asset. Deploy `aQty` lights on line A and `bQty`
 * on line B → the clamp identity is split across two accessory child lines whose
 * outstanding totals sum on the bulk-totals screen. Returns the shared clamp.
 */
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

    // Return 3 of 5: line A (sortOrder first) fills fully (2), line B takes 1.
    const res = await checkInBulkAccessoryTotals(s.project.id, [
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

    // Remaining total now reflects only what's still out.
    expect(outstandingFor(await getBulkCheckInTotals(s.project.id), clampKey)).toBe(2);
  });

  it("rejects an over-return and leaves all child lines untouched", async () => {
    const s = await seed();
    const { clampKey } = await clampsAcrossTwoLines(s, 2, 3);

    await expect(
      checkInBulkAccessoryTotals(s.project.id, [{ key: clampKey, quantity: 6, condition: "GOOD" }]),
    ).rejects.toThrow(/only 5 currently deployed/i);

    // Whole transaction rolled back — nothing returned.
    expect(outstandingFor(await getBulkCheckInTotals(s.project.id), clampKey)).toBe(5);
  });

  it("empty and zero-quantity submits are safe no-ops", async () => {
    const s = await seed();
    const { clampKey } = await clampsAcrossTwoLines(s, 2, 3);

    expect((await checkInBulkAccessoryTotals(s.project.id, [])).returned).toEqual([]);
    expect((await checkInBulkAccessoryTotals(s.project.id, [{ key: clampKey, quantity: 0 }])).returned).toEqual([]);

    // State unchanged.
    expect(outstandingFor(await getBulkCheckInTotals(s.project.id), clampKey)).toBe(5);
  });

  it("repeated partial returns accumulate without ever over-returning", async () => {
    const s = await seed();
    const { clampKey } = await clampsAcrossTwoLines(s, 2, 3);

    await checkInBulkAccessoryTotals(s.project.id, [{ key: clampKey, quantity: 2, condition: "GOOD" }]);
    await checkInBulkAccessoryTotals(s.project.id, [{ key: clampKey, quantity: 2, condition: "GOOD" }]);
    expect(outstandingFor(await getBulkCheckInTotals(s.project.id), clampKey)).toBe(1);

    // Final unit returns; the identity drops off the totals entirely.
    await checkInBulkAccessoryTotals(s.project.id, [{ key: clampKey, quantity: 1, condition: "GOOD" }]);
    const totals = await getBulkCheckInTotals(s.project.id);
    expect(totals.find((t) => t.key === clampKey)).toBeUndefined();

    // A further attempt to return more is rejected (nothing left deployed).
    await expect(
      checkInBulkAccessoryTotals(s.project.id, [{ key: clampKey, quantity: 1, condition: "GOOD" }]),
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

    await checkInBulkAccessoryTotals(project.id, [{ key, quantity: 1, condition: "GOOD" }]);

    // Exactly one cable came back; the other is still out.
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

    // Per-parent return (unchanged code path) cascades to the accessory.
    await checkInItems(project.id, [{ lineItemId: lineId, assetId: light.id, returnCondition: "GOOD" }]);

    const cableAsset = await testPrisma.asset.findUnique({ where: { id: cable.id } });
    expect(cableAsset?.status).toBe("AVAILABLE");
    // And that accessory no longer appears as due-back on the bulk screen.
    expect(await getBulkCheckInTotals(project.id)).toEqual([]);
  });
});
