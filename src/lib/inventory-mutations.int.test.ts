/**
 * Integration tests for the Wave 1.4 helper against a real Postgres.
 *
 * These exercise the concurrency-guard behavior that unit tests with a
 * mocked tx client can't fully reproduce — Postgres MVCC semantics under
 * concurrent transactions, real updateMany affected-row counts, real
 * organizationId filtering through Prisma's query layer.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
  createModelFixture,
  createBulkAssetFixture,
} from "../../tests/helpers/integration";
import {
  adjustBulkAvailability,
  InventoryError,
} from "./inventory-mutations";

describe("adjustBulkAvailability (integration)", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("decrements availableQuantity inside a transaction", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const bulk = await createBulkAssetFixture(org.id, model.id, {
      assetTag: "XLR-001",
      total: 20,
      available: 20,
    });

    await testPrisma.$transaction(async (tx) => {
      await adjustBulkAvailability(tx, org.id, [
        { bulkAssetId: bulk.id, delta: -5 },
      ]);
    });

    const after = await testPrisma.bulkAsset.findUnique({
      where: { id: bulk.id },
      select: { availableQuantity: true },
    });
    expect(after?.availableQuantity).toBe(15);
  });

  it("increments availableQuantity (release on check-in)", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const bulk = await createBulkAssetFixture(org.id, model.id, {
      assetTag: "XLR-002",
      total: 20,
      available: 12,
    });

    await testPrisma.$transaction(async (tx) => {
      await adjustBulkAvailability(tx, org.id, [
        { bulkAssetId: bulk.id, delta: 8 },
      ]);
    });

    const after = await testPrisma.bulkAsset.findUnique({
      where: { id: bulk.id },
      select: { availableQuantity: true },
    });
    expect(after?.availableQuantity).toBe(20);
  });

  it("throws INSUFFICIENT_STOCK when the guard fails", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const bulk = await createBulkAssetFixture(org.id, model.id, {
      assetTag: "XLR-003",
      total: 5,
      available: 3,
    });

    await expect(
      testPrisma.$transaction(async (tx) => {
        await adjustBulkAvailability(tx, org.id, [
          { bulkAssetId: bulk.id, delta: -5 },
        ]);
      }),
    ).rejects.toThrow(InventoryError);

    // Stock unchanged
    const after = await testPrisma.bulkAsset.findUnique({
      where: { id: bulk.id },
      select: { availableQuantity: true },
    });
    expect(after?.availableQuantity).toBe(3);
  });

  it("throws CROSS_ORG when attempting to mutate another org's bulk", async () => {
    const ownerOrg = await createOrgFixture({ slug: "owner" });
    const intruderOrg = await createOrgFixture({ slug: "intruder" });
    await createUserFixture(ownerOrg.id);
    const model = await createModelFixture(ownerOrg.id);
    const bulk = await createBulkAssetFixture(ownerOrg.id, model.id, {
      assetTag: "XLR-004",
      total: 10,
    });

    await expect(
      testPrisma.$transaction(async (tx) => {
        // intruderOrg tries to consume ownerOrg's bulk
        await adjustBulkAvailability(tx, intruderOrg.id, [
          { bulkAssetId: bulk.id, delta: -1 },
        ]);
      }),
    ).rejects.toMatchObject({
      name: "InventoryError",
      code: "CROSS_ORG",
    });

    // Original org's stock untouched
    const after = await testPrisma.bulkAsset.findUnique({
      where: { id: bulk.id },
      select: { availableQuantity: true },
    });
    expect(after?.availableQuantity).toBe(10);
  });

  it("rollback on partial failure leaves all bulks untouched", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const bulkA = await createBulkAssetFixture(org.id, model.id, {
      assetTag: "XLR-A",
      total: 10,
      available: 10,
    });
    const bulkB = await createBulkAssetFixture(org.id, model.id, {
      assetTag: "XLR-B",
      total: 5,
      available: 2, // not enough for delta of -5
    });

    await expect(
      testPrisma.$transaction(async (tx) => {
        await adjustBulkAvailability(tx, org.id, [
          { bulkAssetId: bulkA.id, delta: -3 }, // would succeed
          { bulkAssetId: bulkB.id, delta: -5 }, // will throw — rolls back both
        ]);
      }),
    ).rejects.toThrow(InventoryError);

    // Both bulks untouched — transaction atomicity
    const afterA = await testPrisma.bulkAsset.findUnique({
      where: { id: bulkA.id },
      select: { availableQuantity: true },
    });
    const afterB = await testPrisma.bulkAsset.findUnique({
      where: { id: bulkB.id },
      select: { availableQuantity: true },
    });
    expect(afterA?.availableQuantity).toBe(10);
    expect(afterB?.availableQuantity).toBe(2);
  });

  it("concurrent decrements on the edge of stock can never oversold", async () => {
    // Two transactions race to consume 3 units each from a bulk with
    // availableQuantity=4. Without the guard, both would naively decrement
    // and the bulk would end at -2 (oversold). With the guard, exactly one
    // succeeds (delta=-3, final=1) and the other throws INSUFFICIENT_STOCK.
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const bulk = await createBulkAssetFixture(org.id, model.id, {
      assetTag: "XLR-RACE",
      total: 4,
      available: 4,
    });

    const tx1 = testPrisma.$transaction(async (tx) => {
      await adjustBulkAvailability(tx, org.id, [
        { bulkAssetId: bulk.id, delta: -3 },
      ]);
    });
    const tx2 = testPrisma.$transaction(async (tx) => {
      await adjustBulkAvailability(tx, org.id, [
        { bulkAssetId: bulk.id, delta: -3 },
      ]);
    });

    const results = await Promise.allSettled([tx1, tx2]);
    const successes = results.filter((r) => r.status === "fulfilled");
    const failures = results.filter((r) => r.status === "rejected");

    // Exactly one succeeded (under Read Committed, the second one sees the
    // first's commit and our guard catches that available < 3).
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    const after = await testPrisma.bulkAsset.findUnique({
      where: { id: bulk.id },
      select: { availableQuantity: true },
    });
    // Whichever transaction won, the final value is 4 - 3 = 1.
    // Never -2 (which would mean both succeeded — oversold).
    expect(after?.availableQuantity).toBe(1);
  });
});
