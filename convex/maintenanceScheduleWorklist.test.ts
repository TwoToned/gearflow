// @vitest-environment node
import { convexTest, type TestConvex } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const USER = "user_1";
const NOW = Date.UTC(2026, 2, 15);
const asUser = { subject: USER, orgId: ORG, role: "warehouse" };

function makeT(): T {
  return convexTest(schema, modules);
}
async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "warehouse" });
  });
}

describe("maintenanceScheduleWorklist.dueWorklist", () => {
  test("an overdue serialized cycle shows per-unit rows with checked-off state", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "model1", organizationId: ORG, name: "Moving Light", assetType: "SERIALIZED" });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, assetTag: "MOV-1", modelId: "model1", status: "AVAILABLE", isActive: true });
      await ctx.db.insert("assets", { id: "a2", organizationId: ORG, assetTag: "MOV-2", modelId: "model1", status: "AVAILABLE", isActive: true });
      await ctx.db.insert("serviceSchedules", { id: "sched1", organizationId: ORG, modelId: "model1", name: "6mo", intervalMonths: 6, anchorDate: NOW });
      await ctx.db.insert("maintenanceRecords", {
        id: "cyc1", organizationId: ORG, type: "PREVENTATIVE", status: "SCHEDULED", title: "6mo — Moving Light",
        scheduledDate: NOW - 5 * 24 * 60 * 60 * 1000, serviceScheduleId: "sched1", poolQuantitySnapshot: 2, createdAt: NOW, updatedAt: NOW,
      });
      await ctx.db.insert("maintenanceRecordAssets", { id: "co1", maintenanceRecordId: "cyc1", assetId: "a1", kind: "CHECKOFF", completedAt: NOW, completedById: USER });
    });

    const res = await t.withIdentity(asUser).query(api.maintenanceScheduleWorklist.dueWorklist, { orgId: ORG, nowMs: NOW });
    expect(res.stats.overdue).toBe(1);
    expect(res.sections).toHaveLength(1);
    const section = res.sections[0] as { isBulk: boolean; units: { assetId: string; checkedOff: boolean }[]; progress: number; poolQuantitySnapshot: number };
    expect(section.isBulk).toBe(false);
    expect(section.progress).toBe(1);
    expect(section.poolQuantitySnapshot).toBe(2);
    expect(section.units).toHaveLength(2);
    expect(section.units.find((u) => u.assetId === "a1")?.checkedOff).toBe(true);
    expect(section.units.find((u) => u.assetId === "a2")?.checkedOff).toBe(false);
  });

  test("a not-yet-due bulk cycle shows in dueSoon with session progress", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "model2", organizationId: ORG, name: "XLR Cable", assetType: "BULK" });
      await ctx.db.insert("bulkAssets", { id: "bulk1", organizationId: ORG, modelId: "model2", assetTag: "XLR-10M", totalQuantity: 120, availableQuantity: 120, isActive: true });
      await ctx.db.insert("serviceSchedules", { id: "sched2", organizationId: ORG, modelId: "model2", name: "annual", intervalMonths: 12, anchorDate: NOW });
      await ctx.db.insert("maintenanceRecords", {
        id: "cyc2", organizationId: ORG, type: "PREVENTATIVE", status: "SCHEDULED", title: "annual — XLR Cable",
        scheduledDate: NOW + 3 * 24 * 60 * 60 * 1000, serviceScheduleId: "sched2", poolQuantitySnapshot: 120, createdAt: NOW, updatedAt: NOW,
      });
      await ctx.db.insert("maintenanceRecordAssets", { id: "sess1", maintenanceRecordId: "cyc2", bulkAssetId: "bulk1", quantity: 18, kind: "CHECKOFF", completedAt: NOW, completedById: USER });
    });

    const res = await t.withIdentity(asUser).query(api.maintenanceScheduleWorklist.dueWorklist, { orgId: ORG, nowMs: NOW });
    expect(res.stats.dueSoon).toBe(1);
    const section = res.sections[0] as { isBulk: boolean; progress: number; bulkAssetId: string | null };
    expect(section.isBulk).toBe(true);
    expect(section.progress).toBe(18);
    expect(section.bulkAssetId).toBe("bulk1");
  });

  test("a completed cycle with no new one generated yet produces no section", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "model3", organizationId: ORG, name: "Done model", assetType: "SERIALIZED" });
      await ctx.db.insert("serviceSchedules", { id: "sched3", organizationId: ORG, modelId: "model3", name: "s", intervalMonths: 6, anchorDate: NOW });
      await ctx.db.insert("maintenanceRecords", {
        id: "cyc3", organizationId: ORG, type: "PREVENTATIVE", status: "COMPLETED", result: "PASS", title: "done",
        scheduledDate: NOW - 100, serviceScheduleId: "sched3", poolQuantitySnapshot: 1, createdAt: NOW, updatedAt: NOW,
      });
    });
    const res = await t.withIdentity(asUser).query(api.maintenanceScheduleWorklist.dueWorklist, { orgId: ORG, nowMs: NOW });
    expect(res.sections).toHaveLength(0);
    expect(res.stats.overdue).toBe(0);
  });

  test("an inactive schedule is excluded even with an open cycle", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "model4", organizationId: ORG, name: "Inactive sched model", assetType: "SERIALIZED" });
      await ctx.db.insert("serviceSchedules", { id: "sched4", organizationId: ORG, modelId: "model4", name: "s", intervalMonths: 6, anchorDate: NOW, isActive: false });
      await ctx.db.insert("maintenanceRecords", {
        id: "cyc4", organizationId: ORG, type: "PREVENTATIVE", status: "SCHEDULED", title: "still open",
        scheduledDate: NOW - 100, serviceScheduleId: "sched4", poolQuantitySnapshot: 1, createdAt: NOW, updatedAt: NOW,
      });
    });
    const res = await t.withIdentity(asUser).query(api.maintenanceScheduleWorklist.dueWorklist, { orgId: ORG, nowMs: NOW });
    expect(res.sections).toHaveLength(0);
  });
});
