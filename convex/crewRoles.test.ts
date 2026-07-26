// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const USER = "user_1";
const asUser = (orgId: string, role?: string) => ({ subject: USER, orgId, role });

async function member(t: ReturnType<typeof convexTest>, role: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role });
  });
}

async function seedRole(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("crewRoles", {
      id: "r1", organizationId: ORG, name: "Audio Tech", department: "Audio",
      defaultRate: 300, rateType: "DAILY", chargeRate: 500,
    });
  });
}

/**
 * Role-gated visibility (WS10 #949) — `listForSettings` is the roles-admin read
 * that must strip cost (`defaultRate`) AND charge (`chargeRate`) for anyone below
 * manager+ standing, server-enforced (not just hidden client-side, R-9.3). The
 * decision is looked up from the `members` row (same query `requireOrgPermission`
 * uses), not the JWT's `role` claim, so a stale token can't leak the fields.
 */
describe("crewRoles.listForSettings — role-gated field visibility", () => {
  test("member payload has defaultRate/chargeRate stripped", async () => {
    const t = convexTest(schema, modules);
    await member(t, "member");
    await seedRole(t);
    const rows = await t.withIdentity(asUser(ORG)).query(api.crewRoles.listForSettings, { orgId: ORG });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Audio Tech"); // non-sensitive fields still present
    expect(rows[0].defaultRate).toBeUndefined();
    expect(rows[0].chargeRate).toBeUndefined();
  });

  test("manager payload keeps both rate fields", async () => {
    const t = convexTest(schema, modules);
    await member(t, "manager");
    await seedRole(t);
    const rows = await t.withIdentity(asUser(ORG)).query(api.crewRoles.listForSettings, { orgId: ORG });
    expect(rows[0].defaultRate).toBe(300);
    expect(rows[0].chargeRate).toBe(500);
  });

  test("owner/admin payload also keeps both rate fields", async () => {
    const t = convexTest(schema, modules);
    await member(t, "admin");
    await seedRole(t);
    const rows = await t.withIdentity(asUser(ORG)).query(api.crewRoles.listForSettings, { orgId: ORG });
    expect(rows[0].defaultRate).toBe(300);
    expect(rows[0].chargeRate).toBe(500);
  });

  test("viewer/warehouse payload has fields stripped, same as member", async () => {
    const t = convexTest(schema, modules);
    await member(t, "viewer");
    await seedRole(t);
    const rows = await t.withIdentity(asUser(ORG)).query(api.crewRoles.listForSettings, { orgId: ORG });
    expect(rows[0].defaultRate).toBeUndefined();
    expect(rows[0].chargeRate).toBeUndefined();
  });

  test("the plain `list` query (used by cost-preview call sites) is UNCHANGED — still full rows for everyone", async () => {
    const t = convexTest(schema, modules);
    await member(t, "member");
    await seedRole(t);
    const rows = await t.withIdentity(asUser(ORG)).query(api.crewRoles.list, { orgId: ORG });
    expect(rows[0].defaultRate).toBe(300);
    expect(rows[0].chargeRate).toBe(500);
  });
});
