// @vitest-environment node
//
// The People lists' bulk writes and their SERVER-side exact Undo (peopleBulkWrites.ts):
// per-row gates named, one exact audit row per changed record, and an Undo that is
// author-scoped, window-bound, used once, compare-and-set per field, and keeps (and names)
// anything that changed since. Includes the supplier archive (danger high) split.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1", OTHER = "org_2", USER = "user_1", NOW = Date.now();
const actor = { userId: USER, userName: "Alice" };
const as = (t: T, role = "admin", userId = USER) => t.withIdentity({ subject: userId, orgId: ORG, role });

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
async function seed(t: T, role = "admin") {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role });
    await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: "user_2", role: "admin" });
    for (const id of ["a", "b", "busy"]) await ctx.db.insert("crewMembers", { id, organizationId: ORG, firstName: id, lastName: "Crew", status: "ACTIVE", tags: ["x"] });
    await ctx.db.insert("crewMembers", { id: "foreign", organizationId: OTHER, firstName: "F", lastName: "O", status: "ACTIVE" });
    await ctx.db.insert("crewAssignments", { id: "c1", organizationId: ORG, projectId: "p", crewMemberId: "busy", status: "CONFIRMED", startDate: NOW, endDate: NOW + 86_400_000 });
    await ctx.db.insert("clients", { id: "k1", organizationId: ORG, name: "Idle", isActive: true });
    await ctx.db.insert("clients", { id: "k2", organizationId: ORG, name: "Busy", isActive: true });
    await ctx.db.insert("projects", { id: "j1", organizationId: ORG, projectNumber: "#1", name: "Gig", clientId: "k2", status: "CONFIRMED", isTemplate: false });
    await ctx.db.insert("suppliers", { id: "s1", organizationId: ORG, name: "Scene", isActive: true, tags: [] });
  });
}
const get = (t: T, table: "crewMembers" | "clients" | "suppliers", id: string) =>
  t.run(async (ctx) => (await ctx.db.query(table).withIndex("by_cuid", (q) => q.eq("id", id)).first()) as Record<string, unknown> | null);
type Kind = "crew" | "client" | "supplier";
const items = (...ids: string[]) => ids.map((id) => ({ id, auditId: `au_${id}` }));
// One audit id names ONE audit row (`assertAuditIdFree`: an Undo trusts the row with its id), so a second forward
// write on the same record in one test needs its own `audit` suffix.
const setActive = (t: T, kind: Kind, ids: string[], active: boolean, who = as(t), audit = "") =>
  who.mutation(api.peopleBulkWrites.setActiveManyNative, { orgId: ORG, kind, items: items(...ids).map((i) => ({ ...i, auditId: i.auditId + audit })), active, todayMs: NOW, now: NOW, actor });
const addTag = (t: T, kind: Kind, ids: string[], tag: string, who = as(t)) =>
  who.mutation(api.peopleBulkWrites.addTagManyNative, { orgId: ORG, kind, items: items(...ids), tag, now: NOW, actor });
const undo = (t: T, kind: Kind, ids: string[], who = as(t)) =>
  who.mutation(api.peopleBulkWrites.undoManyNative, { orgId: ORG, kind, items: items(...ids), now: NOW + 1, actor });

describe("deactivate / reactivate (crew)", () => {
  test("server gates: a confirmed call, a foreign id and a repeat are skipped and NAMED; the rest change", async () => {
    const t = makeT(); await seed(t);
    const out = await setActive(t, "crew", ["a", "busy", "foreign", "a"], false);
    expect(out.changed.map((c) => c.id)).toEqual(["a"]);
    expect(out.skipped).toEqual(expect.arrayContaining([{ id: "busy", name: "busy Crew", reason: "has a confirmed call" }, { id: "foreign", name: "foreign", reason: "not found" }]));
    expect((await get(t, "crewMembers", "a"))?.status).toBe("INACTIVE");
    expect((await get(t, "crewMembers", "busy"))?.status).toBe("ACTIVE");
    expect((await get(t, "crewMembers", "foreign"))?.status).toBe("ACTIVE");
  });

  test("Undo restores exactly; a second Undo, another user and a record changed since are refused or kept", async () => {
    const t = makeT(); await seed(t);
    await setActive(t, "crew", ["a", "b"], false);
    await t.run(async (ctx) => { const b = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", "b")).first(); await ctx.db.patch(b!._id, { status: "ON_LEAVE" }); });
    const other = await undo(t, "crew", ["a", "b"], as(t, "admin", "user_2"));
    expect(other.restored).toEqual([]);
    expect(other.kept.map((k) => k.reason)).toEqual([expect.stringMatching(/person who made/), expect.stringMatching(/person who made/)]);
    const res = await undo(t, "crew", ["a", "b"]);
    expect(res.restored).toEqual(["a"]);
    expect(res.kept).toEqual([{ id: "b", reason: expect.stringMatching(/changed since/) }]);
    expect((await get(t, "crewMembers", "a"))?.status).toBe("ACTIVE");
    expect((await get(t, "crewMembers", "b"))?.status).toBe("ON_LEAVE"); // someone else's later edit is never clobbered
    const again = await undo(t, "crew", ["a"]);
    expect(again.kept[0].reason).toMatch(/already undone/);
  });

  test("reactivate, and a viewer cannot do any of it", async () => {
    const t = makeT(); await seed(t);
    await setActive(t, "crew", ["a"], false);
    const out = await setActive(t, "crew", ["a"], true, as(t), "_re");
    expect(out.changed).toHaveLength(1);
    const t2 = makeT(); await seed(t2, "viewer");
    await expect(setActive(t2, "crew", ["a"], false, as(t2, "viewer"))).rejects.toThrow();
    expect((await get(t2, "crewMembers", "a"))?.status).toBe("ACTIVE");
  });
});

describe("gates and limits", () => {
  test("a gate that cannot read every call SKIPS the row (fails closed), never lets Archive through", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { for (let i = 0; i < 2001; i++) await ctx.db.insert("crewAssignments", { id: `bulk${i}`, organizationId: ORG, projectId: "p", crewMemberId: "a", status: "PENDING", startDate: NOW });
    });
    const out = await setActive(t, "crew", ["a"], false);
    expect(out.changed).toEqual([]);
    expect(out.skipped).toEqual([{ id: "a", name: "a Crew", reason: "too many records to check" }]);
    expect((await get(t, "crewMembers", "a"))?.status).toBe("ACTIVE");
  });

  test("the client gate fails closed too: a client whose jobs cannot all be read is skipped, never archived", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { for (let i = 0; i < 2001; i++) await ctx.db.insert("projects", { id: `pj${i}`, organizationId: ORG, projectNumber: `#${i}`, name: "Old", clientId: "k1", status: "COMPLETED", isTemplate: false }); });
    const out = await setActive(t, "client", ["k1"], false);
    expect(out.changed).toEqual([]);
    expect(out.skipped).toEqual([{ id: "k1", name: "Idle", reason: "too many records to check" }]);
    expect((await get(t, "clients", "k1"))?.isActive).toBe(true);
  });

  test("a batch over the human cap is refused before anything is written", async () => {
    const t = makeT(); await seed(t);
    const ids = Array.from({ length: 501 }, (_, i) => `x${i}`);
    await expect(setActive(t, "crew", ids, false)).rejects.toThrow();
    await expect(addTag(t, "crew", ids, "vip")).rejects.toThrow();
    expect((await get(t, "crewMembers", "a"))?.status).toBe("ACTIVE");
  });

  test("a repeated id changes once and writes ONE audit row", async () => {
    const t = makeT(); await seed(t);
    const out = await setActive(t, "crew", ["a", "a", "a"], false);
    expect(out.changed).toHaveLength(1);
    const logs = await t.run(async (ctx) => ctx.db.query("activityLogs").collect());
    expect(logs.filter((l) => l.entityId === "a")).toHaveLength(1);
  });

  test("a crew member with a legacy isActive:false (status ACTIVE) can be reactivated, and the Undo restores it", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { const a = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", "a")).first(); await ctx.db.patch(a!._id, { isActive: false }); });
    const out = await setActive(t, "crew", ["a"], true);
    expect(out.changed.map((c) => c.id)).toEqual(["a"]);
    expect((await get(t, "crewMembers", "a"))?.isActive).toBe(true);
    await undo(t, "crew", ["a"]);
    expect((await get(t, "crewMembers", "a"))?.isActive).toBe(false);
  });
});

describe("tags", () => {
  test("adds one tag per record, skips records that already have it, and Undo removes only what this write added", async () => {
    const t = makeT(); await seed(t);
    const out = await addTag(t, "crew", ["a", "b"], "VIP");
    expect(out.changed).toHaveLength(2);
    expect((await get(t, "crewMembers", "a"))?.tags).toEqual(["x", "vip"]);
    expect((await addTag(t, "crew", ["a"], "vip")).skipped).toEqual([{ id: "a", name: "a Crew", reason: "already tagged vip" }]);
    const res = await undo(t, "crew", ["a", "b"]);
    expect(res.restored).toHaveLength(2);
    expect((await get(t, "crewMembers", "a"))?.tags).toEqual(["x"]);
  });
  test("Undo keeps a record whose tags changed since", async () => {
    const t = makeT(); await seed(t);
    await addTag(t, "supplier", ["s1"], "hire");
    await t.run(async (ctx) => { const s = await ctx.db.query("suppliers").withIndex("by_cuid", (q) => q.eq("id", "s1")).first(); await ctx.db.patch(s!._id, { tags: ["hire", "later"] }); });
    const res = await undo(t, "supplier", ["s1"]);
    expect(res.restored).toEqual([]);
    expect((await get(t, "suppliers", "s1"))?.tags).toEqual(["hire", "later"]);
  });
  test("an empty or over-long tag is refused", async () => {
    const t = makeT(); await seed(t);
    await expect(addTag(t, "crew", ["a"], "   ")).rejects.toThrow();
    await expect(addTag(t, "crew", ["a"], "x".repeat(60))).rejects.toThrow();
  });
});

describe("archive (client, supplier)", () => {
  test("a client with an open job stays; the rest archive; Undo reactivates exactly", async () => {
    const t = makeT(); await seed(t);
    const out = await setActive(t, "client", ["k1", "k2"], false);
    expect(out.changed.map((c) => c.id)).toEqual(["k1"]);
    expect(out.skipped).toEqual([{ id: "k2", name: "Busy", reason: "has open jobs" }]);
    expect((await get(t, "clients", "k1"))?.isActive).toBe(false);
    await undo(t, "client", ["k1"]);
    expect((await get(t, "clients", "k1"))?.isActive).toBe(true);
  });
  test("supplier archive is its own high-danger op with an exact Undo, and a foreign supplier is never touched", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { await ctx.db.insert("suppliers", { id: "sx", organizationId: OTHER, name: "Foreign", isActive: true }); });
    const out = await setActive(t, "supplier", ["s1", "sx"], false);
    expect(out.changed.map((c) => c.id)).toEqual(["s1"]);
    expect((await get(t, "suppliers", "sx"))?.isActive).toBe(true);
    expect((await undo(t, "supplier", ["s1"])).restored).toEqual(["s1"]);
    expect((await get(t, "suppliers", "s1"))?.isActive).toBe(true);
  });
});
