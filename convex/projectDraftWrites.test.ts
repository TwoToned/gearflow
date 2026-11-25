// @vitest-environment node
//
// projectDraftWrites.discardDraftNative: ONE server-guarded verb behind the wizard's
// `Discard draft…` and the `Create as enquiry` Undo. Each guard has its own test, so
// removing any one of them fails exactly one test below. Also createNative's replay
// idempotency (the wizard mints its ids once).
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const USER = "user_1";
const OTHER = "user_2";
const NOW = 1_700_000_000_000;
const ACTOR = { userId: USER, userName: "Alice" };
const asUser = (subject = USER, orgId = ORG) => ({ subject, orgId });

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

/** An Enquiry created by USER: its project row, live version, member and CREATE audit row. */
async function seedDraft(t: T, over: { status?: string; isTemplate?: boolean } = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "member" });
    await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: OTHER, role: "member" });
    await ctx.db.insert("projects", {
      id: "p1", organizationId: ORG, projectNumber: "P-1", name: "Draft", status: (over.status ?? "ENQUIRY") as "ENQUIRY",
      isTemplate: over.isTemplate ?? false, liveVersionId: "v1", createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projectVersions", { id: "v1", organizationId: ORG, projectId: "p1", number: 1, contentState: "ready", createdAt: NOW, createdById: USER });
    await ctx.db.insert("projectManagers", { id: "pm1", organizationId: ORG, projectId: "p1", userId: USER, addedAt: NOW });
    await ctx.db.insert("activityLogs", {
      id: "create1", organizationId: ORG, action: "CREATE", entityType: "project", entityId: "p1", entityName: "P-1",
      userId: USER, userName: "Alice", summary: "Created project", projectId: "p1", createdAt: NOW,
    });
  });
}

const args = (over: Partial<{ via: "undo" | "discard"; createAuditId: string; projectId: string }> = {}) => ({
  orgId: ORG, projectId: "p1", createAuditId: "create1", via: "discard" as const, actor: ACTOR, auditId: "a1", now: NOW, ...over,
});
const call = (t: T, a: ReturnType<typeof args>, who = asUser()) => t.withIdentity(who).mutation(api.projectDraftWrites.discardDraftNative, a);
const exists = (t: T) => t.run(async (ctx) => !!(await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first()));

describe("discardDraftNative: the empty draft is deleted", () => {
  test("discard hard-deletes an empty draft the caller made, with its version and managers, and leaves a marker", async () => {
    const t = makeT();
    await seedDraft(t);
    expect(await call(t, args())).toEqual({ outcome: "deleted" });
    expect(await exists(t)).toBe(false);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("projectVersions").withIndex("by_projectId_number", (q) => q.eq("projectId", "p1")).collect()).toHaveLength(0);
      expect(await ctx.db.query("projectManagers").withIndex("by_projectId", (q) => q.eq("projectId", "p1")).collect()).toHaveLength(0);
      expect(await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "undo:create1")).first()).not.toBeNull();
    });
  });

  test("undo inside the window deletes it too", async () => {
    const t = makeT();
    await seedDraft(t);
    expect(await call(t, args({ via: "undo" }))).toEqual({ outcome: "deleted" });
    expect(await exists(t)).toBe(false);
  });
});

describe("discardDraftNative: every guard holds (undo refuses, discard cancels instead of deleting)", () => {
  test("Undo refuses after another user has written to the job", async () => {
    const t = makeT();
    await seedDraft(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("activityLogs", { id: "x1", organizationId: ORG, action: "UPDATE", entityType: "project", entityId: "p1", entityName: "P-1", userId: OTHER, userName: "Bob", summary: "Edited", projectId: "p1", createdAt: NOW });
    });
    await expect(call(t, args({ via: "undo" }))).rejects.toThrow(/someone else/);
    expect(await exists(t)).toBe(true);
  });

  test("Undo refuses once the job has a quote", async () => {
    const t = makeT();
    await seedDraft(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("quotes", { id: "q1", organizationId: ORG, projectId: "p1", version: 1, status: "DRAFT", snapshot: {} } as never);
    });
    await expect(call(t, args({ via: "undo" }))).rejects.toThrow(/quotes/);
    expect(await exists(t)).toBe(true);
  });

  test("Undo refuses once the job has a line", async () => {
    const t = makeT();
    await seedDraft(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { versionId: "v1", lineageId: "l1", id: "l1", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", quantity: 1, status: "QUOTED", sortOrder: 0, createdAt: NOW, updatedAt: NOW });
    });
    await expect(call(t, args({ via: "undo" }))).rejects.toThrow(/lines/);
    expect(await exists(t)).toBe(true);
  });

  test("Undo refuses when the job has more than one version", async () => {
    const t = makeT();
    await seedDraft(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectVersions", { id: "v2", organizationId: ORG, projectId: "p1", number: 2, contentState: "ready", createdAt: NOW, createdById: USER });
    });
    await expect(call(t, args({ via: "undo" }))).rejects.toThrow(/version/);
  });

  test("Undo refuses after the 10-minute window (server clock)", async () => {
    const t = makeT();
    await seedDraft(t);
    const realNow = Date.now;
    Date.now = () => realNow() + 11 * 60 * 1000;
    try {
      await expect(call(t, args({ via: "undo" }))).rejects.toThrow(/10 minutes/);
    } finally {
      Date.now = realNow;
    }
    expect(await exists(t)).toBe(true);
  });

  test("a second Undo refuses (marker), and a stale one after the delete finds nothing", async () => {
    const t = makeT();
    await seedDraft(t);
    await call(t, args({ via: "undo" }));
    await expect(call(t, args({ via: "undo", projectId: "p1" }))).rejects.toThrow();
    // The marker alone also refuses while the row exists (guard tested in isolation).
    const t2 = makeT();
    await seedDraft(t2);
    await t2.run(async (ctx) => {
      await ctx.db.insert("activityLogs", { id: "undo:create1", organizationId: ORG, action: "DELETE", entityType: "project", entityId: "p1", entityName: "P-1", userId: USER, userName: "Alice", summary: "marker", createdAt: NOW });
    });
    await expect(call(t2, args({ via: "undo" }))).rejects.toThrow(/already discarded/);
    expect(await exists(t2)).toBe(true);
  });

  test("a caller who did not create it cannot delete it (Undo refuses; Discard cancels)", async () => {
    const t = makeT();
    await seedDraft(t);
    await expect(call(t, args({ via: "undo" }), asUser(OTHER))).rejects.toThrow(/did not create/);
    expect(await exists(t)).toBe(true);
    expect(await call(t, { ...args(), actor: { userId: OTHER, userName: "Bob" } }, asUser(OTHER))).toEqual({ outcome: "cancelled" });
  });

  test("a create audit id from another project or org proves nothing", async () => {
    const t = makeT();
    await seedDraft(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("activityLogs", { id: "create-other", organizationId: ORG, action: "CREATE", entityType: "project", entityId: "someone-elses", entityName: "X", userId: USER, userName: "Alice", summary: "c", createdAt: NOW });
    });
    await expect(call(t, args({ via: "undo", createAuditId: "create-other" }))).rejects.toThrow(/did not create/);
    expect(await exists(t)).toBe(true);
  });

  test("Discard on a draft with lines CANCELS it (never deletes), and only while it is an Enquiry", async () => {
    const t = makeT();
    await seedDraft(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { versionId: "v1", lineageId: "l1", id: "l1", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", quantity: 1, status: "QUOTED", sortOrder: 0, createdAt: NOW, updatedAt: NOW });
    });
    expect(await call(t, args())).toEqual({ outcome: "cancelled" });
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(p?.status).toBe("CANCELLED");
    });
  });

  test("a job that has moved past Enquiry, and a template, refuse both verbs", async () => {
    const t = makeT();
    await seedDraft(t, { status: "QUOTING" });
    await expect(call(t, args())).rejects.toThrow(/moved on/);
    await expect(call(t, args({ via: "undo" }))).rejects.toThrow(/moved on/);
    const t2 = makeT();
    await seedDraft(t2, { isTemplate: true });
    await expect(call(t2, args())).rejects.toThrow(/moved on/);
  });

  test("another org's caller is refused", async () => {
    const t = makeT();
    await seedDraft(t);
    await expect(call(t, args(), asUser("user_9", "org_2"))).rejects.toThrow();
    expect(await exists(t)).toBe(true);
  });
});

describe("createNative replay", () => {
  const create = (t: T, over: Partial<{ auditId: string; who: ReturnType<typeof asUser> }> = {}) =>
    t.withIdentity(over.who ?? asUser()).mutation(api.projectWrites.createNative, {
      id: "p9", organizationId: ORG, projectNumber: "P-9", name: "Wizard draft", isTemplate: false, status: "ENQUIRY",
      createdAt: NOW, updatedAt: NOW, actor: ACTOR, auditId: over.auditId ?? "audit9",
    } as never);
  const count = (t: T) => t.run(async (ctx) => (await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p9")).collect()).length);

  test("the same create retried (same id and audit id, same caller) returns the row it made, never a second one", async () => {
    const t = makeT();
    await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "member" }); });
    expect(await create(t)).toEqual({ created: true, id: "p9" });
    expect(await create(t)).toEqual({ created: true, id: "p9" });
    expect(await count(t)).toBe(1);
  });

  test("a different audit id, or a different caller, with the same project id is still refused", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "member" });
      await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: OTHER, role: "member" });
    });
    await create(t);
    await expect(create(t, { auditId: "other-audit" })).rejects.toThrow(/already exists/);
    await expect(t.withIdentity(asUser(OTHER)).mutation(api.projectWrites.createNative, {
      id: "p9", organizationId: ORG, projectNumber: "P-10", name: "Hijack", isTemplate: false, status: "ENQUIRY",
      createdAt: NOW, updatedAt: NOW, actor: { userId: OTHER, userName: "Bob" }, auditId: "audit9",
    } as never)).rejects.toThrow(/already exists/);
    expect(await count(t)).toBe(1);
  });
});
