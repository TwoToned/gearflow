// @vitest-environment node
//
// UX Phase 14 (14b-3): the maintenance Edit sheet's write. A plain `recordFieldEdit` of an allow-listed set of fields
// (never status), whose ONE exact Undo takes ids only. Labour (`cost`) follows the job-cost rule; the asset list is
// editable only while the job is SCHEDULED (it holds nothing then), else `JOB_LIVE`.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
type Who = Parameters<T["withIdentity"]>[0];
const ORG = "org_1";
const USER = "user_1";
const asUser: Who = { subject: USER, orgId: ORG };
const asAgent: Who = { subject: USER, orgId: ORG, akid: "key_1" };
const ACTOR = { userId: USER, userName: "Alice" };
const NOW = Date.now();

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
async function seed(t: T, status = "SCHEDULED") {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: "user_2", role: "owner" });
    await ctx.db.insert("apiKeys", { id: "key_1", organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h", scopes: JSON.stringify(["*"]), isActive: true, actingUserId: USER, createdById: USER, noFinancials: true });
    await ctx.db.insert("maintenanceRecords", { id: "r1", organizationId: ORG, type: "REPAIR", title: "Fix desk", description: "old", status, cost: 50, tags: ["x"], createdAt: 1, updatedAt: 1 } as never);
    await ctx.db.insert("maintenanceRecords", { id: "r2", organizationId: ORG, type: "REPAIR", title: "Other", status: "SCHEDULED", createdAt: 1, updatedAt: 1 } as never);
    for (const id of ["a1", "a2", "a3"]) {
      await ctx.db.insert("assets", { id, organizationId: ORG, modelId: "m", assetTag: id.toUpperCase(), status: "AVAILABLE", isActive: true, updatedAt: 100 } as never);
    }
    await ctx.db.insert("maintenanceRecordAssets", { id: "l1", maintenanceRecordId: "r1", assetId: "a1", kind: "LINK" });
  });
}
const rec = (t: T, id = "r1") => t.run(async (ctx) => (await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", id)).first())!);
const linked = (t: T, id = "r1") =>
  t.run(async (ctx) => (await ctx.db.query("maintenanceRecordAssets").withIndex("by_maintenanceRecordId", (q) => q.eq("maintenanceRecordId", id)).collect()).map((l) => l.assetId).sort());
const base = { orgId: ORG, actor: ACTOR, now: NOW };

const edit = (t: T, set: Record<string, unknown>, over: { clear?: string[]; assetIds?: string[]; auditId?: string; who?: Who; id?: string } = {}) =>
  t.withIdentity(over.who ?? asUser).mutation(api.maintenanceEditWrites.editNative, { ...base, id: over.id ?? "r1", set, clear: over.clear ?? [], ...(over.assetIds ? { assetIds: over.assetIds } : {}), auditId: over.auditId ?? "e1" } as never);
const undo = (t: T, auditId = "e1", who: Who = asUser, actor = ACTOR, id = "r1") =>
  t.withIdentity(who).mutation(api.maintenanceEditWrites.undoEditNative, { orgId: ORG, id, auditId, now: NOW + 1, actor });

describe("editNative", () => {
  afterEach(() => vi.useRealTimers());

  test("sets and clears fields, keeps every other field and the status, and Undo restores exactly", async () => {
    const t = makeT();
    await seed(t);
    expect(await edit(t, { title: "  Fix the desk ", scheduledDate: NOW + 1000, tags: ["x", "y"] }, { clear: ["description"] })).toEqual({ id: "r1", changed: true, undoable: true });
    const after = await rec(t);
    expect(after).toMatchObject({ title: "Fix the desk", scheduledDate: NOW + 1000, tags: ["x", "y"], status: "SCHEDULED", cost: 50, type: "REPAIR" });
    expect(after.description).toBeUndefined();
    await undo(t);
    const back = await rec(t);
    expect(back).toMatchObject({ title: "Fix desk", description: "old", tags: ["x"], cost: 50 });
    expect(back.scheduledDate).toBeUndefined();
  });

  test("a save that changes nothing writes nothing and reports no undo", async () => {
    const t = makeT();
    await seed(t);
    expect(await edit(t, { title: "Fix desk", tags: ["x"] })).toEqual({ id: "r1", changed: false, undoable: false });
    expect((await rec(t)).updatedAt).toBe(1);
  });

  test("status is NOT a field: it cannot be set or cleared, nor can any field off the allow-list", async () => {
    const t = makeT();
    await seed(t);
    await expect(edit(t, { status: "COMPLETED" })).rejects.toThrow();
    await expect(edit(t, { organizationId: "org_2" })).rejects.toThrow();
    await expect(edit(t, {}, { clear: ["status"] })).rejects.toMatchObject({ data: { code: "INVALID_FIELD" } });
    await expect(edit(t, {}, { clear: ["title"] })).rejects.toMatchObject({ data: { code: "INVALID_FIELD" } });
    expect((await rec(t)).status).toBe("SCHEDULED");
  });

  test("validation: empty title, over-long text, bad labour, another org's record", async () => {
    const t = makeT();
    await seed(t);
    await expect(edit(t, { title: "  " })).rejects.toMatchObject({ data: { code: "INVALID_FIELD" } });
    await expect(edit(t, { title: "x".repeat(201) })).rejects.toThrow(/at most/);
    await expect(edit(t, { cost: -1 })).rejects.toThrow(/at least/);
    await expect(edit(t, { cost: 10_000_001 })).rejects.toThrow(/at most/);
    await t.run(async (ctx) => {
      await ctx.db.insert("maintenanceRecords", { id: "rx", organizationId: "org_2", type: "REPAIR", title: "Theirs", status: "SCHEDULED", createdAt: 1, updatedAt: 1 } as never);
    });
    await expect(edit(t, { title: "x" }, { id: "rx" })).rejects.toThrow(/not found/i);
  });
});

describe("the asset list", () => {
  test("a SCHEDULED job's membership is editable (links and unlinks, no hold moves) and Undo restores it", async () => {
    const t = makeT();
    await seed(t);
    await edit(t, {}, { assetIds: ["a2", "a3"] });
    expect(await linked(t)).toEqual(["a2", "a3"]);
    const status = async (id: string) => (await t.run(async (ctx) => (await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).first())!)).status;
    expect(await status("a2")).toBe("AVAILABLE");
    await undo(t);
    expect(await linked(t)).toEqual(["a1"]);
  });

  test("a job under way refuses with JOB_LIVE and changes nothing; a list with no asset is refused", async () => {
    const t = makeT();
    await seed(t, "IN_PROGRESS");
    await expect(edit(t, { title: "Renamed" }, { assetIds: ["a2"] })).rejects.toMatchObject({ data: { code: "JOB_LIVE" } });
    expect(await linked(t)).toEqual(["a1"]);
    expect((await rec(t)).title).toBe("Fix desk");
    // The fields themselves stay editable on a live job.
    await edit(t, { title: "Renamed" }, { auditId: "e2" });
    expect((await rec(t)).title).toBe("Renamed");
    const s = makeT();
    await seed(s);
    await expect(edit(s, {}, { assetIds: [] })).rejects.toBeTruthy();
  });

  test("an Undo of a membership change refuses once the job went live", async () => {
    const t = makeT();
    await seed(t);
    await edit(t, {}, { assetIds: ["a2"] });
    await t.run(async (ctx) => {
      const r = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", "r1")).first();
      await ctx.db.patch(r!._id, { status: "IN_PROGRESS" });
    });
    await expect(undo(t)).rejects.toBeTruthy();
    expect(await linked(t)).toEqual(["a2"]);
  });
});

describe("labour follows the job-cost rule", () => {
  test("a noFinancials key neither sets nor clears labour, but its other fields save", async () => {
    const t = makeT();
    await seed(t);
    await edit(t, { cost: 999, title: "By key" }, { who: asAgent });
    expect(await rec(t)).toMatchObject({ title: "By key", cost: 50 });
    await edit(t, {}, { clear: ["cost"], who: asAgent, auditId: "e2" });
    expect((await rec(t)).cost).toBe(50);
  });

  test("an owner sets and clears labour", async () => {
    const t = makeT();
    await seed(t);
    await edit(t, { cost: 80 });
    expect((await rec(t)).cost).toBe(80);
    await edit(t, {}, { clear: ["cost"], auditId: "e2" });
    expect((await rec(t)).cost).toBeUndefined();
  });

  test("a key cannot Undo an edit that touched labour; the owner still can", async () => {
    const t = makeT();
    await seed(t);
    await edit(t, { cost: 80 });
    await expect(undo(t, "e1", asAgent)).rejects.toMatchObject({ data: { code: "NOT_UNDOABLE" } });
    expect((await rec(t)).cost).toBe(80);
    await undo(t);
    expect((await rec(t)).cost).toBe(50);
  });
});

describe("the exact Undo", () => {
  afterEach(() => vi.useRealTimers());

  test("refuses when a changed field moved since (changing nothing)", async () => {
    const t = makeT();
    await seed(t);
    await edit(t, { title: "Mine" });
    await edit(t, { title: "Later" }, { auditId: "e2" });
    await expect(undo(t, "e1")).rejects.toMatchObject({ data: { code: "CHANGED_SINCE" } });
    expect((await rec(t)).title).toBe("Later");
  });

  test("a field the edit did not touch may change in between; only the edited fields are compared", async () => {
    const t = makeT();
    await seed(t);
    await edit(t, { title: "Mine" });
    await edit(t, { description: "newer" }, { auditId: "e2" });
    await undo(t, "e1");
    expect(await rec(t)).toMatchObject({ title: "Fix desk", description: "newer" });
  });

  test("only the author, once, inside the window, and never with another record's audit id", async () => {
    const t = makeT();
    await seed(t);
    await edit(t, { title: "Mine" });
    await expect(undo(t, "e1", { subject: "user_2", orgId: ORG }, { userId: "user_2", userName: "Bob" })).rejects.toMatchObject({ data: { code: "NOT_AUTHOR" } });
    await edit(t, { title: "Theirs" }, { id: "r2", auditId: "e_b" });
    await expect(undo(t, "e_b")).rejects.toMatchObject({ data: { code: "NOT_FOUND" } }); // r2's audit row, r1's id
    expect((await rec(t, "r2")).title).toBe("Theirs");
    await expect(undo(t, "nope")).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await undo(t, "e1");
    await expect(undo(t, "e1")).rejects.toMatchObject({ data: { code: "ALREADY_UNDONE" } });
  });

  test("the window is the server's clock: an Undo after 10 minutes refuses", async () => {
    const t = makeT();
    await seed(t);
    await edit(t, { title: "Mine" });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    await expect(undo(t)).rejects.toThrow(/10 minutes|too long|expired/i);
    expect((await rec(t)).title).toBe("Mine");
  });
});

describe("photos", () => {
  const urlOf = (id: string) => `/api/files/${id}`;
  test("an edit that drops a photo whose bytes it deleted is not undoable", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("fileUploads", { id: "f1", organizationId: ORG, fileName: "f1.jpg", fileSize: 1, mimeType: "image/jpeg", storageKey: "k_f1", url: urlOf("f1"), uploadedById: USER });
      await ctx.db.insert("storedFiles", { storageId: "k_f1", organizationId: ORG, folder: "maintenance-photos" });
      const r = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", "r1")).first();
      await ctx.db.patch(r!._id, { photos: [urlOf("f1")] });
    });
    const res = await edit(t, { photos: [] });
    expect(res.changed).toBe(true);
    expect(res.undoable).toBe(false);
    expect((await rec(t)).photos).toEqual([]);
  });

  test("an Undo that would restore a photo whose bytes have since been deleted refuses (assertPhotosRestorable), changing nothing", async () => {
    const t = makeT();
    await seed(t);
    const url = "/api/files/k_p1";
    await t.run(async (ctx) => {
      await ctx.db.insert("fileUploads", { id: "p1", organizationId: ORG, fileName: "p1.jpg", fileSize: 1, mimeType: "image/jpeg", storageKey: "k_p1", url, uploadedById: USER });
      await ctx.db.insert("storedFiles", { storageId: "k_p1", organizationId: ORG, folder: "maintenance-photos" });
      for (const id of ["r1", "r2"]) {
        const r = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", id)).first();
        await ctx.db.patch(r!._id, { photos: [url] });
      }
    });
    const bytes = () => t.run(async (ctx) => (await ctx.db.query("storedFiles").withIndex("by_storageId", (q) => q.eq("storageId", "k_p1")).unique()) != null);
    // r1 drops P while r2 still holds it: nothing is deleted, so the edit is undoable.
    expect(await edit(t, { photos: [] })).toMatchObject({ changed: true, undoable: true });
    expect(await bytes()).toBe(true);
    // The other holder goes away: P is now unreferenced and its bytes are deleted.
    await t.withIdentity(asUser).mutation(api.maintenanceWrites.deleteNative, { orgId: ORG, id: "r2", now: NOW, actor: ACTOR, auditId: "del2" });
    expect(await bytes()).toBe(false);
    // Restoring P would point r1 at deleted bytes: the Undo refuses, and r1 is unchanged.
    await expect(undo(t)).rejects.toMatchObject({ data: { code: "NOT_UNDOABLE" } });
    expect((await rec(t)).photos).toEqual([]);
  });

  test("an Undo whose snapshot names a field off the allow-list refuses (a tampered audit row), changing nothing", async () => {
    const t = makeT();
    await seed(t);
    await edit(t, { title: "Mine" });
    // Tamper with the stored snapshot: it now claims the edit changed `status`.
    await t.run(async (ctx) => {
      const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "e1")).first();
      const d = row!.details as { fieldEdit: { before: Record<string, unknown>; after: Record<string, unknown> } };
      d.fieldEdit.before.status = "COMPLETED";
      d.fieldEdit.after.status = "SCHEDULED";
      await ctx.db.patch(row!._id, { details: d });
    });
    await expect(undo(t)).rejects.toMatchObject({ data: { code: "NOT_UNDOABLE" } });
    expect(await rec(t)).toMatchObject({ title: "Mine", status: "SCHEDULED" });
  });

  test("a photo that is not the actor's own fresh upload is refused", async () => {
    const t = makeT();
    await seed(t);
    await expect(edit(t, { photos: ["https://evil.example/x.png"] })).rejects.toMatchObject({ data: { code: "INVALID_PHOTO" } });
    expect((await rec(t)).photos ?? []).toEqual([]);
  });
});
