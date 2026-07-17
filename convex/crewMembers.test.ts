// @vitest-environment node
//
// convex/crewMembers.ts `listPage` — the crew table's server-side replacement
// for the 2 whole-org client subscriptions (useCrewMembers/useCrewRoles) it
// used to filter/join/sort in the browser (Finding #1,
// docs/designs/perf-convex-efficiency-2026-06.md).
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const USER = "user_1";
const asUser = { subject: USER, orgId: ORG };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("crewRoles", { id: "role1", organizationId: ORG, name: "Sound Engineer", color: "#123456" });
    await ctx.db.insert("crewMembers", {
      id: "CM1", organizationId: ORG, firstName: "Alice", lastName: "Smith",
      email: "alice@example.com", crewRoleId: "role1", type: "EMPLOYEE", status: "ACTIVE",
      icalToken: "secret-token-1",
    });
    await ctx.db.insert("crewMembers", {
      id: "CM2", organizationId: ORG, firstName: "Bob", lastName: "Jones",
      department: "Lighting", type: "FREELANCER", status: "INACTIVE",
    });
  });
}

describe("crewMembers.listPage", () => {
  test("resolves crewRole name/color server-side", async () => {
    const t = makeT();
    await seed(t);
    const result = await t.withIdentity(asUser).query(api.crewMembers.listPage, { orgId: ORG });
    const cm1 = result.items.find((m) => m.id === "CM1")!;
    expect(cm1.crewRole?.name).toBe("Sound Engineer");
    const cm2 = result.items.find((m) => m.id === "CM2")!;
    expect(cm2.crewRole).toBeNull();
  });

  test("redacts icalToken for a non-service (user) caller", async () => {
    const t = makeT();
    await seed(t);
    const result = await t.withIdentity(asUser).query(api.crewMembers.listPage, { orgId: ORG });
    const cm1 = result.items.find((m) => m.id === "CM1")!;
    expect(cm1.icalToken).toBeUndefined();
  });

  test("rejects sortBy:icalToken instead of sorting on the raw pre-redaction value", async () => {
    // Regression test (found in adversarial review): sorting runs on the raw doc
    // before redaction, so an unvalidated sortBy could leak icalToken's relative
    // ordering across rows even though the token value itself is stripped from the
    // response. sortBy must fall back to the default ("lastName") for any value
    // outside the allowlisted, UI-exposed sortable columns.
    const t = makeT();
    await seed(t);
    const sortedByToken = await t.withIdentity(asUser).query(api.crewMembers.listPage, { orgId: ORG, sortBy: "icalToken" });
    const sortedDefault = await t.withIdentity(asUser).query(api.crewMembers.listPage, { orgId: ORG });
    expect(sortedByToken.items.map((m) => m.id)).toEqual(sortedDefault.items.map((m) => m.id));
    expect(sortedByToken.items.every((m) => m.icalToken === undefined)).toBe(true);
  });

  test("filters by type/department/status", async () => {
    const t = makeT();
    await seed(t);
    const byType = await t.withIdentity(asUser).query(api.crewMembers.listPage, { orgId: ORG, type: "FREELANCER" });
    expect(byType.items.map((m) => m.id)).toEqual(["CM2"]);

    const byDept = await t.withIdentity(asUser).query(api.crewMembers.listPage, { orgId: ORG, department: "Lighting" });
    expect(byDept.items.map((m) => m.id)).toEqual(["CM2"]);

    const byStatus = await t.withIdentity(asUser).query(api.crewMembers.listPage, { orgId: ORG, status: "ACTIVE" });
    expect(byStatus.items.map((m) => m.id)).toEqual(["CM1"]);
  });

  test("search matches firstName/lastName/email/department", async () => {
    const t = makeT();
    await seed(t);
    const byFirst = await t.withIdentity(asUser).query(api.crewMembers.listPage, { orgId: ORG, search: "alice" });
    expect(byFirst.items.map((m) => m.id)).toEqual(["CM1"]);
    const byDept = await t.withIdentity(asUser).query(api.crewMembers.listPage, { orgId: ORG, search: "lighting" });
    expect(byDept.items.map((m) => m.id)).toEqual(["CM2"]);
  });

  test("sorts by lastName by default", async () => {
    const t = makeT();
    await seed(t);
    const result = await t.withIdentity(asUser).query(api.crewMembers.listPage, { orgId: ORG });
    expect(result.items.map((m) => m.id)).toEqual(["CM2", "CM1"]); // Jones before Smith
  });

  test("cross-org isolation", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m2", organizationId: "org_2", userId: "user_2", role: "owner" });
    });
    const result = await t.withIdentity({ subject: "user_2", orgId: "org_2" }).query(api.crewMembers.listPage, { orgId: "org_2" });
    expect(result.items).toEqual([]);
  });
});
