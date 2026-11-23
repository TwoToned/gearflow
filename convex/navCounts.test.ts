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
import { NAV_COUNT_CAP, type NavCountServerSource } from "./navCounts";

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

  test("Maintenance: open (scheduled + in progress) with how many are past their date", async () => {
    const t = await makeT();
    await t.run(async (ctx) => {
      const rec = (id: string, status: string, scheduledDate?: number) =>
        ctx.db.insert("maintenanceRecords", { id, organizationId: ORG, title: id, status: status as "SCHEDULED", scheduledDate, type: "REPAIR" as never });
      await rec("a", "SCHEDULED", NOW - DAY);
      await rec("b", "SCHEDULED", NOW + DAY);
      await rec("c", "IN_PROGRESS", NOW - 2 * DAY);
      await rec("d", "IN_PROGRESS");
      await rec("e", "COMPLETED", NOW - DAY);
    });
    expect(await count(t, "maintenance")).toEqual({ value: 4, secondary: 2, truncated: false });
  });

  test("Test & tag: overdue, active only", async () => {
    const t = await makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("testTagAssets", { id: "t1", organizationId: ORG, testTagId: "T1", description: "Lead", status: "OVERDUE", isActive: true });
      await ctx.db.insert("testTagAssets", { id: "t2", organizationId: ORG, testTagId: "T2", description: "Lead", status: "OVERDUE", isActive: false });
      await ctx.db.insert("testTagAssets", { id: "t3", organizationId: ORG, testTagId: "T3", description: "Lead", status: "CURRENT", isActive: true });
    });
    expect(await count(t, "testTagOverdue")).toEqual({ value: 1, truncated: false });
  });

  test("Assets is null until the counters are seeded (unknown, not zero)", async () => {
    const t = await makeT();
    expect(await count(t, "assets")).toBeNull();
  });

  test("Returns: overdue-return jobs by the shared rule; none here", async () => {
    const t = await makeT();
    expect(await count(t, "returnsOverdue")).toEqual({ value: 0, truncated: false });
  });

  test(`the read stops at ${NAV_COUNT_CAP} + 1 and says so: the row prints n+`, async () => {
    const t = await makeT();
    await t.run(async (ctx) => {
      for (let i = 0; i <= NAV_COUNT_CAP; i++) await ctx.db.insert("locations", { id: `l${i}`, organizationId: ORG, name: `L${i}` });
    });
    expect(await count(t, "locations")).toEqual({ value: NAV_COUNT_CAP, truncated: true });
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
