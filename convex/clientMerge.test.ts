// @vitest-environment node
//
// Client Merge + exact Undo (UX Phase 13, D73): what moves (incl. projectVersions: the
// make-live round trip), cross-org refusals, the cap, RBAC, and Undo that reverses exactly
// the recorded ids and names anything the user re-pointed since.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1", OTHER = "org_2", USER = "user_1", NOW = 1_700_000_000_000;
const actor = { userId: USER, userName: "Alice" };
const as = (t: T, role = "admin", userId = USER) => t.withIdentity({ subject: userId, orgId: ORG, role });

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}
async function seed(t: T, role = "admin") {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role });
    await ctx.db.insert("clients", { id: "keep", organizationId: ORG, name: "Hilton", isActive: true, tags: ["vip"] });
    await ctx.db.insert("clients", { id: "gone", organizationId: ORG, name: "Hilton Sydney", isActive: true, tags: ["hotel", "vip"] });
    await ctx.db.insert("clients", { id: "foreign", organizationId: OTHER, name: "Foreign", isActive: true });
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "#1", name: "Gala", clientId: "gone", status: "QUOTING", isTemplate: false, liveVersionId: "v1", clientContactId: "cc1", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("projectVersions", { id: "v1", organizationId: ORG, projectId: "p1", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1", clientId: "gone" });
    await ctx.db.insert("projectVersions", { id: "v2", organizationId: ORG, projectId: "p1", number: 2, contentState: "ready", createdAt: NOW, createdById: "u1", clientId: "gone" });
    await ctx.db.insert("invoices", { id: "i1", organizationId: ORG, projectId: "p1", clientId: "gone", kind: "FULL", status: "ISSUED", subtotal: 1, taxAmount: 0, total: 1 } as never);
    await ctx.db.insert("clientContacts", { id: "cc1", organizationId: ORG, clientId: "gone", name: "Priya", isPrimary: true, sortOrder: 0 });
    await ctx.db.insert("clientContacts", { id: "cc0", organizationId: ORG, clientId: "keep", name: "Sam", isPrimary: true, sortOrder: 0 });
    await ctx.db.insert("clientMedia", { id: "cm1", organizationId: ORG, clientId: "gone", fileId: "f1" });
    await ctx.db.insert("clientMedia", { id: "cm2", organizationId: ORG, clientId: "gone", fileId: "f2" });
    await ctx.db.insert("clientMedia", { id: "cm3", organizationId: ORG, clientId: "keep", fileId: "f2" }); // survivor already has f2
    await ctx.db.insert("workItemLinks", { id: "wl1", organizationId: ORG, workItemId: "t1", entityType: "client", entityId: "gone", createdAt: NOW });
    await ctx.db.insert("projects", { id: "px", organizationId: OTHER, projectNumber: "#X", name: "Foreign", clientId: "gone", isTemplate: false });
  });
}
const row = <K extends "projects" | "invoices" | "clientContacts" | "clientMedia" | "workItemLinks" | "projectVersions" | "clients">(t: T, table: K, id: string) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t.run(async (ctx) => (ctx.db.query(table).withIndex("by_cuid" as any, (q: any) => q.eq("id", id)).first()) as any) as Promise<Record<string, unknown> | null>;

const merge = (t: T, over: Record<string, unknown> = {}, who = as(t)) =>
  who.mutation(api.clientMergeWrites.mergeClientsNative, { orgId: ORG, survivorId: "keep", loserId: "gone", auditId: "aM", receivedAuditId: "aR", now: NOW, actor, ...over });
const undo = (t: T, over: Record<string, unknown> = {}, who = as(t)) =>
  who.mutation(api.clientMergeWrites.undoClientMergeNative, { orgId: ORG, forwardAuditId: "aM", now: NOW + 1, actor, ...over });

describe("mergeClientsNative", () => {
  test("moves exactly the listed rows, archives the loser, never touches another org", async () => {
    const t = makeT(); await seed(t);
    const res = await merge(t);
    expect(res.counts).toEqual({ projects: 1, versions: 2, invoices: 1, contacts: 1, media: 1, links: 1, skippedMedia: 1 });
    expect((await row(t, "projects", "p1"))?.clientId).toBe("keep");
    expect((await row(t, "projects", "px"))?.clientId).toBe("gone"); // the foreign org's row is never moved
    for (const v of ["v1", "v2"]) expect((await row(t, "projectVersions", v))?.clientId).toBe("keep");
    expect((await row(t, "invoices", "i1"))?.clientId).toBe("keep");
    expect(await row(t, "clientContacts", "cc1")).toMatchObject({ clientId: "keep", isPrimary: false }); // the survivor's primary stands
    expect((await row(t, "clientContacts", "cc0"))?.isPrimary).toBe(true);
    expect((await row(t, "clientMedia", "cm1"))?.clientId).toBe("keep");
    expect((await row(t, "clientMedia", "cm2"))?.clientId).toBe("gone"); // duplicate file skipped, named in counts
    expect((await row(t, "workItemLinks", "wl1"))?.entityId).toBe("keep");
    expect(await row(t, "clients", "gone")).toMatchObject({ isActive: false });
    expect((await row(t, "clients", "keep"))?.tags).toEqual(["vip", "hotel"]);
    const merged = await as(t).query(api.clientMergeWrites.mergedInto, { orgId: ORG, id: "gone" });
    expect(merged).toMatchObject({ id: "keep", name: "Hilton", forwardAuditId: "aM" });
  });

  test("MAKE-LIVE ROUND TRIP: making an old version live after a merge keeps the survivor", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", versionId: "v1", lineageId: "li1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, description: "PA", quantity: 1, unitPrice: 1, lineTotal: 1 });
    });
    await merge(t);
    const res = await as(t).mutation(api.versions.makeLiveNative, { organizationId: ORG, projectId: "p1", versionId: "v2", actor, auditId: "aLive", now: NOW });
    expect(res.liveVersionId).toBe("v2");
    expect((await row(t, "projects", "p1"))?.clientId).toBe("keep");
  });

  test("refusals: same client, other org's client, archived loser, a role without invoice:update, nothing written", async () => {
    const t = makeT(); await seed(t);
    await expect(merge(t, { loserId: "keep" })).rejects.toThrow(/two different/);
    await expect(merge(t, { loserId: "foreign" })).rejects.toThrow(/not found/i);
    await expect(merge(t, { survivorId: "foreign" })).rejects.toThrow(/not found/i);
    const t2 = makeT(); await seed(t2, "viewer");
    await expect(merge(t2, {}, as(t2, "viewer"))).rejects.toThrow();
    expect((await row(t2, "clients", "gone"))?.isActive).toBe(true);
    await merge(t);
    await expect(merge(t, { auditId: "aM2", receivedAuditId: "aR2" })).rejects.toThrow(/already archived/);
  });
});

describe("undoClientMergeNative", () => {
  test("restores exactly the recorded rows, the primary flag and the tags", async () => {
    const t = makeT(); await seed(t);
    await merge(t);
    const res = await undo(t);
    expect(res.left).toEqual([]);
    expect((await row(t, "projects", "p1"))?.clientId).toBe("gone");
    for (const v of ["v1", "v2"]) expect((await row(t, "projectVersions", v))?.clientId).toBe("gone");
    expect(await row(t, "clientContacts", "cc1")).toMatchObject({ clientId: "gone", isPrimary: true });
    expect((await row(t, "clientMedia", "cm1"))?.clientId).toBe("gone");
    expect((await row(t, "workItemLinks", "wl1"))?.entityId).toBe("gone");
    expect((await row(t, "clients", "keep"))?.tags).toEqual(["vip"]);
    expect((await row(t, "clients", "gone"))?.isActive).toBe(true);
    expect(await as(t).query(api.clientMergeWrites.mergedInto, { orgId: ORG, id: "gone" })).toBeNull();
  });

  test("leaves, and names, a row the user re-pointed since; never touches rows added after the merge", async () => {
    const t = makeT(); await seed(t);
    await merge(t);
    await t.run(async (ctx) => {
      const inv = await ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", "i1")).first();
      await ctx.db.patch(inv!._id, { clientId: "elsewhere" });
      await ctx.db.insert("projects", { id: "later", organizationId: ORG, projectNumber: "#9", name: "New", clientId: "keep", isTemplate: false });
    });
    const res = await undo(t);
    expect(res.left).toEqual([{ table: "invoices", id: "i1" }]);
    expect((await row(t, "invoices", "i1"))?.clientId).toBe("elsewhere");
    expect((await row(t, "projects", "later"))?.clientId).toBe("keep");
  });

  test("refused as a whole: second time, another user, outside the window; and it deletes nothing", async () => {
    const t = makeT(); await seed(t);
    await merge(t);
    await undo(t);
    await expect(undo(t)).rejects.toThrow(/already undone|reactivated/);
    const t2 = makeT(); await seed(t2);
    await t2.run(async (ctx) => { await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: "user_2", role: "admin" }); });
    await merge(t2);
    await expect(undo(t2, {}, as(t2, "admin", "user_2"))).rejects.toThrow(/person who merged/);
    expect((await row(t2, "projects", "p1"))?.clientId).toBe("keep");
    const t3 = makeT(); await seed(t3);
    await merge(t3);
    await t3.run(async (ctx) => {
      const f = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "aM")).first();
      await ctx.db.patch(f!._id, { details: { ...(f!.details as object), serverSavedAt: Date.now() - 11 * 60 * 1000 } });
    });
    await expect(undo(t3)).rejects.toThrow(/10 minutes/);
  });

  test("`once` is the deterministic undo: marker: a second Undo is refused even after the loser is archived again", async () => {
    const t = makeT(); await seed(t);
    await merge(t);
    await undo(t);
    expect(await row(t, "activityLogs" as never, "undo:aM")).toBeTruthy();
    await t.run(async (ctx) => { const g = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", "gone")).first(); await ctx.db.patch(g!._id, { isActive: false }); });
    await expect(undo(t)).rejects.toThrow(/already undone/);
  });

  test("mergedInto skips a merge that was undone (the marker), and finds the live one after a re-merge", async () => {
    const t = makeT(); await seed(t);
    await merge(t);
    await undo(t);
    const setActiveFlag = (active: boolean) => t.run(async (ctx) => { const g = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", "gone")).first(); await ctx.db.patch(g!._id, { isActive: active }); });
    await setActiveFlag(false);
    expect(await as(t).query(api.clientMergeWrites.mergedInto, { orgId: ORG, id: "gone" })).toBeNull(); // the only merge on record was undone
    await setActiveFlag(true);
    await merge(t, { auditId: "aM2", receivedAuditId: "aR2", now: NOW + 5 });
    expect(await as(t).query(api.clientMergeWrites.mergedInto, { orgId: ORG, id: "gone" })).toMatchObject({ id: "keep", forwardAuditId: "aM2" });
  });

  test("mergedInto picks the NEWEST live merge when more than one is on record (sort direction)", async () => {
    const t = makeT(); await seed(t);
    await merge(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "k3", organizationId: ORG, name: "Older survivor", isActive: true });
      const fwd = (await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "aM")).first())!;
      const { _id, _creationTime, ...rest } = fwd;
      void _id; void _creationTime;
      await ctx.db.insert("activityLogs", { ...rest, id: "aOld", createdAt: (fwd.createdAt ?? NOW) - 10_000, details: { ...(fwd.details as object), survivorId: "k3" } } as never);
    });
    expect(await as(t).query(api.clientMergeWrites.mergedInto, { orgId: ORG, id: "gone" })).toMatchObject({ id: "keep", forwardAuditId: "aM" });
  });

  test("another org cannot undo this org's merge, and a planted foreign id in the snapshot is never touched", async () => {
    const t = makeT(); await seed(t);
    await merge(t);
    await t.run(async (ctx) => { await ctx.db.insert("members", { id: "mo", organizationId: OTHER, userId: USER, role: "admin" }); });
    await expect(undo(t, { orgId: OTHER }, t.withIdentity({ subject: USER, orgId: OTHER, role: "admin" }))).rejects.toThrow(/not found/);
    expect((await row(t, "projects", "p1"))?.clientId).toBe("keep");
    // The foreign project `px` still points at "gone"; planting its id in the forward row's moved list must not move it.
    await t.run(async (ctx) => {
      await ctx.db.patch((await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "px")).first())!._id, { clientId: "keep" });
      const f = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "aM")).first();
      const d = f!.details as { moved: { projects: string[] } };
      await ctx.db.patch(f!._id, { details: { ...d, moved: { ...d.moved, projects: [...d.moved.projects, "px"] } } });
    });
    await undo(t);
    expect((await row(t, "projects", "px"))?.clientId).toBe("keep");
    expect((await row(t, "projects", "p1"))?.clientId).toBe("gone");
  });

  test("compare-and-set: a contact, a link and the tags changed since are left and named, not clobbered", async () => {
    const t = makeT(); await seed(t);
    await merge(t);
    await t.run(async (ctx) => {
      await ctx.db.patch((await ctx.db.query("clientContacts").withIndex("by_cuid", (q) => q.eq("id", "cc1")).first())!._id, { clientId: "elsewhere" });
      await ctx.db.patch((await ctx.db.query("workItemLinks").withIndex("by_cuid", (q) => q.eq("id", "wl1")).first())!._id, { entityId: "elsewhere" });
      await ctx.db.patch((await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", "keep")).first())!._id, { tags: ["vip", "hotel", "later"] });
    });
    const res = await undo(t);
    expect(res.left).toEqual(expect.arrayContaining([{ table: "clientContacts", id: "cc1" }, { table: "workItemLinks", id: "wl1" }, { table: "clients", id: "keep" }]));
    expect((await row(t, "clientContacts", "cc1"))?.clientId).toBe("elsewhere");
    expect((await row(t, "workItemLinks", "wl1"))?.entityId).toBe("elsewhere");
    expect((await row(t, "clients", "keep"))?.tags).toEqual(["vip", "hotel", "later"]);
  });

  test("a role without invoice:update cannot merge or undo, and the survivor must be active", async () => {
    const t = makeT(); await seed(t, "member");
    await expect(merge(t, {}, as(t, "member"))).rejects.toThrow();
    expect((await row(t, "clients", "gone"))?.isActive).toBe(true);
    const t2 = makeT(); await seed(t2);
    await merge(t2);
    await t2.run(async (ctx) => { await ctx.db.patch((await ctx.db.query("members").first())!._id, { role: "member" }); });
    await expect(undo(t2, {}, as(t2, "member"))).rejects.toThrow();
    const t3 = makeT(); await seed(t3);
    await t3.run(async (ctx) => { await ctx.db.patch((await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", "keep")).first())!._id, { isActive: false }); });
    await expect(merge(t3)).rejects.toThrow(/active client/);
  });

  test("a merge over the cap refuses before writing anything", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 1001; i++) await ctx.db.insert("clientContacts", { id: `bulk${i}`, organizationId: ORG, clientId: "gone", name: `c${i}` });
    });
    await expect(merge(t)).rejects.toThrow(/Too many/);
    expect((await row(t, "clients", "gone"))?.isActive).toBe(true);
    expect((await row(t, "projects", "p1"))?.clientId).toBe("gone");
  });
});
