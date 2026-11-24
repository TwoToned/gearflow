// @vitest-environment node
//
// convex/dashboardStats.ts — `maintenanceDue` is the Maintenance page's Overdue
// tile (UX Phase 11 review: one overdue rule, every record counted, schedule
// cycles included, as the page counts them); WS6 #945's `modelsDueForService`
// is the separate, model-level count of overdue schedule-generated cycles.
import { convexTest, type TestConvex } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { maintenanceTileCounts } from "./lib/maintenanceOpen";

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

describe("dashboardStats.bundle — maintenanceDue (the page's Overdue tile) and WS6 modelsDueForService", () => {
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

  test("maintenanceDue IS the Maintenance page's Overdue tile (ONE rule: held work isn't late, schedule cycles count)", async () => {
    const t = makeT(); await seed(t);
    const rows = [
      { id: "s", status: "SCHEDULED", scheduledDate: NOW - 1000 },
      { id: "i", status: "IN_PROGRESS", scheduledDate: NOW - 5000 },
      { id: "now", status: "SCHEDULED", scheduledDate: NOW },
      { id: "later", status: "SCHEDULED", scheduledDate: NOW + 1000 },
      { id: "p", status: "AWAITING_PARTS", scheduledDate: NOW - 1000 },
      { id: "q", status: "QA", scheduledDate: NOW - 1000 },
      { id: "d", status: "COMPLETED", scheduledDate: NOW - 1000 },
      { id: "x", status: undefined, scheduledDate: NOW - 1000 },
      { id: "cyc", status: "SCHEDULED", scheduledDate: NOW - 1000, serviceScheduleId: "sched1" },
    ] as const;
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "model1", organizationId: ORG, name: "Moving Light" });
      await ctx.db.insert("serviceSchedules", { id: "sched1", organizationId: ORG, modelId: "model1", name: "6mo", intervalMonths: 6, anchorDate: NOW });
      for (const r of rows) {
        await ctx.db.insert("maintenanceRecords", {
          id: r.id, organizationId: ORG, type: "REPAIR", status: r.status, title: r.id, scheduledDate: r.scheduledDate,
          ...("serviceScheduleId" in r ? { serviceScheduleId: r.serviceScheduleId } : {}), createdAt: NOW, updatedAt: NOW,
        });
      }
    });
    // The page's tile, through the function the page renders it with.
    const pageOverdue = maintenanceTileCounts([...rows], NOW, 0).overdue;
    expect(pageOverdue).toBe(3);
    expect((await bundle(t)).maintenanceDue).toBe(pageOverdue);
  });

  test("a schedule-generated overdue PM cycle counts in maintenanceDue (as the page does) AND as a model due for service", async () => {
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
    expect(res.maintenanceDue).toBe(1);
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
