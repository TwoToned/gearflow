// @vitest-environment node
//
// navCounts.get (UX Phase 11, S4): the phone More sheet's row counts. Pinned:
// each source's figure, the cap + `truncated` (never a wrong exact number), the
// org guard, and the ROLE check (Q3): a role that can't read a row's resource
// gets null, never a number.
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { NAV_COUNT_CAP, NAV_COUNT_SOURCES, type NavCountServerSource } from "./navCounts";
import { maintenanceTileCounts } from "./lib/maintenanceOpen";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const NOW = Date.UTC(2026, 10, 22);
const DAY = 86_400_000;
const asUser = { subject: USER, orgId: ORG };

async function makeT(role = "member"): Promise<T> {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role });
  });
  return t;
}

const count = (t: T, source: NavCountServerSource, orgId = ORG) =>
  t.withIdentity(asUser).query(api.navCounts.get, { orgId, source, now: NOW });

describe("navCounts.get — figures", () => {
  test("Clients / Suppliers / Locations / Crew: org totals, inactive and archived excluded, another org's never counted", async () => {
    const t = await makeT();
    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i++) await ctx.db.insert("clients", { id: `c${i}`, organizationId: ORG, name: `C${i}`, isActive: true });
      await ctx.db.insert("clients", { id: "cOff", organizationId: ORG, name: "Off", isActive: false });
      await ctx.db.insert("clients", { id: "cX", organizationId: OTHER, name: "X", isActive: true });
      await ctx.db.insert("suppliers", { id: "s1", organizationId: ORG, name: "S", isActive: true });
      await ctx.db.insert("locations", { id: "l1", organizationId: ORG, name: "Shed" });
      await ctx.db.insert("crewMembers", { id: "cm1", organizationId: ORG, firstName: "A", lastName: "B", status: "ACTIVE" });
      await ctx.db.insert("crewMembers", { id: "cm2", organizationId: ORG, firstName: "C", lastName: "D", status: "ARCHIVED" });
    });
    expect(await count(t, "clients")).toEqual({ value: 3, truncated: false });
    expect(await count(t, "suppliers")).toEqual({ value: 1, truncated: false });
    expect(await count(t, "locations")).toEqual({ value: 1, truncated: false });
    expect(await count(t, "crew")).toEqual({ value: 1, truncated: false });
  });

  test("Maintenance: open and overdue are the Maintenance page's own Open / Overdue tiles (one definition)", async () => {
    const t = await makeT();
    const seeded = [
      { id: "a", status: "SCHEDULED", scheduledDate: NOW - DAY },
      { id: "b", status: "SCHEDULED", scheduledDate: NOW + DAY },
      { id: "c", status: "IN_PROGRESS", scheduledDate: NOW - 2 * DAY },
      { id: "d", status: "IN_PROGRESS" },
      { id: "e", status: "AWAITING_PARTS", scheduledDate: NOW - DAY },
      { id: "f", status: "QA" },
      { id: "g", status: "COMPLETED", scheduledDate: NOW - DAY },
      { id: "h", status: "CANCELLED" },
      // No status at all: not open, not overdue, on the page and on the server.
      { id: "z", status: undefined, scheduledDate: NOW - DAY },
    ];
    await t.run(async (ctx) => {
      for (const r of seeded) {
        await ctx.db.insert("maintenanceRecords", { id: r.id, organizationId: ORG, title: r.id, status: r.status as "SCHEDULED", scheduledDate: r.scheduledDate, type: "REPAIR" as never });
      }
    });
    // The page's tiles, through the very function the page renders them with.
    const page = maintenanceTileCounts(seeded, NOW, 0);
    expect([page.open, page.overdue]).toEqual([6, 2]);
    expect(await count(t, "maintenance")).toEqual({ value: page.open, secondary: page.overdue, truncated: false });
  });

  test("Test & tag: overdue, active only", async () => {
    const t = await makeT();
    // Derived from the due date (the list's own Overdue), so the stored word is irrelevant: t3 says CURRENT but is late.
    await t.run(async (ctx) => {
      await ctx.db.insert("testTagAssets", { id: "t1", organizationId: ORG, testTagId: "T1", description: "Lead", status: "OVERDUE", isActive: true, nextDueDate: NOW - DAY });
      await ctx.db.insert("testTagAssets", { id: "t2", organizationId: ORG, testTagId: "T2", description: "Lead", status: "OVERDUE", isActive: false, nextDueDate: NOW - DAY });
      await ctx.db.insert("testTagAssets", { id: "t3", organizationId: ORG, testTagId: "T3", description: "Lead", status: "CURRENT", isActive: true, nextDueDate: NOW - 2 * DAY });
      await ctx.db.insert("testTagAssets", { id: "t4", organizationId: ORG, testTagId: "T4", description: "Lead", status: "OVERDUE", isActive: true, nextDueDate: NOW + DAY });
    });
    expect(await count(t, "testTagOverdue")).toEqual({ value: 2, truncated: false });
  });

  test("Assets is null until the counters are seeded (unknown, not zero)", async () => {
    const t = await makeT();
    expect(await count(t, "assets")).toBeNull();
  });

  test("Returns: overdue-return jobs by the shared rule; none here", async () => {
    const t = await makeT();
    expect(await count(t, "returnsOverdue")).toEqual({ value: 0, truncated: false });
  });

  test("the filter runs before the cap: an inactive row among the first CAP doesn't hide the kept row at CAP + 1", async () => {
    const t = await makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "off", organizationId: ORG, name: "Off", isActive: false });
      for (let i = 0; i < NAV_COUNT_CAP; i++) await ctx.db.insert("clients", { id: `c${i}`, organizationId: ORG, name: `C${i}`, isActive: true });
    });
    // 201 rows read: one inactive, 200 active → 200 (and truncated, the scan hit its cap).
    expect(await count(t, "clients")).toEqual({ value: NAV_COUNT_CAP, truncated: true });
  });

  test(`the read stops at ${NAV_COUNT_CAP} + 1 and says so: the row prints n+`, async () => {
    const t = await makeT();
    await t.run(async (ctx) => {
      for (let i = 0; i <= NAV_COUNT_CAP; i++) await ctx.db.insert("locations", { id: `l${i}`, organizationId: ORG, name: `L${i}` });
    });
    expect(await count(t, "locations")).toEqual({ value: NAV_COUNT_CAP, truncated: true });
  });
});

describe("navCounts.get — the validator is NAV_COUNT_SOURCES", () => {
  test("every listed source is accepted; anything else is refused by the validator", async () => {
    const t = await makeT();
    for (const s of NAV_COUNT_SOURCES) await expect(count(t, s)).resolves.toBeDefined();
    await expect(count(t, "invoicesOverdue" as NavCountServerSource)).rejects.toThrow(/Validator/i);
  });
});

describe("navCounts.get — guards", () => {
  test("a caller whose org doesn't match is rejected", async () => {
    const t = await makeT();
    await expect(count(t, "clients", OTHER)).rejects.toThrow(/organization mismatch/i);
  });

  test("a role that can't read the row's resource gets null, never a number (viewer × Returns)", async () => {
    const t = await makeT("viewer");
    expect(await count(t, "returnsOverdue")).toBeNull();
    // …while what the viewer CAN read still counts.
    expect(await count(t, "clients")).toEqual({ value: 0, truncated: false });
  });

  test("no member row: nothing at all", async () => {
    const t = convexTest(schema, modules);
    expect(await count(t, "clients")).toBeNull();
  });
});
