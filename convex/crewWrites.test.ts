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

async function member(t: ReturnType<typeof convexTest>, role: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role });
  });
}
async function seedCrew(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("crewMembers", { id: "c1", organizationId: ORG, firstName: "Bob", lastName: "Ryan", status: "ACTIVE", isActive: true, notes: "old", createdAt: NOW, updatedAt: NOW });
  });
}

describe("crewWrites.createNative", () => {
  const createArgs = { id: "c1", organizationId: ORG, firstName: "Ada", lastName: "Lovelace", status: "ACTIVE" as const, createdAt: NOW, updatedAt: NOW, actor: ACTOR, auditId: "log1" };

  test("a manager creates a crew member + CREATE audit", async () => {
    const t = convexTest(schema, modules);
    await member(t, "manager");
    const res = await t.withIdentity(asUser(ORG)).mutation(api.crewWrites.createNative, createArgs);
    expect(res.id).toBe("c1");
    await t.run(async (ctx) => {
      const c = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", "c1")).first();
      expect(c?.firstName).toBe("Ada");
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("CREATE");
      expect(log?.entityType).toBe("crew_member");
    });
  });

  test("idempotent by cuid (retried create doesn't duplicate)", async () => {
    const t = convexTest(schema, modules);
    await seedCrew(t); // c1 already exists
    await t.withIdentity(SERVICE).mutation(api.crewWrites.createNative, { ...createArgs, auditId: "log2" });
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", "c1")).collect();
      expect(rows).toHaveLength(1);
      expect(rows[0].firstName).toBe("Bob"); // original kept (createIfMissing semantics)
    });
  });

  test("a member (crew:read only) is denied create", async () => {
    const t = convexTest(schema, modules);
    await member(t, "member");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.crewWrites.createNative, createArgs),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("crewWrites.updateNative", () => {
  const updArgs = { id: "c1", orgId: ORG, set: { firstName: "Robert", updatedAt: NOW }, clear: [] as string[], entityName: "Robert Ryan", actor: ACTOR, auditId: "log1", now: NOW };

  test("applies set + UPDATE audit", async () => {
    const t = convexTest(schema, modules);
    await seedCrew(t);
    await t.withIdentity(SERVICE).mutation(api.crewWrites.updateNative, updArgs);
    await t.run(async (ctx) => {
      const c = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", "c1")).first();
      expect(c?.firstName).toBe("Robert");
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("UPDATE");
    });
  });

  test("clear removes a field", async () => {
    const t = convexTest(schema, modules);
    await seedCrew(t);
    await t.withIdentity(SERVICE).mutation(api.crewWrites.updateNative, { ...updArgs, set: { updatedAt: NOW }, clear: ["notes"] });
    await t.run(async (ctx) => {
      const c = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", "c1")).first();
      expect(c?.notes).toBeUndefined();
    });
  });

  test("a member is denied update", async () => {
    const t = convexTest(schema, modules);
    await seedCrew(t);
    await member(t, "member");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.crewWrites.updateNative, updArgs),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});
