// @vitest-environment node
//
// UX Phase 14 (14b-5, D77): the category record's Edit and Delete, each with an exact Undo (ids only). Edit is an
// allow-listed `recordFieldEdit` (incl. the optional default T&T class + interval); a parent can't be the category itself
// or below it. Delete moves models and kits to Uncategorised and subcategories up, and its Undo recreates the category
// under the same id and puts exactly those rows back, refusing as a whole unless each is still as the delete left it.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
type Who = Parameters<T["withIdentity"]>[0];
const ORG = "org_1";
const USER = "user_1";
const asUser: Who = { subject: USER, orgId: ORG };
const ACTOR = { userId: USER, userName: "Alice" };
const NOW = Date.now();

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}
/** root > mid > leaf; a sibling `other`; a foreign category; models and kits in `mid`. */
async function seed(t: T, role = "owner") {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role });
    await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: "user_2", role: "owner" });
    const cat = (id: string, extra: Record<string, unknown>) => ctx.db.insert("categories", { id, organizationId: ORG, name: id, createdAt: 1, updatedAt: 1, ...extra } as never);
    await cat("root", {});
    await cat("mid", { parentId: "root", description: "Mid", tags: ["x"], defaultEquipmentClass: "CLASS_II", defaultTestIntervalMonths: 6 });
    await cat("leaf", { parentId: "mid" });
    await cat("other", {});
    await ctx.db.insert("categories", { id: "foreign", organizationId: "org_2", name: "Theirs" } as never);
    for (const id of ["mo1", "mo2"]) await ctx.db.insert("models", { id, organizationId: ORG, name: id, categoryId: "mid", isActive: true, updatedAt: 1 } as never);
    await ctx.db.insert("kits", { id: "k1", organizationId: ORG, name: "Kit", assetTag: "K1", categoryId: "mid", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: 1, updatedAt: 1 } as never);
  });
}
const cat = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("categories").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const model = (t: T, id: string) => t.run(async (ctx) => (await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).first())!);
const kit = (t: T, id: string) => t.run(async (ctx) => (await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).first())!);
const base = { orgId: ORG, actor: ACTOR, now: NOW };

const edit = (t: T, set: Record<string, unknown>, over: { clear?: string[]; auditId?: string; id?: string; who?: Who } = {}) =>
  t.withIdentity(over.who ?? asUser).mutation(api.categoriesEditWrites.editNative, { ...base, id: over.id ?? "mid", set, clear: over.clear ?? [], auditId: over.auditId ?? "e1" } as never);
const undoEdit = (t: T, auditId = "e1", who: Who = asUser, actor = ACTOR, id = "mid") =>
  t.withIdentity(who).mutation(api.categoriesEditWrites.undoEditNative, { orgId: ORG, id, auditId, now: NOW + 1, actor });
const del = (t: T, id = "mid", auditId = "d1", who: Who = asUser) =>
  t.withIdentity(who).mutation(api.categoriesEditWrites.deleteNative, { ...base, id, auditId });
const undoDel = (t: T, auditId = "d1", who: Who = asUser, actor = ACTOR, id = "mid") =>
  t.withIdentity(who).mutation(api.categoriesEditWrites.undoDeleteNative, { orgId: ORG, id, auditId, now: NOW + 1, actor });

describe("editNative", () => {
  afterEach(() => vi.useRealTimers());

  test("sets and clears fields incl. the default T&T class and interval; Undo restores exactly", async () => {
    const t = makeT();
    await seed(t);
    expect(await edit(t, { name: "  Mid cases ", defaultEquipmentClass: "CLASS_I", defaultTestIntervalMonths: 12, tags: ["x", "y"] }, { clear: ["description"] })).toEqual({ id: "mid", changed: true });
    const after = (await cat(t, "mid"))!;
    expect(after).toMatchObject({ name: "Mid cases", defaultEquipmentClass: "CLASS_I", defaultTestIntervalMonths: 12, tags: ["x", "y"], parentId: "root" });
    expect(after.description).toBeUndefined();
    await undoEdit(t);
    expect(await cat(t, "mid")).toMatchObject({ name: "mid", description: "Mid", defaultEquipmentClass: "CLASS_II", defaultTestIntervalMonths: 6, tags: ["x"] });
  });

  test("clearing the default class and interval removes them (a category can have none)", async () => {
    const t = makeT();
    await seed(t);
    await edit(t, {}, { clear: ["defaultEquipmentClass", "defaultTestIntervalMonths"] });
    const c = (await cat(t, "mid"))!;
    expect(c.defaultEquipmentClass).toBeUndefined();
    expect(c.defaultTestIntervalMonths).toBeUndefined();
  });

  test("a save that changes nothing writes nothing", async () => {
    const t = makeT();
    await seed(t);
    expect(await edit(t, { name: "mid", defaultTestIntervalMonths: 6 })).toEqual({ id: "mid", changed: false });
    expect((await cat(t, "mid"))!.updatedAt).toBe(1);
  });

  test("only the approved T&T defaults exist: no profile, no appliance type, and nothing off the allow-list", async () => {
    const t = makeT();
    await seed(t);
    for (const bad of [{ defaultTestProfileId: "p" }, { defaultApplianceType: "APPLIANCE" }, { organizationId: "org_2" }, { sortOrder: 4 }]) await expect(edit(t, bad)).rejects.toThrow();
    await expect(edit(t, {}, { clear: ["name"] })).rejects.toMatchObject({ data: { code: "INVALID_FIELD" } });
  });

  test("validation: empty name, bounds, interval, empty parent, other org's category", async () => {
    const t = makeT();
    await seed(t);
    await expect(edit(t, { name: " " })).rejects.toMatchObject({ data: { code: "INVALID_FIELD" } });
    await expect(edit(t, { name: "x".repeat(101) })).rejects.toThrow(/at most/);
    await expect(edit(t, { defaultTestIntervalMonths: 0 })).rejects.toThrow(/at least/);
    await expect(edit(t, { defaultTestIntervalMonths: 121 })).rejects.toThrow(/at most/);
    await expect(edit(t, { defaultTestIntervalMonths: 1.5 })).rejects.toThrow(/whole/);
    await expect(edit(t, { parentId: "" })).rejects.toThrow(/at least 1/);
    await expect(edit(t, { name: "x" }, { id: "foreign" })).rejects.toThrow(/not found/i);
  });

  test("the parent: another org's, itself, and one of its own descendants are refused; a sibling works; clearing makes it top level", async () => {
    const t = makeT();
    await seed(t);
    await expect(edit(t, { parentId: "foreign" })).rejects.toThrow(/not found/i);
    await expect(edit(t, { parentId: "mid" }, { auditId: "e2" })).rejects.toMatchObject({ data: { code: "INVALID_FIELD" } });
    await expect(edit(t, { parentId: "leaf" }, { auditId: "e3" })).rejects.toMatchObject({ data: { code: "INVALID_FIELD" } });
    expect((await cat(t, "mid"))!.parentId).toBe("root");
    await edit(t, { parentId: "other" }, { auditId: "e4" });
    expect((await cat(t, "mid"))!.parentId).toBe("other");
    await edit(t, {}, { clear: ["parentId"], auditId: "e5" });
    expect((await cat(t, "mid"))!.parentId).toBeUndefined();
  });

  test("the category tree read is bounded and FAILS CLOSED: past 2000 categories a parent change is refused, never judged on a partial tree", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 2000; i++) await ctx.db.insert("categories", { id: `filler${i}`, organizationId: ORG, name: `f${i}` } as never); // + the 4 seeded = 2004
    });
    await expect(edit(t, { parentId: "other" })).rejects.toMatchObject({ data: { code: "TOO_MANY" } });
    expect((await cat(t, "mid"))!.parentId).toBe("root");
    await edit(t, { name: "Renamed" }, { auditId: "e2" }); // an edit that needs no tree still works
    expect((await cat(t, "mid"))!.name).toBe("Renamed");
  });

  test("a caller without model:update is refused", async () => {
    const t = makeT();
    await seed(t, "viewer");
    await expect(edit(t, { name: "x" })).rejects.toThrow();
  });
});

describe("the exact Edit Undo", () => {
  afterEach(() => vi.useRealTimers());

  test("refuses when a changed field moved since; an untouched field may move", async () => {
    const t = makeT();
    await seed(t);
    await edit(t, { name: "Mine" });
    await edit(t, { name: "Later" }, { auditId: "e2" });
    await expect(undoEdit(t, "e1")).rejects.toMatchObject({ data: { code: "CHANGED_SINCE" } });
    expect((await cat(t, "mid"))!.name).toBe("Later");
    const u = makeT();
    await seed(u);
    await edit(u, { name: "Mine" });
    await edit(u, { description: "newer" }, { auditId: "e2" });
    await undoEdit(u, "e1");
    expect(await cat(u, "mid")).toMatchObject({ name: "mid", description: "newer" });
  });

  test("only the author, once, inside the window, and never with another category's audit id", async () => {
    const t = makeT();
    await seed(t);
    await edit(t, { name: "Mine" });
    await expect(undoEdit(t, "e1", { subject: "user_2", orgId: ORG }, { userId: "user_2", userName: "Bob" })).rejects.toMatchObject({ data: { code: "NOT_AUTHOR" } });
    await edit(t, { name: "Other2" }, { id: "other", auditId: "e_b" });
    await expect(undoEdit(t, "e_b")).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await undoEdit(t, "e1");
    await expect(undoEdit(t, "e1")).rejects.toMatchObject({ data: { code: "ALREADY_UNDONE" } });
    const w = makeT();
    await seed(w);
    await edit(w, { name: "Mine" });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    await expect(undoEdit(w)).rejects.toThrow(/10 minutes|too long|expired/i);
  });

  test("undoing a parent change refuses once the old parent would now sit below the category", async () => {
    const t = makeT();
    await seed(t);
    await edit(t, { parentId: "other" }); // mid: root -> other
    await edit(t, { parentId: "mid" }, { id: "root", auditId: "e2" }); // root now sits below mid
    await expect(undoEdit(t, "e1")).rejects.toMatchObject({ data: { code: "INVALID_FIELD" } });
    expect((await cat(t, "mid"))!.parentId).toBe("other");
  });
});

describe("foreign orgs and tampered audit rows can never drive an Undo", () => {
  const tamper = (t: T, auditId: string, change: (d: Record<string, any>) => void) => // eslint-disable-line @typescript-eslint/no-explicit-any
    t.run(async (ctx) => {
      const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", auditId)).first();
      const d = JSON.parse(JSON.stringify(row!.details));
      change(d);
      await ctx.db.patch(row!._id, { details: d });
    });

  test("another org cannot undo this org's delete with its audit id (the forward row's org is checked)", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => { await ctx.db.insert("members", { id: "mx", organizationId: "org_2", userId: "user_x", role: "owner" }); });
    await del(t);
    await expect(
      t.withIdentity({ subject: "user_x", orgId: "org_2" }).mutation(api.categoriesEditWrites.undoDeleteNative, { orgId: "org_2", id: "mid", auditId: "d1", now: NOW + 1, actor: { userId: "user_x", userName: "X" } }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    expect(await cat(t, "mid")).toBeNull();
  });

  test("a moved row that now belongs to another org makes the Undo refuse (assertStillAsLeft checks each row's org)", async () => {
    const t = makeT();
    await seed(t);
    await del(t);
    await t.run(async (ctx) => {
      const m = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", "mo1")).first();
      await ctx.db.patch(m!._id, { organizationId: "org_2" });
    });
    await expect(undoDel(t)).rejects.toMatchObject({ data: { code: "CHANGED_SINCE" } });
    expect(await cat(t, "mid")).toBeNull();
  });

  test("a snapshot whose category belongs to another org is refused (the snapshot's own org is checked)", async () => {
    const t = makeT();
    await seed(t);
    await del(t);
    await tamper(t, "d1", (d) => { d.categoryDelete.category.organizationId = "org_2"; });
    await expect(undoDel(t)).rejects.toMatchObject({ data: { code: "NOT_UNDOABLE" } });
    expect(await cat(t, "mid")).toBeNull();
  });

  test("an edit snapshot naming a field off the allow-list refuses the Undo (a tampered audit row), changing nothing", async () => {
    const t = makeT();
    await seed(t);
    await edit(t, { name: "Mine" });
    await tamper(t, "e1", (d) => { d.fieldEdit.before.sortOrder = 9; d.fieldEdit.after.sortOrder = null; });
    await expect(undoEdit(t)).rejects.toMatchObject({ data: { code: "NOT_UNDOABLE" } });
    expect((await cat(t, "mid"))!.name).toBe("Mine");
  });
});

describe("deleteNative", () => {
  test("models and kits become Uncategorised, subcategories move up to the deleted category's parent, the category is gone", async () => {
    const t = makeT();
    await seed(t);
    expect(await del(t)).toEqual({ id: "mid", movedModels: 2, movedKits: 1, movedSubcategories: 1 });
    expect(await cat(t, "mid")).toBeNull();
    expect((await cat(t, "leaf"))!.parentId).toBe("root");
    for (const id of ["mo1", "mo2"]) expect((await model(t, id)).categoryId).toBeUndefined();
    expect((await kit(t, "k1")).categoryId).toBeUndefined();
  });

  test("a top-level category's subcategories become top level", async () => {
    const t = makeT();
    await seed(t);
    await del(t, "root");
    expect((await cat(t, "mid"))!.parentId).toBeUndefined();
    expect((await model(t, "mo1")).categoryId).toBe("mid"); // models of the SUBcategory are untouched
  });

  test("another org's category is not found; a caller without model:delete is refused; a reused audit id is refused", async () => {
    const t = makeT();
    await seed(t);
    await expect(del(t, "foreign")).rejects.toThrow(/not found/i);
    await edit(t, { name: "x" }, { auditId: "taken" });
    await expect(del(t, "mid", "taken")).rejects.toMatchObject({ data: { code: "AUDIT_ID_TAKEN" } });
    expect(await cat(t, "mid")).not.toBeNull();
    const v = makeT();
    await seed(v, "viewer");
    await expect(del(v)).rejects.toThrow();
  });

  test("a category holding more than the cap is refused whole, moving nothing", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 499; i++) await ctx.db.insert("models", { id: `bulk${i}`, organizationId: ORG, name: `b${i}`, categoryId: "mid", isActive: true, updatedAt: 1 } as never);
    });
    await expect(del(t)).rejects.toMatchObject({ data: { code: "TOO_MANY" } }); // 2 seeded + 499 = 501
    expect(await cat(t, "mid")).not.toBeNull();
    expect((await model(t, "mo1")).categoryId).toBe("mid");
  });

  test("the verified caller is named on the audit row, never the supplied actor", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(asUser).mutation(api.categoriesEditWrites.deleteNative, { ...base, actor: { userId: "attacker", userName: "Mallory" }, id: "mid", auditId: "da" });
    const row = await t.run(async (ctx) => (await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "da")).first())!);
    expect(row.userId).toBe(USER);
    expect(row.userName).not.toBe("Mallory");
  });
});

describe("deleting a category the org's settings name (no dangling id)", () => {
  const setSettings = (t: T, settings: string) =>
    t.run(async (ctx) => { await ctx.db.insert("orgSettings", { organizationId: ORG, settings } as never); });

  test("a container category (containerCategoryIds) or the deprecated prep-kit category cannot be deleted; nothing moves", async () => {
    const t = makeT();
    await seed(t);
    await setSettings(t, JSON.stringify({ containerCategoryIds: ["mid"], prepKitCategoryId: "other" }));
    await expect(del(t, "mid", "d1")).rejects.toMatchObject({ data: { code: "USED_BY_SETTINGS" } });
    await expect(del(t, "other", "d2")).rejects.toMatchObject({ data: { code: "USED_BY_SETTINGS" } });
    expect(await cat(t, "mid")).not.toBeNull();
    expect((await model(t, "mo1")).categoryId).toBe("mid");
    expect((await cat(t, "leaf"))!.parentId).toBe("mid");
    // A category the settings do not name is still deletable.
    await del(t, "leaf", "d3");
    expect(await cat(t, "leaf")).toBeNull();
  });

  test("an absent, blank or empty-object settings blob names nothing, so it blocks nothing", async () => {
    for (const blob of [null, "", "   ", "{}"]) {
      const t = makeT();
      await seed(t);
      if (blob !== null) await setSettings(t, blob);
      await del(t, "other", "d1");
      expect(await cat(t, "other")).toBeNull();
    }
  });

  test("an unreadable settings blob (bad JSON, not an object, a wrongly shaped key) FAILS CLOSED: the delete is refused, nothing moves", async () => {
    for (const blob of ["{ not json", "[]", "42", "null", JSON.stringify({ containerCategoryIds: "mid" }), JSON.stringify({ containerCategoryIds: [1, 2] }), JSON.stringify({ prepKitCategoryId: 7 })]) {
      const t = makeT();
      await seed(t);
      await setSettings(t, blob);
      await expect(del(t, "other", "d1")).rejects.toMatchObject({ data: { code: "SETTINGS_UNREADABLE" } });
      expect(await cat(t, "other")).not.toBeNull();
      expect((await model(t, "mo1")).categoryId).toBe("mid");
    }
  });

  test("once the reference is removed from Settings the delete works", async () => {
    const t = makeT();
    await seed(t);
    await setSettings(t, JSON.stringify({ containerCategoryIds: ["x"] }));
    await t.run(async (ctx) => {
      const row = await ctx.db.query("orgSettings").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).first();
      await ctx.db.patch(row!._id, { settings: JSON.stringify({ containerCategoryIds: ["mid"] }) });
    });
    await expect(del(t, "mid", "d2")).rejects.toMatchObject({ data: { code: "USED_BY_SETTINGS" } });
    await t.run(async (ctx) => {
      const row = await ctx.db.query("orgSettings").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).first();
      await ctx.db.patch(row!._id, { settings: JSON.stringify({ containerCategoryIds: [] }) });
    });
    await del(t, "mid", "d3");
    expect(await cat(t, "mid")).toBeNull();
  });

  test("another org's settings never block this org's delete", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => { await ctx.db.insert("orgSettings", { organizationId: "org_2", settings: JSON.stringify({ containerCategoryIds: ["mid"] }) } as never); });
    await del(t, "other", "d1");
    expect(await cat(t, "other")).toBeNull();
  });
});

describe("the exact Delete Undo", () => {
  afterEach(() => vi.useRealTimers());

  test("recreates the category under the same id with every stored field and puts exactly the moved rows back", async () => {
    const t = makeT();
    await seed(t);
    await del(t);
    await undoDel(t);
    expect(await cat(t, "mid")).toMatchObject({ id: "mid", name: "mid", parentId: "root", description: "Mid", tags: ["x"], defaultEquipmentClass: "CLASS_II", defaultTestIntervalMonths: 6, createdAt: 1 });
    expect((await cat(t, "leaf"))!.parentId).toBe("mid");
    for (const id of ["mo1", "mo2"]) expect((await model(t, id)).categoryId).toBe("mid");
    expect((await kit(t, "k1")).categoryId).toBe("mid");
  });

  test("refuses as a whole, changing nothing, when a moved model, kit or subcategory was changed since", async () => {
    for (const change of ["model", "kit", "child"] as const) {
      const t = makeT();
      await seed(t);
      await del(t);
      await t.run(async (ctx) => {
        if (change === "model") { const m = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", "mo1")).first(); await ctx.db.patch(m!._id, { categoryId: "other" }); }
        if (change === "kit") { const k = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", "k1")).first(); await ctx.db.patch(k!._id, { categoryId: "other" }); }
        if (change === "child") { const c = await ctx.db.query("categories").withIndex("by_cuid", (q) => q.eq("id", "leaf")).first(); await ctx.db.patch(c!._id, { parentId: "other" }); }
      });
      await expect(undoDel(t)).rejects.toMatchObject({ data: { code: "CHANGED_SINCE" } });
      expect(await cat(t, "mid")).toBeNull();
      expect((await model(t, "mo2")).categoryId).toBeUndefined(); // the untouched ones were not restored either
    }
  });

  test("refuses when its parent was deleted since, or a category with that id exists again", async () => {
    const t = makeT();
    await seed(t);
    await del(t, "leaf", "dl"); // a leaf: nothing to move, so only its PARENT can make the Undo refuse
    await del(t, "mid", "dm"); // its parent goes away
    await expect(undoDel(t, "dl", asUser, ACTOR, "leaf")).rejects.toMatchObject({ data: { code: "CHANGED_SINCE" } });
    expect(await cat(t, "leaf")).toBeNull();
    const u = makeT();
    await seed(u);
    await del(u);
    await u.run(async (ctx) => { await ctx.db.insert("categories", { id: "mid", organizationId: ORG, name: "again" } as never); });
    await expect(undoDel(u)).rejects.toMatchObject({ data: { code: "CHANGED_SINCE" } });
  });

  test("only the author, once, inside the window, and never with another category's audit id", async () => {
    const t = makeT();
    await seed(t);
    await del(t);
    await expect(undoDel(t, "d1", { subject: "user_2", orgId: ORG }, { userId: "user_2", userName: "Bob" })).rejects.toMatchObject({ data: { code: "NOT_AUTHOR" } });
    await del(t, "other", "d_b");
    await expect(undoDel(t, "d_b")).rejects.toMatchObject({ data: { code: "NOT_FOUND" } }); // other's audit row, mid's id
    await expect(undoDel(t, "nope")).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await undoDel(t);
    await expect(undoDel(t)).rejects.toMatchObject({ data: { code: "ALREADY_UNDONE" } });
    const w = makeT();
    await seed(w);
    await del(w);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    await expect(undoDel(w)).rejects.toThrow(/10 minutes|too long|expired/i);
    expect(await cat(w, "mid")).toBeNull();
  });
});
