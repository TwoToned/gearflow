// @vitest-environment node
//
// Order hire state (UX Phase 13, D71): the pure derivation, Mark returned / Extend hire
// and their exact Undo on the shared fieldEditUndo, RBAC, org checks, and the supplier
// delete gate (blocked while the supplier has orders).
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { DAY_MS, isOnHire, orderHireState, returnLateDays } from "./lib/orderHireState";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1", OTHER = "org_2", USER = "user_1";
const actor = { userId: USER, userName: "Alice" };
const NOW = Date.now();
const as = (t: T, role = "admin", userId = USER, orgId = ORG) => t.withIdentity({ subject: userId, orgId, role });

describe("orderHireState (pure)", () => {
  const o = (over: Record<string, unknown>) => ({ type: "SUBHIRE", status: "RECEIVED", ...over });
  test("words", () => {
    expect(orderHireState(o({})).word).toBe("On hire");
    expect(orderHireState(o({ status: "PARTIAL" })).word).toBe("On hire");
    expect(orderHireState(o({ returnedDate: 1 })).word).toBe("Returned");
    expect(orderHireState(o({ status: "ORDERED" })).word).toBe("Ordered");
    expect(orderHireState(o({ status: "DRAFT", returnedDate: 1 })).word).toBe("Draft");
    expect(orderHireState(o({ status: "CANCELLED" })).word).toBe("Cancelled");
    expect(orderHireState({ type: "PURCHASE", status: "RECEIVED", returnedDate: 1 }).word).toBe("Received");
    expect(orderHireState({ type: "PURCHASE", status: "PARTIAL" }).word).toBe("Partly received");
  });
  test("late days only while on hire with a due date", () => {
    const today = Math.floor(NOW / DAY_MS);
    expect(returnLateDays(o({ returnDueDate: NOW - 3 * DAY_MS }), today)).toBe(3);
    expect(returnLateDays(o({ returnDueDate: NOW + DAY_MS }), today)).toBe(0);
    expect(returnLateDays(o({}), today)).toBe(0);
    expect(returnLateDays(o({ returnDueDate: NOW - 3 * DAY_MS, returnedDate: NOW }), today)).toBe(0);
    expect(isOnHire({ type: "REPAIR", status: "RECEIVED" })).toBe(false);
  });
});

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}
async function seed(t: T, role = "admin") {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role });
    await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: "user_2", role: "admin" });
    await ctx.db.insert("suppliers", { id: "s1", organizationId: ORG, name: "Scene", isActive: false });
    await ctx.db.insert("supplierOrders", { id: "o1", organizationId: ORG, supplierId: "s1", orderNumber: "SH-1", type: "SUBHIRE", status: "RECEIVED", orderDate: NOW - 10 * DAY_MS, returnDueDate: NOW - 2 * DAY_MS });
    await ctx.db.insert("supplierOrders", { id: "o2", organizationId: ORG, supplierId: "s1", orderNumber: "PO-2", type: "PURCHASE", status: "RECEIVED" });
    await ctx.db.insert("supplierOrders", { id: "ox", organizationId: OTHER, supplierId: "sx", orderNumber: "SH-X", type: "SUBHIRE", status: "RECEIVED" });
  });
}
const order = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const base = { id: "o1", orgId: ORG, now: NOW, actor, auditId: "a1" };
const markReturned = (t: T, over: Record<string, unknown> = {}, who = as(t)) => who.mutation(api.supplierOrdersWrites.markReturnedNative, { ...base, returnedDate: NOW - DAY_MS, ...over });
const extend = (t: T, over: Record<string, unknown> = {}, who = as(t)) => who.mutation(api.supplierOrdersWrites.extendHireNative, { ...base, returnDueDate: NOW + 3 * DAY_MS, ...over });
const undo = (t: T, over: Record<string, unknown> = {}, who = as(t)) => who.mutation(api.supplierOrdersWrites.undoHireChangeNative, { id: "o1", orgId: ORG, forwardAuditId: "a1", now: NOW, actor, ...over });

describe("Mark returned / Extend hire", () => {
  test("Mark returned sets only returnedDate; Undo restores exactly and a second Undo is refused", async () => {
    const t = makeT(); await seed(t);
    await markReturned(t);
    expect((await order(t, "o1"))?.returnedDate).toBe(NOW - DAY_MS);
    expect((await order(t, "o1"))?.returnDueDate).toBe(NOW - 2 * DAY_MS);
    expect((await undo(t)).restored).toEqual(["returnedDate"]);
    expect((await order(t, "o1"))?.returnedDate).toBeUndefined();
    await expect(undo(t)).rejects.toThrow(/already undone/);
  });

  test("Extend hire moves only returnDueDate (never a sub-hire's hireEnd) and Undo restores the prior date", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { await ctx.db.insert("subHires", { id: "sh", organizationId: ORG, supplierId: "s1", createdById: USER, orderNumber: "B", supplierOrderId: "o1", hireEnd: 777 } as never); });
    await extend(t);
    expect((await order(t, "o1"))?.returnDueDate).toBe(NOW + 3 * DAY_MS);
    expect(await t.run(async (ctx) => (await ctx.db.query("subHires").withIndex("by_cuid", (q) => q.eq("id", "sh")).first())?.hireEnd)).toBe(777);
    await undo(t);
    expect((await order(t, "o1"))?.returnDueDate).toBe(NOW - 2 * DAY_MS);
  });

  test("Undo refuses when the field moved since, for another user, and changes nothing", async () => {
    const t = makeT(); await seed(t);
    await extend(t);
    await expect(undo(t, {}, as(t, "admin", "user_2"))).rejects.toThrow(/person who made/);
    await t.run(async (ctx) => { const o = await ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", "o1")).first(); await ctx.db.patch(o!._id, { returnDueDate: NOW + 9 * DAY_MS }); });
    await expect(undo(t)).rejects.toThrow(/changed since/);
    expect((await order(t, "o1"))?.returnDueDate).toBe(NOW + 9 * DAY_MS);
  });

  test("guards: not a sub-hire, not on hire, already returned, backwards dates, other org, no permission", async () => {
    const t = makeT(); await seed(t);
    await expect(markReturned(t, { id: "o2" })).rejects.toThrow(/sub-hire/);
    await expect(extend(t, { returnDueDate: NOW - 5 * DAY_MS })).rejects.toThrow(/after the current/);
    await expect(markReturned(t, { returnedDate: NOW + 10 * DAY_MS })).rejects.toThrow(/future/);
    await expect(markReturned(t, { returnedDate: NOW - 30 * DAY_MS })).rejects.toThrow(/before it was ordered/);
    await expect(markReturned(t, { id: "ox" })).rejects.toThrow(/not found/i);
    await markReturned(t);
    await expect(markReturned(t, { auditId: "a2" })).rejects.toThrow(/already marked returned/);
    await expect(extend(t, { auditId: "a3" })).rejects.toThrow(/already marked returned/);
    await t.run(async (ctx) => { const o = await ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", "o1")).first(); await ctx.db.patch(o!._id, { status: "ORDERED", returnedDate: undefined }); });
    await expect(markReturned(t, { auditId: "a4" })).rejects.toThrow(/not been received/);
    const t2 = makeT(); await seed(t2, "viewer");
    await expect(markReturned(t2, {}, as(t2, "viewer"))).rejects.toThrow();
    expect((await order(t2, "o1"))?.returnedDate).toBeUndefined();
  });

  test("getDetail and listBySupplier carry both dates", async () => {
    const t = makeT(); await seed(t);
    await markReturned(t);
    const d = await as(t).query(api.supplierOrders.getDetail, { orgId: ORG, id: "o1" });
    expect(d).toMatchObject({ returnedDate: NOW - DAY_MS, returnDueDate: NOW - 2 * DAY_MS });
    const l = await as(t).query(api.supplierOrders.listBySupplier, { orgId: ORG, supplierId: "s1" });
    expect(l.orders.find((x) => x.id === "o1")).toMatchObject({ returnedDate: NOW - DAY_MS });
  });
});

describe("supplier delete gate (D74)", () => {
  test("blocked while the supplier has orders; allowed once it has none", async () => {
    const t = makeT(); await seed(t);
    const args = { id: "s1", orgId: ORG, now: NOW, actor, auditId: "d1" };
    await expect(as(t).mutation(api.suppliersWrites.removeNative, args)).rejects.toThrow(/existing orders/);
    await t.run(async (ctx) => { for (const id of ["o1", "o2"]) { const o = await ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", id)).first(); await ctx.db.delete(o!._id); } });
    await as(t).mutation(api.suppliersWrites.removeNative, { ...args, auditId: "d2" });
    expect(await t.run(async (ctx) => ctx.db.query("suppliers").withIndex("by_cuid", (q) => q.eq("id", "s1")).first())).toBeNull();
  });
});
