// @vitest-environment node
//
// The TWO money lines (UX Phase 15; owner ruling 2026-11-24, "anyone with
// invoice read"):
//   - JOB COST — the project's `serviceCostTotal` / `labourCostTotal` /
//     `margin` (also inside a snapshot entry), `projectCosts.operationalCosts`
//     and `crewAssignments.projectLabourCost` — follow `canSeeJobCost`:
//     invoice:read and not a noFinancials key. ABSENT for everyone else (the
//     all-zero EMPTY shape for the two whole-payload reads, their stable contract).
//   - INDIVIDUAL PAY — a service's own crew-rolled `costTotal`, a call's cost —
//     stays behind the pay line (`canSeeCrewPay`: manager+, not noFinancials).
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

async function seed(t: T, role: string, key?: { noFinancials: boolean; scopes?: string[] }) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role });
    await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
    if (key) {
      await ctx.db.insert("apiKeys", {
        id: KEY, organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h",
        scopes: JSON.stringify(key.scopes ?? ["*"]), isActive: true, actingUserId: USER, createdById: USER, noFinancials: key.noFinancials,
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
    await ctx.db.insert("crewAssignments", { id: "a2", organizationId: ORG, projectId: "p1", crewMemberId: "c1", status: "CONFIRMED", estimatedCost: 300 } as never);
  });
}

const reads = async (t: T, who = asUser) => {
  const c = t.withIdentity(who);
  const project = (await c.query(api.projects.getById, { id: "p1" })) as Record<string, unknown>;
  const list = (await c.query(api.projects.list, { orgId: ORG }))[0] as Record<string, unknown>;
  const page = (await c.query(api.projects.listPage, { orgId: ORG })).items[0] as Record<string, unknown>;
  const byIds = (await c.query(api.projects.listByIds, { orgId: ORG, ids: ["p1"] }))[0] as Record<string, unknown>;
  const byNumber = (await c.query(api.projects.getByOrgAndNumber, { organizationId: ORG, projectNumber: "2341" })) as Record<string, unknown>;
  const service = (await c.query(api.projectServices.listByProject, { projectId: "p1", orgId: ORG }))[0] as Record<string, unknown>;
  const costs = await c.query(api.projectCosts.operationalCosts, { projectId: "p1", orgId: ORG });
  const entries = await c.query(api.projectLocksRead.currentEntries, { projectId: "p1", orgId: ORG });
  return { project, list, page, byIds, byNumber, service, costs, entries };
};
const labour = (t: T, who = asUser) => t.withIdentity(who).query(api.crewAssignments.projectLabourCost, { projectId: "p1", orgId: ORG });
const JOB_COST = ["serviceCostTotal", "labourCostTotal", "margin"];
const projectEntry = (r: Awaited<ReturnType<typeof reads>>) => r.entries.find((e) => e.entityType === "project")!.data as Record<string, unknown>;
const serviceEntry = (r: Awaited<ReturnType<typeof reads>>) => r.entries.find((e) => e.entityType === "service")!.data as Record<string, unknown>;

function expectJobCost(r: Awaited<ReturnType<typeof reads>>) {
  for (const row of [r.project, r.list, r.page, r.byIds, r.byNumber, projectEntry(r)]) {
    expect(row).toMatchObject({ serviceCostTotal: 650, labourCostTotal: 300, margin: 4050 });
  }
  expect(r.costs).toMatchObject({ labourCostTotal: 300, serviceCostTotal: 650, total: 5000 });
}
function expectNoJobCost(r: Awaited<ReturnType<typeof reads>>) {
  for (const row of [r.project, r.list, r.page, r.byIds, r.byNumber, projectEntry(r)]) {
    for (const f of JOB_COST) expect(row, f).not.toHaveProperty(f);
    expect(row).toMatchObject({ total: 5000, equipmentRevenue: 4000 }); // the rest of the row stays
  }
  expect(r.costs).toMatchObject({ labourCostTotal: 0, serviceCostTotal: 0, netMargin: 0, total: 0 }); // the EMPTY shape
}
function expectNoIndividualPay(r: Awaited<ReturnType<typeof reads>>) {
  expect(r.service).not.toHaveProperty("costTotal");
  expect(r.service).toMatchObject({ lineTotal: 900 });
  expect(serviceEntry(r)).not.toHaveProperty("costTotal");
  const asg = r.entries.find((e) => e.entityType === "crewAssignment")!.data as Record<string, unknown>;
  for (const f of ["estimatedCost", "rateOverride", "responseToken"]) expect(asg, f).not.toHaveProperty(f);
}

describe("job cost follows invoice:read; individual pay follows the pay line", () => {
  test("a member WITH invoice:read sees job cost and margin on every read — and still no per-person or per-service pay", async () => {
    const t = makeT(); await seed(t, "member");
    const r = await reads(t);
    expectJobCost(r);
    expectNoIndividualPay(r);
    expect(await labour(t)).toEqual({ totalLabourCost: 300, assignmentCount: 1 });
  });

  test("projectLabourCost IS the stored labourCostTotal, never a recompute (a cancelled call's cost can't be back-solved from a difference)", async () => {
    const t = makeT(); await seed(t, "member");
    await t.run(async (ctx) => {
      // recalc counts every unlinked call, CANCELLED included (a logged follow-up): 300 + 777.
      await ctx.db.insert("crewAssignments", { id: "a3", organizationId: ORG, projectId: "p1", crewMemberId: "c1", status: "CANCELLED", estimatedCost: 777 } as never);
      const p1 = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      await ctx.db.patch(p1!._id, { labourCostTotal: 1077 });
    });
    const project = (await t.withIdentity(asUser).query(api.projects.getById, { id: "p1" })) as Record<string, unknown>;
    const l = await labour(t);
    expect(l.totalLabourCost).toBe(project.labourCostTotal); // one number, one source
    expect(l.totalLabourCost).toBe(1077);
  });

  test("a caller without invoice:read (a key scoped to project + crew only, acting as an owner) gets job cost ABSENT", async () => {
    const t = makeT(); await seed(t, "owner", { noFinancials: false, scopes: ["project:read", "crew:read"] });
    const r = await reads(t, asAgent);
    expectNoJobCost(r);
    expect(await labour(t, asAgent)).toEqual({ totalLabourCost: 0, assignmentCount: 0 });
  });

  test("the pay line implies the job-cost line: an owner key with project:* + crew:* but no invoice gets no individual pay and no service costTotal", async () => {
    const t = makeT(); await seed(t, "owner", { noFinancials: false, scopes: ["project:*", "crew:*"] });
    const r = await reads(t, asAgent);
    expectNoJobCost(r);
    expectNoIndividualPay(r); // else job cost could be rebuilt from the services' costTotal and the calls' estimatedCost
    const crew = await t.withIdentity(asAgent).query(api.crewAssignments.projectCrew, { projectId: "p1", orgId: ORG });
    for (const a of crew) for (const f of ["estimatedCost", "rateOverride"]) expect(a, f).not.toHaveProperty(f);
    // The same owner key with the invoice scope too sees pay.
    const ti = makeT(); await seed(ti, "owner", { noFinancials: false, scopes: ["project:*", "crew:*", "invoice:read"] });
    expect((await reads(ti, asAgent)).service).toMatchObject({ costTotal: 650 });
  });

  test("the same key WITH invoice:read sees job cost (the scope is the only difference)", async () => {
    const t = makeT(); await seed(t, "owner", { noFinancials: false, scopes: ["project:read", "crew:read", "invoice:read"] });
    expectJobCost(await reads(t, asAgent));
  });

  test("a noFinancials key, even as an owner with every scope, gets no job cost and no pay", async () => {
    const t = makeT(); await seed(t, "owner", { noFinancials: true });
    const r = await reads(t, asAgent);
    expectNoJobCost(r);
    expectNoIndividualPay(r);
    expect(await labour(t, asAgent)).toEqual({ totalLabourCost: 0, assignmentCount: 0 });
  });

  test("a manager sees job cost AND individual pay", async () => {
    const t = makeT(); await seed(t, "manager");
    const r = await reads(t);
    expectJobCost(r);
    expect(r.service).toMatchObject({ costTotal: 650 });
    expect(serviceEntry(r)).toMatchObject({ costTotal: 650 });
    const asg = r.entries.find((e) => e.entityType === "crewAssignment" && e.entityId === "a1")!.data;
    expect(asg).not.toHaveProperty("responseToken"); // a bearer credential, never
    expect(asg).toMatchObject({ estimatedCost: 650 });
  });

  // The two orders DISAGREE: by margin p1 (4050) comes before p2 (99999); by
  // rentalStartDate p2 (NOW − 1) comes before p1 (NOW). So a caller who can't see
  // margin asking to sort by it must get the date order — honouring it would leak it.
  async function seedTwo(t: T, role: string, key?: { noFinancials: boolean; scopes?: string[] }) {
    await seed(t, role, key);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p2", organizationId: ORG, projectNumber: "2342", name: "Zed", status: "CONFIRMED", isTemplate: false, margin: 99999, rentalStartDate: NOW - 1 } as never);
      const p1 = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      await ctx.db.patch(p1!._id, { rentalStartDate: NOW });
    });
  }
  const order = async (t: T, sortBy?: string, who = asUser) =>
    (await t.withIdentity(who).query(api.projects.listPage, { orgId: ORG, sortOrder: "asc", ...(sortBy ? { sortBy } : {}) })).items.map((p) => p.id);

  test("without job cost a job-cost field can't be a sort key: margin falls back to the date order", async () => {
    const t = makeT(); await seedTwo(t, "owner", { noFinancials: true });
    expect(await order(t, undefined, asAgent)).toEqual(["p2", "p1"]);
    expect(await order(t, "margin", asAgent)).toEqual(["p2", "p1"]);
    expect(await order(t, "labourCostTotal", asAgent)).toEqual(["p2", "p1"]);
  });

  test("a member with invoice:read can sort by margin (the fixture's orders really differ)", async () => {
    const t = makeT(); await seedTwo(t, "member");
    expect(await order(t, "margin")).toEqual(["p1", "p2"]);
    expect(await order(t)).toEqual(["p2", "p1"]);
  });

  test("a create below the pay line can't set a service's costTotal (the form never shows Cost); a manager's can", async () => {
    const base = { orgId: ORG, projectId: "p1", type: "MISC" as const, title: "Truck", showOnDocuments: true, quantity: 1, taxable: true, costTotal: 120, now: NOW, actor: { userId: USER, userName: "Alice" } };
    const svc = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("projectServices").withIndex("by_cuid", (q) => q.eq("id", id)).first());
    const t = makeT(); await seed(t, "member");
    await t.withIdentity(asUser).mutation(api.projectServicesWrites.createServiceNative, { ...base, id: "s9", auditId: "c9" });
    expect((await svc(t, "s9"))?.costTotal).toBeUndefined();
    const tm = makeT(); await seed(tm, "manager");
    await tm.withIdentity(asUser).mutation(api.projectServicesWrites.createServiceNative, { ...base, id: "s9", auditId: "c9" });
    expect((await svc(tm, "s9"))?.costTotal).toBe(120);
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
