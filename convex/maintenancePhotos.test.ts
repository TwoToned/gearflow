// @vitest-environment node
//
// UX Phase 14 (14b-3, Phase 13 review add-on): the photos on a maintenance record. A NEW photo must pass THE attach
// rule (`assertAttachableUpload`): the actor's own recent upload, this org's, in the maintenance folder, held by
// nothing. A photo already on the record is never re-validated on a save. Bytes are deleted ONLY through
// `deleteStoredFileIfUnreferenced`, after the record row changed, so a file anything else holds survives.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { MAINTENANCE_PHOTO_FOLDER } from "./lib/maintenancePhotoFolder";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const actor = { userId: USER, userName: "Alice" };
const asUser = { subject: USER, orgId: ORG, role: "admin" };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "admin" });
    await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: "user_2", role: "admin" });
    await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
    await ctx.db.insert("assets", { id: "as1", organizationId: ORG, assetTag: "AS1", modelId: "m1", status: "AVAILABLE", isActive: true, createdAt: NOW, updatedAt: NOW });
  });
}
const urlOf = (id: string) => `/api/files/k_${id}`;
/** An upload as `/api/uploads` leaves it: a `fileUploads` row plus its `storedFiles` row. */
async function upload(t: T, id: string, over: { by?: string; org?: string; folder?: string } = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("fileUploads", { id, organizationId: over.org ?? ORG, fileName: `${id}.jpg`, fileSize: 1, mimeType: "image/jpeg", storageKey: `k_${id}`, url: urlOf(id), uploadedById: over.by ?? USER });
    await ctx.db.insert("storedFiles", { storageId: `k_${id}`, organizationId: over.org ?? ORG, folder: over.folder ?? MAINTENANCE_PHOTO_FOLDER });
  });
}
const fileExists = (t: T, id: string) =>
  t.run(async (ctx) => {
    const up = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    const stored = await ctx.db.query("storedFiles").withIndex("by_storageId", (q) => q.eq("storageId", `k_${id}`)).unique();
    return up != null && stored != null;
  });
const rec = (t: T, id = "rec1") => t.run(async (ctx) => ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", id)).first());
/** A record that already holds `photos`, written straight to the table (as an older save would have left it). */
async function seedRecord(t: T, photos: string[], id = "rec1") {
  await t.run(async (ctx) => {
    await ctx.db.insert("maintenanceRecords", { id, organizationId: ORG, type: "REPAIR", title: "Fix drill", status: "SCHEDULED", photos, createdAt: NOW, updatedAt: NOW } as never);
    await ctx.db.insert("maintenanceRecordAssets", { id: `l_${id}`, maintenanceRecordId: id, assetId: "as1", kind: "LINK" });
  });
}

const base = { orgId: ORG, type: "REPAIR" as const, title: "Fix drill", assetLinks: [{ id: "lnk1", assetId: "as1" }], now: NOW, actor };
const create = (t: T, photos: string[], recordId = "rec1", auditId = "a1") =>
  t.withIdentity(asUser).mutation(api.maintenanceWrites.createNative, { ...base, recordId, photos, auditId });
const update = (t: T, photos: string[], auditId = "u1", id = "rec1") =>
  t.withIdentity(asUser).mutation(api.maintenanceWrites.updateNative, { ...base, id, status: "SCHEDULED", photos, auditId });
const remove = (t: T, id = "rec1", auditId = "d1") => t.withIdentity(asUser).mutation(api.maintenanceWrites.deleteNative, { orgId: ORG, id, now: NOW, actor, auditId });

describe("a NEW photo must pass the attach rule", () => {
  afterEach(() => vi.useRealTimers());

  test("the actor's own fresh upload in the maintenance folder is attached", async () => {
    const t = makeT();
    await seed(t);
    await upload(t, "f1");
    await create(t, [urlOf("f1")]);
    expect((await rec(t))?.photos).toEqual([urlOf("f1")]);
  });

  test("something that is not an uploaded file (any other URL) is refused and nothing is created", async () => {
    const t = makeT();
    await seed(t);
    await expect(create(t, ["https://evil.example/x.png"])).rejects.toMatchObject({ data: { code: "INVALID_PHOTO" } });
    expect(await rec(t)).toBeNull();
  });

  test("someone else's upload is refused", async () => {
    const t = makeT();
    await seed(t);
    await upload(t, "f1", { by: "user_2" });
    await expect(create(t, [urlOf("f1")])).rejects.toMatchObject({ data: { code: "INVALID_PHOTO" } });
    expect(await rec(t)).toBeNull();
  });

  test("another organisation's upload is refused", async () => {
    const t = makeT();
    await seed(t);
    await upload(t, "f1", { org: OTHER });
    await expect(create(t, [urlOf("f1")])).rejects.toThrow(/File not found/);
    expect(await rec(t)).toBeNull();
  });

  test("an upload older than the attach window is refused", async () => {
    const t = makeT();
    await seed(t);
    await upload(t, "f1");
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    await expect(create(t, [urlOf("f1")])).rejects.toMatchObject({ data: { code: "INVALID_PHOTO" } });
    vi.useRealTimers();
    expect(await rec(t)).toBeNull();
  });

  test("a file uploaded into another folder (misc, check-photos) is refused", async () => {
    const t = makeT();
    await seed(t);
    await upload(t, "f1", { folder: "misc" });
    await upload(t, "f2", { folder: "check-photos" });
    await expect(create(t, [urlOf("f1")])).rejects.toThrow(/not uploaded for this/);
    await expect(create(t, [urlOf("f2")])).rejects.toThrow(/not uploaded for this/);
    expect(await rec(t)).toBeNull();
  });

  test("a file something already holds (another job's photos, a media row) is refused", async () => {
    const t = makeT();
    await seed(t);
    await upload(t, "f1");
    await upload(t, "f2");
    await seedRecord(t, [urlOf("f1")], "other");
    await t.run(async (ctx) => {
      await ctx.db.insert("kitMedia", { id: "km1", organizationId: ORG, kitId: "k1", fileId: "f2" } as never);
    });
    await expect(create(t, [urlOf("f1")])).rejects.toThrow(/already attached/);
    await expect(create(t, [urlOf("f2")])).rejects.toThrow(/already attached/);
    expect(await rec(t)).toBeNull();
  });

  test("one bad photo among good ones refuses the whole write", async () => {
    const t = makeT();
    await seed(t);
    await upload(t, "f1");
    await expect(create(t, [urlOf("f1"), "https://evil.example/x.png"])).rejects.toMatchObject({ data: { code: "INVALID_PHOTO" } });
    expect(await rec(t)).toBeNull();
  });

  test("an update's NEW photo is proven the same way, and a refusal changes nothing", async () => {
    const t = makeT();
    await seed(t);
    await seedRecord(t, []);
    await upload(t, "f1", { by: "user_2" });
    await expect(update(t, [urlOf("f1")])).rejects.toMatchObject({ data: { code: "INVALID_PHOTO" } });
    expect((await rec(t))?.photos).toEqual([]);
    await upload(t, "f3");
    await update(t, [urlOf("f3")]);
    expect((await rec(t))?.photos).toEqual([urlOf("f3")]);
  });
});

describe("a photo already on the record is never re-validated", () => {
  afterEach(() => vi.useRealTimers());

  test("an old, foreign-user, wrong-folder, shared file stays valid on a save that keeps it", async () => {
    const t = makeT();
    await seed(t);
    await upload(t, "old", { by: "user_2", folder: "misc" });
    await seedRecord(t, [urlOf("old")]);
    await seedRecord(t, [urlOf("old")], "twin"); // held by a second job too
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    await update(t, [urlOf("old")]);
    expect((await rec(t))?.photos).toEqual([urlOf("old")]);
    expect(await fileExists(t, "old")).toBe(true); // kept, so nothing is deleted
  });

  test("keeping the old photo while adding a bad one is still refused (only the new one is proven)", async () => {
    const t = makeT();
    await seed(t);
    await upload(t, "old", { by: "user_2", folder: "misc" });
    await seedRecord(t, [urlOf("old")]);
    await expect(update(t, [urlOf("old"), "https://evil.example/x.png"])).rejects.toMatchObject({ data: { code: "INVALID_PHOTO" } });
    expect((await rec(t))?.photos).toEqual([urlOf("old")]);
  });
});

describe("labour is bounded on the legacy create and update too", () => {
  test("a cost above the shared maximum is refused (create and update), the maximum itself is fine", async () => {
    const t = makeT();
    await seed(t);
    await expect(t.withIdentity(asUser).mutation(api.maintenanceWrites.createNative, { ...base, recordId: "c1", photos: [], cost: 10_000_001, auditId: "ca" })).rejects.toThrow(/at most/);
    expect(await rec(t, "c1")).toBeNull();
    await t.withIdentity(asUser).mutation(api.maintenanceWrites.createNative, { ...base, recordId: "c2", photos: [], cost: 10_000_000, auditId: "cb" });
    await expect(t.withIdentity(asUser).mutation(api.maintenanceWrites.updateNative, { ...base, id: "c2", status: "SCHEDULED", photos: [], cost: 10_000_001, auditId: "ua" })).rejects.toThrow(/at most/);
    expect((await rec(t, "c2"))?.cost).toBe(10_000_000);
  });
});

describe("removal deletes bytes only through deleteStoredFileIfUnreferenced", () => {
  test("a photo an update drops has its bytes deleted when nothing else holds it", async () => {
    const t = makeT();
    await seed(t);
    await upload(t, "f1");
    await seedRecord(t, [urlOf("f1")]);
    await update(t, []);
    expect((await rec(t))?.photos).toEqual([]);
    expect(await fileExists(t, "f1")).toBe(false);
  });

  test("an update that OMITS photos and tags leaves them, and their bytes, untouched (absent is unchanged, not cleared)", async () => {
    const t = makeT();
    await seed(t);
    await upload(t, "f1");
    await seedRecord(t, [urlOf("f1")]);
    await t.run(async (ctx) => {
      const r = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", "rec1")).first();
      await ctx.db.patch(r!._id, { tags: ["a", "b"] });
    });
    await t.withIdentity(asUser).mutation(api.maintenanceWrites.updateNative, { ...base, id: "rec1", status: "SCHEDULED", title: "Renamed", auditId: "partial" });
    const after = await rec(t);
    expect(after?.title).toBe("Renamed");
    expect(after?.photos).toEqual([urlOf("f1")]);
    expect(after?.tags).toEqual(["a", "b"]);
    expect(await fileExists(t, "f1")).toBe(true);
  });

  test("a dropped photo something else still holds (another job, a media row) keeps its bytes", async () => {
    const t = makeT();
    await seed(t);
    await upload(t, "shared");
    await upload(t, "media");
    await seedRecord(t, [urlOf("shared"), urlOf("media")]);
    await seedRecord(t, [urlOf("shared")], "twin");
    await t.run(async (ctx) => {
      await ctx.db.insert("kitMedia", { id: "km1", organizationId: ORG, kitId: "k1", fileId: "media" } as never);
    });
    await update(t, []);
    expect(await fileExists(t, "shared")).toBe(true);
    expect(await fileExists(t, "media")).toBe(true);
  });

  test("a photo that stays keeps its bytes while a dropped sibling goes", async () => {
    const t = makeT();
    await seed(t);
    await upload(t, "keep");
    await upload(t, "drop");
    await seedRecord(t, [urlOf("keep"), urlOf("drop")]);
    await update(t, [urlOf("keep")]);
    expect(await fileExists(t, "keep")).toBe(true);
    expect(await fileExists(t, "drop")).toBe(false);
  });

  test("deleting the job deletes its unreferenced photos' bytes and spares a held one", async () => {
    const t = makeT();
    await seed(t);
    await upload(t, "own");
    await upload(t, "shared");
    await seedRecord(t, [urlOf("own"), urlOf("shared")]);
    await seedRecord(t, [urlOf("shared")], "twin");
    await remove(t);
    expect(await rec(t)).toBeNull();
    expect(await fileExists(t, "own")).toBe(false);
    expect(await fileExists(t, "shared")).toBe(true);
  });

  test("an Undo of a create never deletes a stored file", async () => {
    const t = makeT();
    await seed(t);
    await upload(t, "f1");
    await create(t, [urlOf("f1")]);
    await t.withIdentity(asUser).mutation(api.maintenanceWrites.undoCreateNative, { orgId: ORG, id: "rec1", auditId: "a1", now: NOW + 1, actor });
    expect(await rec(t)).toBeNull();
    expect(await fileExists(t, "f1")).toBe(true);
  });

  test("a removed photo whose upload cannot be found (not in this org) is left alone, never guessed", async () => {
    const t = makeT();
    await seed(t);
    await upload(t, "theirs", { org: OTHER });
    await seedRecord(t, [urlOf("theirs")]);
    await update(t, []);
    expect(await fileExists(t, "theirs")).toBe(true); // another org's file is untouched
  });
});

describe("labour follows the cost line on the record's own save", () => {
  test("a noFinancials key creates and updates a job without setting or clearing its labour", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("apiKeys", { id: "key1", organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h", scopes: JSON.stringify(["*"]), isActive: true, actingUserId: USER, createdById: USER, noFinancials: true });
    });
    const asKey = { subject: USER, orgId: ORG, akid: "key1" };
    await t.withIdentity(asKey).mutation(api.maintenanceWrites.createNative, { ...base, recordId: "viaKey", photos: [], cost: 500, auditId: "ck" });
    expect((await rec(t, "viaKey"))?.cost).toBeUndefined(); // a hidden caller sets no labour on create

    await seedRecord(t, [], "r2");
    await t.run(async (ctx) => {
      const r = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", "r2")).first();
      await ctx.db.patch(r!._id, { cost: 75 });
    });
    await t.withIdentity(asKey).mutation(api.maintenanceWrites.updateNative, { ...base, id: "r2", status: "SCHEDULED", photos: [], title: "Renamed", auditId: "uk" });
    expect(await rec(t, "r2")).toMatchObject({ title: "Renamed", cost: 75 }); // an update with no cost key does NOT clear it
    await t.withIdentity(asUser).mutation(api.maintenanceWrites.updateNative, { ...base, id: "r2", status: "SCHEDULED", photos: [], title: "Renamed", cost: 90, auditId: "uu" });
    expect((await rec(t, "r2"))?.cost).toBe(90); // a user session sets it
  });
});
