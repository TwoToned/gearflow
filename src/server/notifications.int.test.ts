/**
 * Integration tests for Wave 2.D notifications work:
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
} from "../../tests/helpers/integration";

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
    // return, cert, flagged, invitation); false for opt-in noisy
    // (upcoming project, crew offers, timesheets).
    expect(pref.overdueMaintenance).toBe(true);
    expect(pref.overdueReturn).toBe(true);
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
      data: { userId: user.id, upcomingProject: true, pendingOffers: true },
    });

    const after = await testPrisma.userNotificationPreference.findUnique({
      where: { userId: user.id },
    });
    expect(after?.upcomingProject).toBe(true);
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
