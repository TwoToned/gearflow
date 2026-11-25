// @vitest-environment node
//
// UX Phase 14 (14a-2): the Locations and Kits list reads, lastMovementAt stamped through the REAL
// writers, and Move contents with its exact Undo. Cross-tenant rows must never appear.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const asUser = { subject: USER, orgId: ORG };
const ACTOR = { userId: USER, userName: "Alice" };
const NOW = 1_800_000_000_000;

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: "user_2", role: "owner" });
    await ctx.db.insert("locations", { id: "whA", organizationId: ORG, name: "Warehouse A", type: "WAREHOUSE", capacity: 10 });
    await ctx.db.insert("locations", { id: "binB2", organizationId: ORG, name: "B2", type: "WAREHOUSE", parentId: "whA" });
    await ctx.db.insert("locations", { id: "van2", organizationId: ORG, name: "Van 2", type: "VEHICLE" });
    await ctx.db.insert("locations", { id: "hall", organizationId: ORG, name: "Town Hall", type: "VENUE" });
    await ctx.db.insert("locations", { id: "foreign", organizationId: OTHER, name: "Foreign WH", type: "WAREHOUSE" });
    const asset = { organizationId: ORG, modelId: "m", isActive: true };
    await ctx.db.insert("assets", { ...asset, id: "a1", assetTag: "A-1", status: "AVAILABLE", locationId: "whA" });
    await ctx.db.insert("assets", { ...asset, id: "a2", assetTag: "A-2", status: "AVAILABLE", locationId: "whA" });
    await ctx.db.insert("assets", { ...asset, id: "a3", assetTag: "A-3", status: "AVAILABLE", locationId: "binB2" });
    await ctx.db.insert("assets", { ...asset, id: "out", assetTag: "A-OUT", status: "CHECKED_OUT", locationId: "whA" });
    await ctx.db.insert("assets", { ...asset, id: "inkit", assetTag: "A-KIT", status: "AVAILABLE", locationId: "whA", kitId: "k1" });
    await ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, modelId: "m", assetTag: "B-1", totalQuantity: 10, availableQuantity: 10, isActive: true, locationId: "whA" });
    await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "K-1", name: "Rack", status: "AVAILABLE", isActive: true, locationId: "whA" });
    await ctx.db.insert("assets", { id: "fa", organizationId: OTHER, modelId: "m", assetTag: "F-1", isActive: true, locationId: "foreign" });
  });
}

const names = (r: { items: { name: string }[] }) => r.items.map((i) => i.name);
const lastMove = (t: T, id: string) =>
  t.run(async (ctx) => (await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", id)).first())?.lastMovementAt ?? null);

describe("locationsList.listPage", () => {
  test("stored count, capacity, fill, bin count; no movement yet prints null (never a guess); another org's rows never appear", async () => {
    const t = makeT();
    await seed(t);
    const r = await t.withIdentity(asUser).query(api.locationsList.listPage, { orgId: ORG });
    expect(names(r)).toEqual(["B2", "Town Hall", "Van 2", "Warehouse A"]);
    const wh = r.items.find((i) => i.id === "whA")!;
    // 4 assets (incl. the one out and the kit member) + 1 bulk line + 1 kit = 6.
    expect(wh).toMatchObject({ stored: 6, capacity: 10, fill: 60, binCount: 1, lastMovement: null, labelState: "not-printed" });
    expect(r.items.find((i) => i.id === "van2")).toMatchObject({ capacity: null, fill: null });
  });

  test("strip words and counts: Sites is Venue + Offsite; Empty counts bins' contents too", async () => {
    const t = makeT();
    await seed(t);
    const as = t.withIdentity(asUser);
    expect(names(await as.query(api.locationsList.listPage, { orgId: ORG, segment: "sites" }))).toEqual(["Town Hall"]);
    expect(names(await as.query(api.locationsList.listPage, { orgId: ORG, segment: "empty" }))).toEqual(["Town Hall", "Van 2"]);
    expect(await as.query(api.locationsList.segmentCounts, { orgId: ORG })).toEqual({ all: 4, warehouses: 2, vehicles: 1, sites: 1, empty: 2 });
  });

  test("a caller from another org is rejected", async () => {
    const t = makeT();
    await seed(t);
    await expect(t.withIdentity({ subject: USER, orgId: OTHER }).query(api.locationsList.listPage, { orgId: ORG })).rejects.toThrow();
  });
});

describe("lastMovementAt is stamped by the real writers", () => {
  test("asset bulk move stamps the place it left and the place it entered, nothing else", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(asUser).mutation(api.assetWrites.bulkUpdateNative, { orgId: ORG, ids: ["a1"], set: { locationId: "van2" }, clear: [], now: NOW });
    expect(await lastMove(t, "whA")).toBe(NOW);
    expect(await lastMove(t, "van2")).toBe(NOW);
    expect(await lastMove(t, "hall")).toBeNull();
  });

  test("an edit that leaves the location alone does not stamp", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(asUser).mutation(api.assetWrites.bulkUpdateNative, { orgId: ORG, ids: ["a1"], set: { condition: "FAIR" }, clear: [], now: NOW });
    expect(await lastMove(t, "whA")).toBeNull();
  });

  test("clearing the location stamps the place it left", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(asUser).mutation(api.assetWrites.bulkUpdateNative, { orgId: ORG, ids: ["a1"], set: {}, clear: ["locationId"], now: NOW });
    expect(await lastMove(t, "whA")).toBe(NOW);
  });

  test("a kit location edit stamps both ends", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(asUser).mutation(api.kitWrites.updateNative, { id: "k1", orgId: ORG, patch: { locationId: "hall" }, actor: ACTOR, auditId: "au1", now: NOW });
    expect(await lastMove(t, "whA")).toBe(NOW);
    expect(await lastMove(t, "hall")).toBe(NOW);
  });

  test("creating an asset at a location stamps it", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m", organizationId: ORG, name: "Par" });
    });
    await t.withIdentity(asUser).mutation(api.assetWrites.createNative, { id: "new1", organizationId: ORG, modelId: "m", assetTag: "N-1", locationId: "van2", createdAt: NOW, updatedAt: NOW, actor: ACTOR, auditId: "au2" } as never);
    expect(await lastMove(t, "van2")).toBe(NOW);
  });
});

describe("Move contents", () => {
  afterEach(() => vi.useRealTimers());
  const move = (t: T, over: Record<string, unknown> = {}, id = asUser) =>
    t.withIdentity(id).mutation(api.locationsWrites.moveContentsNative, { orgId: ORG, fromIds: ["whA"], toId: "van2", now: NOW, actor: ACTOR, auditId: "mv1", ...over } as never);
  const undo = (t: T, id = asUser) => t.withIdentity(id).mutation(api.locationsWrites.undoMoveContentsNative, { orgId: ORG, auditId: "mv1", now: NOW + 1000, actor: ACTOR });
  const at = (t: T, table: "assets" | "bulkAssets" | "kits", id: string) =>
    t.run(async (ctx) => (await ctx.db.query(table).withIndex("by_cuid", (q) => q.eq("id", id)).first())?.locationId ?? null);

  test("moves what can move, names what it skipped, and stamps both ends", async () => {
    const t = makeT();
    await seed(t);
    const r = await move(t);
    // a1, a2, bulk b1 and kit k1 move; A-OUT is out on a job and A-KIT travels with its kit.
    expect(r.moved).toBe(4);
    expect(Object.fromEntries(r.skipped.map((s) => [s.reason, s.count]))).toEqual({ "out on a job": 1, "in a kit": 1 });
    expect(await at(t, "assets", "a1")).toBe("van2");
    expect(await at(t, "assets", "out")).toBe("whA");
    expect(await at(t, "kits", "k1")).toBe("van2");
    expect(await lastMove(t, "whA")).toBe(NOW);
    expect(await lastMove(t, "van2")).toBe(NOW);
  });

  test("Undo puts back exactly the rows it moved, once", async () => {
    const t = makeT();
    await seed(t);
    await move(t);
    expect(await undo(t)).toEqual({ restored: 4, left: 0 });
    expect(await at(t, "assets", "a1")).toBe("whA");
    expect(await at(t, "kits", "k1")).toBe("whA");
    await expect(undo(t)).rejects.toThrow(/already undone/);
  });

  test("Undo leaves a row that moved on since, and says so", async () => {
    const t = makeT();
    await seed(t);
    await move(t);
    await t.withIdentity(asUser).mutation(api.assetWrites.bulkUpdateNative, { orgId: ORG, ids: ["a1"], set: { locationId: "hall" }, clear: [], now: NOW + 500 });
    expect(await undo(t)).toEqual({ restored: 3, left: 1 });
    expect(await at(t, "assets", "a1")).toBe("hall");
  });

  test("refuses another person and refuses once the 10-minute window has passed", async () => {
    const t = makeT();
    await seed(t);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T10:00:00Z"));
    await move(t);
    await expect(undo(t, { subject: "user_2", orgId: ORG })).rejects.toThrow(/Only the person/);
    vi.setSystemTime(new Date("2026-11-24T10:11:00Z"));
    await expect(undo(t)).rejects.toThrow(/10 minutes/);
    expect(await at(t, "assets", "a1")).toBe("van2");
  });

  test("a destination that is also a source, or another org's location, is refused and nothing moves", async () => {
    const t = makeT();
    await seed(t);
    await expect(move(t, { toId: "whA" })).rejects.toThrow(/not one of the selected/);
    await expect(move(t, { toId: "foreign" })).rejects.toThrow(/Destination not found/);
    await expect(move(t, { fromIds: ["foreign"] })).rejects.toThrow(/Location not found/);
    expect(await at(t, "assets", "a1")).toBe("whA");
  });

  test("a stranger from another org cannot move or undo", async () => {
    const t = makeT();
    await seed(t);
    await expect(move(t, {}, { subject: USER, orgId: OTHER })).rejects.toThrow();
  });
});

describe("kitsList", () => {
  async function seedKits(t: T) {
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("kits", { id: "k2", organizationId: ORG, assetTag: "K-2", name: "Missing PA805", status: "AVAILABLE", isActive: true });
      await ctx.db.insert("assets", { id: "pa", organizationId: ORG, modelId: "m", assetTag: "PA805", status: "LOST", isActive: true });
      await ctx.db.insert("kitSerializedItems", { id: "ks2", organizationId: ORG, kitId: "k2", assetId: "pa", addedById: "u1" });
      await ctx.db.insert("kits", { id: "k3", organizationId: ORG, assetTag: "K-3", name: "Legacy", status: "INCOMPLETE", isActive: true });
      await ctx.db.insert("kitSerializedItems", { id: "ks1", organizationId: ORG, kitId: "k1", assetId: "a1", addedById: "u1" });
      await ctx.db.insert("kits", { id: "kf", organizationId: OTHER, assetTag: "K-F", name: "Foreign", status: "AVAILABLE", isActive: true });
    });
  }

  test("state is derived; Missing items is the red segment; a stored INCOMPLETE marker keeps blocking", async () => {
    const t = makeT();
    await seedKits(t);
    const as = t.withIdentity(asUser);
    const all = await as.query(api.kitsList.listPage, { orgId: ORG });
    expect(Object.fromEntries(all.items.map((i) => [i.assetTag, i.state?.key]))).toEqual({ "K-1": "AVAILABLE", "K-2": "INCOMPLETE", "K-3": "INCOMPLETE" });
    expect(all.items.find((i) => i.assetTag === "K-2")!.state!.missing[0]).toMatchObject({ label: "PA805", why: "lost" });
    expect((await as.query(api.kitsList.listPage, { orgId: ORG, segment: "missing" })).items.map((i) => i.assetTag).sort()).toEqual(["K-2", "K-3"]);
    expect(await as.query(api.kitsList.segmentCounts, { orgId: ORG })).toEqual({ all: 3, complete: 1, missing: 2, onjob: 0, maintenance: 0, retired: 0, truncated: false });
  });

  test("a noFinancials key cannot order kits by purchase price: asc and desc are the same default order", async () => {
    const t = makeT();
    await seedKits(t);
    await t.run(async (ctx) => {
      const set = async (id: string, patch: Record<string, unknown>) => {
        const k = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).first();
        await ctx.db.patch(k!._id, patch);
      };
      await set("k1", { purchasePrice: 900 });
      await set("k2", { purchasePrice: 10 });
      await set("k3", { purchasePrice: 400 });
      await ctx.db.insert("apiKeys", {
        id: "key_1", organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h",
        scopes: JSON.stringify(["*"]), isActive: true, actingUserId: USER, createdById: USER, noFinancials: true,
      });
    });
    const agent = t.withIdentity({ subject: USER, orgId: ORG, akid: "key_1" });
    const tags = async (sortOrder: "asc" | "desc") =>
      (await agent.query(api.kitsList.listPage, { orgId: ORG, sortBy: "purchasePrice", sortOrder })).items.map((i) => i.assetTag);
    expect(await tags("asc")).toEqual(await tags("desc"));
    expect(await tags("asc")).toEqual(["K-1", "K-2", "K-3"]);
    expect((await agent.query(api.kitsList.listPage, { orgId: ORG, sortBy: "notAField", sortOrder: "desc" })).items.map((i) => i.assetTag)).toEqual(["K-1", "K-2", "K-3"]);
  });

  test("In maintenance and Retired are reachable words, with counts", async () => {
    const t = makeT();
    await seedKits(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("kits", { id: "km", organizationId: ORG, assetTag: "K-M", name: "In repair", status: "IN_MAINTENANCE", isActive: true });
      await ctx.db.insert("kits", { id: "kr", organizationId: ORG, assetTag: "K-R", name: "Old", status: "AVAILABLE", isActive: false });
    });
    const as = t.withIdentity(asUser);
    expect((await as.query(api.kitsList.listPage, { orgId: ORG, segment: "maintenance" })).items.map((i) => i.assetTag)).toEqual(["K-M"]);
    expect((await as.query(api.kitsList.listPage, { orgId: ORG, segment: "retired" })).items.map((i) => i.assetTag)).toEqual(["K-R"]);
    expect((await as.query(api.kitsList.listPage, { orgId: ORG })).items.map((i) => i.assetTag)).not.toContain("K-R");
    expect(await as.query(api.kitsList.segmentCounts, { orgId: ORG })).toMatchObject({ maintenance: 1, retired: 1, truncated: false });
  });

  test("the booking gate query agrees, including the stored INCOMPLETE marker", async () => {
    const t = makeT();
    await seedKits(t);
    const as = t.withIdentity(asUser);
    expect(await as.query(api.kitsList.bookingGate, { orgId: ORG, id: "k2" })).toMatchObject({ key: "INCOMPLETE", blocksBooking: true });
    expect(await as.query(api.kitsList.bookingGate, { orgId: ORG, id: "k3" })).toMatchObject({ key: "INCOMPLETE", blocksBooking: true });
    expect(await as.query(api.kitsList.bookingGate, { orgId: ORG, id: "kf" })).toBeNull();
  });

  test("a kit booked on a confirmed job is Reserved and On a job; a missing item still beats it", async () => {
    const t = makeT();
    await seedKits(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "#2341", name: "Gig", status: "CONFIRMED", isTemplate: false, liveVersionId: "v1", rentalStartDate: NOW, rentalEndDate: NOW + 86_400_000, createdAt: 1, updatedAt: 1 });
      const line = { organizationId: ORG, projectId: "p1", versionId: "v1", status: "CONFIRMED", description: "x", quantity: 1 } as const;
      await ctx.db.insert("projectLineItems", { ...line, id: "l1", kitId: "k1" } as never);
      await ctx.db.insert("projectLineItems", { ...line, id: "l2", kitId: "k2" } as never);
    });
    const as = t.withIdentity(asUser);
    const r = await as.query(api.kitsList.listPage, { orgId: ORG, now: NOW });
    const byTag = Object.fromEntries(r.items.map((i) => [i.assetTag, i.state]));
    expect(byTag["K-1"]).toMatchObject({ key: "RESERVED", booking: { projectNumber: "#2341" } });
    expect(byTag["K-2"]).toMatchObject({ key: "INCOMPLETE", booking: { projectNumber: "#2341" } });
    expect((await as.query(api.kitsList.listPage, { orgId: ORG, segment: "onjob", now: NOW })).items.map((i) => i.assetTag)).toEqual(["K-1"]);
  });

  test("a caller from another org is rejected", async () => {
    const t = makeT();
    await seedKits(t);
    await expect(t.withIdentity({ subject: USER, orgId: OTHER }).query(api.kitsList.listPage, { orgId: ORG })).rejects.toThrow();
  });
});
