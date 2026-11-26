// @vitest-environment node
//
// UX Phase 13 slice-3 review, HIGH 1: a crew document edit's audit row keeps the label, kind and
// expiry in `details.fieldEdit` (the exact Undo needs them), and the activity reads need only
// project read. Every read (`list`, `listByEntity`, `recentForProject`, `exportRows`, and so the
// CSV) drops those `details` for a caller who fails the crew-document rule for the row's member;
// the Undo, which reads the stored row server-side, is unaffected.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { CREW_DOCUMENTS_FOLDER } from "./lib/crewDocumentCore";
import { crewDocumentRedactor } from "./lib/activityPay";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1", USER = "user_1", SELF = "user_self", KEY = "key_1";
const actor = { userId: USER, userName: "Alice" };
const NOW = Date.now();
const as = (role: string, userId = USER) => ({ subject: userId, orgId: ORG, role });
const SERVICE = { subject: "gearflow-service", svc: true };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

/** A manager adds a document to c1 (linked to SELF) and renames it: the edit audit row is `a2`. */
async function seed(t: T) {
  await t.run(async (ctx) => {
    for (const [id, userId, role] of [["m1", USER, "manager"], ["m2", "u_viewer", "viewer"], ["m3", "u_wh", "warehouse"], ["m4", SELF, "member"], ["m5", "u_other", "member"]] as const) {
      await ctx.db.insert("members", { id, organizationId: ORG, userId, role });
    }
    await ctx.db.insert("apiKeys", { id: KEY, organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h", scopes: JSON.stringify(["*"]), isActive: true, actingUserId: USER, createdById: USER });
    await ctx.db.insert("crewMembers", { id: "c1", organizationId: ORG, firstName: "Bob", lastName: "Ryan", status: "ACTIVE", isActive: true, userId: SELF });
    await ctx.db.insert("fileUploads", { id: "f1", organizationId: ORG, fileName: "f1.pdf", fileSize: 10, mimeType: "application/pdf", storageKey: "k_f1", url: "/api/files/k_f1", uploadedById: USER });
    await ctx.db.insert("storedFiles", { storageId: "k_f1", organizationId: ORG, folder: CREW_DOCUMENTS_FOLDER });
  });
  const m = t.withIdentity(as("manager"));
  await m.mutation(api.crewDocumentsWrites.addNative, { id: "d1", orgId: ORG, crewMemberId: "c1", fileId: "f1", kind: "LICENCE", name: "White card", expiresAt: NOW + 1000, now: NOW, actor, auditId: "a1" });
  await m.mutation(api.crewDocumentsWrites.updateNative, { orgId: ORG, crewMemberId: "c1", documentId: "d1", kind: "TICKET", name: "Blue card", expiresAt: NOW + 5000, now: NOW + 1, actor, auditId: "a2" });
  // The recent-for-project read keys on `projectId`; give the edit row one so that path is exercised too.
  await t.run(async (ctx) => {
    const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "a2")).first();
    await ctx.db.patch(row!._id, { projectId: "p1" });
  });
}

type Row = { entityType: string; action: string; details?: unknown };
const isDoc = (r: Row & { entityId?: string }) => r.entityType === "crewDocument";

/** The crew-document edit row, as each read path returns it. */
async function reads(t: T, who: Record<string, unknown>) {
  const c = t.withIdentity(who);
  const list = (await c.query(api.activityLog.list, { orgId: ORG })).items.find(isDoc);
  const byEntity = (await c.query(api.activityLog.listByEntity, { orgId: ORG, entityType: "crewDocument", entityId: "d1" })).items.find(isDoc);
  const recent = (await c.query(api.activityLog.recentForProject, { orgId: ORG, projectId: "p1" })).items.find(isDoc);
  const exported = (await c.query(api.activityLog.exportRows, { orgId: ORG })).find(isDoc);
  return { list, byEntity, recent, exported };
}
const LEAK = /Blue card|White card|expiresAt|"kind"/;

describe("crew document audit details", () => {
  test("a manager and the member themself see the diff on every read path", async () => {
    const t = makeT(); await seed(t);
    for (const who of [as("manager"), as("member", SELF)]) {
      const r = await reads(t, who);
      for (const [path, row] of Object.entries({ list: r.list, byEntity: r.byEntity, recent: r.recent })) {
        expect(JSON.stringify(row?.details), path).toMatch(/Blue card/);
      }
    }
  });

  test("warehouse, viewer, another member and an API key get the row without its details, on every read path", async () => {
    const t = makeT(); await seed(t);
    for (const who of [as("warehouse", "u_wh"), as("viewer", "u_viewer"), as("member", "u_other"), { ...as("manager"), akid: KEY }]) {
      const r = await reads(t, who);
      for (const [path, row] of Object.entries({ list: r.list, byEntity: r.byEntity, recent: r.recent })) {
        expect(row, path).toBeDefined();
        expect(row?.action, path).toBe("UPDATE");
        expect(row?.details, path).toBeUndefined();
        expect(JSON.stringify(row), path).not.toMatch(LEAK);
      }
    }
  });

  test("the CSV rows (exportRows, read with the service identity) never carry them", async () => {
    const t = makeT(); await seed(t);
    const { exported } = await reads(t, SERVICE);
    expect(exported).toBeDefined();
    expect(exported?.details).toBeUndefined();
    expect(JSON.stringify(exported)).not.toMatch(LEAK);
  });

  test("the exact Undo still works after a redacted read: it reads the stored row server-side", async () => {
    const t = makeT(); await seed(t);
    await reads(t, as("viewer", "u_viewer"));
    const out = await t.withIdentity(as("manager")).mutation(api.crewDocumentsWrites.undoUpdateNative, { orgId: ORG, documentId: "d1", forwardAuditId: "a2", now: NOW + 2, actor });
    expect(out.restored.length).toBeGreaterThan(0);
    const doc = await t.run(async (ctx) => ctx.db.query("crewDocuments").withIndex("by_cuid", (q) => q.eq("id", "d1")).first());
    expect(doc).toMatchObject({ name: "White card", kind: "LICENCE" });
  });

  test("the add row (under the member) names only the kind and is unchanged for everyone", async () => {
    const t = makeT(); await seed(t);
    const rows = (await t.withIdentity(as("viewer", "u_viewer")).query(api.activityLog.listByEntity, { orgId: ORG, entityType: "crew_member", entityId: "c1" })).items;
    expect(JSON.stringify(rows)).not.toMatch(/White card|Blue card/);
    expect(rows.some((r: { summary: string }) => /licence document/.test(r.summary))).toBe(true);
  });

  test("the pure redactor fails closed: a row with no readable owner, or an owner not in the visible set, loses details", () => {
    const redact = crewDocumentRedactor(new Set(["c1"]));
    const row = (details: unknown) => ({ entityType: "crewDocument", action: "UPDATE", details });
    expect(redact(row({ crewMemberId: "c1", fieldEdit: {} })).details).toBeDefined();
    expect(redact(row({ crewMemberId: "c2", fieldEdit: {} })).details).toBeUndefined();
    expect(redact(row({ fieldEdit: {} })).details).toBeUndefined();
    expect(redact(row(undefined)).details).toBeUndefined();
    const other = { entityType: "client", action: "UPDATE", details: { changes: [] } };
    expect(redact(other)).toBe(other);
  });
});
