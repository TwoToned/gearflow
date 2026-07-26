// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";

/**
 * Integration coverage for the charge-side auto-pricing cascade (WS10 #949),
 * through the REAL browser-direct mutations (createServiceNative/updateServiceNative)
 * rather than calling recalcServiceChargeFromCrew directly (that's serviceCost.test.ts) —
 * this file proves the full write path (RBAC, crew reconcile, recalc, recalcProjectTotals)
 * produces the right end-to-end numbers, in particular the "no new revenue bucket,
 * no double-count" invariant the spec calls out explicitly.
 */
const modules = import.meta.glob("./**/*.ts");
function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
type T = ReturnType<typeof makeT>;

const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const asUser = (orgId: string) => ({ subject: USER, orgId });
const ACTOR = { userId: USER, userName: "Alice" };

async function member(t: T, role: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role });
  });
}

async function seedProject(t: T, id = "p1", status: Doc<"projects">["status"] = "CONFIRMED") {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id, organizationId: ORG, projectNumber: `P-${id}`, name: "Gig", status,
      total: 0,
    });
  });
}

async function seedCrewWithChargeRate(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("crewMembers", { id: "cm1", organizationId: ORG, firstName: "Bob", lastName: "Roe", status: "ACTIVE" });
    await ctx.db.insert("crewRoles", { id: "cr1", organizationId: ORG, name: "Tech", chargeRate: 200, rateType: "FLAT" });
  });
}

const svcById = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("projectServices").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const projById = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first());

const baseInput = { type: "LABOUR" as const, title: "Show day", showOnDocuments: true, quantity: 1, taxable: true, crewRoleId: "cr1" };

describe("charge cascade — createServiceNative", () => {
  test("auto-prices lineTotal from crew charge rate when unitPrice unset", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await seedCrewWithChargeRate(t);
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
      id: "s1", orgId: ORG, projectId: "p1", ...baseInput,
      crew: [{ id: "a1", crewMemberId: "cm1" }],
      now: NOW, actor: ACTOR, auditId: "log1",
    });
    const s = await svcById(t, "s1");
    expect(s?.crewChargeTotal).toBe(200);
    expect(s?.lineTotal).toBe(200);
  });

  test("revenue non-double-count: an auto-priced LABOUR service contributes exactly once via serviceRevenue", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await seedCrewWithChargeRate(t);
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
      id: "s1", orgId: ORG, projectId: "p1", ...baseInput,
      crew: [{ id: "a1", crewMemberId: "cm1" }],
      now: NOW, actor: ACTOR, auditId: "log1",
    });
    const project = await projById(t, "p1");
    // subtotal 200 (equipment 0 + service 200) + 10% default tax = 220. No other
    // bucket (labourCostTotal, serviceCostTotal) picks up the CHARGE side at all —
    // only lineTotal flows into serviceRevenue, exactly once.
    expect(project?.total).toBe(220);
  });

  test("manual-override protection: a typed unitPrice survives the crew-driven recalc", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await seedCrewWithChargeRate(t);
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
      id: "s1", orgId: ORG, projectId: "p1", ...baseInput, unitPrice: 999,
      crew: [{ id: "a1", crewMemberId: "cm1" }],
      now: NOW, actor: ACTOR, auditId: "log1",
    });
    const s = await svcById(t, "s1");
    // crewChargeTotal is still tracked (for margin), but lineTotal stays the
    // manually-typed 999 — never silently clobbered by the crew charge rate.
    expect(s?.crewChargeTotal).toBe(200);
    expect(s?.lineTotal).toBe(999);
  });

  test("no charge rate configured anywhere — service stays manually-priced-only, margin hidden", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("crewMembers", { id: "cm1", organizationId: ORG, firstName: "Bob", lastName: "Roe", status: "ACTIVE" });
      await ctx.db.insert("crewRoles", { id: "cr1", organizationId: ORG, name: "Tech" }); // no chargeRate
    });
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
      id: "s1", orgId: ORG, projectId: "p1", ...baseInput,
      crew: [{ id: "a1", crewMemberId: "cm1" }],
      now: NOW, actor: ACTOR, auditId: "log1",
    });
    const s = await svcById(t, "s1");
    expect(s?.crewChargeTotal).toBeUndefined();
    expect(s?.lineTotal).toBeUndefined();
  });
});

describe("charge cascade — updateServiceNative", () => {
  test("clearing a manual unitPrice re-exposes the crew-driven auto price", async () => {
    const t = makeT();
    await member(t, "member");
    // QUOTED (OPEN lock tier, #957) — this test exercises charge-cascade pricing
    // math via updateServiceNative's money-field path, not lifecycle-lock gating.
    await seedProject(t, "p1", "QUOTED");
    await seedCrewWithChargeRate(t);
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
      id: "s1", orgId: ORG, projectId: "p1", ...baseInput, unitPrice: 999,
      crew: [{ id: "a1", crewMemberId: "cm1" }],
      now: NOW, actor: ACTOR, auditId: "log1",
    });
    expect((await svcById(t, "s1"))?.lineTotal).toBe(999);

    // Clear unitPrice (send undefined), crew unchanged (present, same member).
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.updateServiceNative, {
      id: "s1", orgId: ORG, ...baseInput,
      crew: [{ id: "a1", crewMemberId: "cm1" }],
      now: NOW, actor: ACTOR, auditId: "log2",
    });
    const s = await svcById(t, "s1");
    expect(s?.lineTotal).toBe(200); // back to the auto-priced value
  });

  test("chargeRateOverride set on the service wins over the role default", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await seedCrewWithChargeRate(t);
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
      id: "s1", orgId: ORG, projectId: "p1", ...baseInput, chargeRateOverride: 350,
      crew: [{ id: "a1", crewMemberId: "cm1" }],
      now: NOW, actor: ACTOR, auditId: "log1",
    });
    const s = await svcById(t, "s1");
    expect(s?.crewChargeTotal).toBe(350);
    expect(s?.lineTotal).toBe(350);
  });
});
