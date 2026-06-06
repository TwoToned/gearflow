/**
 * Integration tests for importModelRatesCSV (src/server/csv.ts). Verifies
 * identifier matching, rate-only updates, defaultRentalPrice sync, that models
 * are never created, and that ambiguous/unknown/invalid rows are reported.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
} from "../../tests/helpers/integration";

const h = vi.hoisted(() => ({
  ctx: { organizationId: "", userId: "u1", userName: "Tester" },
}));
vi.mock("@/lib/org-context", () => ({
  getOrgContext: async () => h.ctx,
  requirePermission: async () => h.ctx,
}));
vi.mock("@/lib/activity-log", () => ({ logActivity: vi.fn(async () => {}) }));

import { importModelRatesCSV } from "@/server/csv";

async function makeModel(
  orgId: string,
  data: { name: string; sku?: string; modelNumber?: string; dailyRate?: number },
) {
  return testPrisma.model.create({
    data: {
      organizationId: orgId,
      name: data.name,
      sku: data.sku ?? null,
      modelNumber: data.modelNumber ?? null,
      dailyRate: data.dailyRate ?? null,
    },
  });
}

beforeEach(async () => {
  await setupIntegrationTest();
});
afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("importModelRatesCSV", () => {
  it("matches by name and updates rates, syncing defaultRentalPrice from dailyRate", async () => {
    const org = await createOrgFixture();
    h.ctx.organizationId = org.id;
    const model = await makeModel(org.id, { name: "SM58" });

    const csv = "name,dailyRate,weeklyRate,monthlyRate\nSM58,20,80,240";
    const result = await importModelRatesCSV(csv);

    expect(result).toMatchObject({ created: 0, updated: 1 });
    expect(result.errors).toHaveLength(0);

    const updated = await testPrisma.model.findUniqueOrThrow({ where: { id: model.id } });
    expect(Number(updated.dailyRate)).toBe(20);
    expect(Number(updated.weeklyRate)).toBe(80);
    expect(Number(updated.monthlyRate)).toBe(240);
    expect(Number(updated.defaultRentalPrice)).toBe(20);
  });

  it("matches by sku and applies a partial update, leaving blank rates unchanged", async () => {
    const org = await createOrgFixture();
    h.ctx.organizationId = org.id;
    const model = await makeModel(org.id, { name: "QSC", sku: "SKU-9", dailyRate: 15 });

    const csv = "sku,weeklyRate\nSKU-9,60";
    const result = await importModelRatesCSV(csv);

    expect(result.updated).toBe(1);
    const updated = await testPrisma.model.findUniqueOrThrow({ where: { id: model.id } });
    expect(Number(updated.weeklyRate)).toBe(60);
    expect(Number(updated.dailyRate)).toBe(15); // untouched
  });

  it("reports ambiguous name matches without updating", async () => {
    const org = await createOrgFixture();
    h.ctx.organizationId = org.id;
    await makeModel(org.id, { name: "Dup", sku: "A" });
    await makeModel(org.id, { name: "Dup", sku: "B" });

    const csv = "name,dailyRate\nDup,30";
    const result = await importModelRatesCSV(csv);

    expect(result.updated).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("matches 2 models");
  });

  it("reports unknown identifiers and negative rates as row errors", async () => {
    const org = await createOrgFixture();
    h.ctx.organizationId = org.id;
    await makeModel(org.id, { name: "Real" });

    const csv = "name,dailyRate\nGhost,30\nReal,-5";
    const result = await importModelRatesCSV(csv);

    expect(result.updated).toBe(0);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].message).toContain("not found");
    expect(result.errors[1].message.toLowerCase()).toContain("negative");
  });

  it("never creates models", async () => {
    const org = await createOrgFixture();
    h.ctx.organizationId = org.id;
    await makeModel(org.id, { name: "Only" });

    const csv = "name,dailyRate\nDoesNotExist,99";
    await importModelRatesCSV(csv);

    const count = await testPrisma.model.count({ where: { organizationId: org.id } });
    expect(count).toBe(1);
  });

  it("throws when no rate column is present", async () => {
    const org = await createOrgFixture();
    h.ctx.organizationId = org.id;
    await expect(importModelRatesCSV("name,category\nSM58,Audio")).rejects.toThrow(/rate column/);
  });

  it("does not touch models in another organization", async () => {
    const orgA = await createOrgFixture({ slug: "a" });
    const orgB = await createOrgFixture({ slug: "b" });
    const other = await makeModel(orgB.id, { name: "Shared", dailyRate: 5 });
    h.ctx.organizationId = orgA.id;

    const csv = "name,dailyRate\nShared,99";
    const result = await importModelRatesCSV(csv);

    expect(result.updated).toBe(0);
    expect(result.errors[0].message).toContain("not found");
    const unchanged = await testPrisma.model.findUniqueOrThrow({ where: { id: other.id } });
    expect(Number(unchanged.dailyRate)).toBe(5);
  });
});
