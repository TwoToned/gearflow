// @vitest-environment node
//
// UX Phase 13, D72: crew documents. THE visibility rule (the member themself or crew:update on a
// USER session; never an API key, never warehouse / viewer), the fresh-upload guard on add, an exact
// server-side Undo that never deletes a stored file, the confirmed remove that does, the delete
// cascade, the C2 delete guard, and the generic file serve refusing the crew-documents folder.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { CREW_DOCUMENTS_FOLDER, MAX_CREW_DOCUMENTS, crewDocumentExpiry, crewDocumentsVisible, worstCrewDocument } from "./lib/crewDocumentCore";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1", OTHER = "org_2", USER = "user_1", SELF = "user_self", KEY = "key_1";
const actor = { userId: USER, userName: "Alice" };
const NOW = Date.now();
const DAY = 86_400_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const as = (role: string, userId = USER) => ({ subject: userId, orgId: ORG, role });

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

/** Members: a manager (crew:update), a viewer, a warehouse user, and `SELF` (a `member` linked to crew member c1). */
async function seed(t: T) {
  await t.run(async (ctx) => {
    for (const [id, userId, role] of [["m1", USER, "manager"], ["m2", "u_viewer", "viewer"], ["m3", "u_wh", "warehouse"], ["m4", SELF, "member"], ["m5", "u_other", "member"]] as const) {
      await ctx.db.insert("members", { id, organizationId: ORG, userId, role });
    }
    await ctx.db.insert("apiKeys", { id: KEY, organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h", scopes: JSON.stringify(["*"]), isActive: true, actingUserId: USER, createdById: USER });
    await ctx.db.insert("crewMembers", { id: "c1", organizationId: ORG, firstName: "Bob", lastName: "Ryan", status: "ACTIVE", isActive: true, userId: SELF });
    await ctx.db.insert("crewMembers", { id: "c2", organizationId: ORG, firstName: "Cy", lastName: "Dee", status: "ACTIVE", isActive: true });
    await ctx.db.insert("crewMembers", { id: "cx", organizationId: OTHER, firstName: "For", lastName: "Eign" });
    for (const [id, org, by, folder] of [["f1", ORG, USER, CREW_DOCUMENTS_FOLDER], ["f2", ORG, USER, CREW_DOCUMENTS_FOLDER], ["f3", ORG, "someone-else", CREW_DOCUMENTS_FOLDER], ["f4", ORG, USER, "misc"], ["fx", OTHER, USER, CREW_DOCUMENTS_FOLDER]] as const) {
      await ctx.db.insert("fileUploads", { id, organizationId: org, fileName: `${id}.pdf`, fileSize: 10, mimeType: "application/pdf", storageKey: `k_${id}`, url: `/api/files/k_${id}`, uploadedById: by });
      await ctx.db.insert("storedFiles", { storageId: `k_${id}`, organizationId: org, folder });
    }
  });
}
const rows = (t: T) => t.run(async (ctx) => ctx.db.query("crewDocuments").collect());
const fileRow = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", id)).first());

const add = (t: T, over: Record<string, unknown> = {}, who = t.withIdentity(as("manager"))) =>
  who.mutation(api.crewDocumentsWrites.addNative, { id: "d1", orgId: ORG, crewMemberId: "c1", fileId: "f1", kind: "LICENCE", name: "White card", expiresAt: NOW + 10 * DAY, now: NOW, actor, auditId: "a1", ...over });

describe("the pure rule and health", () => {
  test("visible only to a user session that manages crew or is the member", () => {
    expect(crewDocumentsVisible({ userSession: true, managesCrew: true, isSelf: false })).toBe(true);
    expect(crewDocumentsVisible({ userSession: true, managesCrew: false, isSelf: true })).toBe(true);
    expect(crewDocumentsVisible({ userSession: true, managesCrew: false, isSelf: false })).toBe(false);
    expect(crewDocumentsVisible({ userSession: false, managesCrew: true, isSelf: true })).toBe(false);
  });
  test("expiry is derived; the worst document is the soonest to lapse", () => {
    expect(crewDocumentExpiry(null, NOW).state).toBe("none");
    expect(crewDocumentExpiry(NOW - DAY, NOW).state).toBe("expired");
    expect(crewDocumentExpiry(NOW + 5 * DAY, NOW).state).toBe("soon");
    expect(crewDocumentExpiry(NOW + 90 * DAY, NOW).state).toBe("ok");
    const worst = worstCrewDocument([{ id: "a", expiresAt: NOW + 20 * DAY }, { id: "b", expiresAt: NOW - 2 * DAY }, { id: "c", expiresAt: null }], NOW);
    expect(worst?.doc.id).toBe("b");
    expect(worstCrewDocument([{ expiresAt: NOW + 200 * DAY }], NOW)).toBeNull();
  });
});

describe("visibility: the list", () => {
  test("a manager and the member themself see them; warehouse, viewer, another member and an API key get null", async () => {
    const t = makeT(); await seed(t);
    await add(t);
    const list = (id: Record<string, string>) => t.withIdentity(id).query(api.crewDocuments.listForMember, { orgId: ORG, crewMemberId: "c1" });
    for (const who of [as("manager"), as("member", SELF)]) {
      expect(await list(who)).toEqual([expect.objectContaining({ id: "d1", kind: "LICENCE", name: "White card", file: expect.objectContaining({ downloadPath: "/api/crew/documents/d1/file" }) })]);
    }
    for (const who of [as("warehouse", "u_wh"), as("viewer", "u_viewer"), as("member", "u_other"), { subject: USER, orgId: ORG, role: "manager", akid: KEY }]) {
      expect(await list(who)).toBeNull();
    }
  });

  test("SENTINEL: no storage key, URL or file id ever reaches the list", async () => {
    const t = makeT(); await seed(t);
    await add(t);
    const out = JSON.stringify(await t.withIdentity(as("manager")).query(api.crewDocuments.listForMember, { orgId: ORG, crewMemberId: "c1" }));
    expect(out).not.toMatch(/k_f1|\/api\/files|"fileId"|storageKey|"url"/);
  });

  test("another org's member reads as null (never an empty list) and a foreign document row is never listed", async () => {
    const t = makeT(); await seed(t);
    expect(await t.withIdentity(as("manager")).query(api.crewDocuments.listForMember, { orgId: ORG, crewMemberId: "cx" })).toBeNull();
    await t.run(async (ctx) => { await ctx.db.insert("crewDocuments", { id: "planted", organizationId: OTHER, crewMemberId: "c1", fileId: "fx", kind: "ID", createdAt: NOW, createdById: "x" }); });
    expect(await t.withIdentity(as("manager")).query(api.crewDocuments.listForMember, { orgId: ORG, crewMemberId: "c1" })).toEqual([]);
  });
});

describe("addNative: the fresh-upload guard", () => {
  test("adds the member's own fresh crew-documents upload, audited by KIND only", async () => {
    const t = makeT(); await seed(t);
    await add(t);
    expect(await rows(t)).toEqual([expect.objectContaining({ id: "d1", crewMemberId: "c1", fileId: "f1", kind: "LICENCE", organizationId: ORG })]);
    const log = await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "a1")).first());
    expect(log?.summary).toMatch(/licence document/);
    expect(JSON.stringify(log)).not.toMatch(/White card|f1\.pdf/);
  });

  test("refuses: someone else's upload, a foreign file, the wrong folder, a stale upload, a reused file, a foreign member", async () => {
    const t = makeT(); await seed(t);
    await expect(add(t, { fileId: "f3" })).rejects.toThrow(/not uploaded by you/);
    await expect(add(t, { fileId: "fx" })).rejects.toThrow(/File not found/);
    await expect(add(t, { fileId: "f4" })).rejects.toThrow(/not uploaded for this/);
    await expect(add(t, { crewMemberId: "cx" })).rejects.toThrow(/not found/);
    await add(t);
    await expect(add(t, { id: "d2", auditId: "a2" })).rejects.toThrow(/already attached/);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 11 * 60 * 1000);
      await expect(add(t, { id: "d3", fileId: "f2", auditId: "a3" })).rejects.toThrow(/too old/);
    } finally {
      vi.useRealTimers();
    }
    expect(await rows(t)).toHaveLength(1);
  });

  test("only a USER session with crew:update writes: a member (even the person themself), a viewer and an API key are refused", async () => {
    const t = makeT(); await seed(t);
    await expect(add(t, {}, t.withIdentity(as("member", SELF)))).rejects.toThrow(/permission/);
    await expect(add(t, {}, t.withIdentity(as("viewer", "u_viewer")))).rejects.toThrow(/permission/);
    await expect(add(t, {}, t.withIdentity({ subject: USER, orgId: ORG, role: "manager", akid: KEY }))).rejects.toThrow(/permission/);
    expect(await rows(t)).toHaveLength(0);
  });
});

describe("Undo and remove", () => {
  test("Undo of an add detaches the row once and NEVER deletes the file; a second Undo and another user are refused", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m6", organizationId: ORG, userId: "user_2", role: "manager" }); });
    await add(t);
    const undo = (who = t.withIdentity(as("manager"))) => who.mutation(api.crewDocumentsWrites.undoAddNative, { orgId: ORG, crewMemberId: "c1", forwardAuditId: "a1", now: NOW, actor });
    await expect(undo(t.withIdentity(as("manager", "user_2")))).rejects.toThrow(/person who made/);
    expect((await undo()).restored).toBe(true);
    expect(await rows(t)).toHaveLength(0);
    expect(await fileRow(t, "f1")).not.toBeNull();
    await expect(undo()).rejects.toThrow(/already undone/);
  });

  test("an edit (rename, kind, expiry) is undone exactly, refused when changed since, and cannot be pointed at another document", async () => {
    const t = makeT(); await seed(t);
    await add(t);
    await add(t, { id: "d2", fileId: "f2", auditId: "a9" });
    const edit = (over: Record<string, unknown>) => t.withIdentity(as("manager")).mutation(api.crewDocumentsWrites.updateNative, { orgId: ORG, crewMemberId: "c1", documentId: "d1", kind: "LICENCE", name: "White card", expiresAt: NOW + 10 * DAY, now: NOW, actor, auditId: "e1", ...over });
    const undoEdit = (over: Record<string, unknown> = {}) => t.withIdentity(as("manager")).mutation(api.crewDocumentsWrites.undoUpdateNative, { orgId: ORG, documentId: "d1", forwardAuditId: "e1", now: NOW, actor, ...over });
    expect((await edit({ expiresAt: NOW + 400 * DAY, kind: "TICKET" })).changed).toBe(true);
    await expect(undoEdit({ documentId: "d2" })).rejects.toThrow(/not found/);
    await undoEdit();
    expect((await rows(t)).find((d) => d.id === "d1")).toMatchObject({ kind: "LICENCE", expiresAt: NOW + 10 * DAY });
    expect((await edit({ name: "Same", auditId: "e2" })).changed).toBe(true);
    await t.run(async (ctx) => { const d = (await ctx.db.query("crewDocuments").withIndex("by_cuid", (q) => q.eq("id", "d1")).first())!; await ctx.db.patch(d._id, { name: "Later" }); });
    await expect(undoEdit({ forwardAuditId: "e2" })).rejects.toThrow(/changed since/);
    expect((await edit({ auditId: "e3" })).changed).toBe(true); // an edit back to the original name is a real change too
  });

  test("remove is the one verb that deletes the stored file; it needs crew:update and the right member", async () => {
    const t = makeT(); await seed(t);
    await add(t);
    const rm = (over: Record<string, unknown> = {}, who = t.withIdentity(as("manager"))) => who.mutation(api.crewDocumentsWrites.removeNative, { orgId: ORG, crewMemberId: "c1", documentId: "d1", now: NOW, actor, auditId: "r1", ...over });
    await expect(rm({}, t.withIdentity(as("member", SELF)))).rejects.toThrow(/permission/);
    await expect(rm({ crewMemberId: "c2" })).rejects.toThrow(/not on this crew member/);
    await rm();
    expect(await rows(t)).toHaveLength(0);
    expect(await fileRow(t, "f1")).toBeNull();
    expect(await t.run(async (ctx) => ctx.db.query("storedFiles").withIndex("by_storageId", (q) => q.eq("storageId", "k_f1")).first())).toBeNull();
  });
});

describe("write refusals, each guard alone", () => {
  const edit = (t: T, over: Record<string, unknown> = {}) => t.withIdentity(as("manager")).mutation(api.crewDocumentsWrites.updateNative, { orgId: ORG, crewMemberId: "c1", documentId: "d1", kind: "LICENCE", name: "White card", expiresAt: NOW + 10 * DAY, now: NOW, actor, auditId: "e1", ...over });
  const undoAdd = (t: T) => t.withIdentity(as("manager")).mutation(api.crewDocumentsWrites.undoAddNative, { orgId: ORG, crewMemberId: "c1", forwardAuditId: "a1", now: NOW, actor });
  const moveDocTo = (t: T, org: string) => t.run(async (ctx) => { const d = (await ctx.db.query("crewDocuments").withIndex("by_cuid", (q) => q.eq("id", "d1")).first())!; await ctx.db.patch(d._id, { organizationId: org }); });

  test("addNative refuses a duplicate document id and a name over 200 characters", async () => {
    const t = makeT(); await seed(t);
    await add(t);
    await expect(add(t, { fileId: "f2", auditId: "a2" })).rejects.toThrow(/already exists/);
    await expect(add(t, { id: "d2", fileId: "f2", auditId: "a2", name: "x".repeat(201) })).rejects.toThrow(/at most 200/);
    expect(await rows(t)).toHaveLength(1);
  });

  test("an expiry must be a finite date between 1970 and 2099, on add and on edit", async () => {
    const t = makeT(); await seed(t);
    for (const bad of [-1, 4.2e12, Number.POSITIVE_INFINITY]) await expect(add(t, { expiresAt: bad }), String(bad)).rejects.toThrow(/expiresAt/);
    expect(await rows(t)).toHaveLength(0);
    await add(t);
    for (const bad of [-1, 4.2e12]) await expect(edit(t, { expiresAt: bad }), String(bad)).rejects.toThrow(/expiresAt/);
    expect((await edit(t, { expiresAt: 0 })).changed).toBe(true); // the bound itself is allowed
  });

  test("a member can have at most MAX_CREW_DOCUMENTS documents: the 100th is added, the 101st refused", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { for (let i = 0; i < MAX_CREW_DOCUMENTS - 1; i++) await ctx.db.insert("crewDocuments", { id: `x${i}`, organizationId: ORG, crewMemberId: "c1", fileId: `none${i}`, kind: "OTHER", createdAt: NOW, createdById: USER }); });
    await add(t); // number 100
    await expect(add(t, { id: "d2", fileId: "f2", auditId: "a2" })).rejects.toThrow(/at most 100 documents/);
    expect(await rows(t)).toHaveLength(MAX_CREW_DOCUMENTS);
    await add(t, { id: "d3", crewMemberId: "c2", fileId: "f2", auditId: "a3" }); // the cap is per member
  });

  test("Undo of an add is refused once the document was edited, and the row stays", async () => {
    const t = makeT(); await seed(t);
    await add(t);
    await edit(t, { name: "Renamed", now: NOW + 5 });
    await expect(undoAdd(t)).rejects.toThrow(/edited since/);
    expect(await rows(t)).toHaveLength(1);
  });

  test("Undo of an add never deletes a row of another org (the row's org is re-checked)", async () => {
    const t = makeT(); await seed(t);
    await add(t);
    await moveDocTo(t, OTHER);
    expect((await undoAdd(t)).restored).toBe(false);
    expect(await rows(t)).toHaveLength(1);
  });

  test("Undo of an edit never touches a row of another org (the load re-checks the org)", async () => {
    const t = makeT(); await seed(t);
    await add(t);
    await edit(t, { name: "Renamed", now: NOW + 5 });
    await moveDocTo(t, OTHER);
    await expect(t.withIdentity(as("manager")).mutation(api.crewDocumentsWrites.undoUpdateNative, { orgId: ORG, documentId: "d1", forwardAuditId: "e1", now: NOW, actor })).rejects.toThrow();
    expect((await rows(t))[0]).toMatchObject({ name: "Renamed", organizationId: OTHER });
  });

  test("the writer guard is for the caller's OWN org: a manager of this org cannot write into another", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { await ctx.db.insert("members", { id: "mo", organizationId: OTHER, userId: "u_viewer", role: "viewer" }); });
    // The manager's token is for ORG; the call names OTHER. (A user who is a manager of ORG and only a viewer of OTHER must not pass either.)
    await expect(add(t, { orgId: OTHER, crewMemberId: "cx", fileId: "fx" })).rejects.toThrow(/permission/);
    await expect(add(t, { orgId: OTHER, crewMemberId: "cx", fileId: "fx" }, t.withIdentity({ subject: "u_viewer", orgId: OTHER, role: "viewer" }))).rejects.toThrow(/permission/);
  });

  test("canSeeCrewDocuments is for the caller's OWN org: a manager of this org reads null for another org's member", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "mo", organizationId: OTHER, userId: USER, role: "manager" });
      // USER is also a crew member of OTHER (the `isSelf` branch, which `callerMay` does not gate by org).
      await ctx.db.insert("crewMembers", { id: "cy", organizationId: OTHER, firstName: "Al", lastName: "Ice", status: "ACTIVE", isActive: true, userId: USER });
      await ctx.db.insert("crewDocuments", { id: "dy", organizationId: OTHER, crewMemberId: "cy", fileId: "fx", kind: "ID", createdAt: NOW, createdById: "x" });
    });
    // USER is a manager of BOTH orgs and the person behind OTHER's `cy`, but this token is for ORG: a read naming OTHER must not pass.
    for (const crewMemberId of ["cx", "cy"]) expect(await t.withIdentity(as("manager")).query(api.crewDocuments.listForMember, { orgId: OTHER, crewMemberId }), crewMemberId).toBeNull();
  });
});

describe("the generic file-record reads never expose a crew document's file", () => {
  test("fileUploads.list / getById / getByThumbnailUrl drop a crew-documents row (name, size, storage key) for every caller; other files still read", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { const f = (await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", "f1")).first())!; await ctx.db.patch(f._id, { thumbnailUrl: "/api/files/k_f1_thumb" }); });
    for (const who of [as("manager"), { ...as("manager"), akid: KEY }, SERVICE]) {
      const c = t.withIdentity(who);
      const ids = (await c.query(api.fileUploads.list, { orgId: ORG })).map((f) => f.id);
      expect(ids).not.toContain("f1");
      expect(ids).not.toContain("f2");
      expect(ids).toContain("f4"); // the misc-folder file still reads
      expect(await c.query(api.fileUploads.getById, { id: "f1" })).toBeNull();
      expect((await c.query(api.fileUploads.getById, { id: "f4" }))?.id).toBe("f4");
    }
    expect(await t.withIdentity(SERVICE).query(api.fileUploads.getByThumbnailUrl, { thumbnailUrl: "/api/files/k_f1_thumb" })).toBeNull();
  });
});

describe("the delete cascade at the document cap", () => {
  const seedCap = async (t: T, n: number) => {
    await t.run(async (ctx) => {
      for (let i = 0; i < n; i++) {
        await ctx.db.insert("fileUploads", { id: `cf${i}`, organizationId: ORG, fileName: `cf${i}.pdf`, fileSize: 10, mimeType: "application/pdf", storageKey: `k_cf${i}`, url: `/api/files/k_cf${i}`, uploadedById: USER });
        await ctx.db.insert("storedFiles", { storageId: `k_cf${i}`, organizationId: ORG, folder: CREW_DOCUMENTS_FOLDER });
        await ctx.db.insert("crewDocuments", { id: `cd${i}`, organizationId: ORG, crewMemberId: "c1", fileId: `cf${i}`, kind: "OTHER", createdAt: NOW, createdById: USER });
      }
      for (let i = 0; i < 50; i++) await ctx.db.insert("maintenanceRecords", { id: `mr${i}`, organizationId: ORG, type: "REPAIR", title: "x", photos: [`/api/files/other${i}`] } as never);
    });
  };

  test("the holder scans are read ONCE for all 100 files, not once per file (the read-limit bound)", async () => {
    const t = makeT(); await seed(t); await seedCap(t, 100);
    const reads: Record<string, number> = {};
    await t.run(async (ctx) => {
      for (const d of await ctx.db.query("crewDocuments").collect()) await ctx.db.delete(d._id); // as the cascade does, before asking
      const db = new Proxy(ctx.db, { get: (target, prop, recv) => (prop === "query" ? (table: string) => { reads[table] = (reads[table] ?? 0) + 1; return (target.query as (t: string) => unknown)(table); } : Reflect.get(target, prop, recv)) }) as typeof ctx.db;
      const { fileReferenceStates } = await import("./lib/attachableUpload");
      const states = await fileReferenceStates(db, ORG, Array.from({ length: 100 }, (_, i) => `cf${i}`));
      expect([...states.values()].filter((s) => s === "free")).toHaveLength(100);
    });
    expect(reads.maintenanceRecords).toBe(1);
    expect(reads.checkRecords).toBe(1);
  });

  test("deleting a member with 100 documents deletes every row and every stored file", async () => {
    const t = makeT(); await seed(t); await seedCap(t, 100);
    await t.run(async (ctx) => { const m = (await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", "c1")).first())!; await ctx.db.patch(m._id, { status: "INACTIVE" }); await ctx.db.insert("members", { id: "own", organizationId: ORG, userId: "u_owner", role: "owner" }); });
    await t.withIdentity(as("owner", "u_owner")).mutation(api.crewWrites.deleteNative, { id: "c1", orgId: ORG, actor, auditId: "del", now: NOW });
    expect(await rows(t)).toHaveLength(0);
    expect(await t.run(async (ctx) => (await ctx.db.query("fileUploads").collect()).filter((f) => f.id.startsWith("cf")))).toHaveLength(0);
  });

  test("a file another record still holds survives the cascade, and an unprovable set deletes nothing", async () => {
    const t = makeT(); await seed(t); await seedCap(t, 3);
    await t.run(async (ctx) => { const m = (await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", "c1")).first())!; await ctx.db.patch(m._id, { status: "INACTIVE" }); await ctx.db.insert("members", { id: "own", organizationId: ORG, userId: "u_owner", role: "owner" }); await ctx.db.insert("maintenanceRecords", { id: "held", organizationId: ORG, type: "REPAIR", title: "x", photos: ["/api/files/k_cf1"] } as never); });
    await t.withIdentity(as("owner", "u_owner")).mutation(api.crewWrites.deleteNative, { id: "c1", orgId: ORG, actor, auditId: "del", now: NOW });
    expect((await t.run(async (ctx) => (await ctx.db.query("fileUploads").collect()).filter((f) => f.id.startsWith("cf")))).map((f) => f.id)).toEqual(["cf1"]);

    const t2 = makeT(); await seed(t2); await seedCap(t2, 2);
    await t2.run(async (ctx) => { const m = (await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", "c1")).first())!; await ctx.db.patch(m._id, { status: "INACTIVE" }); await ctx.db.insert("members", { id: "own", organizationId: ORG, userId: "u_owner", role: "owner" }); for (let i = 0; i < 5001; i++) await ctx.db.insert("maintenanceRecords", { id: `big${i}`, organizationId: ORG, type: "REPAIR", title: "x" } as never); });
    await expect(t2.withIdentity(as("owner", "u_owner")).mutation(api.crewWrites.deleteNative, { id: "c1", orgId: ORG, actor, auditId: "del", now: NOW })).rejects.toThrow(/Too many records to check this file safely/);
    expect(await rows(t2)).toHaveLength(2);
    expect(await t2.run(async (ctx) => ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", "c1")).first())).not.toBeNull();
  });
});

describe("remove when the file's holders cannot be proven", () => {
  test("refuses with FILE_REFS_UNVERIFIABLE and changes nothing: the row, the file and the audit all stay", async () => {
    const t = makeT(); await seed(t);
    await add(t);
    await t.run(async (ctx) => { for (let i = 0; i < 5001; i++) await ctx.db.insert("maintenanceRecords", { id: `m${i}`, organizationId: ORG, type: "REPAIR", title: "x" } as never); });
    await expect(t.withIdentity(as("manager")).mutation(api.crewDocumentsWrites.removeNative, { orgId: ORG, crewMemberId: "c1", documentId: "d1", now: NOW, actor, auditId: "r1" })).rejects.toThrow(/Too many records to check this file safely/);
    expect(await rows(t)).toHaveLength(1);
    expect(await fileRow(t, "f1")).not.toBeNull();
    expect(await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "r1")).first())).toBeNull();
  });
});

describe("the file is only reachable through the gated route", () => {
  test("the generic serve (and any caller of it, an API key included) gets nothing for a crew document; other files still serve", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { await ctx.db.insert("storedFiles", { storageId: "k_plain", organizationId: ORG, folder: "misc" }); });
    expect(await t.withIdentity(SERVICE).query(api.files.getServeInfo, { storageId: "k_f1" })).toBeNull();
    expect(await t.withIdentity(as("manager")).query(api.files.getServeInfo, { storageId: "k_f1" })).toBeNull();
    expect(await t.withIdentity({ subject: USER, orgId: ORG, role: "manager", akid: KEY }).query(api.files.getServeInfo, { storageId: "k_f1" })).toBeNull();
  });

  // Each case below stores a REAL blob, so `ctx.storage.getUrl` succeeds: a missing guard shows as a returned url,
  // not as convex-test throwing on a fake key (which would pass these without the guard).
  const realBlob = (t: T, storageKey: string, fileId: string) =>
    t.run(async (ctx) => {
      const id = await ctx.storage.store(new Blob(["%PDF-1.4"]));
      const f = (await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", fileId)).first())!;
      await ctx.db.patch(f._id, { storageKey: id });
      const s = (await ctx.db.query("storedFiles").withIndex("by_storageId", (q) => q.eq("storageId", storageKey)).first())!;
      await ctx.db.patch(s._id, { storageId: id });
    });
  const download = (t: T, who: Record<string, string | boolean>, orgId: string, id: string) => t.withIdentity(who).query(api.crewDocuments.getForDownload, { orgId, id });

  test("getForDownload: the service identity gets the url and the member's user id (the positive control)", async () => {
    const t = makeT(); await seed(t); await realBlob(t, "k_f1", "f1");
    await add(t);
    expect(await download(t, SERVICE, ORG, "d1")).toMatchObject({ url: expect.any(String), memberUserId: SELF, fileName: "f1.pdf" });
  });

  test("getForDownload is service-only: a manager, the member themself and an API key are refused even with a real file", async () => {
    const t = makeT(); await seed(t); await realBlob(t, "k_f1", "f1");
    await add(t);
    for (const who of [as("manager"), as("member", SELF), { ...as("manager"), akid: KEY }]) await expect(download(t, who, ORG, "d1")).rejects.toThrow();
  });

  test("getForDownload re-checks the document's org, the member's org and the file's org (each alone, with everything else real)", async () => {
    const t = makeT(); await seed(t); await realBlob(t, "k_f1", "f1"); await realBlob(t, "k_fx", "fx");
    await t.run(async (ctx) => {
      // dz: a document of ANOTHER org pointing at this org's member and file; dm: this org's document on a FOREIGN member; df: this org's document on a FOREIGN file.
      await ctx.db.insert("crewDocuments", { id: "dz", organizationId: OTHER, crewMemberId: "c1", fileId: "f1", kind: "ID", createdAt: NOW, createdById: "x" });
      await ctx.db.insert("crewDocuments", { id: "dm", organizationId: ORG, crewMemberId: "cx", fileId: "f1", kind: "ID", createdAt: NOW, createdById: "x" });
      await ctx.db.insert("crewDocuments", { id: "df", organizationId: ORG, crewMemberId: "c1", fileId: "fx", kind: "ID", createdAt: NOW, createdById: "x" });
    });
    for (const id of ["dz", "dm", "df"]) expect(await download(t, SERVICE, ORG, id), id).toBeNull();
  });
});

describe("delete cascade and the C2 guard", () => {
  test("deleting an INACTIVE member deletes their documents and their stored files, and leaves other members' alone", async () => {
    const t = makeT(); await seed(t);
    await add(t);
    await add(t, { id: "d2", crewMemberId: "c2", fileId: "f2", auditId: "a2" });
    await t.run(async (ctx) => { const m = (await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", "c1")).first())!; await ctx.db.patch(m._id, { status: "INACTIVE" }); await ctx.db.insert("members", { id: "own", organizationId: ORG, userId: "u_owner", role: "owner" }); });
    await t.withIdentity(as("owner", "u_owner")).mutation(api.crewWrites.deleteNative, { id: "c1", orgId: ORG, actor, auditId: "del", now: NOW });
    expect((await rows(t)).map((d) => d.id)).toEqual(["d2"]);
    expect(await fileRow(t, "f1")).toBeNull();
    expect(await fileRow(t, "f2")).not.toBeNull();
  });

  test("C2: an ACTIVE or ON_LEAVE member cannot be deleted by the API; INACTIVE, ARCHIVED and legacy isActive:false can", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { await ctx.db.insert("members", { id: "own", organizationId: ORG, userId: "u_owner", role: "owner" }); });
    const del = (id: string, auditId: string) => t.withIdentity(as("owner", "u_owner")).mutation(api.crewWrites.deleteNative, { id, orgId: ORG, actor, auditId, now: NOW });
    const patch = (id: string, p: Record<string, unknown>) => t.run(async (ctx) => { const m = (await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", id)).first())!; await ctx.db.patch(m._id, p); });
    await expect(del("c1", "x1")).rejects.toThrow(/Deactivate/);
    await patch("c1", { status: "ON_LEAVE" });
    await expect(del("c1", "x2")).rejects.toThrow(/Deactivate/);
    expect(await t.run(async (ctx) => ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", "c1")).first())).not.toBeNull();
    await patch("c1", { status: "ARCHIVED" });
    await del("c1", "x3");
    await patch("c2", { isActive: false });
    await del("c2", "x4");
    expect(await t.run(async (ctx) => ctx.db.query("crewMembers").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect())).toEqual([]);
  });
});

describe("a crew document's file only goes when nothing else holds it", () => {
  test("remove and the member-delete cascade keep a file another row still holds", async () => {
    const t = makeT(); await seed(t);
    await add(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("clientMedia", { id: "cm", organizationId: ORG, clientId: "c", fileId: "f1" }); // legacy: also held by a media row
      await ctx.db.insert("members", { id: "own", organizationId: ORG, userId: "u_owner", role: "owner" });
    });
    await t.withIdentity(as("manager")).mutation(api.crewDocumentsWrites.removeNative, { orgId: ORG, crewMemberId: "c1", documentId: "d1", now: NOW, actor, auditId: "r1" });
    expect(await rows(t)).toHaveLength(0);
    expect(await fileRow(t, "f1")).not.toBeNull(); // the media row still holds it

    await add(t, { id: "d2", fileId: "f2", auditId: "a8" });
    await t.run(async (ctx) => {
      await ctx.db.insert("clientMedia", { id: "cm2", organizationId: ORG, clientId: "c", fileId: "f2" });
      const m = (await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", "c1")).first())!;
      await ctx.db.patch(m._id, { status: "INACTIVE" });
    });
    await t.withIdentity(as("owner", "u_owner")).mutation(api.crewWrites.deleteNative, { id: "c1", orgId: ORG, actor, auditId: "del", now: NOW });
    expect(await rows(t)).toHaveLength(0);
    expect(await fileRow(t, "f2")).not.toBeNull();
  });
});
