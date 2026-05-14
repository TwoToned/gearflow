/**
 * Integration tests for getProjectOperationalCosts (Wave 2 P&L panel).
 *
 * Invariants under test:
 *   - revenue + persisted costs read straight from Project columns
 *   - maintenance cost = SUM(MaintenanceRecord.cost) where projectId matches,
 *     excluding CANCELLED
 *   - damage cost = SUM(actualCost ?? estimatedCost) per row
 *   - chargedBack damage is subtracted from "our" damage cost (client pays it)
 *   - netMargin = total − (services + labour + sub-hire + maintenance + our damage)
 *   - empty / missing project returns a zero shell
 *
 * Note: `prisma` (used by the server fn) and `testPrisma` (used by fixtures)
 * point at the same DATABASE_URL in this harness, so writes from one are
 * visible to the other.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
} from "../../tests/helpers/integration";
import { createId } from "@paralleldrive/cuid2";
import { computeProjectOperationalCosts } from "@/lib/project-costs";

async function createProjectFixture(
  orgId: string,
  overrides?: {
    equipmentRevenue?: number;
    serviceCostTotal?: number;
    labourCostTotal?: number;
    subHireCostTotal?: number;
    total?: number;
  },
) {
  return testPrisma.project.create({
    data: {
      organizationId: orgId,
      projectNumber: `P-${createId().slice(0, 8)}`,
      name: "Test Project",
      taxRate: 0,
      equipmentRevenue: overrides?.equipmentRevenue ?? 0,
      serviceCostTotal: overrides?.serviceCostTotal ?? 0,
      labourCostTotal: overrides?.labourCostTotal ?? 0,
      subHireCostTotal: overrides?.subHireCostTotal ?? 0,
      total: overrides?.total ?? 0,
    },
  });
}

async function createMaintenanceRecord(
  orgId: string,
  projectId: string,
  options: { cost: number; status?: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" },
) {
  return testPrisma.maintenanceRecord.create({
    data: {
      organizationId: orgId,
      projectId,
      type: "REPAIR",
      status: options.status ?? "COMPLETED",
      title: "Test repair",
      cost: options.cost,
    },
  });
}

async function createDamageEvent(
  orgId: string,
  projectId: string,
  createdById: string,
  options: {
    actualCost?: number;
    estimatedCost?: number;
    chargedBack?: boolean;
    severity?: "MINOR" | "MAJOR" | "TOTAL";
  },
) {
  return testPrisma.damageEvent.create({
    data: {
      organizationId: orgId,
      projectId,
      createdById,
      severity: options.severity ?? "MINOR",
      status: "OPEN",
      actualCost: options.actualCost ?? null,
      estimatedCost: options.estimatedCost ?? null,
      chargedBack: options.chargedBack ?? false,
    },
  });
}

describe("getProjectOperationalCosts", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("returns persisted Project.* columns straight through", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const project = await createProjectFixture(org.id, {
      equipmentRevenue: 1000,
      serviceCostTotal: 100,
      labourCostTotal: 200,
      subHireCostTotal: 150,
      total: 1100,
    });

    const result = await computeProjectOperationalCosts(project.id, org.id);
    expect(result.equipmentRevenue).toBe(1000);
    expect(result.serviceCostTotal).toBe(100);
    expect(result.labourCostTotal).toBe(200);
    expect(result.subHireCostTotal).toBe(150);
    expect(result.total).toBe(1100);
  });

  it("sums maintenance cost for non-cancelled records", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const project = await createProjectFixture(org.id, { total: 5000 });

    await createMaintenanceRecord(org.id, project.id, { cost: 200 });
    await createMaintenanceRecord(org.id, project.id, { cost: 50 });
    await createMaintenanceRecord(org.id, project.id, { cost: 999, status: "CANCELLED" });

    const result = await computeProjectOperationalCosts(project.id, org.id);
    expect(result.maintenanceCostTotal).toBe(250);
    expect(result.counts.maintenanceRecords).toBe(2);
  });

  it("prefers actualCost over estimatedCost on damage events", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const project = await createProjectFixture(org.id, { total: 5000 });

    await createDamageEvent(org.id, project.id, user.id, { actualCost: 100, estimatedCost: 50 });
    await createDamageEvent(org.id, project.id, user.id, { estimatedCost: 75 });
    await createDamageEvent(org.id, project.id, user.id, { actualCost: 25 });

    const result = await computeProjectOperationalCosts(project.id, org.id);
    // 100 (actual wins) + 75 (estimated fallback) + 25 (actual)
    expect(result.damageCostTotal).toBe(200);
    expect(result.counts.damageEvents).toBe(3);
  });

  it("excludes charged-back damage from our cost", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const project = await createProjectFixture(org.id, { total: 5000 });

    await createDamageEvent(org.id, project.id, user.id, { actualCost: 100, chargedBack: false });
    await createDamageEvent(org.id, project.id, user.id, { actualCost: 300, chargedBack: true });

    const result = await computeProjectOperationalCosts(project.id, org.id);
    expect(result.damageCostTotal).toBe(400); // gross
    expect(result.damageChargedBackTotal).toBe(300);

    // net margin should subtract only $100 of damage, not $400
    // total=5000, all other costs=0, our damage=100 → margin=4900
    expect(result.netMargin).toBe(4900);
  });

  it("netMargin = total − (services + labour + sub-hire + maintenance + our damage)", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const project = await createProjectFixture(org.id, {
      total: 10000,
      serviceCostTotal: 1000,
      labourCostTotal: 1500,
      subHireCostTotal: 500,
    });
    await createMaintenanceRecord(org.id, project.id, { cost: 200 });
    await createDamageEvent(org.id, project.id, user.id, { actualCost: 100 });

    const result = await computeProjectOperationalCosts(project.id, org.id);
    // 10000 − (1000 + 1500 + 500 + 200 + 100) = 6700
    expect(result.netMargin).toBe(6700);
    expect(result.marginPercent).toBeCloseTo(67, 0);
  });

  it("returns empty shell for missing/cross-org project", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    // Use a valid-shaped cuid that doesn't exist
    const fakeId = createId();
    const result = await computeProjectOperationalCosts(fakeId, org.id);
    expect(result.total).toBe(0);
    expect(result.netMargin).toBe(0);
    expect(result.marginPercent).toBe(0);
    expect(result.counts.maintenanceRecords).toBe(0);
  });

  it("marginPercent clamps to [0, 100]", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    // Costs exceed revenue — negative margin → clamped to 0
    const project = await createProjectFixture(org.id, {
      total: 1000,
      serviceCostTotal: 2000,
    });
    const result = await computeProjectOperationalCosts(project.id, org.id);
    expect(result.netMargin).toBe(-1000);
    expect(result.marginPercent).toBe(0);
  });
});
