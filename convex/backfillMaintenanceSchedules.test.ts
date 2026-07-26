// @vitest-environment node
import { convexTest, type TestConvex } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };

function makeT(): T {
  return convexTest(schema, modules);
}

const schedulesFor = (t: T, modelId: string) =>
  t.run(async (ctx) => ctx.db.query("serviceSchedules").withIndex("by_modelId", (q) => q.eq("modelId", modelId)).collect());

describe("backfillMaintenanceSchedulesPage — WS6 #945 migrate", () => {
  test("seeds one schedule per model with a positive maintenanceIntervalDays, days -> nearest month", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "Moving Light", maintenanceIntervalDays: 180 });
      await ctx.db.insert("models", { id: "m2", organizationId: ORG, name: "Cable", maintenanceIntervalDays: 365 });
      await ctx.db.insert("models", { id: "m3", organizationId: ORG, name: "No interval" }); // absent -> skipped
      await ctx.db.insert("models", { id: "m4", organizationId: ORG, name: "Zero interval", maintenanceIntervalDays: 0 }); // 0 -> skipped
    });

    const dry = await t.withIdentity(SERVICE).mutation(api.backfillMaintenanceSchedules.backfillMaintenanceSchedulesPage, { cursor: null, apply: false, now: NOW });
    expect(dry.scanned).toBe(2);
    expect(dry.created).toBe(0);
    expect(await schedulesFor(t, "m1")).toHaveLength(0); // dry-run wrote nothing

    const applied = await t.withIdentity(SERVICE).mutation(api.backfillMaintenanceSchedules.backfillMaintenanceSchedulesPage, { cursor: null, apply: true, now: NOW });
    expect(applied.created).toBe(2);

    const s1 = (await schedulesFor(t, "m1"))[0];
    expect(s1.intervalMonths).toBe(6); // 180 days -> 6 months
    expect(s1.anchorDate).toBe(NOW);
    expect(s1.isActive).toBe(true);

    const s2 = (await schedulesFor(t, "m2"))[0];
    expect(s2.intervalMonths).toBe(12); // 365 days -> 12 months

    expect(await schedulesFor(t, "m3")).toHaveLength(0);
    expect(await schedulesFor(t, "m4")).toHaveLength(0);
  });

  test("idempotent — re-running does not duplicate an already-backfilled model", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "Moving Light", maintenanceIntervalDays: 180 });
    });
    await t.withIdentity(SERVICE).mutation(api.backfillMaintenanceSchedules.backfillMaintenanceSchedulesPage, { cursor: null, apply: true, now: NOW });
    const again = await t.withIdentity(SERVICE).mutation(api.backfillMaintenanceSchedules.backfillMaintenanceSchedulesPage, { cursor: null, apply: true, now: NOW });
    expect(again.created).toBe(0);
    expect(await schedulesFor(t, "m1")).toHaveLength(1);
  });

  test("skips a model that already has a manually-created schedule", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "Moving Light", maintenanceIntervalDays: 180 });
      await ctx.db.insert("serviceSchedules", {
        id: "existing", organizationId: ORG, modelId: "m1", name: "Manual", intervalMonths: 3, anchorDate: NOW,
      });
    });
    const res = await t.withIdentity(SERVICE).mutation(api.backfillMaintenanceSchedules.backfillMaintenanceSchedulesPage, { cursor: null, apply: true, now: NOW });
    expect(res.created).toBe(0);
    expect(await schedulesFor(t, "m1")).toHaveLength(1);
  });
});
