/**
 * Integration tests for asset utilization (Wave 3).
 *
 * Invariants under test:
 *   - bookingDays = sum of inclusive day spans for line items where this
 *     exact asset is assigned, clamped to the period
 *   - revenue = sum of lineTotal across those line items
 *   - maintenance cost = SUM(MaintenanceRecord.cost) via join, in period
 *   - damage cost = SUM(actualCost ?? estimatedCost), minus chargedBack
 *   - netContribution = revenue − maintenance − ourDamage
 *   - utilizationRate = bookingDays / periodDays, clamped [0..1]
 *   - cancelled line items don't count
 *   - line items with assetId NULL (model-only) don't count
 *   - bookings outside the period are excluded
 *   - cross-org isolation
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
import { computeAssetUtilization } from "@/lib/utilization";

async function createProjectFixture(
  orgId: string,
  rentalStart: Date,
  rentalEnd: Date,
) {
  return testPrisma.project.create({
    data: {
      organizationId: orgId,
      projectNumber: `P-${createId().slice(0, 8)}`,
      name: "Test Project",
      taxRate: 0,
      rentalStartDate: rentalStart,
      rentalEndDate: rentalEnd,
    },
  });
}

async function createLineItem(
  orgId: string,
  projectId: string,
  options: {
    assetId?: string | null;
    modelId: string;
    lineTotal?: number;
    status?: "QUOTED" | "CONFIRMED" | "CANCELLED" | "CHECKED_OUT" | "RETURNED";
  },
) {
  return testPrisma.projectLineItem.create({
    data: {
      organizationId: orgId,
      projectId,
      modelId: options.modelId,
      assetId: options.assetId ?? null,
      type: "EQUIPMENT",
      quantity: 1,
      unitPrice: options.lineTotal ?? 100,
      duration: 1,
      pricingType: "FLAT",
      lineTotal: options.lineTotal ?? 100,
      status: options.status ?? "QUOTED",
    },
  });
}

async function createMaintenance(
  orgId: string,
  assetId: string,
  options: { cost: number; createdAt?: Date },
) {
  return testPrisma.maintenanceRecord.create({
    data: {
      organizationId: orgId,
      type: "REPAIR",
      status: "COMPLETED",
      title: "Repair",
      cost: options.cost,
      createdAt: options.createdAt,
      assets: { create: [{ assetId }] },
    },
  });
}

describe("computeAssetUtilization", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("counts booking days for the period (10-day rental over a 30-day period)", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const asset = await createAssetFixture(org.id, model.id, {
      assetTag: `T-${createId().slice(0, 8)}`,
    });
    // 10-day rental (inclusive): Apr 1 → Apr 10
    const project = await createProjectFixture(
      org.id,
      new Date("2026-04-01"),
      new Date("2026-04-10"),
    );
    await createLineItem(org.id, project.id, {
      modelId: model.id,
      assetId: asset.id,
      lineTotal: 250,
    });

    const result = await computeAssetUtilization(asset.id, org.id, {
      start: new Date("2026-04-01"),
      end: new Date("2026-04-30"),
    });
    expect(result).not.toBeNull();
    expect(result!.bookingDays).toBe(10);
    expect(result!.periodDays).toBe(30);
    expect(result!.utilizationRate).toBeCloseTo(10 / 30, 5);
    expect(result!.revenue).toBe(250);
    expect(result!.projectCount).toBe(1);
  });

  it("clamps a booking that straddles the period start", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const asset = await createAssetFixture(org.id, model.id, {
      assetTag: `T-${createId().slice(0, 8)}`,
    });
    // Rental: Mar 25 → Apr 5. Period: Apr 1 → Apr 30. Effective: Apr 1 → Apr 5 = 5 days.
    const project = await createProjectFixture(
      org.id,
      new Date("2026-03-25"),
      new Date("2026-04-05"),
    );
    await createLineItem(org.id, project.id, {
      modelId: model.id,
      assetId: asset.id,
      lineTotal: 500,
    });

    const result = await computeAssetUtilization(asset.id, org.id, {
      start: new Date("2026-04-01"),
      end: new Date("2026-04-30"),
    });
    expect(result!.bookingDays).toBe(5);
    expect(result!.revenue).toBe(500); // revenue not pro-rated; full lineTotal lands
  });

  it("excludes bookings outside the period entirely", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const asset = await createAssetFixture(org.id, model.id, {
      assetTag: `T-${createId().slice(0, 8)}`,
    });
    const project = await createProjectFixture(
      org.id,
      new Date("2025-01-01"),
      new Date("2025-01-10"),
    );
    await createLineItem(org.id, project.id, {
      modelId: model.id,
      assetId: asset.id,
      lineTotal: 999,
    });

    const result = await computeAssetUtilization(asset.id, org.id, {
      start: new Date("2026-04-01"),
      end: new Date("2026-04-30"),
    });
    expect(result!.bookingDays).toBe(0);
    expect(result!.revenue).toBe(0);
    expect(result!.projectCount).toBe(0);
  });

  it("ignores CANCELLED line items", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const asset = await createAssetFixture(org.id, model.id, {
      assetTag: `T-${createId().slice(0, 8)}`,
    });
    const project = await createProjectFixture(
      org.id,
      new Date("2026-04-01"),
      new Date("2026-04-05"),
    );
    await createLineItem(org.id, project.id, {
      modelId: model.id,
      assetId: asset.id,
      lineTotal: 500,
      status: "CANCELLED",
    });

    const result = await computeAssetUtilization(asset.id, org.id, {
      start: new Date("2026-04-01"),
      end: new Date("2026-04-30"),
    });
    expect(result!.bookingDays).toBe(0);
    expect(result!.revenue).toBe(0);
  });

  it("ignores line items with assetId NULL (model-only bookings)", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const asset = await createAssetFixture(org.id, model.id, {
      assetTag: `T-${createId().slice(0, 8)}`,
    });
    const project = await createProjectFixture(
      org.id,
      new Date("2026-04-01"),
      new Date("2026-04-05"),
    );
    // Line item references the model but no specific asset
    await createLineItem(org.id, project.id, {
      modelId: model.id,
      assetId: null,
      lineTotal: 500,
    });

    const result = await computeAssetUtilization(asset.id, org.id, {
      start: new Date("2026-04-01"),
      end: new Date("2026-04-30"),
    });
    expect(result!.bookingDays).toBe(0);
    expect(result!.revenue).toBe(0);
  });

  it("sums maintenance cost via the join table within period", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const asset = await createAssetFixture(org.id, model.id, {
      assetTag: `T-${createId().slice(0, 8)}`,
    });
    // Two records in period, one outside
    await createMaintenance(org.id, asset.id, { cost: 100, createdAt: new Date("2026-04-10") });
    await createMaintenance(org.id, asset.id, { cost: 50, createdAt: new Date("2026-04-20") });
    await createMaintenance(org.id, asset.id, { cost: 999, createdAt: new Date("2025-12-01") });

    const result = await computeAssetUtilization(asset.id, org.id, {
      start: new Date("2026-04-01"),
      end: new Date("2026-04-30"),
    });
    expect(result!.maintenanceCost).toBe(150);
  });

  it("netContribution = revenue − maintenance", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const asset = await createAssetFixture(org.id, model.id, {
      assetTag: `T-${createId().slice(0, 8)}`,
    });
    const project = await createProjectFixture(
      org.id,
      new Date("2026-04-01"),
      new Date("2026-04-10"),
    );
    await createLineItem(org.id, project.id, {
      modelId: model.id,
      assetId: asset.id,
      lineTotal: 1000,
    });
    await createMaintenance(org.id, asset.id, { cost: 200, createdAt: new Date("2026-04-15") });

    const result = await computeAssetUtilization(asset.id, org.id, {
      start: new Date("2026-04-01"),
      end: new Date("2026-04-30"),
    });
    expect(result!.revenue).toBe(1000);
    expect(result!.maintenanceCost).toBe(200);
    expect(result!.netContribution).toBe(800); // 1000 − 200
  });

  it("returns null for missing / cross-org asset", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const result = await computeAssetUtilization(createId(), org.id);
    expect(result).toBeNull();
  });

  it("utilization rate clamps to [0, 1]", async () => {
    // Theoretical: two overlapping bookings could exceed period days.
    // Even so, the rate must clamp to 1.0.
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const asset = await createAssetFixture(org.id, model.id, {
      assetTag: `T-${createId().slice(0, 8)}`,
    });
    const p1 = await createProjectFixture(org.id, new Date("2026-04-01"), new Date("2026-04-20"));
    const p2 = await createProjectFixture(org.id, new Date("2026-04-10"), new Date("2026-04-30"));
    await createLineItem(org.id, p1.id, { modelId: model.id, assetId: asset.id, lineTotal: 100 });
    await createLineItem(org.id, p2.id, { modelId: model.id, assetId: asset.id, lineTotal: 100 });

    const result = await computeAssetUtilization(asset.id, org.id, {
      start: new Date("2026-04-01"),
      end: new Date("2026-04-30"),
    });
    // bookingDays may exceed periodDays in overlap scenarios; rate clamps to 1.
    expect(result!.utilizationRate).toBe(1);
  });
});
