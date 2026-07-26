// @vitest-environment node
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const actor = { userId: USER, userName: "Alice" };
const asUser = { subject: USER, orgId: ORG, role: "manager" };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}
async function seed(t: T, role = "manager") {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role });
    await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
    await ctx.db.insert("models", { id: "model1", organizationId: ORG, name: "Moving Light" });
  });
}
const scheduleDoc = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("serviceSchedules").withIndex("by_cuid", (q) => q.eq("id", id)).first());

const baseCreate = {
  orgId: ORG, id: "sched1", modelId: "model1", name: "6-month service",
  intervalMonths: 6, anchorDate: NOW, now: NOW, actor, auditId: "a1",
};

describe("serviceSchedulesWrites.createNative", () => {
  test("creates a schedule", async () => {
    const t = makeT(); await seed(t);
    const res = await t.withIdentity(asUser).mutation(api.serviceSchedulesWrites.createNative, baseCreate);
    expect(res.id).toBe("sched1");
    const doc = await scheduleDoc(t, "sched1");
    expect(doc?.intervalMonths).toBe(6);
    expect(doc?.isActive).toBe(true);
  });

  test("rejects a cross-org model reference", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { await ctx.db.insert("models", { id: "foreignModel", organizationId: OTHER, name: "x" }); });
    await expect(
      t.withIdentity(asUser).mutation(api.serviceSchedulesWrites.createNative, { ...baseCreate, modelId: "foreignModel" }),
    ).rejects.toThrow(/not found/i);
  });

  test("rejects intervalMonths < 1", async () => {
    const t = makeT(); await seed(t);
    await expect(
      t.withIdentity(asUser).mutation(api.serviceSchedulesWrites.createNative, { ...baseCreate, intervalMonths: 0 }),
    ).rejects.toThrow(/intervalMonths/);
  });

  test("viewer is denied (no maintenance:create)", async () => {
    const t = makeT(); await seed(t, "viewer");
    await expect(
      t.withIdentity({ subject: USER, orgId: ORG, role: "viewer" }).mutation(api.serviceSchedulesWrites.createNative, baseCreate),
    ).rejects.toThrow(/Forbidden|permission/i);
  });
});

describe("serviceSchedulesWrites.updateNative", () => {
  test("updates cadence/name/instructions, leaves modelId alone", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asUser).mutation(api.serviceSchedulesWrites.createNative, baseCreate);
    await t.withIdentity(asUser).mutation(api.serviceSchedulesWrites.updateNative, {
      orgId: ORG, id: "sched1", name: "Annual service", intervalMonths: 12, anchorDate: NOW,
      instructions: "Check bulbs", now: NOW + 1, actor, auditId: "a2",
    });
    const doc = await scheduleDoc(t, "sched1");
    expect(doc?.name).toBe("Annual service");
    expect(doc?.intervalMonths).toBe(12);
    expect(doc?.instructions).toBe("Check bulbs");
    expect(doc?.modelId).toBe("model1");
  });

  test("rejects a cross-org schedule", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("serviceSchedules", { id: "foreign", organizationId: OTHER, modelId: "model1", name: "x", intervalMonths: 1, anchorDate: NOW });
    });
    await expect(
      t.withIdentity(asUser).mutation(api.serviceSchedulesWrites.updateNative, {
        orgId: ORG, id: "foreign", name: "y", intervalMonths: 1, anchorDate: NOW, now: NOW, actor, auditId: "a2",
      }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("serviceSchedulesWrites.deactivateNative", () => {
  // deactivateNative gates on maintenance:delete — manager doesn't have delete
  // (only owner/admin do, see permissionsCore.ts), so this describe uses admin.
  const asAdmin = { subject: USER, orgId: ORG, role: "admin" };

  test("soft-deletes (isActive: false), leaves generated cycles untouched", async () => {
    const t = makeT(); await seed(t, "admin");
    await t.withIdentity(asAdmin).mutation(api.serviceSchedulesWrites.createNative, baseCreate);
    await t.run(async (ctx) => {
      await ctx.db.insert("maintenanceRecords", {
        id: "cyc1", organizationId: ORG, type: "PREVENTATIVE", status: "SCHEDULED",
        title: "cycle", serviceScheduleId: "sched1", poolQuantitySnapshot: 1, createdAt: NOW, updatedAt: NOW,
      });
    });
    await t.withIdentity(asAdmin).mutation(api.serviceSchedulesWrites.deactivateNative, {
      orgId: ORG, id: "sched1", now: NOW + 1, actor, auditId: "a3",
    });
    const doc = await scheduleDoc(t, "sched1");
    expect(doc?.isActive).toBe(false);
    const cyc = await t.run(async (ctx) => ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", "cyc1")).unique());
    expect(cyc?.status).toBe("SCHEDULED"); // untouched
  });
});
