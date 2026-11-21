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
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "2341", name: "Launch", status: "CONFIRMED", isTemplate: false });
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
});
