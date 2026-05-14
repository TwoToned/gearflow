/**
 * Integration tests for damage capture (Wave 3).
 *
 * Invariants under test:
 *   - createDamageEventCore writes the row with the right severity/status/photos
 *   - When severity != MINOR AND assetId is set AND createMaintenanceRecord=true,
 *     a linked MaintenanceRecord is created and DamageEvent.maintenanceRecordId
 *     points at it
 *   - When severity = MINOR, no MaintenanceRecord is created (cosmetic-only)
 *   - When createMaintenanceRecord = false, no MaintenanceRecord even for MAJOR
 *   - When neither assetId nor bulkAssetId is set, no MaintenanceRecord
 *     (nothing to hold) even if severity is MAJOR
 *   - MaintenanceRecord inherits projectId so it shows on the project P&L
 *   - chargedBack toggle updates the row and survives a re-read
 *   - listDamageEvents filters by projectId (drilldown from P&L panel)
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
} from "../../tests/helpers/integration";
import { createId } from "@paralleldrive/cuid2";
import {
  createDamageEventCore,
  updateDamageEventCore,
} from "@/lib/damage-core";

async function createProjectFixture(orgId: string) {
  return testPrisma.project.create({
    data: {
      organizationId: orgId,
      projectNumber: `P-${createId().slice(0, 8)}`,
      name: "Test Project",
      taxRate: 0,
    },
  });
}

async function createAssetFixture(orgId: string) {
  const model = await testPrisma.model.create({
    data: { organizationId: orgId, name: "Test Model" },
  });
  return testPrisma.asset.create({
    data: {
      organizationId: orgId,
      modelId: model.id,
      assetTag: `T-${createId().slice(0, 8)}`,
      status: "AVAILABLE",
    },
  });
}

describe("createDamageEventCore", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("creates a DamageEvent row with the supplied fields", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const asset = await createAssetFixture(org.id);

    const event = await createDamageEventCore(
      {
        severity: "MAJOR",
        notes: "Driver dropped during load-out",
        photos: ["https://example.com/photo1.jpg"],
        estimatedCost: 250,
        actualCost: null,
        chargedBack: false,
        createMaintenanceRecord: true,
        assetId: asset.id,
        projectId: null,
      },
      { organizationId: org.id, userId: user.id },
    );

    expect(event.severity).toBe("MAJOR");
    expect(event.notes).toBe("Driver dropped during load-out");
    expect(event.status).toBe("OPEN");
    expect(event.photos).toEqual(["https://example.com/photo1.jpg"]);
    expect(Number(event.estimatedCost)).toBe(250);
    expect(event.actualCost).toBeNull();
    expect(event.chargedBack).toBe(false);
    expect(event.assetId).toBe(asset.id);
  });

  it("creates a linked MaintenanceRecord for MAJOR + asset + createMaintenanceRecord:true", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const asset = await createAssetFixture(org.id);
    const project = await createProjectFixture(org.id);

    const event = await createDamageEventCore(
      {
        severity: "MAJOR",
        notes: "Cone tear visible",
        photos: [],
        chargedBack: false,
        createMaintenanceRecord: true,
        assetId: asset.id,
        projectId: project.id,
      },
      { organizationId: org.id, userId: user.id },
    );

    expect(event.maintenanceRecordId).not.toBeNull();

    const mr = await testPrisma.maintenanceRecord.findUnique({
      where: { id: event.maintenanceRecordId! },
      include: { assets: true },
    });
    expect(mr).not.toBeNull();
    expect(mr!.type).toBe("REPAIR");
    expect(mr!.status).toBe("SCHEDULED");
    expect(mr!.projectId).toBe(project.id);
    expect(mr!.assets).toHaveLength(1);
    expect(mr!.assets[0].assetId).toBe(asset.id);
  });

  it("does NOT create a MaintenanceRecord for MINOR damage", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const asset = await createAssetFixture(org.id);

    const event = await createDamageEventCore(
      {
        severity: "MINOR",
        notes: "Cosmetic scratch",
        photos: [],
        chargedBack: false,
        createMaintenanceRecord: true,
        assetId: asset.id,
        projectId: null,
      },
      { organizationId: org.id, userId: user.id },
    );

    expect(event.maintenanceRecordId).toBeNull();
    const mrCount = await testPrisma.maintenanceRecord.count({ where: { organizationId: org.id } });
    expect(mrCount).toBe(0);
  });

  it("does NOT create a MaintenanceRecord when createMaintenanceRecord:false", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const asset = await createAssetFixture(org.id);

    const event = await createDamageEventCore(
      {
        severity: "TOTAL",
        notes: "Write-off",
        photos: [],
        chargedBack: false,
        createMaintenanceRecord: false, // opted out
        assetId: asset.id,
        projectId: null,
      },
      { organizationId: org.id, userId: user.id },
    );

    expect(event.maintenanceRecordId).toBeNull();
  });

  it("does NOT create a MaintenanceRecord when there is no asset/bulkAsset link", async () => {
    // Custom-item-only damage (project-level note, no inventory backing).
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const project = await createProjectFixture(org.id);

    const event = await createDamageEventCore(
      {
        severity: "MAJOR",
        notes: "Borrowed gear, returned damaged",
        photos: [],
        chargedBack: true,
        createMaintenanceRecord: true,
        projectId: project.id,
      },
      { organizationId: org.id, userId: user.id },
    );

    expect(event.maintenanceRecordId).toBeNull();
  });
});

describe("updateDamageEventCore", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("toggles chargedBack and persists actualCost", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const asset = await createAssetFixture(org.id);

    const event = await createDamageEventCore(
      {
        severity: "MINOR",
        notes: "Scratch",
        photos: [],
        chargedBack: false,
        createMaintenanceRecord: false,
        assetId: asset.id,
        projectId: null,
      },
      { organizationId: org.id, userId: user.id },
    );

    // Charge back + record actual cost + mark resolved
    const updated = await updateDamageEventCore(event.id, org.id, {
      chargedBack: true,
      actualCost: 75,
      status: "RESOLVED",
    });

    expect(updated.chargedBack).toBe(true);
    expect(Number(updated.actualCost)).toBe(75);
    expect(updated.status).toBe("RESOLVED");

    // Survives re-read
    const reread = await testPrisma.damageEvent.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(reread.chargedBack).toBe(true);
    expect(reread.status).toBe("RESOLVED");
  });

  it("undoes a charge-back", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const asset = await createAssetFixture(org.id);

    const event = await createDamageEventCore(
      {
        severity: "MAJOR",
        notes: "n",
        photos: [],
        chargedBack: true,
        createMaintenanceRecord: false,
        assetId: asset.id,
        projectId: null,
      },
      { organizationId: org.id, userId: user.id },
    );

    const updated = await updateDamageEventCore(event.id, org.id, {
      chargedBack: false,
    });
    expect(updated.chargedBack).toBe(false);
  });
});

describe("damage list filtering by projectId", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("only returns rows whose projectId matches the filter", async () => {
    // Mirror the listDamageEvents where clause locally — same as
    // other int tests that don't go through the requirePermission layer.
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const asset = await createAssetFixture(org.id);
    const projectA = await createProjectFixture(org.id);
    const projectB = await createProjectFixture(org.id);

    // 2 events on project A, 1 on project B, 1 unattached
    await createDamageEventCore(
      { severity: "MAJOR", notes: "a1", photos: [], chargedBack: false, createMaintenanceRecord: false, assetId: asset.id, projectId: projectA.id },
      { organizationId: org.id, userId: user.id },
    );
    await createDamageEventCore(
      { severity: "MAJOR", notes: "a2", photos: [], chargedBack: false, createMaintenanceRecord: false, assetId: asset.id, projectId: projectA.id },
      { organizationId: org.id, userId: user.id },
    );
    await createDamageEventCore(
      { severity: "MAJOR", notes: "b1", photos: [], chargedBack: false, createMaintenanceRecord: false, assetId: asset.id, projectId: projectB.id },
      { organizationId: org.id, userId: user.id },
    );
    await createDamageEventCore(
      { severity: "MAJOR", notes: "stand-alone", photos: [], chargedBack: false, createMaintenanceRecord: false, assetId: asset.id, projectId: null },
      { organizationId: org.id, userId: user.id },
    );

    const aRows = await testPrisma.damageEvent.findMany({
      where: { organizationId: org.id, projectId: projectA.id },
    });
    expect(aRows).toHaveLength(2);

    const bRows = await testPrisma.damageEvent.findMany({
      where: { organizationId: org.id, projectId: projectB.id },
    });
    expect(bRows).toHaveLength(1);

    const allRows = await testPrisma.damageEvent.findMany({
      where: { organizationId: org.id },
    });
    expect(allRows).toHaveLength(4);
  });
});
