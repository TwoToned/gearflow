// @vitest-environment node
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
// Counted project writes go through the sharded counter component (gate #3); mount it.
// enforceBrowserWriteLimit goes through the rate-limiter component; mount it too.
function makeT() {
  const tc = convexTest(schema, modules);
  registerRateLimiter(tc, "rateLimiter");
  registerShardedCounter(tc, "shardedCounter");
  return tc;
}
const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const asUser = (orgId: string) => ({ subject: USER, orgId });
const ACTOR = { userId: USER, userName: "Alice" };

async function seedProject(t: ReturnType<typeof convexTest>, role?: string, isTemplate = false) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate, createdAt: NOW, updatedAt: NOW });
    if (role) await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role });
  });
}

describe("projectWrites.updateStatusNative", () => {
  const args = { id: "p1", orgId: ORG, status: "PREPPING" as const, actor: ACTOR, auditId: "log1", now: NOW };

  test("member changes status + STATUS_CHANGE audit (from/to)", async () => {
    const t = makeT();
    await seedProject(t, "member");
    await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateStatusNative, args);
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(p?.status).toBe("PREPPING");
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("STATUS_CHANGE");
      expect(log?.details).toEqual({ changes: [{ field: "status", from: "CONFIRMED", to: "PREPPING" }] });
    });
  });

  test("rejects a template (TEMPLATE_STATUS)", async () => {
    const t = makeT();
    await seedProject(t, undefined, true);
    await expect(
      t.withIdentity(SERVICE).mutation(api.projectWrites.updateStatusNative, args),
    ).rejects.toThrow(/template/i);
  });

  test("a viewer is denied (project:update)", async () => {
    const t = makeT();
    await seedProject(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateStatusNative, args),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("projectWrites.updateNotesNative", () => {
  test("patches a whitelisted notes field + audit; clears on null", async () => {
    const t = makeT();
    await seedProject(t);
    await t.withIdentity(SERVICE).mutation(api.projectWrites.updateNotesNative, { id: "p1", orgId: ORG, field: "crewNotes", notes: "load in 6am", actor: ACTOR, auditId: "log1", now: NOW });
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(p?.crewNotes).toBe("load in 6am");
    });
    await t.withIdentity(SERVICE).mutation(api.projectWrites.updateNotesNative, { id: "p1", orgId: ORG, field: "crewNotes", notes: null, actor: ACTOR, auditId: "log2", now: NOW });
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(p?.crewNotes).toBeUndefined();
    });
  });
});

describe("projectWrites.archiveNative", () => {
  test("sets status CANCELLED + audit", async () => {
    const t = makeT();
    await seedProject(t);
    await t.withIdentity(SERVICE).mutation(api.projectWrites.archiveNative, { id: "p1", orgId: ORG, actor: ACTOR, auditId: "log1", now: NOW });
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(p?.status).toBe("CANCELLED");
    });
  });
});

describe("projectWrites.updateNative", () => {
  const uargs = { id: "p1", orgId: ORG, actor: ACTOR, auditId: "log1", now: NOW };
  test("member patches fields + UPDATE audit (label from doc)", async () => {
    const t = makeT();
    await seedProject(t, "member");
    await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateNative, { ...uargs, set: { name: "Renamed Gig", taxRate: 10, updatedAt: NOW }, clear: [] });
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(p?.name).toBe("Renamed Gig");
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("UPDATE");
      expect(log?.entityName).toBe("P1");
      expect(log?.summary).toContain("Renamed Gig");
    });
  });
  test("clear removes a field", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false, clientNotes: "x", createdAt: NOW, updatedAt: NOW });
    });
    await t.withIdentity(SERVICE).mutation(api.projectWrites.updateNative, { ...uargs, set: { updatedAt: NOW }, clear: ["clientNotes"] });
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(p?.clientNotes).toBeUndefined();
    });
  });
  test("viewer denied", async () => {
    const t = makeT();
    await seedProject(t, "viewer");
    await expect(t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateNative, { ...uargs, set: { updatedAt: NOW }, clear: [] })).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("projectWrites.createNative", () => {
  const cargs = { id: "np1", organizationId: ORG, projectNumber: "P-100", name: "New Gig", isTemplate: false, createdAt: NOW, updatedAt: NOW, actor: ACTOR, auditId: "log1" };
  test("member creates a project + CREATE audit (created:true)", async () => {
    const t = makeT();
    await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "member" }); });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.createNative, cargs);
    expect(res).toEqual({ created: true, id: "np1" });
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "np1")).first();
      expect(p?.projectNumber).toBe("P-100");
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("CREATE");
    });
  });
  test("returns created:false + no insert/audit on a number clash", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "existing", organizationId: ORG, projectNumber: "P-100", name: "Taken", status: "CONFIRMED", isTemplate: false, createdAt: NOW, updatedAt: NOW });
    });
    const res = await t.withIdentity(SERVICE).mutation(api.projectWrites.createNative, cargs);
    expect(res).toEqual({ created: false, id: "existing" });
    await t.run(async (ctx) => {
      const np = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "np1")).first();
      expect(np).toBeNull();
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log).toBeNull();
    });
  });
  test("a viewer is denied (project:create)", async () => {
    const t = makeT();
    await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "viewer" }); });
    await expect(t.withIdentity(asUser(ORG)).mutation(api.projectWrites.createNative, cargs)).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("projectWrites.deleteNative", () => {
  const dargs = { id: "p1", orgId: ORG, freedAssets: 2, freedKits: 1, actor: ACTOR, auditId: "log1", now: NOW };
  test("owner deletes project + DELETE audit (freed counts)", async () => {
    const t = makeT();
    await seedProject(t, "owner");
    await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.deleteNative, dargs);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first()).toBeNull();
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("DELETE");
      expect((log?.details as { freedAssets: number }).freedAssets).toBe(2);
    });
  });
  test("a member (no project:delete) is denied", async () => {
    const t = makeT();
    await seedProject(t, "member");
    await expect(t.withIdentity(asUser(ORG)).mutation(api.projectWrites.deleteNative, dargs)).rejects.toThrow(/insufficient permissions/i);
  });
});
