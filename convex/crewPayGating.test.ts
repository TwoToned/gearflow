// @vitest-environment node
//
// UX Phase 15 (D49): crew pay — timesheet rate/total, assignment rate/cost,
// member default rates — is manager-only, enforced SERVER-side. A caller below
// manager (a `member` holds crew:read) and an API key flagged `noFinancials`
// (even acting as an owner) get none of it; a manager gets all of it.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1", USER = "user_1", KEY = "key_1";
const D0 = Date.UTC(2026, 10, 16);
const asUser = { subject: USER, orgId: ORG };
const asAgent = { subject: USER, orgId: ORG, akid: KEY };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
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
    await ctx.db.insert("crewRoles", { id: "r1", organizationId: ORG, name: "Rigger", defaultRate: 600, rateType: "DAILY" });
    await ctx.db.insert("crewMembers", { id: "c1", organizationId: ORG, firstName: "Bob", lastName: "Ryan", isActive: true, crewRoleId: "r1", defaultHourlyRate: 45, skillIds: ["sk1"] });
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "2341", name: "Launch", status: "CONFIRMED", isTemplate: false, liveVersionId: "v1" });
    await ctx.db.insert("crewAssignments", { id: "a1", organizationId: ORG, projectId: "p1", crewMemberId: "c1", crewRoleId: "r1", status: "CONFIRMED", startDate: D0, endDate: D0, rateOverride: 650, rateType: "DAILY", estimatedCost: 650 });
    // Two entries the same day on a DAILY rate: the day rate counts once.
    await ctx.db.insert("crewTimeEntries", { id: "t1", organizationId: ORG, crewMemberId: "c1", assignmentId: "a1", date: D0, startTime: "07:00", endTime: "12:00", totalHours: 5, status: "SUBMITTED" });
    await ctx.db.insert("crewTimeEntries", { id: "t2", organizationId: ORG, crewMemberId: "c1", assignmentId: "a1", date: D0, startTime: "13:00", endTime: "17:00", totalHours: 4, status: "SUBMITTED" });
  });
}

const list = (t: T, who = asUser) => t.withIdentity(who).query(api.crewTimeEntries.allEntries, { orgId: ORG, pageSize: 50, sortBy: "startTime", sortOrder: "asc" });

describe("crewTimeEntries.allEntries — pay is manager-only (server-side)", () => {
  test("manager: rate and derived total per row; the day rate counts once; totals.pay over the set", async () => {
    const t = makeT(); await seed(t, "manager");
    const res = await list(t);
    expect(res.payVisible).toBe(true);
    const byId = new Map(res.entries.map((e) => [e.id, e as Record<string, unknown>]));
    expect(byId.get("t1")).toMatchObject({ rate: 650, rateType: "DAILY", total: 650, rateIncluded: false });
    expect(byId.get("t2")).toMatchObject({ rate: 650, total: null, rateIncluded: true });
    expect(res.totals).toEqual({ hours: 9, pay: 650 });
    expect(res.counts).toMatchObject({ SUBMITTED: 2, all: 2 });
  });

  test("S2: the approved entry carries the day rate even when a draft is earlier that day", async () => {
    const t = makeT(); await seed(t, "manager");
    await t.run(async (ctx) => {
      const t2 = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", "t2")).first();
      await ctx.db.patch(t2!._id, { status: "APPROVED" });
      const t1 = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", "t1")).first();
      await ctx.db.patch(t1!._id, { status: "DRAFT" });
    });
    const res = await list(t);
    const byId = new Map(res.entries.map((e) => [e.id, e as Record<string, unknown>]));
    expect(byId.get("t2")).toMatchObject({ total: 650, rateIncluded: false });
    expect(byId.get("t1")).toMatchObject({ total: null, rateIncluded: true });
    expect(res.totals).toEqual({ hours: 9, pay: 650 });
  });

  test("below manager (member holds crew:read): no rate, no total, no pay total", async () => {
    const t = makeT(); await seed(t, "member");
    const res = await list(t);
    expect(res.payVisible).toBe(false);
    for (const e of res.entries) {
      const row = e as Record<string, unknown>;
      expect(row.rate).toBeUndefined();
      expect(row.total).toBeUndefined();
      expect(row.rateType).toBeUndefined();
    }
    expect(res.totals).toEqual({ hours: 9 });
  });

  test("a noFinancials key acting as an OWNER gets no pay", async () => {
    const t = makeT(); await seed(t, "owner", { noFinancials: true });
    const res = await list(t, asAgent);
    expect(res.payVisible).toBe(false);
    expect((res.entries[0] as Record<string, unknown>).total).toBeUndefined();
  });

  test("the total is derived, never stored: approving writes no money field", async () => {
    const t = makeT(); await seed(t, "manager");
    await t.withIdentity(asUser).mutation(api.crewTimeEntriesWrites.approveNative, { orgId: ORG, ids: ["t1"], now: D0 + 1, actor: { userId: USER, userName: "Alice" }, auditId: "ap" });
    const doc = await t.run(async (ctx) => ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", "t1")).first());
    expect(Object.keys(doc!).filter((k) => /total$|rate|pay/i.test(k) && k !== "totalHours")).toEqual([]);
  });
});

describe("planner reads redact pay below manager", () => {
  const planner = (t: T) => t.withIdentity(asUser).query(api.crewAvailability.plannerData, { orgId: ORG, startMs: D0 - 86_400_000, endMs: D0 + 6 * 86_400_000 });

  test("plannerData: manager sees rateOverride/estimatedCost; member does not; skillIds ship", async () => {
    const tm = makeT(); await seed(tm, "manager");
    const mgr = await planner(tm);
    expect(mgr[0].skillIds).toEqual(["sk1"]);
    expect(mgr[0].assignments[0]).toMatchObject({ rateOverride: 650, estimatedCost: 650 });

    const tb = makeT(); await seed(tb, "member");
    const mem = (await planner(tb))[0].assignments[0] as Record<string, unknown>;
    expect(mem.rateOverride).toBeUndefined();
    expect(mem.estimatedCost).toBeUndefined();
    expect(mem.status).toBe("CONFIRMED"); // everything else still ships
  });

  test("membersForAssignment: member default rates are null below manager (Q-I5)", async () => {
    const tm = makeT(); await seed(tm, "manager");
    const mgr = await tm.withIdentity(asUser).query(api.crewAssignments.membersForAssignment, { projectId: "p1", orgId: ORG });
    expect(mgr[0].defaultHourlyRate).toBe(45);

    const tb = makeT(); await seed(tb, "member");
    const mem = await tb.withIdentity(asUser).query(api.crewAssignments.membersForAssignment, { projectId: "p1", orgId: ORG });
    expect(mem[0].defaultHourlyRate).toBeNull();
    expect(mem[0].defaultDayRate).toBeNull();
    expect(mem[0].firstName).toBe("Bob");
  });

  test("crewDashboard.pickerList (the Log time picker): pay below manager redacted, the offer token never ships", async () => {
    const withToken = async (t: T) => t.run(async (ctx) => {
      const a = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", "a1")).first();
      await ctx.db.patch(a!._id, { responseToken: "secret-token" });
    });
    const tm = makeT(); await seed(tm, "manager"); await withToken(tm);
    const mgr = (await tm.withIdentity(asUser).query(api.crewDashboard.pickerList, { orgId: ORG }))[0].assignments[0] as Record<string, unknown>;
    expect(mgr).toMatchObject({ rateOverride: 650, estimatedCost: 650 });
    expect(mgr.responseToken).toBeUndefined();

    const tb = makeT(); await seed(tb, "member"); await withToken(tb);
    const mem = (await tb.withIdentity(asUser).query(api.crewDashboard.pickerList, { orgId: ORG }))[0].assignments[0] as Record<string, unknown>;
    expect(mem.rateOverride).toBeUndefined();
    expect(mem.estimatedCost).toBeUndefined();
    expect(mem.responseToken).toBeUndefined();
    expect(mem.status).toBe("CONFIRMED");
  });
});

describe("S1: every crew member and role read follows the one pay rule", () => {
  const reads = async (t: T, who = asUser) => {
    const c = t.withIdentity(who);
    const page = await c.query(api.crewMembers.listPage, { orgId: ORG });
    return {
      member: page.items[0] as Record<string, unknown>,
      roleList: (await c.query(api.crewRoles.list, { orgId: ORG }))[0] as Record<string, unknown>,
      roleById: (await c.query(api.crewRoles.getById, { id: "r1" })) as Record<string, unknown>,
    };
  };
  const withCharge = (t: T) =>
    t.run(async (ctx) => {
      const r = await ctx.db.query("crewRoles").withIndex("by_cuid", (q) => q.eq("id", "r1")).first();
      await ctx.db.patch(r!._id, { chargeRate: 900 });
    });

  test("a member (holds crew:read, below manager) gets no member or role rate", async () => {
    const t = makeT(); await seed(t, "member"); await withCharge(t);
    const r = await reads(t);
    expect(r.member).toMatchObject({ firstName: "Bob" });
    expect(r.member.defaultHourlyRate).toBeUndefined();
    expect(r.member.defaultDayRate).toBeUndefined();
    for (const row of [r.roleList, r.roleById]) {
      expect(row.name).toBe("Rigger");
      expect(row.defaultRate).toBeUndefined();
      expect(row.chargeRate).toBeUndefined();
    }
  });

  test("a noFinancials key, even acting as an owner, gets none", async () => {
    const t = makeT(); await seed(t, "owner", { noFinancials: true }); await withCharge(t);
    const r = await reads(t, asAgent);
    expect(r.member.defaultHourlyRate).toBeUndefined();
    expect([r.roleList.defaultRate, r.roleList.chargeRate, r.roleById.defaultRate, r.roleById.chargeRate]).toEqual([undefined, undefined, undefined, undefined]);
  });

  // The other pay-bearing crew reads: the member page, the job's crew, the labour
  // total and the crew dashboard lists all follow the same rule.
  const more = async (t: T, who = asUser) => {
    const c = t.withIdentity(who);
    const detail = (await c.query(api.crew.memberDetail, { id: "c1", orgId: ORG }))!;
    const crew = (await c.query(api.crewAssignments.projectCrew, { projectId: "p1", orgId: ORG }))[0] as Record<string, unknown> & { crewMember: Record<string, unknown>; crewRole: Record<string, unknown> };
    const labour = await c.query(api.crewAssignments.projectLabourCost, { projectId: "p1", orgId: ORG });
    const active = (await c.query(api.crewDashboard.activeAssignmentsSummary, { orgId: ORG, nowMs: D0 - 1 }))[0] as Record<string, unknown>;
    return { detail, crew, labour, active };
  };

  test("a member: memberDetail, projectCrew, projectLabourCost and the dashboard lists carry no pay", async () => {
    const t = makeT(); await seed(t, "member");
    const r = await more(t);
    expect(r.detail).toMatchObject({ defaultHourlyRate: null, defaultDayRate: null, crewRole: { name: "Rigger", defaultRate: null } });
    expect(r.detail.assignments[0]).not.toHaveProperty("estimatedCost");
    expect(r.detail.assignments[0]).not.toHaveProperty("rateOverride");
    expect(r.crew).not.toHaveProperty("estimatedCost");
    expect(r.crew.crewMember).not.toHaveProperty("defaultHourlyRate");
    expect(r.crew.crewRole).not.toHaveProperty("defaultRate");
    expect(r.labour).toEqual({ totalLabourCost: 0, assignmentCount: 0 });
    expect(r.active).toMatchObject({ id: "a1" });
    expect(r.active).not.toHaveProperty("estimatedCost");
    expect(r.active).not.toHaveProperty("rateOverride");
  });

  test("a noFinancials key (as owner) gets none of it either; a manager gets all of it", async () => {
    const ta = makeT(); await seed(ta, "owner", { noFinancials: true });
    const a = await more(ta, asAgent);
    expect(a.detail.defaultHourlyRate).toBeNull();
    expect(a.crew).not.toHaveProperty("rateOverride");
    expect(a.labour.totalLabourCost).toBe(0);
    expect(a.active).not.toHaveProperty("estimatedCost");
    const tm = makeT(); await seed(tm, "manager");
    const m = await more(tm);
    expect(m.detail).toMatchObject({ defaultHourlyRate: 45, crewRole: { defaultRate: 600 } });
    expect(m.detail.assignments[0]).toMatchObject({ estimatedCost: 650, rateOverride: 650 });
    expect(m.crew).toMatchObject({ estimatedCost: 650, crewMember: { defaultHourlyRate: 45 }, crewRole: { defaultRate: 600 } });
    expect(m.labour).toEqual({ totalLabourCost: 650, assignmentCount: 1 });
    expect(m.active).toMatchObject({ estimatedCost: 650 });
  });

  test("an edit by a caller who can't see pay keeps the member's stored rates (set and clear both ignored)", async () => {
    const ta = makeT(); await seed(ta, "owner", { noFinancials: true });
    const upd = (set: Record<string, unknown>, clear: string[]) =>
      ta.withIdentity(asAgent).mutation(api.crewWrites.updateNative, { id: "c1", orgId: ORG, set, clear, actor: { userId: USER, userName: "Alice" }, auditId: `u-${Math.random()}`, now: D0 });
    await upd({ firstName: "Robert", defaultHourlyRate: 1 }, []);
    await upd({ firstName: "Rob" }, ["defaultHourlyRate"]);
    const c = await ta.run(async (ctx) => ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", "c1")).first());
    expect(c).toMatchObject({ firstName: "Rob", defaultHourlyRate: 45 });
  });

  test("a manager gets every rate", async () => {
    const t = makeT(); await seed(t, "manager"); await withCharge(t);
    const r = await reads(t);
    expect(r.member.defaultHourlyRate).toBe(45);
    expect(r.roleList).toMatchObject({ defaultRate: 600, chargeRate: 900 });
    expect(r.roleById).toMatchObject({ defaultRate: 600, chargeRate: 900 });
    expect(r.member.icalToken).toBeUndefined();
  });
});

describe("crew roles: rates follow the one pay rule (S4, S5)", () => {
  const roles = (t: T, who = asUser) => t.withIdentity(who).query(api.crewRoles.listForSettings, { orgId: ORG });
  const role = (t: T) => t.run(async (ctx) => ctx.db.query("crewRoles").withIndex("by_cuid", (q) => q.eq("id", "r1")).first());
  const edit = (t: T, who: typeof asUser, rates: { defaultRate?: number; chargeRate?: number }) =>
    t.withIdentity(who).mutation(api.crewRolesWrites.updateNative, {
      id: "r1", orgId: ORG, name: "Rigger II", rateType: "DAILY", ...rates, now: D0, actor: { userId: USER, userName: "Alice" }, auditId: `e-${Math.random()}`,
    });

  test("S5: listForSettings gives a noFinancials key (even as an owner) no rates; a manager gets them", async () => {
    const ta = makeT(); await seed(ta, "owner", { noFinancials: true });
    const agentRow = (await roles(ta, asAgent))[0] as Record<string, unknown>;
    expect(agentRow.defaultRate).toBeUndefined();
    expect(agentRow.name).toBe("Rigger");
    const tm = makeT(); await seed(tm, "manager");
    expect((await roles(tm))[0]).toMatchObject({ defaultRate: 600 });
  });

  test("ratesVisible is canSeeCrewPay: manager yes; member no; a noFinancials key (as owner) no", async () => {
    const rv = (t: T, who = asUser) => t.withIdentity(who).query(api.crewRoles.ratesVisible, { orgId: ORG });
    const tm = makeT(); await seed(tm, "manager");
    expect(await rv(tm)).toBe(true);
    const tb = makeT(); await seed(tb, "member");
    expect(await rv(tb)).toBe(false);
    const ta = makeT(); await seed(ta, "owner", { noFinancials: true });
    expect(await rv(ta, asAgent)).toBe(false);
  });

  test("S4: an edit by a caller who can't see pay keeps the stored rates; a manager's edit can clear them", async () => {
    const ta = makeT(); await seed(ta, "owner", { noFinancials: true });
    await ta.run(async (ctx) => {
      const r = await ctx.db.query("crewRoles").withIndex("by_cuid", (q) => q.eq("id", "r1")).first();
      await ctx.db.patch(r!._id, { chargeRate: 900 });
    });
    await edit(ta, asAgent, {}); // the redacted read had no rates, so the edit sends none
    expect(await role(ta)).toMatchObject({ name: "Rigger II", defaultRate: 600, chargeRate: 900 });
    await edit(ta, asAgent, { defaultRate: 1 }); // and a rate it sends anyway is ignored
    expect((await role(ta))?.defaultRate).toBe(600);

    const tm = makeT(); await seed(tm, "manager");
    await edit(tm, asUser, { defaultRate: 650 });
    expect((await role(tm))?.defaultRate).toBe(650);
    await edit(tm, asUser, {});
    expect((await role(tm))?.defaultRate).toBeUndefined();
  });
});
