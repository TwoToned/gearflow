// @vitest-environment node
//
// convex/dashboardStats.ts — WS6 #945: schedule-generated PM cycles must be
// EXCLUDED from the legacy `maintenanceDue` count (they get their own
// `modelsDueForService` chip) so the two dashboard signals never double-count
// the same underlying work.
import { convexTest, type TestConvex } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const USER = "user_1";
const NOW = Date.UTC(2026, 6, 1);
const asUser = { subject: USER, orgId: ORG, role: "member" };

function makeT(): T {
  return convexTest(schema, modules);
}
async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "member" });
  });
}
const bundle = (t: T) => t.withIdentity(asUser).query(api.dashboardStats.bundle, { orgId: ORG, now: NOW });

describe("dashboardStats.bundle — WS6 maintenanceDue exclusion", () => {
  test("an ad-hoc (non-schedule) due REPAIR record counts toward maintenanceDue", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("maintenanceRecords", {
        id: "rec1", organizationId: ORG, type: "REPAIR", status: "SCHEDULED", title: "fix",
        scheduledDate: NOW - 1000, createdAt: NOW, updatedAt: NOW,
      });
    });
    const res = await bundle(t);
    expect(res.maintenanceDue).toBe(1);
    expect(res.modelsDueForService).toBe(0);
  });

  test("a schedule-generated due PM cycle counts toward modelsDueForService, NOT maintenanceDue", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "model1", organizationId: ORG, name: "Moving Light" });
      await ctx.db.insert("serviceSchedules", { id: "sched1", organizationId: ORG, modelId: "model1", name: "6mo", intervalMonths: 6, anchorDate: NOW });
      await ctx.db.insert("maintenanceRecords", {
        id: "cyc1", organizationId: ORG, type: "PREVENTATIVE", status: "SCHEDULED", title: "6mo — Moving Light",
        scheduledDate: NOW - 1000, serviceScheduleId: "sched1", poolQuantitySnapshot: 5, createdAt: NOW, updatedAt: NOW,
      });
    });
    const res = await bundle(t);
    expect(res.maintenanceDue).toBe(0);
    expect(res.modelsDueForService).toBe(1);
  });

  test("two due schedules on the SAME model count as one model, not two", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "model1", organizationId: ORG, name: "Moving Light" });
      await ctx.db.insert("serviceSchedules", { id: "sched1", organizationId: ORG, modelId: "model1", name: "90-day clean", intervalMonths: 3, anchorDate: NOW });
      await ctx.db.insert("serviceSchedules", { id: "sched2", organizationId: ORG, modelId: "model1", name: "annual service", intervalMonths: 12, anchorDate: NOW });
      await ctx.db.insert("maintenanceRecords", {
        id: "cyc1", organizationId: ORG, type: "PREVENTATIVE", status: "SCHEDULED", title: "90-day — Moving Light",
        scheduledDate: NOW - 1000, serviceScheduleId: "sched1", poolQuantitySnapshot: 5, createdAt: NOW, updatedAt: NOW,
      });
      await ctx.db.insert("maintenanceRecords", {
        id: "cyc2", organizationId: ORG, type: "PREVENTATIVE", status: "SCHEDULED", title: "annual — Moving Light",
        scheduledDate: NOW - 1000, serviceScheduleId: "sched2", poolQuantitySnapshot: 5, createdAt: NOW, updatedAt: NOW,
      });
    });
    const res = await bundle(t);
    expect(res.modelsDueForService).toBe(1);
  });

  test("a schedule-generated cycle NOT yet due does not count toward either tile", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "model1", organizationId: ORG, name: "Moving Light" });
      await ctx.db.insert("serviceSchedules", { id: "sched1", organizationId: ORG, modelId: "model1", name: "6mo", intervalMonths: 6, anchorDate: NOW });
      await ctx.db.insert("maintenanceRecords", {
        id: "cyc1", organizationId: ORG, type: "PREVENTATIVE", status: "SCHEDULED", title: "6mo — Moving Light",
        scheduledDate: NOW + 100_000, serviceScheduleId: "sched1", poolQuantitySnapshot: 5, createdAt: NOW, updatedAt: NOW,
      });
    });
    const res = await bundle(t);
    expect(res.maintenanceDue).toBe(0);
    expect(res.modelsDueForService).toBe(0);
  });
});
