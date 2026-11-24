// @vitest-environment node
//
// The People lists (UX Phase 13): segment membership matches the rows listed, the
// strip counts match the segments, and every money / pay field is ABSENT (never
// zero, never a sort key) for a caller below the line. Includes the sentinel sweep
// for suppliers.detail.spend and suppliers.subhiresPage (cost/margin follow the
// job-cost line, `canSeeJobCost`).
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_A";
const OTHER = "org_B";
const USER = "user_1";
const KEY = "key_1";
const asUser = { subject: USER, orgId: ORG };
const asAgent = { subject: USER, orgId: ORG, akid: KEY };
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 24, 12);
const day = (n: number) => Math.floor(NOW / DAY) * DAY + n * DAY;

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

async function seed(t: T, role: string, key?: { noFinancials: boolean }) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role });
    if (key) {
      await ctx.db.insert("apiKeys", {
        id: KEY, organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h",
        scopes: JSON.stringify(["*"]), isActive: true, actingUserId: USER, createdById: USER, noFinancials: key.noFinancials,
      });
    }
    const crew = (id: string, extra: Record<string, unknown> = {}) =>
      ctx.db.insert("crewMembers", { id, organizationId: ORG, firstName: id, lastName: "Crew", defaultDayRate: 777, ...extra });
    await crew("free");
    await crew("busy");
    await crew("maybe");
    await crew("gone", { status: "INACTIVE" });
    await ctx.db.insert("crewMembers", { id: "foreign", organizationId: OTHER, firstName: "X", lastName: "Y", defaultDayRate: 1 });
    const call = (id: string, member: string, status: string, s: number, e: number, org = ORG) =>
      ctx.db.insert("crewAssignments", { id, organizationId: org, projectId: "p1", crewMemberId: member, status: status as "CONFIRMED", startDate: day(s), endDate: day(e), estimatedCost: 4242 });
    await call("a1", "busy", "CONFIRMED", 2, 3);
    await call("a2", "maybe", "OFFERED", 1, 1);
    await call("a3", "free", "CONFIRMED", 12, 12); // outside the 7-day window
    await call("a4", "free", "CONFIRMED", 1, 1, OTHER); // another org's call never counts
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "#2341", name: "Gala" });

    await ctx.db.insert("clients", { id: "k1", organizationId: ORG, name: "Hilton", isActive: true });
    await ctx.db.insert("clients", { id: "k2", organizationId: ORG, name: "Quiet", isActive: true });
    await ctx.db.insert("clients", { id: "k3", organizationId: ORG, name: "Old", isActive: false });
    await ctx.db.insert("clients", { id: "kf", organizationId: OTHER, name: "Foreign", isActive: true });
    await ctx.db.insert("projects", { id: "j1", organizationId: ORG, projectNumber: "#1", name: "Job", clientId: "k1", status: "CONFIRMED", total: 1234 });
    await ctx.db.insert("projects", { id: "j2", organizationId: ORG, projectNumber: "#2", name: "Quote", clientId: "k1", status: "QUOTED", total: 5678 });
    await ctx.db.insert("invoices", {
      id: "i1", organizationId: ORG, projectId: "j1", clientId: "k1", kind: "FULL", status: "ISSUED", paymentStatus: "UNPAID",
      subtotal: 9000, taxAmount: 999, total: 9999, dueDate: day(-5),
    } as never);

    await ctx.db.insert("suppliers", { id: "s1", organizationId: ORG, name: "Scene", isActive: true });
    await ctx.db.insert("suppliers", { id: "s2", organizationId: ORG, name: "Nothing", isActive: true });
    await ctx.db.insert("suppliers", { id: "s3", organizationId: ORG, name: "Parked", isActive: false });
    await ctx.db.insert("supplierOrders", { id: "o1", organizationId: ORG, supplierId: "s1", orderNumber: "SH-1", type: "SUBHIRE", status: "ORDERED", orderDate: day(-3), total: 3131 });
    await ctx.db.insert("subHires", { id: "sh1", organizationId: ORG, supplierId: "s1", createdById: USER, orderNumber: "SHB-1", status: "CONFIRMED", totalCost: 2121, totalCharge: 3333 } as never);
  });
}

const as = (t: T, identity: typeof asUser | typeof asAgent) => t.withIdentity(identity);

describe("crew list", () => {
  test("segments list exactly the rows the strip counts", async () => {
    const t = makeT();
    await seed(t, "manager");
    const q = (segment: string) => as(t, asUser).query(api.peopleLists.crewPage, { orgId: ORG, now: NOW, segment });
    const ids = async (s: string) => (await q(s)).items.map((r) => r.id).sort();
    expect(await ids("all")).toEqual(["busy", "free", "maybe"]);
    expect(await ids("available")).toEqual(["free"]); // a3 is day 12, outside this week
    expect(await ids("onjob")).toEqual(["busy", "maybe"]);
    expect(await ids("unconfirmed")).toEqual(["maybe"]);
    expect(await ids("inactive")).toEqual(["gone"]);
    const counts = await as(t, asUser).query(api.peopleLists.crewSegmentCounts, { orgId: ORG, now: NOW });
    expect(counts).toMatchObject({ all: 3, available: 1, onjob: 2, unconfirmed: 1, inactive: 1, truncated: 0 });
    const page = await q("onjob");
    expect(page.items.find((r) => r.id === "busy")).toMatchObject({ listStatus: "ON_JOB", daysThisWeek: 2, next: { project: { projectNumber: "#2341" } } });
  });

  test("another org's rows and calls never appear", async () => {
    const t = makeT();
    await seed(t, "manager");
    const all = await as(t, asUser).query(api.peopleLists.crewPage, { orgId: ORG, now: NOW, segment: "all" });
    expect(all.items.some((r) => r.id === "foreign")).toBe(false);
    await expect(as(t, { subject: USER, orgId: OTHER }).query(api.peopleLists.crewPage, { orgId: ORG, now: NOW })).rejects.toThrow();
  });

  test("rates and call cost are absent below the pay line, and a rate is not a sort key", async () => {
    const t = makeT();
    await seed(t, "viewer");
    const page = await as(t, asUser).query(api.peopleLists.crewPage, { orgId: ORG, now: NOW, sortBy: "rate", sortOrder: "desc" });
    expect(page.payVisible).toBe(false);
    expect(JSON.stringify(page)).not.toMatch(/777|4242|defaultDayRate|estimatedCost|icalToken|responseToken/);
  });

  test("a manager sees the rate; an agent key with noFinancials does not", async () => {
    const t = makeT();
    await seed(t, "manager", { noFinancials: true });
    const m = await as(t, asUser).query(api.peopleLists.crewPage, { orgId: ORG, now: NOW });
    expect(m.payVisible).toBe(true);
    expect(m.items.find((r) => r.id === "free")?.defaultDayRate).toBe(777);
    const k = await as(t, asAgent).query(api.peopleLists.crewPage, { orgId: ORG, now: NOW });
    expect(JSON.stringify(k)).not.toMatch(/777|defaultDayRate/);
  });
});

describe("client list", () => {
  test("segments, derived facts and strip counts agree", async () => {
    const t = makeT();
    await seed(t, "manager");
    const q = (segment: string) => as(t, asUser).query(api.peopleLists.clientPage, { orgId: ORG, now: NOW, segment });
    expect((await q("all")).items.map((r) => r.id).sort()).toEqual(["k1", "k2"]);
    expect((await q("active")).items.map((r) => r.id)).toEqual(["k1"]);
    expect((await q("overdue")).items.map((r) => r.id)).toEqual(["k1"]);
    expect((await q("archived")).items.map((r) => r.id)).toEqual(["k3"]);
    const k1 = (await q("all")).items.find((r) => r.id === "k1")!;
    expect(k1).toMatchObject({ openJobCount: 2, quoted: 5678, outstanding: 9999, overdueDays: 5 });
    const c = await as(t, asUser).query(api.peopleLists.clientSegmentCounts, { orgId: ORG, now: NOW });
    expect(c).toMatchObject({ all: 2, active: 1, quoting: 1, overdue: 1, archived: 1, withOpenJobs: 1, quoted: 5678, outstanding: 9999 });
  });

  test("money is absent (and the Overdue segment is not offered) to a noFinancials key; the segment strip hides it", async () => {
    const t = makeT();
    await seed(t, "manager", { noFinancials: true });
    const page = await as(t, asAgent).query(api.peopleLists.clientPage, { orgId: ORG, now: NOW, segment: "overdue", sortBy: "outstanding", sortOrder: "desc" });
    expect(page.moneyVisible).toBe(false);
    expect(page.items.length).toBe(2); // fell back to `all`
    expect(JSON.stringify(page)).not.toMatch(/9999|5678|1234|outstanding|quoted|lifetime|overdueDays/);
    const counts = await as(t, asAgent).query(api.peopleLists.clientSegmentCounts, { orgId: ORG, now: NOW });
    expect(counts.overdue).toBeNull();
    expect(JSON.stringify(counts)).not.toMatch(/9999|5678|quoted|outstanding"/);
  });
});

describe("supplier list and the cost-line closure", () => {
  test("segments and open-order counts", async () => {
    const t = makeT();
    await seed(t, "manager");
    const q = (segment: string) => as(t, asUser).query(api.peopleLists.supplierPage, { orgId: ORG, now: NOW, segment });
    expect((await q("all")).items.map((r) => r.id).sort()).toEqual(["s1", "s2"]);
    expect((await q("open")).items.map((r) => r.id)).toEqual(["s1"]);
    expect((await q("archived")).items.map((r) => r.id)).toEqual(["s3"]);
    expect((await q("open")).items[0]).toMatchObject({ openOrders: 1, spendYtd: 3131 });
    expect(await as(t, asUser).query(api.peopleLists.supplierSegmentCounts, { orgId: ORG, now: NOW })).toMatchObject({ all: 2, open: 1, archived: 1, openOrders: 1, spendYtd: 3131 });
  });

  test("SENTINEL: spend, cost, charge and margin never reach a caller without the job-cost line", async () => {
    const t = makeT();
    await seed(t, "manager", { noFinancials: true });
    const reads = async (identity: typeof asUser | typeof asAgent) => {
      const c = as(t, identity);
      return JSON.stringify([
        await c.query(api.peopleLists.supplierPage, { orgId: ORG, now: NOW, sortBy: "spend" }),
        await c.query(api.peopleLists.supplierSegmentCounts, { orgId: ORG, now: NOW }),
        await c.query(api.suppliers.detail, { orgId: ORG, id: "s1" }),
        await c.query(api.suppliers.subhiresPage, { orgId: ORG, supplierId: "s1", page: 1, pageSize: 25 }),
      ]);
    };
    const hidden = await reads(asAgent);
    expect(hidden).not.toMatch(/3131|2121|3333|1212|spendYtd|totalCost|totalCharge|margin|"spend"|committedOrderSpend/);
    expect(hidden).toContain("SHB-1"); // the rest of the row is intact
    const shown = await reads(asUser);
    expect(shown).toMatch(/3131/);
    expect(shown).toMatch(/2121/);
    expect(shown).toMatch(/1212/); // margin 3333 - 2121
    expect(shown).toMatch(/committedOrderSpend/);
  });
});

describe("supplier list: hire facts (D71)", () => {
  test("On hire now (units), Due back and the Overdue returns segment come from the order's return dates", async () => {
    const t = makeT();
    await seed(t, "manager");
    await t.run(async (ctx) => {
      await ctx.db.insert("supplierOrders", { id: "oh", organizationId: ORG, supplierId: "s2", orderNumber: "SH-9", type: "SUBHIRE", status: "RECEIVED", returnDueDate: day(-3) });
      await ctx.db.insert("supplierOrderItems", { id: "it1", orderId: "oh", description: "Deck", quantity: 4 });
      await ctx.db.insert("supplierOrderItems", { id: "it2", orderId: "oh", description: "Stairs", quantity: 2 });
      await ctx.db.insert("supplierOrders", { id: "back", organizationId: ORG, supplierId: "s1", orderNumber: "SH-8", type: "SUBHIRE", status: "RECEIVED", returnDueDate: day(-9), returnedDate: day(-8) });
    });
    const q = (segment: string) => as(t, asUser).query(api.peopleLists.supplierPage, { orgId: ORG, now: NOW, segment });
    const late = await q("overdue");
    expect(late.items.map((r) => r.id)).toEqual(["s2"]);
    expect(late.items[0]).toMatchObject({ onHireUnits: 6, onHireOrders: 1, lateDays: 3 });
    const all = await q("all");
    expect(all.items.find((r) => r.id === "s1")).toMatchObject({ onHireUnits: 0, lateDays: 0 }); // a returned order is not on hire
    expect((await as(t, asUser).query(api.peopleLists.supplierSegmentCounts, { orgId: ORG, now: NOW })).overdue).toBe(1);
  });
});

describe("crew list: review follow-ups", () => {
  test("an UNDATED pending call makes the person Unconfirmed with an undated Next call (not Available)", async () => {
    const t = makeT();
    await seed(t, "manager");
    await t.run(async (ctx) => {
      await ctx.db.insert("crewMembers", { id: "undated", organizationId: ORG, firstName: "Una", lastName: "Dated" });
      await ctx.db.insert("crewAssignments", { id: "u1", organizationId: ORG, projectId: "p1", crewMemberId: "undated", status: "PENDING" });
    });
    const page = await as(t, asUser).query(api.peopleLists.crewPage, { orgId: ORG, now: NOW, segment: "unconfirmed" });
    const row = page.items.find((r) => r.id === "undated");
    expect(row).toMatchObject({ listStatus: "UNCONFIRMED", next: { startDay: null, callId: "u1" } });
    const avail = await as(t, asUser).query(api.peopleLists.crewPage, { orgId: ORG, now: NOW, segment: "available" });
    expect(avail.items.some((r) => r.id === "undated")).toBe(false);
  });

  test("a viewer's rate sort is the name-order fallback (a hidden rate is not a sort key)", async () => {
    const t = makeT();
    await seed(t, "viewer");
    await t.run(async (ctx) => {
      await ctx.db.insert("crewMembers", { id: "z", organizationId: ORG, firstName: "Z", lastName: "Alpha", defaultDayRate: 100 });
      await ctx.db.insert("crewMembers", { id: "y", organizationId: ORG, firstName: "Y", lastName: "Zulu", defaultDayRate: 900 });
    });
    const q = (sortBy: string) => as(t, asUser).query(api.peopleLists.crewPage, { orgId: ORG, now: NOW, sortBy, sortOrder: "asc", segment: "all" });
    const byRate = (await q("rate")).items.map((r) => r.id);
    const byName = (await q("name")).items.map((r) => r.id);
    expect(byRate).toEqual(byName);
  });

  test("next.project is org-checked: a call pointing at another org's job shows no project", async () => {
    const t = makeT();
    await seed(t, "manager");
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "pforeign", organizationId: OTHER, projectNumber: "#SECRET", name: "Secret job" });
      await ctx.db.insert("crewMembers", { id: "leaky", organizationId: ORG, firstName: "Lea", lastName: "Ky" });
      await ctx.db.insert("crewAssignments", { id: "lk", organizationId: ORG, projectId: "pforeign", crewMemberId: "leaky", status: "CONFIRMED", startDate: day(1), endDate: day(1) });
    });
    const page = await as(t, asUser).query(api.peopleLists.crewPage, { orgId: ORG, now: NOW, segment: "onjob" });
    expect(page.items.find((r) => r.id === "leaky")?.next?.project).toBeNull();
    expect(JSON.stringify(page)).not.toMatch(/SECRET|Secret job/);
  });

  test("On leave and Inactive stay reachable through the Status word, and rows carry only list columns", async () => {
    const t = makeT();
    await seed(t, "manager");
    await t.run(async (ctx) => {
      await ctx.db.insert("crewMembers", { id: "away", organizationId: ORG, firstName: "Ava", lastName: "Away", status: "ON_LEAVE", dateOfBirth: 123456, address: "1 Secret St", emergencyContactName: "Mum", abnOrGst: "ABN-777" });
    });
    const page = await as(t, asUser).query(api.peopleLists.crewPage, { orgId: ORG, now: NOW, statusIn: ["ON_LEAVE"] });
    expect(page.items.map((r) => r.id)).toEqual(["away"]);
    expect(JSON.stringify(page)).not.toMatch(/123456|Secret St|Mum|ABN-777|icalToken|dateOfBirth/);
    const inactive = await as(t, asUser).query(api.peopleLists.crewPage, { orgId: ORG, now: NOW, statusIn: ["INACTIVE"] });
    expect(inactive.items.map((r) => r.id)).toEqual(["gone"]);
  });
});
