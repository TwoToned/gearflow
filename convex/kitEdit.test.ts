// @vitest-environment node
//
// UX Phase 14 (14b-2): the Kit sheet's writes. `editNative` sets AND clears fields (the old update could not
// clear), writes one field-edit audit row and never touches status; its Undo and the create's Undo are exact,
// ids only.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const asUser = { subject: "user_1", orgId: ORG };
const ACTOR = { userId: "user_1", userName: "Alice" };
const NOW = Date.now();

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: "user_1", role: "owner" });
    await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: "user_2", role: "owner" });
    await ctx.db.insert("locations", { id: "wh", organizationId: ORG, name: "WH" });
    await ctx.db.insert("locations", { id: "van", organizationId: ORG, name: "Van" });
    await ctx.db.insert("locations", { id: "foreign", organizationId: "org_2", name: "Theirs" });
    await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "K-1", name: "Rack", description: "old", status: "CHECKED_OUT", condition: "GOOD", isActive: true, locationId: "wh", images: ["x"], createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("kits", { id: "k2", organizationId: ORG, assetTag: "K-2", name: "Other", isActive: true, createdAt: 1, updatedAt: 1 });
  });
}
const kit = (t: T, id = "k1") => t.run(async (ctx) => (await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).first())!);
const edit = (t: T, set: Record<string, unknown>, clear: string[] = [], auditId = "e1", who = asUser) =>
  t.withIdentity(who).mutation(api.kitWrites.editNative, { orgId: ORG, id: "k1", set, clear, actor: ACTOR, auditId, now: NOW } as never);
const undoEdit = (t: T, auditId = "e1", who = asUser) =>
  t.withIdentity(who).mutation(api.kitWrites.undoEditNative, { orgId: ORG, id: "k1", auditId, now: NOW + 1, actor: ACTOR });

describe("kitWrites.editNative", () => {
  afterEach(() => vi.useRealTimers());

  test("sets and CLEARS fields, leaves status, photos and everything unnamed alone, and Undo restores exactly", async () => {
    const t = makeT();
    await seed(t);
    expect(await edit(t, { name: "Rack 2", weight: 12 }, ["description"])).toEqual({ id: "k1", changed: true });
    const after = await kit(t);
    expect(after).toMatchObject({ name: "Rack 2", weight: 12, status: "CHECKED_OUT", images: ["x"], locationId: "wh" });
    expect(after.description).toBeUndefined();
    await undoEdit(t);
    const back = await kit(t);
    expect(back).toMatchObject({ name: "Rack", description: "old", status: "CHECKED_OUT" });
    expect(back.weight).toBeUndefined();
    await expect(undoEdit(t)).rejects.toThrow(/already undone/);
  });

  test("a save that changes nothing writes nothing and offers no Undo", async () => {
    const t = makeT();
    await seed(t);
    expect(await edit(t, { name: "Rack" })).toEqual({ id: "k1", changed: false });
    await expect(undoEdit(t)).rejects.toThrow();
  });

  test("a duplicate asset tag, another org's location, an over-long field and a clear of the name are refused", async () => {
    const t = makeT();
    await seed(t);
    await expect(edit(t, { assetTag: "K-2" })).rejects.toThrow(/already exists/);
    await expect(edit(t, { locationId: "foreign" })).rejects.toThrow();
    await expect(edit(t, { notes: "x".repeat(2001) })).rejects.toThrow(/notes/i);
    await expect(edit(t, {}, ["name"])).rejects.toThrow(/can't be cleared/);
    await expect(edit(t, {}, ["status"])).rejects.toThrow(/can't be cleared/);
  });

  test("moving the kit stamps last movement on both locations, and Undo restores the place", async () => {
    const t = makeT();
    await seed(t);
    await edit(t, { locationId: "van" });
    const stamp = (id: string) => t.run(async (ctx) => (await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", id)).first())!.lastMovementAt);
    expect(await stamp("wh")).toBe(NOW);
    expect(await stamp("van")).toBe(NOW);
    await undoEdit(t);
    expect((await kit(t)).locationId).toBe("wh");
  });

  test("Undo refuses once a changed field was edited again, for another person, and past the window; a tag taken since blocks it", async () => {
    const t = makeT();
    await seed(t);
    await edit(t, { name: "Rack 2" });
    await expect(undoEdit(t, "e1", { subject: "user_2", orgId: ORG })).rejects.toThrow(/Only the person/);
    await edit(t, { name: "Rack 3" }, [], "e2");
    await expect(undoEdit(t)).rejects.toThrow(/changed since/);
    const t2 = makeT();
    await seed(t2);
    await edit(t2, { assetTag: "K-9" });
    await t2.run(async (ctx) => {
      await ctx.db.insert("kits", { id: "k3", organizationId: ORG, assetTag: "K-1", name: "Took the old tag", isActive: true });
    });
    await expect(undoEdit(t2)).rejects.toThrow(/already exists/);
    expect((await kit(t2)).assetTag).toBe("K-9");
    const t3 = makeT();
    await seed(t3);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T10:00:00Z"));
    await edit(t3, { name: "Rack 2" });
    vi.setSystemTime(new Date("2026-11-25T10:11:00Z"));
    await expect(undoEdit(t3)).rejects.toThrow(/10 minutes/);
  });

  test("a viewer cannot edit, and another org cannot", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m3", organizationId: ORG, userId: "viewer", role: "viewer" });
    });
    await expect(edit(t, { name: "x" }, [], "v1", { subject: "viewer", orgId: ORG })).rejects.toThrow(/Forbidden|permission/i);
    await expect(edit(t, { name: "x" }, [], "v2", { subject: "user_1", orgId: "org_2" })).rejects.toThrow();
  });
});

describe("kitWrites.undoCreateNative", () => {
  const create = (t: T, over: Record<string, unknown> = {}) =>
    t.withIdentity(asUser).mutation(api.kitWrites.createNative, { id: "new1", organizationId: ORG, assetTag: "K-NEW", name: "New kit", locationId: "wh", createdAt: NOW, updatedAt: NOW, actor: ACTOR, auditId: "c1", ...over } as never);
  const undo = (t: T, who = asUser) => t.withIdentity(who).mutation(api.kitWrites.undoCreateNative, { orgId: ORG, id: "new1", auditId: "c1", now: NOW + 1, actor: ACTOR });
  const exists = (t: T) => t.run(async (ctx) => (await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", "new1")).first()) != null);

  test("removes exactly the kit it created, once, for the author", async () => {
    const t = makeT();
    await seed(t);
    await create(t);
    await expect(undo(t, { subject: "user_2", orgId: ORG })).rejects.toThrow(/Only the person/);
    await undo(t);
    expect(await exists(t)).toBe(false);
    await expect(undo(t)).rejects.toThrow();
  });

  test("refuses once the kit has a member, was edited, or the audit id belongs to another kit", async () => {
    const t = makeT();
    await seed(t);
    await create(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m", assetTag: "A-1", isActive: true });
      await ctx.db.insert("kitSerializedItems", { id: "ks", organizationId: ORG, kitId: "new1", assetId: "a1", addedById: "u" });
    });
    await expect(undo(t)).rejects.toThrow(/members, jobs, photos, checks or history/);
    const t2 = makeT();
    await seed(t2);
    await create(t2);
    await t2.withIdentity(asUser).mutation(api.kitWrites.editNative, { orgId: ORG, id: "new1", set: { name: "Renamed" }, clear: [], actor: ACTOR, auditId: "e9", now: NOW + 5 });
    await expect(undo(t2)).rejects.toThrow(/changed since/);
    await expect(t2.withIdentity(asUser).mutation(api.kitWrites.undoCreateNative, { orgId: ORG, id: "k1", auditId: "c1", now: NOW, actor: ACTOR })).rejects.toThrow(/can't be un-created/);
  });

  // One row naming the kit, per referencing table: each alone is enough to refuse (the kit is no longer "just created").
  const REFERENCES: Record<string, Record<string, unknown>> = {
    kitSerializedItems: { id: "r", organizationId: ORG, kitId: "new1", assetId: "a1", addedById: "u" },
    kitBulkItems: { id: "r", organizationId: ORG, kitId: "new1", bulkAssetId: "b1", quantity: 1, addedById: "u" },
    projectLineItems: { id: "r", organizationId: ORG, projectId: "p1", kitId: "new1", type: "EQUIPMENT", status: "CONFIRMED", createdAt: 1, updatedAt: 1 },
    kitMedia: { id: "r", organizationId: ORG, kitId: "new1", fileId: "f1" },
    kitCheckItems: { id: "r", organizationId: ORG, kitId: "new1", checkItemId: "ci1" },
    groupTemplateItems: { id: "r", organizationId: ORG, templateId: "tpl", kitId: "new1" },
    maintenanceRecords: { id: "r", organizationId: ORG, type: "REPAIR", title: "Fix", kitId: "new1" },
    checkRecords: { id: "r", organizationId: ORG, context: "AD_HOC", checkItemId: "ci1", checkItemLabelSnapshot: "x", checkItemTypeSnapshot: "PASS_FAIL", result: "PASS", performedById: "u", kitId: "new1" },
    assetScanLogs: { id: "r", organizationId: ORG, action: "SCAN_VERIFY", scannedById: "u", kitId: "new1" },
    kitRevenueAllocations: { id: "r", organizationId: ORG, kitId: "new1", modelId: "m", allocationPercent: 50 },
  };
  test.each(Object.keys(REFERENCES))("refuses once a %s row names the kit, and keeps the kit", async (table) => {
    const t = makeT();
    await seed(t);
    await create(t);
    await t.run(async (ctx) => {
      await ctx.db.insert(table as never, REFERENCES[table] as never);
    });
    await expect(undo(t)).rejects.toThrow(/members, jobs, photos, checks or history/);
    expect(await exists(t)).toBe(true);
  });

  test("a clean kit is removed (the control for the table list above)", async () => {
    const t = makeT();
    await seed(t);
    await create(t);
    await undo(t);
    expect(await exists(t)).toBe(false);
  });

  test("refuses after the 10-minute window, and keeps the kit", async () => {
    const t = makeT();
    await seed(t);
    await create(t);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    await expect(undo(t)).rejects.toThrow(/10 minutes|too long|expired/i);
    vi.useRealTimers();
    expect(await exists(t)).toBe(true);
  });

  test("another org's audit row, or a kit that belongs to another org, is not undoable", async () => {
    const t = makeT();
    await seed(t);
    await create(t);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "c1")).first();
      await ctx.db.patch(row!._id, { organizationId: "org_2" });
    });
    await expect(undo(t)).rejects.toThrow(/can't be un-created/);
    expect(await exists(t)).toBe(true);

    const u = makeT();
    await seed(u);
    await create(u);
    await u.run(async (ctx) => {
      const k = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", "new1")).first();
      await ctx.db.patch(k!._id, { organizationId: "org_2" });
    });
    await expect(undo(u)).rejects.toThrow(/Kit not found/);
    expect(await exists(u)).toBe(true);
  });
});

describe("kitWrites.editNative and the kit cost line", () => {
  test("a noFinancials key can edit a kit but can neither set nor clear what it cost to buy; a user session can", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      const k = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", "k1")).first();
      await ctx.db.patch(k!._id, { purchasePrice: 400 });
      await ctx.db.insert("apiKeys", { id: "key1", organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h", scopes: JSON.stringify(["*"]), isActive: true, actingUserId: "user_1", createdById: "user_1", noFinancials: true });
    });
    const asAgent = { subject: "user_1", orgId: ORG, akid: "key1" };
    expect(await edit(t, { name: "Rack B", purchasePrice: 1 }, [], "ag1", asAgent)).toEqual({ id: "k1", changed: true });
    expect(await kit(t)).toMatchObject({ name: "Rack B", purchasePrice: 400 }); // the price it sent was ignored
    await edit(t, {}, ["purchasePrice"], "ag2", asAgent);
    expect((await kit(t)).purchasePrice).toBe(400); // and it cannot clear it
    await edit(t, { purchasePrice: 450 }, [], "u1");
    expect((await kit(t)).purchasePrice).toBe(450); // a user session sets it
  });
});
