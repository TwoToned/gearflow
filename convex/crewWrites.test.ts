// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
// Crew mutations enforce a browser write limit (rate-limiter component) and counted
// crew writes go through the sharded counter component (gate #3); mount both.
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
    const t = makeT();
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
    const t = makeT();
    await seedCrew(t); // c1 already exists
    await t.withIdentity(SERVICE).mutation(api.crewWrites.createNative, { ...createArgs, auditId: "log2" });
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", "c1")).collect();
      expect(rows).toHaveLength(1);
      expect(rows[0].firstName).toBe("Bob"); // original kept (createIfMissing semantics)
    });
  });

  test("a member (crew:read only) is denied create", async () => {
    const t = makeT();
    await member(t, "member");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.crewWrites.createNative, createArgs),
    ).rejects.toThrow(/insufficient permissions/i);
  });

  test("validation: blank name + bad email rejected", async () => {
    const t = makeT(); await member(t, "manager");
    await expect(t.withIdentity(asUser(ORG)).mutation(api.crewWrites.createNative, { ...createArgs, firstName: "" })).rejects.toThrow(/first name/i);
    await expect(t.withIdentity(asUser(ORG)).mutation(api.crewWrites.createNative, { ...createArgs, email: "nope" })).rejects.toThrow(/email/i);
  });

  // R-8.6.2 — a direct-mutation caller (bypassing crewMemberSchema.parse() in the
  // browser hook) must still hit the same business-constraint bounds server-side.
  test("rejects a phone over the 50-char bound", async () => {
    const t = makeT(); await member(t, "manager");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.crewWrites.createNative, { ...createArgs, phone: "5".repeat(51) }),
    ).rejects.toThrow(/phone/i);
  });

  test("rejects a negative defaultDayRate", async () => {
    const t = makeT(); await member(t, "manager");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.crewWrites.createNative, { ...createArgs, defaultDayRate: -1 }),
    ).rejects.toThrow(/defaultDayRate/);
  });

  test("rejects latitude supplied without longitude (crewMemberSchema .refine())", async () => {
    const t = makeT(); await member(t, "manager");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.crewWrites.createNative, { ...createArgs, addressLatitude: 10 }),
    ).rejects.toThrow(/latitude and longitude/i);
  });
});

describe("crewWrites.updateNative", () => {
  const updArgs = { id: "c1", orgId: ORG, set: { firstName: "Robert", updatedAt: NOW }, clear: [] as string[], actor: ACTOR, auditId: "log1", now: NOW };

  test("applies set + UPDATE audit with computed entityName + field diff", async () => {
    const t = makeT();
    await seedCrew(t);
    await t.withIdentity(SERVICE).mutation(api.crewWrites.updateNative, updArgs);
    await t.run(async (ctx) => {
      const c = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", "c1")).first();
      expect(c?.firstName).toBe("Robert");
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("UPDATE");
      expect(log?.entityName).toBe("Robert Ryan"); // computed from after
      const changes = (log?.details as { changes?: { field: string; from: unknown; to: unknown }[] })?.changes ?? [];
      expect(changes).toContainEqual({ field: "firstName", from: "Bob", to: "Robert" });
    });
  });

  test("clear removes a field", async () => {
    const t = makeT();
    await seedCrew(t);
    await t.withIdentity(SERVICE).mutation(api.crewWrites.updateNative, { ...updArgs, set: { updatedAt: NOW }, clear: ["notes"] });
    await t.run(async (ctx) => {
      const c = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", "c1")).first();
      expect(c?.notes).toBeUndefined();
    });
  });

  test("a member is denied update", async () => {
    const t = makeT();
    await seedCrew(t);
    await member(t, "member");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.crewWrites.updateNative, updArgs),
    ).rejects.toThrow(/insufficient permissions/i);
  });

  // R-8.6.2 — same bound as createNative, enforced on the `set` patch too (previously
  // only createNative validated; a direct-mutation caller could otherwise skip the
  // bound entirely by only ever calling updateNative).
  test("rejects a notes patch over the 2000-char bound", async () => {
    const t = makeT();
    await seedCrew(t);
    await expect(
      t.withIdentity(SERVICE).mutation(api.crewWrites.updateNative, { ...updArgs, set: { ...updArgs.set, notes: "x".repeat(2001) } }),
    ).rejects.toThrow(/notes/);
  });

  test("rejects a blank firstName patch", async () => {
    const t = makeT();
    await seedCrew(t);
    await expect(
      t.withIdentity(SERVICE).mutation(api.crewWrites.updateNative, { ...updArgs, set: { firstName: "", updatedAt: NOW } }),
    ).rejects.toThrow(/firstName/);
  });
});

describe("crewWrites.deleteNative", () => {
  const dargs = { id: "c1", orgId: ORG, actor: ACTOR, auditId: "log1", now: NOW };
  test("owner deletes a crew member + DELETE audit (name derived from doc)", async () => {
    const t = makeT();
    await member(t, "owner"); await seedCrew(t);
    await t.withIdentity(asUser(ORG)).mutation(api.crewWrites.deleteNative, dargs);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", "c1")).first()).toBeNull();
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("DELETE");
      expect(log?.entityName).toBe("Bob Ryan");
    });
  });

  test("delete cascades assignments (+shifts/linked entries), standalone entries, availabilities", async () => {
    const t = makeT();
    await member(t, "owner"); await seedCrew(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("crewAssignments", { id: "as1", organizationId: ORG, crewMemberId: "c1", projectId: "p1", status: "CONFIRMED" });
      await ctx.db.insert("crewShifts", { id: "sh1", assignmentId: "as1", date: NOW });
      await ctx.db.insert("crewTimeEntries", { id: "te-linked", organizationId: ORG, crewMemberId: "c1", assignmentId: "as1", date: NOW, startTime: "09:00", endTime: "17:00" });
      await ctx.db.insert("crewTimeEntries", { id: "te-standalone", organizationId: ORG, crewMemberId: "c1", date: NOW, startTime: "09:00", endTime: "17:00" });
      await ctx.db.insert("crewAvailabilities", { id: "av1", organizationId: ORG, crewMemberId: "c1", startDate: NOW, endDate: NOW });
      // foreign-org rows on a same-name index must survive
      await ctx.db.insert("crewAssignments", { id: "asX", organizationId: "org_2", crewMemberId: "c1", projectId: "pX", status: "CONFIRMED" });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.crewWrites.deleteNative, dargs);
    await t.run(async (ctx) => {
      for (const [table, id] of [["crewAssignments", "as1"], ["crewShifts", "sh1"], ["crewTimeEntries", "te-linked"], ["crewTimeEntries", "te-standalone"], ["crewAvailabilities", "av1"]] as const) {
        expect(await ctx.db.query(table).withIndex("by_cuid", (q) => q.eq("id", id)).first()).toBeNull();
      }
      // foreign-org assignment untouched
      expect(await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", "asX")).first()).not.toBeNull();
    });
  });

  test("a member (no crew:delete) is denied", async () => {
    const t = makeT();
    await member(t, "member"); await seedCrew(t);
    await expect(t.withIdentity(asUser(ORG)).mutation(api.crewWrites.deleteNative, dargs)).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("crew reads", () => {
  test("memberDetail: member + role + skills + user(mirror) + assignments; null cross-org", async () => {
    const t = makeT(); await member(t, "manager");
    await t.run(async (ctx) => {
      await ctx.db.insert("crewMembers", { id: "c1", organizationId: ORG, firstName: "Bob", lastName: "Ryan", crewRoleId: "r1", skillIds: ["s1"], userId: USER, isActive: true });
      await ctx.db.insert("crewRoles", { id: "r1", organizationId: ORG, name: "Rigger", color: "#f00" });
      await ctx.db.insert("crewSkills", { id: "s1", organizationId: ORG, name: "Rigging" });
      await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false });
      await ctx.db.insert("crewAssignments", { id: "as1", organizationId: ORG, crewMemberId: "c1", projectId: "p1", crewRoleId: "r1", status: "CONFIRMED", startDate: NOW });
      await ctx.db.insert("crewMembers", { id: "cX", organizationId: "org_2", firstName: "F", lastName: "F", isActive: true });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.crew.memberDetail, { id: "c1", orgId: ORG });
    expect(res?.firstName).toBe("Bob");
    expect(res?.crewRole?.name).toBe("Rigger");
    expect(res?.skills.map((s) => s.name)).toEqual(["Rigging"]);
    expect(res?.user?.name).toBe("Alice");
    expect(res?.assignments[0].project?.projectNumber).toBe("P1");
    expect(res?.isOwnProfile).toBe(true);
    expect(await t.withIdentity(asUser(ORG)).query(api.crew.memberDetail, { id: "cX", orgId: ORG })).toBeNull();
  });

  test("memberExtras + myCrewMemberId + orgUsersForCrewLink", async () => {
    const t = makeT(); await member(t, "manager");
    await t.run(async (ctx) => {
      await ctx.db.insert("crewMembers", { id: "c1", organizationId: ORG, firstName: "Bob", lastName: "Ryan", skillIds: ["s1"], userId: USER, isActive: true });
      await ctx.db.insert("crewSkills", { id: "s1", organizationId: ORG, name: "Rigging" });
      await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com", image: "http://i/a.png" });
    });
    const extras = await t.withIdentity(asUser(ORG)).query(api.crew.memberExtras, { orgId: ORG });
    expect(extras["c1"].userName).toBe("Alice");
    expect(extras["c1"].skills.map((s) => s.name)).toEqual(["Rigging"]);
    expect(await t.withIdentity(asUser(ORG)).query(api.crew.myCrewMemberId, { orgId: ORG })).toBe("c1");
    const linkable = await t.withIdentity(asUser(ORG)).query(api.crew.orgUsersForCrewLink, { orgId: ORG });
    expect(linkable.find((u) => u.id === USER)?.alreadyLinked).toBe(true);
  });

  test("memberDetail/memberExtras enforce crew:read (not just org membership)", async () => {
    // A member of the org whose role lacks crew:read (unknown role → fail-closed).
    // requireOrgRead would have served crew PII on org-match alone; the tightened
    // requireOrgPermission gate must reject — parity with the old requirePermission.
    const t = makeT(); await member(t, "norole");
    await t.run(async (ctx) => {
      await ctx.db.insert("crewMembers", { id: "c1", organizationId: ORG, firstName: "Bob", lastName: "Ryan", isActive: true });
    });
    await expect(t.withIdentity(asUser(ORG)).query(api.crew.memberDetail, { id: "c1", orgId: ORG })).rejects.toThrow(/Forbidden|permission/i);
    await expect(t.withIdentity(asUser(ORG)).query(api.crew.memberExtras, { orgId: ORG })).rejects.toThrow(/Forbidden|permission/i);
  });
});
