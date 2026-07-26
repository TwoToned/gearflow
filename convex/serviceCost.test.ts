// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { recalcServiceChargeFromCrew } from "./lib/serviceCost";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function makeT() {
  return convexTest(schema, modules);
}
type T = ReturnType<typeof makeT>;

const svcById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("projectServices").withIndex("by_cuid", (q) => q.eq("id", id)).first());

/**
 * recalcServiceChargeFromCrew (WS10 #949) — the charge-side twin of
 * recalcServiceCostFromCrew. Calling it directly via t.run (mirrors
 * recalc.test.ts's style) instead of going through a full mutation, since this is
 * unit-testing the pure recalc helper's behaviour, not the RBAC/audit plumbing
 * around it (that's covered in crewAssignmentsWrites.test.ts /
 * projectServicesWrites.test.ts, which call it indirectly).
 */
describe("recalcServiceChargeFromCrew", () => {
  test("sums resolved charge rate across assignments (role.chargeRate, no override)", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectServices", {
        id: "s1", organizationId: ORG, projectId: "p1", type: "LABOUR", title: "Show day",
        quantity: 1, taxable: true,
      });
      await ctx.db.insert("crewRoles", { id: "r1", organizationId: ORG, name: "Tech", chargeRate: 100, rateType: "DAILY" });
      await ctx.db.insert("crewAssignments", {
        id: "a1", organizationId: ORG, projectId: "p1", crewMemberId: "cm1", serviceId: "s1",
        crewRoleId: "r1", startDate: NOW, endDate: NOW,
      });
      await ctx.db.insert("crewAssignments", {
        id: "a2", organizationId: ORG, projectId: "p1", crewMemberId: "cm2", serviceId: "s1",
        crewRoleId: "r1", startDate: NOW, endDate: NOW,
      });
    });
    await t.run((ctx) => recalcServiceChargeFromCrew(ctx, "s1", ORG, NOW));
    const s = await svcById(t, "s1");
    expect(s?.crewChargeTotal).toBe(200); // 100 + 100
    expect(s?.lineTotal).toBe(200); // no unitPrice, no discount -> auto-priced
  });

  test("chargeRateOverride wins over role.chargeRate", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectServices", {
        id: "s1", organizationId: ORG, projectId: "p1", type: "LABOUR", title: "Show day",
        quantity: 1, taxable: true, chargeRateOverride: 150,
      });
      await ctx.db.insert("crewRoles", { id: "r1", organizationId: ORG, name: "Tech", chargeRate: 100, rateType: "DAILY" });
      await ctx.db.insert("crewAssignments", {
        id: "a1", organizationId: ORG, projectId: "p1", crewMemberId: "cm1", serviceId: "s1",
        crewRoleId: "r1", startDate: NOW, endDate: NOW,
      });
    });
    await t.run((ctx) => recalcServiceChargeFromCrew(ctx, "s1", ORG, NOW));
    const s = await svcById(t, "s1");
    expect(s?.crewChargeTotal).toBe(150);
  });

  test("manual unitPrice protection — a typed price never gets clobbered by crewChargeTotal", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectServices", {
        id: "s1", organizationId: ORG, projectId: "p1", type: "LABOUR", title: "Show day",
        quantity: 1, taxable: true, unitPrice: 500, lineTotal: 500,
      });
      await ctx.db.insert("crewRoles", { id: "r1", organizationId: ORG, name: "Tech", chargeRate: 100, rateType: "DAILY" });
      await ctx.db.insert("crewAssignments", {
        id: "a1", organizationId: ORG, projectId: "p1", crewMemberId: "cm1", serviceId: "s1",
        crewRoleId: "r1", startDate: NOW, endDate: NOW,
      });
    });
    await t.run((ctx) => recalcServiceChargeFromCrew(ctx, "s1", ORG, NOW));
    const s = await svcById(t, "s1");
    // crewChargeTotal still computed (for margin display) but lineTotal is untouched.
    expect(s?.crewChargeTotal).toBe(100);
    expect(s?.lineTotal).toBe(500);
  });

  test("discount reduces the auto-priced lineTotal, clamped at 0", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectServices", {
        id: "s1", organizationId: ORG, projectId: "p1", type: "LABOUR", title: "Show day",
        quantity: 1, taxable: true, discount: 30,
      });
      await ctx.db.insert("crewRoles", { id: "r1", organizationId: ORG, name: "Tech", chargeRate: 100, rateType: "DAILY" });
      await ctx.db.insert("crewAssignments", {
        id: "a1", organizationId: ORG, projectId: "p1", crewMemberId: "cm1", serviceId: "s1",
        crewRoleId: "r1", startDate: NOW, endDate: NOW,
      });
    });
    await t.run((ctx) => recalcServiceChargeFromCrew(ctx, "s1", ORG, NOW));
    expect((await svcById(t, "s1"))?.lineTotal).toBe(70); // 100 - 30
  });

  test("no charge rate configured anywhere — crewChargeTotal + auto lineTotal stay unset, not a fake $0", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectServices", {
        id: "s1", organizationId: ORG, projectId: "p1", type: "LABOUR", title: "Show day",
        quantity: 1, taxable: true,
      });
      await ctx.db.insert("crewRoles", { id: "r1", organizationId: ORG, name: "Tech" }); // no chargeRate
      await ctx.db.insert("crewAssignments", {
        id: "a1", organizationId: ORG, projectId: "p1", crewMemberId: "cm1", serviceId: "s1",
        crewRoleId: "r1", startDate: NOW, endDate: NOW,
      });
    });
    await t.run((ctx) => recalcServiceChargeFromCrew(ctx, "s1", ORG, NOW));
    const s = await svcById(t, "s1");
    expect(s?.crewChargeTotal).toBeUndefined();
    expect(s?.lineTotal).toBeUndefined();
  });

  test("crew-less service is left entirely untouched (no crew -> early return)", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectServices", {
        id: "s1", organizationId: ORG, projectId: "p1", type: "MISC", title: "Truck",
        quantity: 1, taxable: true, unitPrice: 80, lineTotal: 80,
      });
    });
    await t.run((ctx) => recalcServiceChargeFromCrew(ctx, "s1", ORG, NOW));
    const s = await svcById(t, "s1");
    expect(s?.lineTotal).toBe(80);
    expect(s?.crewChargeTotal).toBeUndefined();
  });

  test("HOURLY rateType parity — charge total uses estimatedHours like the cost twin", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projectServices", {
        id: "s1", organizationId: ORG, projectId: "p1", type: "LABOUR", title: "Load in",
        quantity: 1, taxable: true,
      });
      await ctx.db.insert("crewRoles", { id: "r1", organizationId: ORG, name: "Rigger", chargeRate: 60, rateType: "HOURLY" });
      await ctx.db.insert("crewAssignments", {
        id: "a1", organizationId: ORG, projectId: "p1", crewMemberId: "cm1", serviceId: "s1",
        crewRoleId: "r1", estimatedHours: 6,
      });
    });
    await t.run((ctx) => recalcServiceChargeFromCrew(ctx, "s1", ORG, NOW));
    expect((await svcById(t, "s1"))?.crewChargeTotal).toBe(360); // 60 * 6
  });

  test("multi-day DAILY span parity — charge total counts days inclusive like the cost twin", async () => {
    const t = makeT();
    const start = NOW;
    const end = NOW + 2 * DAY; // 3 days inclusive
    await t.run(async (ctx) => {
      await ctx.db.insert("projectServices", {
        id: "s1", organizationId: ORG, projectId: "p1", type: "LABOUR", title: "Bump in/out",
        quantity: 1, taxable: true,
      });
      await ctx.db.insert("crewRoles", { id: "r1", organizationId: ORG, name: "Rigger", chargeRate: 100, rateType: "DAILY" });
      await ctx.db.insert("crewAssignments", {
        id: "a1", organizationId: ORG, projectId: "p1", crewMemberId: "cm1", serviceId: "s1",
        crewRoleId: "r1", startDate: start, endDate: end,
      });
    });
    await t.run((ctx) => recalcServiceChargeFromCrew(ctx, "s1", ORG, NOW));
    expect((await svcById(t, "s1"))?.crewChargeTotal).toBe(300); // 100 * 3 days
  });
});
