// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
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
    const t = convexTest(schema, modules);
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
    const t = convexTest(schema, modules);
    await seedProject(t, undefined, true);
    await expect(
      t.withIdentity(SERVICE).mutation(api.projectWrites.updateStatusNative, args),
    ).rejects.toThrow(/template/i);
  });

  test("a viewer is denied (project:update)", async () => {
    const t = convexTest(schema, modules);
    await seedProject(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateStatusNative, args),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("projectWrites.updateNotesNative", () => {
  test("patches a whitelisted notes field + audit; clears on null", async () => {
    const t = convexTest(schema, modules);
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
    const t = convexTest(schema, modules);
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
    const t = convexTest(schema, modules);
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
    const t = convexTest(schema, modules);
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
    const t = convexTest(schema, modules);
    await seedProject(t, "viewer");
    await expect(t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateNative, { ...uargs, set: { updatedAt: NOW }, clear: [] })).rejects.toThrow(/insufficient permissions/i);
  });
});
