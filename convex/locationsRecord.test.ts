// @vitest-environment node
//
// UX Phase 14 (14b-1): the Location sheet's writes: edit and create with their exact Undo (ids only,
// through convex/lib/fieldEditUndo.ts for edits), the capacity field, the parent-cycle guard, and the
// record page's detail read (bins with their own capacity, fill, label state and last movement).
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
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
    await ctx.db.insert("locations", { id: "wh", organizationId: ORG, name: "Warehouse A", type: "WAREHOUSE", capacity: 100, tags: [], createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("locations", { id: "bin", organizationId: ORG, name: "B2", type: "WAREHOUSE", parentId: "wh", capacity: 4, lastMovementAt: NOW, labelPrintedAt: NOW, createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m", assetTag: "A-1", status: "AVAILABLE", isActive: true, locationId: "bin" });
    await ctx.db.insert("assets", { id: "a2", organizationId: ORG, modelId: "m", assetTag: "A-2", status: "AVAILABLE", isActive: true, locationId: "bin" });
  });
}
const loc = (t: T, id: string) => t.run(async (ctx) => (await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", id)).first())!);

const base = { name: "Warehouse A", type: "WAREHOUSE", tags: [] as string[] };
const edit = (t: T, over: Record<string, unknown>, auditId = "ed1", id = asUser) =>
  t.withIdentity(id).mutation(api.locationsWrites.updateNative, { id: "wh", orgId: ORG, ...base, now: NOW, actor: ACTOR, auditId, ...over } as never);
const undoEdit = (t: T, auditId = "ed1", id = asUser) =>
  t.withIdentity(id).mutation(api.locationsWrites.undoUpdateNative, { orgId: ORG, id: "wh", auditId, now: NOW + 1, actor: ACTOR });

describe("Location edit and its exact Undo", () => {
  afterEach(() => vi.useRealTimers());

  test("a changed capacity and notes are undoable; an unchanged save is not", async () => {
    const t = makeT();
    await seed(t);
    const r = await edit(t, { capacity: 250, notes: "Dock 3" });
    expect(r).toEqual({ id: "wh", changed: true, undoable: true });
    expect(await loc(t, "wh")).toMatchObject({ capacity: 250, notes: "Dock 3" });
    await undoEdit(t);
    expect(await loc(t, "wh")).toMatchObject({ capacity: 100 });
    expect((await loc(t, "wh")).notes).toBeUndefined();
    const same = await edit(t, {}, "ed2");
    expect(same).toEqual({ id: "wh", changed: false, undoable: false });
  });

  test("an absent capacity leaves the stored one alone; null clears it", async () => {
    const t = makeT();
    await seed(t);
    await edit(t, { notes: "x" });
    expect((await loc(t, "wh")).capacity).toBe(100);
    await edit(t, { capacity: null }, "ed2");
    expect((await loc(t, "wh")).capacity).toBeUndefined();
  });

  test("a capacity below 1 or a fraction is refused", async () => {
    const t = makeT();
    await seed(t);
    await expect(edit(t, { capacity: 0 })).rejects.toThrow();
    await expect(edit(t, { capacity: 2.5 })).rejects.toThrow();
  });

  test("Undo refuses once a changed field was edited again, is once only, and is the author's", async () => {
    const t = makeT();
    await seed(t);
    await edit(t, { capacity: 250 });
    await expect(undoEdit(t, "ed1", { subject: "user_2", orgId: ORG })).rejects.toThrow(/Only the person/);
    await edit(t, { capacity: 300 }, "ed2");
    await expect(undoEdit(t)).rejects.toThrow(/changed since/);
    expect((await loc(t, "wh")).capacity).toBe(300);
    await undoEdit(t, "ed2");
    await expect(undoEdit(t, "ed2")).rejects.toThrow(/already undone/);
  });

  test("Undo refuses outside the 10-minute server-clock window", async () => {
    const t = makeT();
    await seed(t);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T10:00:00Z"));
    await edit(t, { capacity: 250 });
    vi.setSystemTime(new Date("2026-11-25T10:11:00Z"));
    await expect(undoEdit(t)).rejects.toThrow(/10 minutes/);
    expect((await loc(t, "wh")).capacity).toBe(250);
  });

  test("changing the default flag moves another location's flag, so it offers no Undo", async () => {
    const t = makeT();
    await seed(t);
    const r = await edit(t, { isDefault: true });
    expect(r).toMatchObject({ changed: true, undoable: false });
  });

  test("a location cannot be placed inside itself or one of its own bins", async () => {
    const t = makeT();
    await seed(t);
    await expect(edit(t, { parentId: "bin" })).rejects.toThrow(/inside itself/);
    await expect(edit(t, { parentId: "wh" })).rejects.toThrow(/inside itself/);
    expect((await loc(t, "wh")).parentId).toBeUndefined();
  });

  test("another org's location cannot be edited or undone", async () => {
    const t = makeT();
    await seed(t);
    await expect(edit(t, { capacity: 9 }, "z", { subject: USER, orgId: "org_2" })).rejects.toThrow();
  });
});

describe("Location create and its exact Undo", () => {
  afterEach(() => vi.useRealTimers());
  const create = (t: T, over: Record<string, unknown> = {}) =>
    t.withIdentity(asUser).mutation(api.locationsWrites.createNative, { id: "new1", orgId: ORG, ...base, name: "Van 3", type: "VEHICLE", capacity: 40, now: NOW, actor: ACTOR, auditId: "cr1", ...over } as never);
  const undoCreate = (t: T, id = asUser) =>
    t.withIdentity(id).mutation(api.locationsWrites.undoCreateNative, { orgId: ORG, id: "new1", auditId: "cr1", now: NOW + 1, actor: ACTOR });

  test("creates with a capacity, then Undo removes exactly that location, once", async () => {
    const t = makeT();
    await seed(t);
    await create(t);
    expect(await loc(t, "new1")).toMatchObject({ name: "Van 3", capacity: 40 });
    await undoCreate(t);
    expect(await t.run(async (ctx) => await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", "new1")).first())).toBeNull();
    await expect(undoCreate(t)).rejects.toThrow();
  });

  test("Undo refuses once the location has been edited, has a bin, or holds anything", async () => {
    const t = makeT();
    await seed(t);
    await create(t);
    await t.withIdentity(asUser).mutation(api.locationsWrites.updateNative, { id: "new1", orgId: ORG, ...base, name: "Van 3b", now: NOW + 5, actor: ACTOR, auditId: "x" } as never);
    await expect(undoCreate(t)).rejects.toThrow(/changed since/);

    const t2 = makeT();
    await seed(t2);
    await create(t2);
    await t2.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "a9", organizationId: ORG, modelId: "m", assetTag: "A-9", isActive: true, locationId: "new1" });
    });
    await expect(undoCreate(t2)).rejects.toThrow(/bins, contents or files/);

    const t3 = makeT();
    await seed(t3);
    await create(t3);
    await t3.run(async (ctx) => {
      await ctx.db.insert("locations", { id: "kid", organizationId: ORG, name: "Bin", parentId: "new1" });
    });
    await expect(undoCreate(t3)).rejects.toThrow(/bins, contents or files/);
  });

  test("Undo is the author's, windowed, and never for a location that took over the default", async () => {
    const t = makeT();
    await seed(t);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T10:00:00Z"));
    await create(t);
    await expect(undoCreate(t, { subject: "user_2", orgId: ORG })).rejects.toThrow(/Only the person/);
    vi.setSystemTime(new Date("2026-11-25T10:11:00Z"));
    await expect(undoCreate(t)).rejects.toThrow(/10 minutes/);

    const t2 = makeT();
    await seed(t2);
    await create(t2, { isDefault: true });
    await expect(undoCreate(t2)).rejects.toThrow(/default/);
  });
});

describe("locations.detail for the record page", () => {
  test("carries capacity, fill and last movement, and each bin's own facts", async () => {
    const t = makeT();
    await seed(t);
    const d = await t.withIdentity(asUser).query(api.locations.detail, { id: "wh", orgId: ORG });
    expect(d).toMatchObject({ capacity: 100, fill: 0, lastMovement: null, labelState: "not-printed" });
    expect(d!.children).toEqual([
      expect.objectContaining({ id: "bin", stored: 2, capacity: 4, fill: 50, lastMovement: NOW, labelState: "printed" }),
    ]);
  });

  test("another org gets nothing", async () => {
    const t = makeT();
    await seed(t);
    await expect(t.withIdentity({ subject: USER, orgId: "org_2" }).query(api.locations.detail, { id: "wh", orgId: ORG })).rejects.toThrow();
  });
});
