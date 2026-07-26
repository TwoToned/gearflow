// @vitest-environment node
//
// convex/crewRolesWrites.ts (create/update/archiveNative) — the previously-missing
// browser-direct write surface for CrewRole (WS10 #949). Verifies RBAC (crew:*),
// per-row org re-check, R-8.6.2 field-bound mirroring, the archive-with-usage-guard
// (non-blocking, returns counts), and cross-tenant rejection.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const actor = { userId: USER, userName: "Alice" };
const asManager = { subject: USER, orgId: ORG, role: "manager" };
const asMember = { subject: USER, orgId: ORG, role: "member" };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seedMember(t: T, role = "manager") {
  await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role }); });
}

const rolesFor = (t: T, orgId: string) =>
  t.run(async (ctx) => ctx.db.query("crewRoles").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect());

describe("crewRolesWrites", () => {
  test("create → update → archive → restore, with audit", async () => {
    const t = makeT(); await seedMember(t);
    await t.withIdentity(asManager).mutation(api.crewRolesWrites.createNative, {
      id: "r1", orgId: ORG, name: "Audio Tech", department: "Audio", defaultRate: 300, rateType: "DAILY", chargeRate: 500, now: NOW, actor, auditId: "a1",
    });
    let roles = await rolesFor(t, ORG);
    expect(roles[0].name).toBe("Audio Tech");
    expect(roles[0].isActive).toBe(true);

    await t.withIdentity(asManager).mutation(api.crewRolesWrites.updateNative, {
      id: "r1", orgId: ORG, name: "Senior Audio Tech", defaultRate: 350, chargeRate: 550, now: NOW + 1, actor, auditId: "a2",
    });
    roles = await rolesFor(t, ORG);
    expect(roles[0].name).toBe("Senior Audio Tech");
    expect(roles[0].defaultRate).toBe(350);
    expect(roles[0].chargeRate).toBe(550);

    const archived = await t.withIdentity(asManager).mutation(api.crewRolesWrites.archiveNative, {
      id: "r1", orgId: ORG, isActive: false, now: NOW + 2, actor, auditId: "a3",
    });
    expect(archived.isActive).toBe(false);
    roles = await rolesFor(t, ORG);
    expect(roles[0].isActive).toBe(false);

    const restored = await t.withIdentity(asManager).mutation(api.crewRolesWrites.archiveNative, {
      id: "r1", orgId: ORG, isActive: true, now: NOW + 3, actor, auditId: "a4",
    });
    expect(restored.isActive).toBe(true);
  });

  test("archive-with-usage-guard: archiving a role in active use is NON-BLOCKING but reports counts", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("crewRoles", { id: "r1", organizationId: ORG, name: "Rigger", isActive: true });
      await ctx.db.insert("crewMembers", { id: "cm1", organizationId: ORG, firstName: "Bob", lastName: "Roe", status: "ACTIVE", crewRoleId: "r1" });
      await ctx.db.insert("crewAssignments", { id: "a1", organizationId: ORG, projectId: "p1", crewMemberId: "cm1", crewRoleId: "r1" });
      await ctx.db.insert("projectServices", { id: "s1", organizationId: ORG, projectId: "p1", type: "LABOUR", title: "Show", quantity: 1, taxable: true, crewRoleId: "r1" });
    });
    const result = await t.withIdentity(asManager).mutation(api.crewRolesWrites.archiveNative, {
      id: "r1", orgId: ORG, isActive: false, now: NOW, actor, auditId: "a1",
    });
    // Non-blocking: it archived despite usage.
    expect(result.isActive).toBe(false);
    expect(result.usage).toEqual({ crewMembers: 1, crewAssignments: 1, projectServices: 1 });
    const roles = await rolesFor(t, ORG);
    expect(roles[0].isActive).toBe(false);
  });

  test("the read-only usage() query matches archiveNative's counts (pre-check parity)", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("crewRoles", { id: "r1", organizationId: ORG, name: "Rigger", isActive: true });
      await ctx.db.insert("crewMembers", { id: "cm1", organizationId: ORG, firstName: "Bob", lastName: "Roe", status: "ACTIVE", crewRoleId: "r1" });
    });
    const usage = await t.withIdentity(asManager).query(api.crewRoles.usage, { id: "r1", orgId: ORG });
    expect(usage).toEqual({ crewMembers: 1, crewAssignments: 0, projectServices: 0 });
  });

  test("update rejects a role in another org; RBAC rejects a member (crew:create/update are manager+ only)", async () => {
    const t = makeT(); await seedMember(t, "manager");
    await t.run(async (ctx) => { await ctx.db.insert("crewRoles", { id: "rX", organizationId: OTHER, name: "Theirs" }); });
    await expect(
      t.withIdentity(asManager).mutation(api.crewRolesWrites.updateNative, { id: "rX", orgId: ORG, name: "hijack", now: NOW, actor, auditId: "a1" }),
    ).rejects.toThrow(/not found/i);

    await t.run(async (ctx) => {
      const m = await ctx.db.query("members").withIndex("by_cuid", (q) => q.eq("id", "m1")).first();
      if (m) await ctx.db.patch(m._id, { role: "member" });
    });
    await expect(
      t.withIdentity(asMember).mutation(api.crewRolesWrites.createNative, { id: "r1", orgId: ORG, name: "X", now: NOW, actor, auditId: "a2" }),
    ).rejects.toThrow(/Forbidden|permission/i);
  });

  // R-8.6.2 — a direct-mutation caller (bypassing crewRoleSchema.parse() in the
  // browser hook) must still hit the same business-constraint bounds server-side.
  test("R-8.6.2: rejects an out-of-bound field even when the client-side Zod is bypassed", async () => {
    const t = makeT(); await seedMember(t);
    await expect(
      t.withIdentity(asManager).mutation(api.crewRolesWrites.createNative, {
        id: "r1", orgId: ORG, name: "X", defaultRate: -50, now: NOW, actor, auditId: "a1",
      }),
    ).rejects.toThrow(/at least 0/i);
  });

  test("idempotent create retry (same cuid) does not duplicate", async () => {
    const t = makeT(); await seedMember(t);
    const args = { id: "r1", orgId: ORG, name: "Audio Tech", now: NOW, actor, auditId: "a1" };
    await t.withIdentity(asManager).mutation(api.crewRolesWrites.createNative, args);
    await t.withIdentity(asManager).mutation(api.crewRolesWrites.createNative, { ...args, auditId: "a2" });
    expect(await rolesFor(t, ORG)).toHaveLength(1);
  });
});
