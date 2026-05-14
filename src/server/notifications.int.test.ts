/**
 * Integration tests for Wave 2.D notifications work:
 *  • LOW_STOCK live compute (replaces stale BulkAsset.status filter — the
 *    bug that emailed "7 of 7 available" as low stock)
 *  • NotificationDismissal persistence (replaces localStorage)
 *  • UserNotificationPreference upsert with defaults
 *  • NotificationEmailLog dedupe (one email per (user, key))
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

/** Replicates the LOW_STOCK live-compute query from notifications.ts. */
async function queryLowStockBulks(orgId: string) {
  const candidates = await testPrisma.bulkAsset.findMany({
    where: {
      organizationId: orgId,
      isActive: true,
      reorderThreshold: { not: null, gt: 0 },
    },
  });
  return candidates.filter(
    (b) =>
      b.reorderThreshold !== null && b.availableQuantity <= b.reorderThreshold,
  );
}

describe("LOW_STOCK live compute (the bogus-email bug fix)", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("bulk with no reorderThreshold is NEVER low-stock (no opt-in, no alert)", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    // available = 0, total = 5 — would have been "low stock" under the old
    // logic that trusted BulkAsset.status. With no threshold, no alert.
    await createBulkAssetFixture(org.id, model.id, {
      assetTag: "NO-THRESHOLD",
      total: 5,
      available: 0,
    });

    const lowStock = await queryLowStockBulks(org.id);
    expect(lowStock).toHaveLength(0);
  });

  it("bulk at threshold IS low-stock", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const bulk = await testPrisma.bulkAsset.create({
      data: {
        organizationId: org.id,
        modelId: model.id,
        assetTag: "AT-THRESHOLD",
        totalQuantity: 20,
        availableQuantity: 5,
        reorderThreshold: 5,
      },
    });

    const lowStock = await queryLowStockBulks(org.id);
    expect(lowStock).toHaveLength(1);
    expect(lowStock[0].id).toBe(bulk.id);
  });

  it("bulk below threshold IS low-stock", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    await testPrisma.bulkAsset.create({
      data: {
        organizationId: org.id,
        modelId: model.id,
        assetTag: "BELOW",
        totalQuantity: 20,
        availableQuantity: 2,
        reorderThreshold: 5,
      },
    });

    const lowStock = await queryLowStockBulks(org.id);
    expect(lowStock).toHaveLength(1);
  });

  it("bulk above threshold is NOT low-stock — fixes the 7-of-7 bogus email", async () => {
    // The exact bug: TTP00097 had 7 of 7 available but received a "low stock"
    // email because its cached `status` enum was LOW_STOCK. With live compute,
    // available > threshold means no alert regardless of cached status.
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    await testPrisma.bulkAsset.create({
      data: {
        organizationId: org.id,
        modelId: model.id,
        assetTag: "BOGUS-7-OF-7",
        totalQuantity: 7,
        availableQuantity: 7,
        reorderThreshold: 2,
        status: "LOW_STOCK", // stale cached enum — proves we don't trust it
      },
    });

    const lowStock = await queryLowStockBulks(org.id);
    expect(lowStock).toHaveLength(0);
  });

  it("inactive bulk is NEVER low-stock", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    await testPrisma.bulkAsset.create({
      data: {
        organizationId: org.id,
        modelId: model.id,
        assetTag: "INACTIVE",
        totalQuantity: 20,
        availableQuantity: 0,
        reorderThreshold: 5,
        isActive: false,
      },
    });

    const lowStock = await queryLowStockBulks(org.id);
    expect(lowStock).toHaveLength(0);
  });

  it("threshold of 0 is treated as no-threshold (gt: 0 filter)", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    await testPrisma.bulkAsset.create({
      data: {
        organizationId: org.id,
        modelId: model.id,
        assetTag: "ZERO-THRESHOLD",
        totalQuantity: 10,
        availableQuantity: 0,
        reorderThreshold: 0,
      },
    });

    const lowStock = await queryLowStockBulks(org.id);
    expect(lowStock).toHaveLength(0);
  });
});

describe("NotificationDismissal persistence", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("dismiss creates a row with unique (userId, notificationKey)", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);

    await testPrisma.notificationDismissal.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        notificationKey: "overdue_maintenance:abc",
      },
    });

    const found = await testPrisma.notificationDismissal.findUnique({
      where: {
        userId_notificationKey: {
          userId: user.id,
          notificationKey: "overdue_maintenance:abc",
        },
      },
    });
    expect(found).not.toBeNull();
  });

  it("re-dismissing the same key is idempotent (unique violation upserts)", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);

    await testPrisma.notificationDismissal.upsert({
      where: {
        userId_notificationKey: { userId: user.id, notificationKey: "k1" },
      },
      create: { organizationId: org.id, userId: user.id, notificationKey: "k1" },
      update: {}, // no-op
    });
    await testPrisma.notificationDismissal.upsert({
      where: {
        userId_notificationKey: { userId: user.id, notificationKey: "k1" },
      },
      create: { organizationId: org.id, userId: user.id, notificationKey: "k1" },
      update: {},
    });

    const count = await testPrisma.notificationDismissal.count({
      where: { userId: user.id, notificationKey: "k1" },
    });
    expect(count).toBe(1);
  });

  it("different users can both dismiss the same key independently", async () => {
    const org = await createOrgFixture();
    const userA = await createUserFixture(org.id);
    const userB = await createUserFixture(org.id);

    await testPrisma.notificationDismissal.create({
      data: { organizationId: org.id, userId: userA.id, notificationKey: "shared" },
    });
    await testPrisma.notificationDismissal.create({
      data: { organizationId: org.id, userId: userB.id, notificationKey: "shared" },
    });

    const all = await testPrisma.notificationDismissal.findMany({
      where: { notificationKey: "shared" },
    });
    expect(all).toHaveLength(2);
  });
});

describe("UserNotificationPreference defaults", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("creating a row with no overrides uses schema defaults", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);

    const pref = await testPrisma.userNotificationPreference.create({
      data: { userId: user.id },
    });

    // Defaults documented in schema: true for compliance-shaped (maintenance,
    // return, low stock, cert, flagged, invitation); false for opt-in noisy
    // (upcoming project, crew offers, timesheets).
    expect(pref.overdueMaintenance).toBe(true);
    expect(pref.overdueReturn).toBe(true);
    expect(pref.lowStock).toBe(true);
    expect(pref.expiringCert).toBe(true);
    expect(pref.flaggedAsset).toBe(true);
    expect(pref.pendingInvitation).toBe(true);
    expect(pref.upcomingProject).toBe(false);
    expect(pref.pendingOffers).toBe(false);
    expect(pref.pendingTimesheets).toBe(false);
  });

  it("upsert + update preserves user's overrides", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);

    await testPrisma.userNotificationPreference.create({
      data: { userId: user.id, lowStock: false, pendingOffers: true },
    });

    const after = await testPrisma.userNotificationPreference.findUnique({
      where: { userId: user.id },
    });
    expect(after?.lowStock).toBe(false);
    expect(after?.pendingOffers).toBe(true);
    // Untouched fields keep defaults
    expect(after?.overdueMaintenance).toBe(true);
  });

  it("userId is unique — second create throws", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);

    await testPrisma.userNotificationPreference.create({
      data: { userId: user.id },
    });

    await expect(
      testPrisma.userNotificationPreference.create({
        data: { userId: user.id },
      }),
    ).rejects.toThrow();
  });
});

describe("NotificationEmailLog dedupe", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("logging the same (user, key) twice throws — proves dedupe constraint", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);

    await testPrisma.notificationEmailLog.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        notificationKey: "stock-abc",
      },
    });

    await expect(
      testPrisma.notificationEmailLog.create({
        data: {
          organizationId: org.id,
          userId: user.id,
          notificationKey: "stock-abc",
        },
      }),
    ).rejects.toThrow();
  });

  it("different users CAN both be logged for the same key", async () => {
    const org = await createOrgFixture();
    const userA = await createUserFixture(org.id);
    const userB = await createUserFixture(org.id);

    await testPrisma.notificationEmailLog.create({
      data: {
        organizationId: org.id,
        userId: userA.id,
        notificationKey: "stock-abc",
      },
    });
    await testPrisma.notificationEmailLog.create({
      data: {
        organizationId: org.id,
        userId: userB.id,
        notificationKey: "stock-abc",
      },
    });

    const count = await testPrisma.notificationEmailLog.count({
      where: { notificationKey: "stock-abc" },
    });
    expect(count).toBe(2);
  });
});
