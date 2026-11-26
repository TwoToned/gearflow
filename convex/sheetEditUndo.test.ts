// @vitest-environment node
//
// UX Phase 13 slice 4: an edit saved from the client / supplier / crew / order SHEET writes ONE audit row holding the
// before/after of only the fields it changed, and the toast's Undo is the server's exact one (ids only; author, window,
// once, still-as-left). Clients, suppliers and crew reuse `peopleBulkWrites.undoManyNative`; an order reuses the
// field-agnostic `undoHireChangeNative`.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

type T = TestConvex<typeof schema>;
const ORG = "org_1", USER = "user_1";
const NOW = Date.now();
const actor = { userId: USER, userName: "Alice" };
const as = (t: T, userId = USER) => t.withIdentity({ subject: userId, orgId: ORG, role: "admin" });

function makeT(): T {
  const t = convexTest(schema, import.meta.glob("./**/*.ts"));
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "admin" });
    await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: "user_2", role: "admin" });
    await ctx.db.insert("clients", { id: "k1", organizationId: ORG, name: "Hilton", isActive: true, notes: "old", tags: ["vip"] });
    await ctx.db.insert("suppliers", { id: "s1", organizationId: ORG, name: "Scene", isActive: true, phone: "111", tags: [] });
    await ctx.db.insert("crewMembers", { id: "c1", organizationId: ORG, firstName: "Bob", lastName: "Ryan", status: "ACTIVE", isActive: true, department: "Rigging" });
    await ctx.db.insert("supplierOrders", { id: "o1", organizationId: ORG, supplierId: "s1", orderNumber: "PO-1", type: "PURCHASE", status: "DRAFT", notes: "n0" });
  });
}
const doc = <K extends "clients" | "suppliers" | "crewMembers" | "supplierOrders">(t: T, table: K, id: string) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t.run(async (ctx) => (ctx.db.query(table).withIndex("by_cuid" as any, (q: any) => q.eq("id", id)).first()) as any) as Promise<Record<string, unknown> | null>;
const undoPeople = (t: T, kind: "client" | "supplier" | "crew", id: string, auditId: string, who = as(t)) =>
  who.mutation(api.peopleBulkWrites.undoManyNative, { orgId: ORG, kind, items: [{ id, auditId }], now: NOW + 1, actor });

describe("an edit's audit row is an exact field edit", () => {
  test("client: only the changed fields are snapshotted, and the Undo restores exactly them", async () => {
    const t = makeT(); await seed(t);
    await as(t).mutation(api.clientWrites.updateNative, { id: "k1", orgId: ORG, patch: { name: "Hilton Sydney", notes: "new", tags: ["vip"] }, actor, auditId: "e1", now: NOW });
    const log = await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "e1")).first());
    expect(Object.keys((log!.details as { fieldEdit: { after: object } }).fieldEdit.after).sort()).toEqual(["name", "notes"]); // tags did not change
    expect((await undoPeople(t, "client", "k1", "e1")).restored).toEqual(["k1"]);
    expect(await doc(t, "clients", "k1")).toMatchObject({ name: "Hilton", notes: "old", tags: ["vip"] });
  });

  test("supplier: the Undo restores, and a field changed since is kept and named", async () => {
    const t = makeT(); await seed(t);
    const edit = (auditId: string, phone: string) => as(t).mutation(api.suppliersWrites.updateNative, { id: "s1", orgId: ORG, name: "Scene", phone, now: NOW, actor, auditId });
    await edit("e1", "222");
    expect((await undoPeople(t, "supplier", "s1", "e1")).restored).toEqual(["s1"]);
    expect((await doc(t, "suppliers", "s1"))?.phone).toBe("111");
    await edit("e2", "333");
    await edit("e3", "444"); // someone edits again afterwards
    const res = await undoPeople(t, "supplier", "s1", "e2");
    expect(res.restored).toEqual([]);
    expect(res.kept).toEqual([{ id: "s1", reason: expect.stringMatching(/changed since/) }]);
    expect((await doc(t, "suppliers", "s1"))?.phone).toBe("444");
  });

  test("crew: a set and a clear are both restored, and another user cannot undo it", async () => {
    const t = makeT(); await seed(t);
    await as(t).mutation(api.crewWrites.updateNative, { id: "c1", orgId: ORG, set: { phone: "0400" }, clear: ["department"], actor, auditId: "e1", now: NOW });
    expect(await doc(t, "crewMembers", "c1")).toMatchObject({ phone: "0400" });
    expect((await doc(t, "crewMembers", "c1"))?.department).toBeUndefined();
    const other = await undoPeople(t, "crew", "c1", "e1", as(t, "user_2"));
    expect(other.restored).toEqual([]);
    expect(other.kept[0].reason).toMatch(/person who made/);
    expect((await undoPeople(t, "crew", "c1", "e1")).restored).toEqual(["c1"]);
    const back = await doc(t, "crewMembers", "c1");
    expect(back?.department).toBe("Rigging");
    expect(back?.phone).toBeUndefined();
  });

  test("order: status and notes are restored by the field-agnostic Undo, once", async () => {
    const t = makeT(); await seed(t);
    await as(t).mutation(api.supplierOrdersWrites.updateNative, { id: "o1", orgId: ORG, status: "ORDERED", notes: "n1", now: NOW, actor, auditId: "e1" });
    expect(await doc(t, "supplierOrders", "o1")).toMatchObject({ status: "ORDERED", notes: "n1" });
    const undo = () => as(t).mutation(api.supplierOrdersWrites.undoHireChangeNative, { id: "o1", orgId: ORG, forwardAuditId: "e1", now: NOW, actor });
    await undo();
    expect(await doc(t, "supplierOrders", "o1")).toMatchObject({ status: "DRAFT", notes: "n0" });
    await expect(undo()).rejects.toThrow(/already undone/);
  });

  test("an edit that changes nothing still audits and has nothing to undo", async () => {
    const t = makeT(); await seed(t);
    await as(t).mutation(api.clientWrites.updateNative, { id: "k1", orgId: ORG, patch: { name: "Hilton" }, actor, auditId: "e1", now: NOW });
    const log = await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "e1")).first());
    expect(log?.summary).toMatch(/Updated client/);
    expect((log?.details as { fieldEdit?: unknown } | undefined)?.fieldEdit).toBeUndefined();
  });
});
