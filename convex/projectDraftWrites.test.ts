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

  test("a non-author is refused for BOTH verbs and the job is untouched (no cancel back door)", async () => {
    const t = makeT();
    await seedDraft(t);
    const other = { ...args(), actor: { userId: OTHER, userName: "Bob" } };
    await expect(call(t, { ...other, via: "undo" }, asUser(OTHER))).rejects.toThrow(/Only the person who created/);
    await expect(call(t, other, asUser(OTHER))).rejects.toThrow(/Only the person who created/);
    // A made-up create audit id proves nothing either.
    await expect(call(t, { ...other, createAuditId: "bogus" }, asUser(OTHER))).rejects.toThrow(/Only the person who created/);
    await expect(call(t, args({ createAuditId: "bogus" }))).rejects.toThrow(/Only the person who created/);
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(p?.status).toBe("ENQUIRY");
    });
  });

  // Each field of the authorship proof, tested alone: a row that is right in every other way.
  test.each([
    ["another org", { organizationId: "org_2" }],
    ["another entity type", { entityType: "asset" }],
    ["another project", { entityId: "someone-elses" }],
    ["not a CREATE row", { action: "UPDATE" }],
    ["another user", { userId: OTHER }],
  ])("the create audit row must be this org's, this project's, a project CREATE by the caller: %s refuses", async (_label, patch) => {
    const t = makeT();
    await seedDraft(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("activityLogs", {
        id: "forged", organizationId: ORG, action: "CREATE", entityType: "project", entityId: "p1", entityName: "P-1",
        userId: USER, userName: "Alice", summary: "c", projectId: "p1", createdAt: NOW, ...patch,
      });
    });
    await expect(call(t, args({ via: "undo", createAuditId: "forged" }))).rejects.toThrow(/Only the person who created/);
    expect(await exists(t)).toBe(true);
  });

  test("more than 50 audit rows is too many to vouch for: Undo refuses even when they are all the author's", async () => {
    const t = makeT();
    await seedDraft(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 51; i++) {
        await ctx.db.insert("activityLogs", { id: `own${i}`, organizationId: ORG, action: "UPDATE", entityType: "project", entityId: "p1", entityName: "P-1", userId: USER, userName: "Alice", summary: "e", projectId: "p1", createdAt: NOW });
      }
    });
    await expect(call(t, args({ via: "undo" }))).rejects.toThrow(/someone else/);
    expect(await exists(t)).toBe(true);
  });

  test("a project in another org is refused even with a matching create row", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "member" });
      await ctx.db.insert("projects", { id: "pz", organizationId: "org_2", projectNumber: "Z", name: "Theirs", status: "ENQUIRY", isTemplate: false, liveVersionId: "vz", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectVersions", { id: "vz", organizationId: "org_2", projectId: "pz", number: 1, contentState: "ready", createdAt: NOW, createdById: USER });
      await ctx.db.insert("activityLogs", { id: "cz", organizationId: "org_2", action: "CREATE", entityType: "project", entityId: "pz", entityName: "Z", userId: USER, userName: "Alice", summary: "c", projectId: "pz", createdAt: NOW });
    });
    await expect(call(t, args({ projectId: "pz", createAuditId: "cz" }))).rejects.toThrow(/organization mismatch/);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "pz")).first()).not.toBeNull();
    });
  });

  test("the delete path re-checks project:create: a key scoped to update only cannot delete", async () => {
    const t = makeT();
    await seedDraft(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("apiKeys", {
        id: "key1", organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h",
        scopes: JSON.stringify(["project:update"]), isActive: true, actingUserId: USER, createdById: USER,
      });
    });
    await expect(call(t, args(), { subject: USER, orgId: ORG, akid: "key1" } as ReturnType<typeof asUser>)).rejects.toThrow();
    expect(await exists(t)).toBe(true);
  });

  test("the cancel path runs the normal status transition: a STATUS_CHANGE audit row, not a bare patch", async () => {
    const t = makeT();
    await seedDraft(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { versionId: "v1", lineageId: "l1", id: "l1", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", quantity: 1, status: "QUOTED", sortOrder: 0, createdAt: NOW, updatedAt: NOW });
    });
    expect(await call(t, args())).toEqual({ outcome: "cancelled" });
    await t.run(async (ctx) => {
      const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "a1")).first();
      expect(row?.action).toBe("STATUS_CHANGE");
      expect(row?.details).toEqual({ changes: [{ field: "status", from: "ENQUIRY", to: "CANCELLED" }] });
    });
  });

  test("the cancel emits project.status_changed like any status change (emitSideEffects is on)", async () => {
    const t = makeT();
    await seedDraft(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("webhooks", { id: "wh1", organizationId: ORG, description: "Zapier", url: "https://example.test/hook", events: JSON.stringify(["project.status_changed"]), secret: "s", isActive: true, createdById: USER, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", { versionId: "v1", lineageId: "l1", id: "l1", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", quantity: 1, status: "QUOTED", sortOrder: 0, createdAt: NOW, updatedAt: NOW });
    });
    expect(await call(t, args())).toEqual({ outcome: "cancelled" });
    const rows = await t.run(async (ctx) => ctx.db.query("webhookDeliveries").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect());
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].payload)).toEqual({ projectId: "p1", projectNumber: "P-1", name: "Draft", from: "ENQUIRY", to: "CANCELLED" });
  });

  test("discarding with a manager row removes it; a draft that fills the manager bound refuses instead of orphaning", async () => {
    const t = makeT();
    await seedDraft(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 200; i++) {
        await ctx.db.insert("projectManagers", { id: `pmx${i}`, organizationId: ORG, projectId: "p1", userId: `u${i}`, addedAt: NOW });
      }
    });
    await expect(call(t, args())).rejects.toThrow(/too many managers/);
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

// One row in each table the draft must NOT have, inserted alone: the matching probe is the only thing that can refuse.
const NOT_EMPTY: [string, string, Record<string, unknown>][] = [
  ["services", "projectServices", { id: "x", organizationId: ORG, versionId: "v1", lineageId: "x", projectId: "p1", title: "Bump in", type: "DELIVERY" }],
  ["cases", "projectContainers", { id: "x", organizationId: ORG, versionId: "v1", lineageId: "x", projectId: "p1", label: "LX-1", lineItemId: "li", kind: "CUSTOM" }],
  ["categories", "projectCategories", { id: "x", organizationId: ORG, versionId: "v1", lineageId: "x", projectId: "p1", name: "Audio", sortOrder: 0 }],
  ["groups", "projectGroups", { id: "x", organizationId: ORG, versionId: "v1", lineageId: "x", projectId: "p1", title: "Rig", sortOrder: 0 }],
  ["crew calls", "crewAssignments", { id: "x", organizationId: ORG, projectId: "p1", crewMemberId: "cm" }],
  ["invoices", "invoices", { id: "x", organizationId: ORG, projectId: "p1", clientId: "c", kind: "FULL", status: "DRAFT", subtotal: 0, taxAmount: 0, total: 0 }],
  ["files", "projectMedia", { id: "x", organizationId: ORG, projectId: "p1", fileId: "f" }],
  ["tasks", "projectTasks", { id: "x", organizationId: ORG, projectId: "p1", title: "Call venue" }],
  ["sub-hires", "subHires", { id: "x", organizationId: ORG, projectId: "p1", supplierId: "s", createdById: USER, orderNumber: "SH-1" }],
  ["supplier orders", "supplierOrders", { id: "x", organizationId: ORG, projectId: "p1", supplierId: "s", orderNumber: "PO-1", type: "PURCHASE" }],
  ["snapshots", "projectSnapshots", { id: "x", organizationId: ORG, projectId: "p1", reason: "CONFIRMED", takenAt: NOW, takenBy: USER }],
  ["discussion", "commentThreads", { orgId: ORG, entityType: "project", entityId: "p1", projectId: "p1", status: "open", createdBy: OTHER, createdByName: "Bob", createdAt: NOW, updatedAt: NOW }],
  ["review markers", "reviewMarkers", { orgId: ORG, entityType: "project", entityId: "p1", targetType: "line", targetId: "l", status: "needs_review", createdBy: OTHER, createdByName: "Bob", createdAt: NOW, updatedAt: NOW }],
  ["maintenance records", "maintenanceRecords", { id: "x", organizationId: ORG, projectId: "p1", title: "Fix", type: "REPAIR" }],
  ["scan history", "assetScanLogs", { id: "x", organizationId: ORG, projectId: "p1", scannedById: USER, action: "CHECK_OUT" }],
  ["warehouse close-outs", "warehouseCloses", { id: "x", organizationId: ORG, projectId: "p1", closedById: USER }],
  ["revenue rollups", "projectModelRevenues", { id: "x", organizationId: ORG, projectId: "p1", modelId: "m", allocatedRevenue: 0, updatedAt: NOW }],
  ["web orders", "wooCommerceOrderLogs", { id: "x", organizationId: ORG, projectId: "p1", wooOrderId: 1, status: "RECEIVED", payload: {} }],
];

describe("discardDraftNative: every table the draft must not have blocks the delete", () => {
  test.each(NOT_EMPTY)("a row in %s refuses Undo and leaves the job", async (label, table, fields) => {
    const t = makeT();
    await seedDraft(t);
    await t.run(async (ctx) => { await ctx.db.insert(table as "quotes", fields as never); });
    await expect(call(t, args({ via: "undo" }))).rejects.toThrow(new RegExp(`it has ${label}`));
    expect(await exists(t)).toBe(true);
  });

  test("another user's comment (a collaboration event, no audit row) refuses Undo", async () => {
    const t = makeT();
    await seedDraft(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("activityEvents", { orgId: ORG, actorUserId: OTHER, actorName: "Bob", actorColor: "#fff", entityType: "project", entityId: "p1", action: "comment", summary: "Bob commented", createdAt: NOW });
    });
    await expect(call(t, args({ via: "undo" }))).rejects.toThrow(/someone else/);
    expect(await exists(t)).toBe(true);
  });

  test("the author's own collaboration events do not block; more than 50 do", async () => {
    const t = makeT();
    await seedDraft(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("activityEvents", { orgId: ORG, actorUserId: USER, actorName: "Alice", actorColor: "#fff", entityType: "project", entityId: "p1", action: "note", summary: "own", createdAt: NOW });
    });
    expect(await call(t, args({ via: "undo" }))).toEqual({ outcome: "deleted" });
    const t2 = makeT();
    await seedDraft(t2);
    await t2.run(async (ctx) => {
      for (let i = 0; i < 51; i++) {
        await ctx.db.insert("activityEvents", { orgId: ORG, actorUserId: USER, actorName: "Alice", actorColor: "#fff", entityType: "project", entityId: "p1", action: "note", summary: `own${i}`, createdAt: NOW });
      }
    });
    await expect(call(t2, args({ via: "undo" }))).rejects.toThrow(/someone else/);
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
