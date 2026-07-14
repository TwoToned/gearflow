// @vitest-environment node
//
// convex/projectManagersWrites.ts — browser-direct project-manager writes. Verifies:
// membership validation (Convex members mirror), user-label audit (users mirror),
// add idempotency, remove, the setNative diff (add/remove delta), per-row org re-check
// on the project, RBAC (project:manage = owner-only), and cross-tenant isolation.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const OTHER = "org_2";
const OWNER = "user_owner";
const NOW = 1_700_000_000_000;
const actor = { userId: OWNER, userName: "Olivia" };
const asOwner = { subject: OWNER, orgId: ORG };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

/** Owner + a couple of member users, a project — all in ORG. */
async function seed(t: T, opts: { projectOrg?: string } = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m_owner", organizationId: ORG, userId: OWNER, role: "owner" });
    await ctx.db.insert("members", { id: "m_u1", organizationId: ORG, userId: "u1", role: "member" });
    await ctx.db.insert("members", { id: "m_u2", organizationId: ORG, userId: "u2", role: "member" });
    await ctx.db.insert("users", { id: "u1", name: "Uno", email: "u1@x.co" });
    await ctx.db.insert("users", { id: "u2", name: "", email: "u2@x.co" });
    await ctx.db.insert("projects", {
      id: "P1", organizationId: opts.projectOrg ?? ORG, projectNumber: "P1", name: "Gig",
      status: "CONFIRMED", isTemplate: false, createdAt: NOW, updatedAt: NOW,
    });
  });
}

const pmRows = (t: T) =>
  t.run(async (ctx) => ctx.db.query("projectManagers").withIndex("by_projectId", (q) => q.eq("projectId", "P1")).collect());

describe("projectManagersWrites", () => {
  test("add validates membership, is idempotent, audits with the user label", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asOwner).mutation(api.projectManagersWrites.addNative, {
      id: "pm1", projectId: "P1", orgId: ORG, userId: "u1", now: NOW, actor, auditId: "a1",
    });
    // Idempotent — a second add for the same (project,user) is a no-op.
    await t.withIdentity(asOwner).mutation(api.projectManagersWrites.addNative, {
      id: "pm1b", projectId: "P1", orgId: ORG, userId: "u1", now: NOW, actor, auditId: "a1b",
    });
    const rows = await pmRows(t);
    expect(rows.map((r) => r.userId)).toEqual(["u1"]);
    const audit = await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "a1")).first());
    expect(audit?.summary).toBe("Added Uno as project manager");
  });

  test("add rejects a non-member", async () => {
    const t = makeT(); await seed(t);
    await expect(
      t.withIdentity(asOwner).mutation(api.projectManagersWrites.addNative, {
        id: "pm1", projectId: "P1", orgId: ORG, userId: "outsider", now: NOW, actor, auditId: "a1",
      }),
    ).rejects.toThrow(/not a member/i);
  });

  test("remove drops the assignment + audits (label falls back to email when name blank)", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectManagers", { id: "pm2", organizationId: ORG, projectId: "P1", userId: "u2", addedAt: NOW });
    });
    await t.withIdentity(asOwner).mutation(api.projectManagersWrites.removeNative, {
      projectId: "P1", orgId: ORG, userId: "u2", now: NOW, actor, auditId: "r1",
    });
    expect(await pmRows(t)).toHaveLength(0);
    const audit = await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "r1")).first());
    expect(audit?.summary).toBe("Removed u2@x.co as project manager");
  });

  test("setNative applies the add/remove diff to exactly the desired set", async () => {
    const t = makeT(); await seed(t);
    // Start with u1 assigned; desire {u1, u2} → add u2, keep u1.
    await t.run(async (ctx) => {
      await ctx.db.insert("projectManagers", { id: "pmX", organizationId: ORG, projectId: "P1", userId: "u1", addedAt: NOW });
    });
    const res = await t.withIdentity(asOwner).mutation(api.projectManagersWrites.setNative, {
      projectId: "P1", orgId: ORG, userIds: ["u1", "u2"], now: NOW, actor, auditPrefix: "run1",
    });
    expect(res).toEqual({ added: ["u2"], removed: [] });
    expect((await pmRows(t)).map((r) => r.userId).sort()).toEqual(["u1", "u2"]);

    // Now desire {u2} → remove u1.
    const res2 = await t.withIdentity(asOwner).mutation(api.projectManagersWrites.setNative, {
      projectId: "P1", orgId: ORG, userIds: ["u2"], now: NOW, actor, auditPrefix: "run2",
    });
    expect(res2).toEqual({ added: [], removed: ["u1"] });
    expect((await pmRows(t)).map((r) => r.userId)).toEqual(["u2"]);
  });

  test("setNative rejects when an added user is not an org member (nothing mutated)", async () => {
    const t = makeT(); await seed(t);
    await expect(
      t.withIdentity(asOwner).mutation(api.projectManagersWrites.setNative, {
        projectId: "P1", orgId: ORG, userIds: ["u1", "outsider"], now: NOW, actor, auditPrefix: "run1",
      }),
    ).rejects.toThrow(/not a member/i);
    expect(await pmRows(t)).toHaveLength(0);
  });

  test("project:manage is owner-only — a non-owner member is rejected", async () => {
    const t = makeT(); await seed(t);
    // u1 is a plain member (not owner) → no project:manage.
    await expect(
      t.withIdentity({ subject: "u1", orgId: ORG, role: "member" }).mutation(api.projectManagersWrites.addNative, {
        id: "pm1", projectId: "P1", orgId: ORG, userId: "u2", now: NOW, actor: { userId: "u1", userName: "Uno" }, auditId: "a1",
      }),
    ).rejects.toThrow(/Forbidden|permission/i);
  });

  test("remove rejects a row whose project belongs to another org (no cross-org audit)", async () => {
    const t = makeT(); await seed(t, { projectOrg: OTHER });
    // A pm row stamped org A but referencing a project that lives in org B.
    await t.run(async (ctx) => {
      await ctx.db.insert("projectManagers", { id: "pmC", organizationId: ORG, projectId: "P1", userId: "u1", addedAt: NOW });
    });
    await expect(
      t.withIdentity(asOwner).mutation(api.projectManagersWrites.removeNative, {
        projectId: "P1", orgId: ORG, userId: "u1", now: NOW, actor, auditId: "r1",
      }),
    ).rejects.toThrow(/not found/i);
    expect(await pmRows(t)).toHaveLength(1); // untouched
  });

  test("cross-tenant: cannot add a manager to a project in another org", async () => {
    const t = makeT(); await seed(t, { projectOrg: OTHER });
    await expect(
      t.withIdentity(asOwner).mutation(api.projectManagersWrites.addNative, {
        id: "pm1", projectId: "P1", orgId: ORG, userId: "u1", now: NOW, actor, auditId: "a1",
      }),
    ).rejects.toThrow(/Project not found/i);
  });
});
