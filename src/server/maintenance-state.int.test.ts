/**
 * Integration tests for the Wave 1.6 maintenance state-machine.
 *
 * The production helpers `holdAssets` and `releaseAssets` are private inside
 * src/server/maintenance.ts. These tests exercise the same Prisma queries
 * and invariants against the real test DB.
 *
 * Invariants under test (per maintenance.ts state-machine docs):
 *  • HOLD: AVAILABLE → IN_MAINTENANCE. Never overwrites CHECKED_OUT / LOST / RETIRED.
 *  • RELEASE: IN_MAINTENANCE → AVAILABLE, but ONLY if no other active
 *    (IN_PROGRESS) maintenance record holds the asset. Never overwrites
 *    CHECKED_OUT / LOST / RETIRED.
 *  • Removed assets are released by `toRemove` handling on update.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
  createModelFixture,
  createAssetFixture,
} from "../../tests/helpers/integration";

// Replicates the production helpers. Mirrored exactly from maintenance.ts to
// ensure invariants under test match invariants in production.

async function holdAssets(orgId: string, assetIds: string[]) {
  if (assetIds.length === 0) return;
  await testPrisma.asset.updateMany({
    where: { id: { in: assetIds }, status: "AVAILABLE" },
    data: { status: "IN_MAINTENANCE" },
  });
}

// Wave 3 extension: any of these statuses count as "holding" the asset.
const HOLDING_STATUSES = ["AWAITING_PARTS", "IN_PROGRESS", "QA"] as const;

async function releaseAssets(
  orgId: string,
  assetIds: string[],
  currentRecordId: string,
) {
  if (assetIds.length === 0) return;
  const stillHeld = await testPrisma.maintenanceRecordAsset.findMany({
    where: {
      assetId: { in: assetIds },
      maintenanceRecordId: { not: currentRecordId },
      maintenanceRecord: { status: { in: [...HOLDING_STATUSES] } },
    },
    select: { assetId: true },
  });
  const stillHeldIds = new Set(stillHeld.map((r) => r.assetId));
  const toRelease = assetIds.filter((id) => !stillHeldIds.has(id));
  if (toRelease.length === 0) return;
  await testPrisma.asset.updateMany({
    where: { id: { in: toRelease }, status: "IN_MAINTENANCE" },
    data: { status: "AVAILABLE" },
  });
}

async function createMaintenanceRecord(
  orgId: string,
  options: {
    status: "SCHEDULED" | "AWAITING_PARTS" | "IN_PROGRESS" | "QA" | "COMPLETED" | "CANCELLED";
    assetIds: string[];
  },
) {
  const record = await testPrisma.maintenanceRecord.create({
    data: {
      organizationId: orgId,
      type: "REPAIR",
      status: options.status,
      title: "Test maintenance",
      assets: { create: options.assetIds.map((assetId) => ({ assetId })) },
    },
  });
  return record;
}

describe("maintenance state machine (Wave 1.6)", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  describe("holdAssets", () => {
    it("flips AVAILABLE → IN_MAINTENANCE", async () => {
      const org = await createOrgFixture();
      await createUserFixture(org.id);
      const model = await createModelFixture(org.id);
      const asset = await createAssetFixture(org.id, model.id, {
        assetTag: "A1",
        status: "AVAILABLE",
      });

      await holdAssets(org.id, [asset.id]);

      const after = await testPrisma.asset.findUnique({
        where: { id: asset.id },
        select: { status: true },
      });
      expect(after?.status).toBe("IN_MAINTENANCE");
    });

    it.each(["CHECKED_OUT", "LOST", "RETIRED"] as const)(
      "does NOT overwrite %s status",
      async (otherStatus) => {
        const org = await createOrgFixture();
        await createUserFixture(org.id);
        const model = await createModelFixture(org.id);
        const asset = await createAssetFixture(org.id, model.id, {
          assetTag: `A-${otherStatus}`,
          status: otherStatus,
        });

        await holdAssets(org.id, [asset.id]);

        const after = await testPrisma.asset.findUnique({
          where: { id: asset.id },
          select: { status: true },
        });
        // Status preserved — guard kept the asset out of maintenance
        expect(after?.status).toBe(otherStatus);
      },
    );

    it("noop on empty list", async () => {
      const org = await createOrgFixture();
      await createUserFixture(org.id);
      // Should not throw
      await holdAssets(org.id, []);
    });
  });

  describe("releaseAssets", () => {
    it("flips IN_MAINTENANCE → AVAILABLE when no other record holds it", async () => {
      const org = await createOrgFixture();
      await createUserFixture(org.id);
      const model = await createModelFixture(org.id);
      const asset = await createAssetFixture(org.id, model.id, {
        assetTag: "R1",
        status: "IN_MAINTENANCE",
      });
      const record = await createMaintenanceRecord(org.id, {
        status: "COMPLETED",
        assetIds: [asset.id],
      });

      await releaseAssets(org.id, [asset.id], record.id);

      const after = await testPrisma.asset.findUnique({
        where: { id: asset.id },
        select: { status: true },
      });
      expect(after?.status).toBe("AVAILABLE");
    });

    it("does NOT release when another IN_PROGRESS record holds the asset", async () => {
      const org = await createOrgFixture();
      await createUserFixture(org.id);
      const model = await createModelFixture(org.id);
      const asset = await createAssetFixture(org.id, model.id, {
        assetTag: "R2",
        status: "IN_MAINTENANCE",
      });
      // Record A is completing (we're releasing through it)
      const completingRecord = await createMaintenanceRecord(org.id, {
        status: "COMPLETED",
        assetIds: [asset.id],
      });
      // Record B holds the same asset and is still IN_PROGRESS
      await createMaintenanceRecord(org.id, {
        status: "IN_PROGRESS",
        assetIds: [asset.id],
      });

      await releaseAssets(org.id, [asset.id], completingRecord.id);

      const after = await testPrisma.asset.findUnique({
        where: { id: asset.id },
        select: { status: true },
      });
      // Still held because record B still has the lock
      expect(after?.status).toBe("IN_MAINTENANCE");
    });

    it.each(["CHECKED_OUT", "LOST", "RETIRED"] as const)(
      "does NOT overwrite %s on release (only flips IN_MAINTENANCE)",
      async (otherStatus) => {
        const org = await createOrgFixture();
        await createUserFixture(org.id);
        const model = await createModelFixture(org.id);
        const asset = await createAssetFixture(org.id, model.id, {
          assetTag: `R-${otherStatus}`,
          status: otherStatus,
        });
        const record = await createMaintenanceRecord(org.id, {
          status: "COMPLETED",
          assetIds: [asset.id],
        });

        await releaseAssets(org.id, [asset.id], record.id);

        const after = await testPrisma.asset.findUnique({
          where: { id: asset.id },
          select: { status: true },
        });
        expect(after?.status).toBe(otherStatus);
      },
    );

    it("noop on empty list", async () => {
      const org = await createOrgFixture();
      await createUserFixture(org.id);
      await releaseAssets(org.id, [], "any-id");
    });

    it("releases only the assets without other active holds (mixed batch)", async () => {
      const org = await createOrgFixture();
      await createUserFixture(org.id);
      const model = await createModelFixture(org.id);
      const releasable = await createAssetFixture(org.id, model.id, {
        assetTag: "MIXED-FREE",
        status: "IN_MAINTENANCE",
      });
      const stuck = await createAssetFixture(org.id, model.id, {
        assetTag: "MIXED-STUCK",
        status: "IN_MAINTENANCE",
      });
      const completing = await createMaintenanceRecord(org.id, {
        status: "COMPLETED",
        assetIds: [releasable.id, stuck.id],
      });
      // Only `stuck` has another active hold
      await createMaintenanceRecord(org.id, {
        status: "IN_PROGRESS",
        assetIds: [stuck.id],
      });

      await releaseAssets(org.id, [releasable.id, stuck.id], completing.id);

      const releasedAfter = await testPrisma.asset.findUnique({
        where: { id: releasable.id },
        select: { status: true },
      });
      const stuckAfter = await testPrisma.asset.findUnique({
        where: { id: stuck.id },
        select: { status: true },
      });
      expect(releasedAfter?.status).toBe("AVAILABLE");
      expect(stuckAfter?.status).toBe("IN_MAINTENANCE");
    });
  });

  // ─── Wave 3: workshop kanban transitions ───────────────────────────
  describe("workshop kanban statuses", () => {
    it.each(["AWAITING_PARTS", "IN_PROGRESS", "QA"] as const)(
      "another active %s record blocks release",
      async (otherStatus) => {
        const org = await createOrgFixture();
        await createUserFixture(org.id);
        const model = await createModelFixture(org.id);
        const asset = await createAssetFixture(org.id, model.id, {
          assetTag: `WS-${Math.random().toString(36).slice(2, 8)}`,
          status: "IN_MAINTENANCE",
        });

        const completing = await createMaintenanceRecord(org.id, {
          status: "IN_PROGRESS",
          assetIds: [asset.id],
        });
        await createMaintenanceRecord(org.id, {
          status: otherStatus,
          assetIds: [asset.id],
        });

        await releaseAssets(org.id, [asset.id], completing.id);

        const after = await testPrisma.asset.findUnique({
          where: { id: asset.id },
          select: { status: true },
        });
        expect(after?.status).toBe("IN_MAINTENANCE");
      },
    );

    it("a SCHEDULED record does NOT block release (not a holding status)", async () => {
      const org = await createOrgFixture();
      await createUserFixture(org.id);
      const model = await createModelFixture(org.id);
      const asset = await createAssetFixture(org.id, model.id, {
        assetTag: `WS-${Math.random().toString(36).slice(2, 8)}`,
        status: "IN_MAINTENANCE",
      });

      const completing = await createMaintenanceRecord(org.id, {
        status: "IN_PROGRESS",
        assetIds: [asset.id],
      });
      // SCHEDULED is upcoming work — doesn't physically hold the asset
      await createMaintenanceRecord(org.id, {
        status: "SCHEDULED",
        assetIds: [asset.id],
      });

      await releaseAssets(org.id, [asset.id], completing.id);

      const after = await testPrisma.asset.findUnique({
        where: { id: asset.id },
        select: { status: true },
      });
      expect(after?.status).toBe("AVAILABLE");
    });

    it("a COMPLETED record never blocks release", async () => {
      const org = await createOrgFixture();
      await createUserFixture(org.id);
      const model = await createModelFixture(org.id);
      const asset = await createAssetFixture(org.id, model.id, {
        assetTag: `WS-${Math.random().toString(36).slice(2, 8)}`,
        status: "IN_MAINTENANCE",
      });

      const completing = await createMaintenanceRecord(org.id, {
        status: "IN_PROGRESS",
        assetIds: [asset.id],
      });
      await createMaintenanceRecord(org.id, {
        status: "COMPLETED",
        assetIds: [asset.id],
      });

      await releaseAssets(org.id, [asset.id], completing.id);

      const after = await testPrisma.asset.findUnique({
        where: { id: asset.id },
        select: { status: true },
      });
      expect(after?.status).toBe("AVAILABLE");
    });
  });
});
