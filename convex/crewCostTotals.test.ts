// @vitest-environment node
//
// UX Phase 15 ruling: a total that INCLUDES crew cost is pay-shaped. Below the
// pay line (the ONE rule, `canSeeCrewPay`) it is ABSENT — never reduced — so no
// crew number can be back-solved: a service's `costTotal`, the project's
// `serviceCostTotal` / `labourCostTotal` / `margin`, the same fields inside a
// snapshot entry, and `projectCosts.operationalCosts` (the all-zero EMPTY shape,
// its stable contract). A manager sees them all.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1", USER = "user_1", KEY = "key_1";
const asUser = { subject: USER, orgId: ORG };
const asAgent = { subject: USER, orgId: ORG, akid: KEY };
const NOW = 1_700_000_000_000;

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

async function seed(t: T, role: string, key?: { noFinancials: boolean }) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role });
    await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
    if (key) {
      await ctx.db.insert("apiKeys", {
        id: KEY, organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h",
        scopes: JSON.stringify(["*"]), isActive: true, actingUserId: USER, createdById: USER, noFinancials: key.noFinancials,
      });
    }
    await ctx.db.insert("projects", {
      id: "p1", organizationId: ORG, projectNumber: "2341", name: "Launch", status: "CONFIRMED", isTemplate: false, liveVersionId: "v1",
      total: 5000, subtotal: 4545, serviceCostTotal: 650, labourCostTotal: 300, margin: 4050, equipmentRevenue: 4000,
    } as never);
    await ctx.db.insert("projectVersions", { id: "v1", organizationId: ORG, projectId: "p1", number: 1, contentState: "ready", createdAt: NOW, createdById: USER } as never);
    await ctx.db.insert("projectServices", { id: "s1", organizationId: ORG, projectId: "p1", versionId: "v1", type: "LABOUR", title: "Rig", costTotal: 650, lineTotal: 900 } as never);
    await ctx.db.insert("crewMembers", { id: "c1", organizationId: ORG, firstName: "Bob", lastName: "Ryan", isActive: true });
    await ctx.db.insert("crewAssignments", { id: "a1", organizationId: ORG, projectId: "p1", crewMemberId: "c1", serviceId: "s1", status: "OFFERED", estimatedCost: 650, rateOverride: 650, responseToken: "tok" } as never);
  });
}

const reads = async (t: T, who = asUser) => {
  const c = t.withIdentity(who);
  const project = (await c.query(api.projects.getById, { id: "p1" })) as Record<string, unknown>;
  const list = (await c.query(api.projects.list, { orgId: ORG }))[0] as Record<string, unknown>;
  const page = (await c.query(api.projects.listPage, { orgId: ORG })).items[0] as Record<string, unknown>;
  const byIds = (await c.query(api.projects.listByIds, { orgId: ORG, ids: ["p1"] }))[0] as Record<string, unknown>;
  const service = (await c.query(api.projectServices.listByProject, { projectId: "p1", orgId: ORG }))[0] as Record<string, unknown>;
  const costs = await c.query(api.projectCosts.operationalCosts, { projectId: "p1", orgId: ORG });
  const entries = await c.query(api.projectLocksRead.currentEntries, { projectId: "p1", orgId: ORG });
  return { project, list, page, byIds, service, costs, entries };
};
const CREW_COST = ["serviceCostTotal", "labourCostTotal", "margin"];

describe("totals that include crew cost follow the one pay rule", () => {
  test("a member (below the pay line): every crew-cost total is ABSENT; the rest of each row stays", async () => {
    const t = makeT(); await seed(t, "member");
    const r = await reads(t);
    for (const row of [r.project, r.list, r.page, r.byIds]) {
      for (const f of CREW_COST) expect(row, f).not.toHaveProperty(f);
      expect(row).toMatchObject({ total: 5000, equipmentRevenue: 4000 });
    }
    expect(r.service).not.toHaveProperty("costTotal");
    expect(r.service).toMatchObject({ lineTotal: 900 });
    expect(r.costs).toMatchObject({ labourCostTotal: 0, serviceCostTotal: 0, netMargin: 0, total: 0 }); // the EMPTY shape
    const projectEntry = r.entries.find((e) => e.entityType === "project")!.data as Record<string, unknown>;
    for (const f of CREW_COST) expect(projectEntry, f).not.toHaveProperty(f);
    expect((r.entries.find((e) => e.entityType === "service")!.data as Record<string, unknown>)).not.toHaveProperty("costTotal");
  });

  test("a noFinancials key, even as an owner, gets none; a manager gets them all", async () => {
    const ta = makeT(); await seed(ta, "owner", { noFinancials: true });
    const a = await reads(ta, asAgent);
    expect(a.project).not.toHaveProperty("margin");
    expect(a.service).not.toHaveProperty("costTotal");
    const tm = makeT(); await seed(tm, "manager");
    const m = await reads(tm);
    expect(m.project).toMatchObject({ serviceCostTotal: 650, labourCostTotal: 300, margin: 4050 });
    expect(m.service).toMatchObject({ costTotal: 650 });
    expect(m.costs).toMatchObject({ labourCostTotal: 300, serviceCostTotal: 650, total: 5000 });
  });

  test("a snapshot entry never carries a crew call's responseToken, and its cost only with crew pay", async () => {
    const t = makeT(); await seed(t, "manager");
    const asg = (await reads(t)).entries.find((e) => e.entityType === "crewAssignment")!;
    expect(asg.data).not.toHaveProperty("responseToken");
    expect(asg.data).toMatchObject({ estimatedCost: 650 });
    const tm = makeT(); await seed(tm, "member");
    const masg = (await reads(tm)).entries.find((e) => e.entityType === "crewAssignment")!;
    expect(masg.data).not.toHaveProperty("responseToken");
    expect(masg.data).not.toHaveProperty("estimatedCost");
    expect(masg.data).not.toHaveProperty("rateOverride");
  });

  test("below the pay line a crew-cost total can't be a sort key either", async () => {
    const t = makeT(); await seed(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p2", organizationId: ORG, projectNumber: "2342", name: "Zed", status: "CONFIRMED", isTemplate: false, margin: 1, rentalStartDate: NOW - 1 } as never);
      const p1 = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      await ctx.db.patch(p1!._id, { rentalStartDate: NOW });
    });
    const c = t.withIdentity(asUser);
    const byMargin = (await c.query(api.projects.listPage, { orgId: ORG, sortBy: "margin", sortOrder: "asc" })).items.map((p) => p.id);
    const byDefault = (await c.query(api.projects.listPage, { orgId: ORG, sortOrder: "asc" })).items.map((p) => p.id);
    expect(byMargin).toEqual(byDefault);
  });

  test("a service save by a caller below the pay line keeps the stored costTotal (the form read none)", async () => {
    const t = makeT(); await seed(t, "member");
    await t.withIdentity(asUser).mutation(api.projectServicesWrites.updateServiceNative, {
      id: "s1", orgId: ORG, type: "MISC", title: "Rig", showOnDocuments: true, quantity: 1, taxable: true, now: NOW, actor: { userId: USER, userName: "Alice" }, auditId: "u1",
    });
    const s = await t.run(async (ctx) => ctx.db.query("projectServices").withIndex("by_cuid", (q) => q.eq("id", "s1")).first());
    expect(s?.costTotal).toBe(650);
  });
});
