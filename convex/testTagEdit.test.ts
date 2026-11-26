// @vitest-environment node
//
// UX Phase 14 (14b-4, D80): the Test & tag item's real Edit and its ONE exact Undo, and Retire's exact Undo. The edit is
// an allow-listed `recordFieldEdit` (never status, never the tag id); next due is DERIVED, so a changed interval
// re-derives it in the same write and the Undo puts it back. The Undo takes ids only.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { deriveNextDueDate } from "./lib/testTagNextDue";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
type Who = Parameters<T["withIdentity"]>[0];
const ORG = "org_1";
const USER = "user_1";
const asUser: Who = { subject: USER, orgId: ORG };
const ACTOR = { userId: USER, userName: "Alice" };
const NOW = Date.now();
const LAST = Date.UTC(2026, 0, 31);

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}
async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: "user_2", role: "owner" });
    await ctx.db.insert("testTagAssets", { id: "t1", organizationId: ORG, testTagId: "TT0001", description: "Drill", equipmentClass: "CLASS_I", applianceType: "APPLIANCE", make: "Acme", location: "Bay 1", testIntervalMonths: 3, status: "CURRENT", isActive: true, lastTestDate: LAST, nextDueDate: deriveNextDueDate(LAST, 3), createdAt: 1, updatedAt: 1 } as never);
    await ctx.db.insert("testTagAssets", { id: "t2", organizationId: ORG, testTagId: "TT0002", description: "Saw", equipmentClass: "CLASS_I", applianceType: "APPLIANCE", testIntervalMonths: 3, status: "NOT_YET_TESTED", isActive: true, createdAt: 1, updatedAt: 1 } as never);
    await ctx.db.insert("assets", { id: "a1", organizationId: ORG, assetTag: "A1", modelId: "m", isActive: true, updatedAt: 1 } as never);
    await ctx.db.insert("assets", { id: "ax", organizationId: "org_2", assetTag: "AX", modelId: "m", isActive: true, updatedAt: 1 } as never);
  });
}
const item = (t: T, id = "t1") => t.run(async (ctx) => (await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", id)).first())!);
const base = { orgId: ORG, actor: ACTOR, now: NOW };
const edit = (t: T, set: Record<string, unknown>, over: { clear?: string[]; auditId?: string; id?: string } = {}) =>
  t.withIdentity(asUser).mutation(api.testTagEditWrites.editNative, { ...base, id: over.id ?? "t1", set, clear: over.clear ?? [], auditId: over.auditId ?? "e1" } as never);
const undo = (t: T, auditId = "e1", who: Who = asUser, actor = ACTOR, id = "t1") =>
  t.withIdentity(who).mutation(api.testTagEditWrites.undoEditNative, { orgId: ORG, id, auditId, now: NOW + 1, actor });

describe("editNative", () => {
  afterEach(() => vi.useRealTimers());

  test("sets and clears fields, never touches status or the tag id, and Undo restores exactly", async () => {
    const t = makeT();
    await seed(t);
    expect(await edit(t, { description: "  Hammer drill ", location: "Bay 2", notes: "n" }, { clear: ["make"] })).toEqual({ id: "t1", changed: true });
    const after = await item(t);
    expect(after).toMatchObject({ description: "Hammer drill", location: "Bay 2", notes: "n", status: "CURRENT", testTagId: "TT0001" });
    expect(after.make).toBeUndefined();
    await undo(t);
    const back = await item(t);
    expect(back).toMatchObject({ description: "Drill", location: "Bay 1", make: "Acme" });
    expect(back.notes).toBeUndefined();
  });

  test("a save that changes nothing writes nothing", async () => {
    const t = makeT();
    await seed(t);
    expect(await edit(t, { description: "Drill", location: "Bay 1" })).toEqual({ id: "t1", changed: false });
    expect((await item(t)).updatedAt).toBe(1);
  });

  test("status, the tag id, next due and anything off the allow-list are refused; required fields cannot be cleared", async () => {
    const t = makeT();
    await seed(t);
    for (const bad of [{ status: "RETIRED" }, { testTagId: "X" }, { nextDueDate: 5 }, { organizationId: "org_2" }]) await expect(edit(t, bad)).rejects.toThrow();
    for (const f of ["description", "status", "testIntervalMonths", "equipmentClass"]) await expect(edit(t, {}, { clear: [f] })).rejects.toMatchObject({ data: { code: "INVALID_FIELD" } });
    expect((await item(t)).status).toBe("CURRENT");
  });

  test("validation: empty description, over-long text, interval and outlet bounds", async () => {
    const t = makeT();
    await seed(t);
    await expect(edit(t, { description: " " })).rejects.toMatchObject({ data: { code: "INVALID_FIELD" } });
    await expect(edit(t, { notes: "x".repeat(2001) })).rejects.toThrow(/at most/);
    await expect(edit(t, { testIntervalMonths: 0 })).rejects.toThrow(/at least/);
    await expect(edit(t, { testIntervalMonths: 121 })).rejects.toThrow(/at most/);
    await expect(edit(t, { outletCount: 51 })).rejects.toThrow(/at most/);
  });

  test("a link to another org's asset is refused; another org's item is not found; a retired item is not edited", async () => {
    const t = makeT();
    await seed(t);
    await expect(edit(t, { assetId: "ax" })).rejects.toThrow();
    expect((await item(t)).assetId).toBeUndefined();
    await edit(t, { assetId: "a1" }, { auditId: "e2" });
    expect((await item(t)).assetId).toBe("a1");
    await t.run(async (ctx) => {
      await ctx.db.insert("testTagAssets", { id: "tx", organizationId: "org_2", testTagId: "X", description: "Theirs", status: "CURRENT", isActive: true } as never);
    });
    await expect(edit(t, { description: "x" }, { id: "tx" })).rejects.toThrow(/not found/i);
    await t.withIdentity(asUser).mutation(api.testTagAssetsWrites.retireNative, { id: "t1", orgId: ORG, now: NOW });
    await expect(edit(t, { description: "x" }, { auditId: "e3" })).rejects.toMatchObject({ data: { code: "RETIRED" } });
  });
});

describe("links", () => {
  test("one link at a time: setting a bulk link while an asset link stays is refused; swapping (clear + set) works", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, assetTag: "B1", modelId: "m", isActive: true } as never);
    });
    await edit(t, { assetId: "a1" });
    await expect(edit(t, { bulkAssetId: "b1" }, { auditId: "e2" })).rejects.toMatchObject({ data: { code: "INVALID_FIELD" } });
    await edit(t, { bulkAssetId: "b1" }, { clear: ["assetId"], auditId: "e3" });
    expect(await item(t)).toMatchObject({ bulkAssetId: "b1" });
    expect((await item(t)).assetId).toBeUndefined();
  });
});

describe("links: cross-org and empty-string refusals", () => {
  test("a bulk asset or a test profile from another org is refused (each link is org-checked when changed)", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("bulkAssets", { id: "bx", organizationId: "org_2", assetTag: "BX", modelId: "m", isActive: true } as never);
      await ctx.db.insert("testProfiles", { id: "px", organizationId: "org_2", name: "Theirs", equipmentClass: "CLASS_I", applianceType: "APPLIANCE", visualChecks: [], electricalTests: [], thresholds: {}, isActive: true } as never);
    });
    await expect(edit(t, { bulkAssetId: "bx" })).rejects.toThrow();
    await expect(edit(t, { testProfileId: "px" }, { auditId: "e2" })).rejects.toThrow();
    expect(await item(t)).toMatchObject({ description: "Drill" });
    expect((await item(t)).bulkAssetId).toBeUndefined();
    expect((await item(t)).testProfileId).toBeUndefined();
  });

  test("an empty string is not a link: clearing goes through `clear` only", async () => {
    const t = makeT();
    await seed(t);
    for (const f of ["assetId", "bulkAssetId", "testProfileId"]) await expect(edit(t, { [f]: "" })).rejects.toThrow(/at least 1/);
  });
});

describe("the interval Undo guards the inputs next due was derived from", () => {
  test("an untested item's interval change, then a test, then Undo: refused (next due would no longer follow the interval)", async () => {
    const t = makeT();
    await seed(t);
    await edit(t, { testIntervalMonths: 12 }, { id: "t2" }); // never tested: next due is not in the diff
    // A test lands: the record write sets last test and a next due derived from the NEW interval.
    await t.run(async (ctx) => {
      const r = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", "t2")).first();
      await ctx.db.patch(r!._id, { lastTestDate: LAST, nextDueDate: deriveNextDueDate(LAST, 12), status: "CURRENT" });
    });
    await expect(undo(t, "e1", asUser, ACTOR, "t2")).rejects.toMatchObject({ data: { code: "CHANGED_SINCE" } });
    expect(await item(t, "t2")).toMatchObject({ testIntervalMonths: 12, nextDueDate: deriveNextDueDate(LAST, 12) });
  });

  test("an edit that does not touch the interval is not guarded (a test since does not block undoing a note)", async () => {
    const t = makeT();
    await seed(t);
    await edit(t, { notes: "n" }, { id: "t2" });
    await t.run(async (ctx) => {
      const r = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", "t2")).first();
      await ctx.db.patch(r!._id, { lastTestDate: LAST, nextDueDate: deriveNextDueDate(LAST, 3) });
    });
    await undo(t, "e1", asUser, ACTOR, "t2");
    expect((await item(t, "t2")).notes).toBeUndefined();
  });
});

describe("the actor comes from auth, never from the arguments", () => {
  const audit = (t: T, id: string) => t.run(async (ctx) => (await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", id)).first())!);
  const FAKE = { userId: "attacker", userName: "Mallory" };

  test("editNative and retireNative name the verified caller on the audit row, not the supplied actor", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(asUser).mutation(api.testTagEditWrites.editNative, { orgId: ORG, id: "t1", set: { notes: "x" }, clear: [], actor: FAKE, auditId: "ae", now: NOW });
    expect(await audit(t, "ae")).toMatchObject({ userId: USER });
    expect((await audit(t, "ae")).userName).not.toBe("Mallory");
    await t.withIdentity(asUser).mutation(api.testTagAssetsWrites.retireNative, { orgId: ORG, id: "t1", now: NOW, actor: FAKE, auditId: "ar" });
    expect(await audit(t, "ar")).toMatchObject({ userId: USER });
    expect((await audit(t, "ar")).userName).not.toBe("Mallory");
    // So the retire's author is the real caller: the Undo by the same user works.
    await t.withIdentity(asUser).mutation(api.testTagAssetsWrites.undoRetireNative, { orgId: ORG, id: "t1", now: NOW + 1, actor: FAKE, auditId: "au" });
    expect((await item(t)).status).toBe("CURRENT");
  });
});

describe("retireNative hardening", () => {
  const retire = (t: T, over: Record<string, unknown>) => t.withIdentity(asUser).mutation(api.testTagAssetsWrites.retireNative, { id: "t1", orgId: ORG, now: NOW, ...over } as never);

  test("an already-retired item is refused; an actor without an audit id (or the reverse) is refused; a taken audit id is refused", async () => {
    const t = makeT();
    await seed(t);
    await expect(retire(t, { actor: ACTOR })).rejects.toMatchObject({ data: { code: "INVALID_FIELD" } });
    await expect(retire(t, { auditId: "a1" })).rejects.toMatchObject({ data: { code: "INVALID_FIELD" } });
    await edit(t, { notes: "x" }, { auditId: "taken" });
    await expect(retire(t, { actor: ACTOR, auditId: "taken" })).rejects.toMatchObject({ data: { code: "AUDIT_ID_TAKEN" } });
    expect((await item(t)).status).toBe("CURRENT");
    await retire(t, { actor: ACTOR, auditId: "r1" });
    await expect(retire(t, { actor: ACTOR, auditId: "r2" })).rejects.toMatchObject({ data: { code: "ALREADY_RETIRED" } });
  });
});

describe("next due is derived", () => {
  test("a changed interval re-derives next due from the last test, and Undo puts both back", async () => {
    const t = makeT();
    await seed(t);
    await edit(t, { testIntervalMonths: 6 });
    expect((await item(t)).nextDueDate).toBe(deriveNextDueDate(LAST, 6));
    await undo(t);
    expect(await item(t)).toMatchObject({ testIntervalMonths: 3, nextDueDate: deriveNextDueDate(LAST, 3) });
  });

  test("an item never tested has no next due to derive: the interval changes alone", async () => {
    const t = makeT();
    await seed(t);
    await edit(t, { testIntervalMonths: 12 }, { id: "t2" });
    const r = await item(t, "t2");
    expect(r.testIntervalMonths).toBe(12);
    expect(r.nextDueDate).toBeUndefined();
  });

  test("an unchanged interval leaves next due alone", async () => {
    const t = makeT();
    await seed(t);
    await edit(t, { testIntervalMonths: 3, notes: "x" });
    expect((await item(t)).nextDueDate).toBe(deriveNextDueDate(LAST, 3));
  });
});

describe("the exact Undo", () => {
  afterEach(() => vi.useRealTimers());

  test("refuses when a changed field moved since (changing nothing); an untouched field may move", async () => {
    const t = makeT();
    await seed(t);
    await edit(t, { description: "Mine" });
    await edit(t, { description: "Later" }, { auditId: "e2" });
    await expect(undo(t, "e1")).rejects.toMatchObject({ data: { code: "CHANGED_SINCE" } });
    expect((await item(t)).description).toBe("Later");
    const u = makeT();
    await seed(u);
    await edit(u, { description: "Mine" });
    await edit(u, { notes: "newer" }, { auditId: "e2" });
    await undo(u, "e1");
    expect(await item(u)).toMatchObject({ description: "Drill", notes: "newer" });
  });

  test("only the author, once, inside the window, and never with another item's audit id", async () => {
    const t = makeT();
    await seed(t);
    await edit(t, { description: "Mine" });
    await expect(undo(t, "e1", { subject: "user_2", orgId: ORG }, { userId: "user_2", userName: "Bob" })).rejects.toMatchObject({ data: { code: "NOT_AUTHOR" } });
    await edit(t, { description: "Other" }, { id: "t2", auditId: "e_b" });
    await expect(undo(t, "e_b")).rejects.toMatchObject({ data: { code: "NOT_FOUND" } }); // t2's audit row, t1's id
    expect((await item(t, "t2")).description).toBe("Other");
    await expect(undo(t, "nope")).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await undo(t, "e1");
    await expect(undo(t, "e1")).rejects.toMatchObject({ data: { code: "ALREADY_UNDONE" } });
  });

  test("an Undo after 10 minutes refuses on the server clock", async () => {
    const t = makeT();
    await seed(t);
    await edit(t, { description: "Mine" });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    await expect(undo(t)).rejects.toThrow(/10 minutes|too long|expired/i);
    expect((await item(t)).description).toBe("Mine");
  });
});

describe("Retire's exact Undo", () => {
  const retire = (t: T, auditId = "r1", over: Record<string, unknown> = {}) =>
    t.withIdentity(asUser).mutation(api.testTagAssetsWrites.retireNative, { id: "t1", orgId: ORG, now: NOW, actor: ACTOR, auditId, ...over } as never);
  const undoRetire = (t: T, auditId = "r1", who: Who = asUser, actor = ACTOR) =>
    t.withIdentity(who).mutation(api.testTagAssetsWrites.undoRetireNative, { orgId: ORG, id: "t1", auditId, now: NOW + 1, actor });

  test("retire then Undo puts back the status, active flag and updatedAt it overwrote", async () => {
    const t = makeT();
    await seed(t);
    await retire(t);
    expect(await item(t)).toMatchObject({ status: "RETIRED", isActive: false });
    await undoRetire(t);
    expect(await item(t)).toMatchObject({ status: "CURRENT", isActive: true, updatedAt: 1 });
  });

  test("a retire with no audit id (the Scan page's older call) still retires and offers no Undo", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(asUser).mutation(api.testTagAssetsWrites.retireNative, { id: "t1", orgId: ORG, now: NOW });
    expect((await item(t)).status).toBe("RETIRED");
    await expect(undoRetire(t, "nope")).rejects.toThrow();
  });

  test("refuses once anything touched the item after the retire (its updatedAt moved), even though it is still retired", async () => {
    const t = makeT();
    await seed(t);
    await retire(t);
    await t.withIdentity(asUser).mutation(api.testTagAssetsWrites.updateNative, { id: "t1", orgId: ORG, patch: { notes: "touched" }, now: NOW + 5 });
    expect(await item(t)).toMatchObject({ status: "RETIRED", notes: "touched" });
    await expect(undoRetire(t)).rejects.toThrow(/changed since/);
    expect((await item(t)).status).toBe("RETIRED");
  });

  test("refuses another person, a second Undo, and once the item was reactivated since", async () => {
    const t = makeT();
    await seed(t);
    await retire(t);
    await expect(undoRetire(t, "r1", { subject: "user_2", orgId: ORG }, { userId: "user_2", userName: "Bob" })).rejects.toThrow(/Only the person/);
    await t.withIdentity(asUser).mutation(api.testTagAssetsWrites.reactivateNative, { id: "t1", orgId: ORG, now: NOW + 5, actor: ACTOR, auditId: "re1" });
    await expect(undoRetire(t)).rejects.toThrow(/changed since/);
    expect((await item(t)).status).toBe("NOT_YET_TESTED");
    const u = makeT();
    await seed(u);
    await retire(u);
    await undoRetire(u);
    await expect(undoRetire(u)).rejects.toThrow(/already undone/);
  });
});
