/**
 * Integration tests for MaintenanceRecord.photos (Wave 3).
 *
 * Invariants under test:
 *   - photos default to empty array on a fresh record
 *   - photos persist through create
 *   - photos survive a status change via setMaintenanceStatus (the workshop
 *     kanban path) — verifies the lightweight update doesn't clobber them
 *   - photos array can be updated independently (replace + clear)
 *
 * The schema migration default is `ARRAY[]::TEXT[]` so any code path that
 * inserts a row without specifying `photos` must still produce an empty
 * array (not NULL).
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
import { createId } from "@paralleldrive/cuid2";

async function createMaintenance(
  orgId: string,
  options: { assetId: string; photos?: string[]; status?: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" },
) {
  return testPrisma.maintenanceRecord.create({
    data: {
      organizationId: orgId,
      type: "REPAIR",
      status: options.status ?? "SCHEDULED",
      title: "Test repair",
      photos: options.photos ?? [],
      assets: { create: [{ assetId: options.assetId }] },
    },
  });
}

describe("MaintenanceRecord.photos", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("defaults to empty array when not specified", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const asset = await createAssetFixture(org.id, model.id, {
      assetTag: `T-${createId().slice(0, 8)}`,
    });

    const record = await testPrisma.maintenanceRecord.create({
      data: {
        organizationId: org.id,
        type: "REPAIR",
        status: "SCHEDULED",
        title: "No photos here",
        // photos omitted intentionally
        assets: { create: [{ assetId: asset.id }] },
      },
    });

    expect(record.photos).toEqual([]);
  });

  it("persists supplied photo URLs", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const asset = await createAssetFixture(org.id, model.id, {
      assetTag: `T-${createId().slice(0, 8)}`,
    });

    const photos = [
      "https://example.com/before.jpg",
      "https://example.com/after.jpg",
    ];
    const record = await createMaintenance(org.id, { assetId: asset.id, photos });

    const reread = await testPrisma.maintenanceRecord.findUniqueOrThrow({
      where: { id: record.id },
    });
    expect(reread.photos).toEqual(photos);
  });

  it("survives status-change updates (workshop kanban path)", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const asset = await createAssetFixture(org.id, model.id, {
      assetTag: `T-${createId().slice(0, 8)}`,
    });

    const photos = ["https://example.com/p1.jpg"];
    const record = await createMaintenance(org.id, {
      assetId: asset.id,
      photos,
      status: "IN_PROGRESS",
    });

    // Mirror the kanban's setMaintenanceStatus path: status-only update
    // shouldn't touch photos.
    await testPrisma.maintenanceRecord.update({
      where: { id: record.id },
      data: { status: "QA" },
    });

    const reread = await testPrisma.maintenanceRecord.findUniqueOrThrow({
      where: { id: record.id },
    });
    expect(reread.status).toBe("QA");
    expect(reread.photos).toEqual(photos);
  });

  it("can be replaced with a different array", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const asset = await createAssetFixture(org.id, model.id, {
      assetTag: `T-${createId().slice(0, 8)}`,
    });

    const record = await createMaintenance(org.id, {
      assetId: asset.id,
      photos: ["https://example.com/old.jpg"],
    });

    await testPrisma.maintenanceRecord.update({
      where: { id: record.id },
      data: { photos: ["https://example.com/new1.jpg", "https://example.com/new2.jpg"] },
    });

    const reread = await testPrisma.maintenanceRecord.findUniqueOrThrow({
      where: { id: record.id },
    });
    expect(reread.photos).toEqual([
      "https://example.com/new1.jpg",
      "https://example.com/new2.jpg",
    ]);
  });

  it("can be cleared to an empty array", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const asset = await createAssetFixture(org.id, model.id, {
      assetTag: `T-${createId().slice(0, 8)}`,
    });

    const record = await createMaintenance(org.id, {
      assetId: asset.id,
      photos: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
    });

    await testPrisma.maintenanceRecord.update({
      where: { id: record.id },
      data: { photos: [] },
    });

    const reread = await testPrisma.maintenanceRecord.findUniqueOrThrow({
      where: { id: record.id },
    });
    expect(reread.photos).toEqual([]);
  });
});
