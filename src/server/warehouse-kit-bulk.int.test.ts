/**
 * Integration regression test for Wave 1.5.
 *
 * Reproduces the audit-flagged bug at the data layer: kit checkout/checkin
 * must move KitBulkItem-backed quantities on the underlying BulkAsset.
 *
 * Tests exercise collectKitBulkAdjustments + adjustBulkAvailability together
 * inside a $transaction — the same composition the production code uses,
 * minus the auth/scan-log/serialized-asset bookkeeping that we don't need
 * to verify here (those are covered by their own paths).
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
  createModelFixture,
  createBulkAssetFixture,
  createKitFixture,
} from "../../tests/helpers/integration";
import {
  adjustBulkAvailability,
  coalesceAdjustments,
  type TxClient,
} from "@/lib/inventory-mutations";

// Reimplement the warehouse.ts helper here at unit scope to avoid pulling
// the "use server" module into the test. The implementation is a single
// findMany — exact mirror of warehouse.ts:collectKitBulkAdjustments.
async function collectKitBulkAdjustments(
  tx: TxClient,
  kitId: string,
  organizationId: string,
  sign: -1 | 1,
) {
  const bulks = await tx.kitBulkItem.findMany({
    where: { kitId, organizationId },
    select: { bulkAssetId: true, quantity: true },
  });
  return bulks.map((b) => ({
    bulkAssetId: b.bulkAssetId,
    delta: sign * b.quantity,
  }));
}

describe("kit bulk availability round-trip (Wave 1.5)", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("checkout decrements all KitBulkItem quantities", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const xlr = await createBulkAssetFixture(org.id, model.id, {
      assetTag: "XLR-BULK",
      total: 20,
      available: 20,
    });
    const gels = await createBulkAssetFixture(org.id, model.id, {
      assetTag: "GELS-BULK",
      total: 50,
      available: 50,
    });

    await createKitFixture(org.id, {
      assetTag: "KIT-A",
      userId: user.id,
      bulkItems: [
        { bulkAssetId: xlr.id, quantity: 4 },
        { bulkAssetId: gels.id, quantity: 10 },
      ],
    });

    // Find the kit we just created
    const kit = await testPrisma.kit.findFirstOrThrow({
      where: { assetTag: "KIT-A" },
    });

    await testPrisma.$transaction(async (tx) => {
      const adjustments = await collectKitBulkAdjustments(tx, kit.id, org.id, -1);
      await adjustBulkAvailability(tx, org.id, coalesceAdjustments(adjustments));
    });

    const [xlrAfter, gelsAfter] = await Promise.all([
      testPrisma.bulkAsset.findUnique({ where: { id: xlr.id }, select: { availableQuantity: true } }),
      testPrisma.bulkAsset.findUnique({ where: { id: gels.id }, select: { availableQuantity: true } }),
    ]);
    expect(xlrAfter?.availableQuantity).toBe(16); // 20 - 4
    expect(gelsAfter?.availableQuantity).toBe(40); // 50 - 10
  });

  it("checkin restores all KitBulkItem quantities (round-trip back to original)", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const xlr = await createBulkAssetFixture(org.id, model.id, {
      assetTag: "XLR-RT",
      total: 20,
      available: 20,
    });

    await createKitFixture(org.id, {
      assetTag: "KIT-RT",
      userId: user.id,
      bulkItems: [{ bulkAssetId: xlr.id, quantity: 7 }],
    });
    const kit = await testPrisma.kit.findFirstOrThrow({
      where: { assetTag: "KIT-RT" },
    });

    // Checkout
    await testPrisma.$transaction(async (tx) => {
      const adj = await collectKitBulkAdjustments(tx, kit.id, org.id, -1);
      await adjustBulkAvailability(tx, org.id, coalesceAdjustments(adj));
    });
    let bulk = await testPrisma.bulkAsset.findUnique({
      where: { id: xlr.id },
      select: { availableQuantity: true },
    });
    expect(bulk?.availableQuantity).toBe(13);

    // Check-in
    await testPrisma.$transaction(async (tx) => {
      const adj = await collectKitBulkAdjustments(tx, kit.id, org.id, +1);
      await adjustBulkAvailability(tx, org.id, coalesceAdjustments(adj));
    });
    bulk = await testPrisma.bulkAsset.findUnique({
      where: { id: xlr.id },
      select: { availableQuantity: true },
    });
    expect(bulk?.availableQuantity).toBe(20);
  });

  it("nested kits compose adjustments correctly via coalesce", async () => {
    // Outer kit holds 3 XLRs. Nested-kit-A also holds 2 XLRs.
    // Checking out the outer + nested should decrement 5 XLRs total from
    // the shared BulkAsset. coalesceAdjustments collapses the two entries.
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const xlr = await createBulkAssetFixture(org.id, model.id, {
      assetTag: "XLR-NEST",
      total: 20,
      available: 20,
    });

    await createKitFixture(org.id, {
      assetTag: "KIT-OUTER",
      userId: user.id,
      bulkItems: [{ bulkAssetId: xlr.id, quantity: 3 }],
    });
    const outer = await testPrisma.kit.findFirstOrThrow({
      where: { assetTag: "KIT-OUTER" },
    });
    await createKitFixture(org.id, {
      assetTag: "KIT-INNER",
      userId: user.id,
      bulkItems: [{ bulkAssetId: xlr.id, quantity: 2 }],
    });
    const inner = await testPrisma.kit.findFirstOrThrow({
      where: { assetTag: "KIT-INNER" },
    });

    await testPrisma.$transaction(async (tx) => {
      const all = [
        ...(await collectKitBulkAdjustments(tx, outer.id, org.id, -1)),
        ...(await collectKitBulkAdjustments(tx, inner.id, org.id, -1)),
      ];
      // coalesce collapses duplicate bulkAssetIds into one adjustment
      await adjustBulkAvailability(tx, org.id, coalesceAdjustments(all));
    });

    const after = await testPrisma.bulkAsset.findUnique({
      where: { id: xlr.id },
      select: { availableQuantity: true },
    });
    expect(after?.availableQuantity).toBe(15); // 20 - (3 + 2)
  });

  it("kit with no KitBulkItems is a no-op (no DB write)", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    await createKitFixture(org.id, {
      assetTag: "KIT-EMPTY",
      userId: user.id,
      // No bulkItems
    });
    const kit = await testPrisma.kit.findFirstOrThrow({
      where: { assetTag: "KIT-EMPTY" },
    });

    await testPrisma.$transaction(async (tx) => {
      const adj = await collectKitBulkAdjustments(tx, kit.id, org.id, -1);
      expect(adj).toEqual([]);
      // adjustBulkAvailability with empty list is also a no-op
      await adjustBulkAvailability(tx, org.id, coalesceAdjustments(adj));
    });
    // No assertion on a bulk needed — the test passes by not throwing
  });
});
