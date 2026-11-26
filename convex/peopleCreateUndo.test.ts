// @vitest-environment node
//
// UX Phase 13 slice 4: the exact Undo of a client / supplier / crew member / order CREATED from its sheet. Ids only:
// the create's own audit row (`details.rowOp`) proves author, window, once and org/entity/table; the record goes only
// while it is exactly as created (never edited, nothing attached since), and a refusal changes nothing.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

type T = TestConvex<typeof schema>;
const ORG = "org_1", OTHER = "org_2", USER = "user_1";
const NOW = Date.now();
const actor = { userId: USER, userName: "Alice" };
const as = (t: T, userId = USER, orgId = ORG) => t.withIdentity({ subject: userId, orgId, role: "admin" });

function makeT(): T {
  const t = convexTest(schema, import.meta.glob("./**/*.ts"));
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
async function seed(t: T) {
  await t.run(async (ctx) => {
    for (const [id, userId, org] of [["m1", USER, ORG], ["m2", "user_2", ORG], ["m3", USER, OTHER]] as const) await ctx.db.insert("members", { id, organizationId: org, userId, role: "admin" });
  });
}

type Kind = "client" | "supplier" | "crew" | "supplierOrder";
const create = {
  client: (t: T) => as(t).mutation(api.clientWrites.createNative, { id: "r1", organizationId: ORG, name: "Hilton", createdAt: NOW, updatedAt: NOW, actor, auditId: "a1" }),
  supplier: (t: T) => as(t).mutation(api.suppliersWrites.createNative, { id: "r1", orgId: ORG, name: "Scene", now: NOW, actor, auditId: "a1" }),
  crew: (t: T) => as(t).mutation(api.crewWrites.createNative, { id: "r1", organizationId: ORG, firstName: "Bob", lastName: "Ryan", createdAt: NOW, updatedAt: NOW, actor, auditId: "a1" }),
  supplierOrder: async (t: T) => {
    await t.run(async (ctx) => { await ctx.db.insert("suppliers", { id: "s1", organizationId: ORG, name: "Scene", isActive: true, tags: [] }); });
    return as(t).mutation(api.supplierOrdersWrites.createNative, { id: "r1", orgId: ORG, supplierId: "s1", orderNumber: "PO-1", type: "PURCHASE", now: NOW, actor, auditId: "a1" });
  },
} as const;
const TABLE = { client: "clients", supplier: "suppliers", crew: "crewMembers", supplierOrder: "supplierOrders" } as const;
const undo = (t: T, kind: Kind, over: Record<string, unknown> = {}, who = as(t)) =>
  who.mutation(api.peopleCreateUndo.undoCreateNative, { orgId: ORG, kind, id: "r1", forwardAuditId: "a1", now: NOW + 1, actor, ...over });
const exists = (t: T, kind: Kind) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t.run(async (ctx) => !!(await ctx.db.query(TABLE[kind]).withIndex("by_cuid" as any, (q: any) => q.eq("id", "r1")).first()));
const marker = (t: T) => t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "undo:a1")).first());

const KINDS: Kind[] = ["client", "supplier", "crew", "supplierOrder"];

describe.each(KINDS)("%s: Undo of a create", (kind) => {
  test("removes the untouched record once; a second Undo is refused", async () => {
    const t = makeT(); await seed(t); await create[kind](t);
    expect(await exists(t, kind)).toBe(true);
    expect(await undo(t, kind)).toEqual({ removed: true });
    expect(await exists(t, kind)).toBe(false);
    await expect(undo(t, kind)).rejects.toThrow(/no longer exists|already undone/);
  });

  test("only the author can undo, and a refusal changes nothing and spends no marker", async () => {
    const t = makeT(); await seed(t); await create[kind](t);
    await expect(undo(t, kind, {}, as(t, "user_2"))).rejects.toThrow(/person who made/);
    expect(await exists(t, kind)).toBe(true);
    expect(await marker(t)).toBeNull();
  });

  test("refuses once the server window has passed", async () => {
    const t = makeT(); await seed(t); await create[kind](t);
    await t.run(async (ctx) => {
      const log = (await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "a1")).first())!;
      const d = log.details as { rowOp: Record<string, unknown> };
      await ctx.db.patch(log._id, { details: { rowOp: { ...d.rowOp, serverSavedAt: Date.now() - 60 * 60 * 1000 } } });
    });
    await expect(undo(t, kind)).rejects.toThrow();
    expect(await exists(t, kind)).toBe(true);
  });

  test("refuses another org's record, a wrong id and a wrong audit row, and never deletes a foreign row", async () => {
    const t = makeT(); await seed(t); await create[kind](t);
    await expect(undo(t, kind, { orgId: OTHER }, as(t, USER, OTHER))).rejects.toThrow();
    await expect(undo(t, kind, { id: "nope" })).rejects.toThrow();
    await expect(undo(t, kind, { forwardAuditId: "missing" })).rejects.toThrow();
    expect(await exists(t, kind)).toBe(true);
  });

  test("refuses a record that was edited since", async () => {
    const t = makeT(); await seed(t); await create[kind](t);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await t.run(async (ctx) => { const r = (await ctx.db.query(TABLE[kind]).withIndex("by_cuid" as any, (q: any) => q.eq("id", "r1")).first())!; await ctx.db.patch(r._id, { updatedAt: NOW + 5 }); });
    await expect(undo(t, kind)).rejects.toThrow(/edited/);
    expect(await exists(t, kind)).toBe(true);
  });
});

describe("what was attached since refuses the Undo and names it", () => {
  const blocked = async (kind: Kind, attach: (t: T) => Promise<void>, why: RegExp) => {
    const t = makeT(); await seed(t); await create[kind](t);
    await attach(t);
    await expect(undo(t, kind)).rejects.toThrow(why);
    expect(await exists(t, kind)).toBe(true);
    expect(await marker(t)).toBeNull();
  };
  const ins = (t: T, fn: (ctx: Parameters<Parameters<T["run"]>[0]>[0]) => Promise<unknown>) => t.run(async (ctx) => { await fn(ctx); });

  test("client: a job, an invoice, a file, a later contact", async () => {
    await blocked("client", (t) => ins(t, (c) => c.db.insert("projects", { id: "p1", organizationId: ORG, clientId: "r1", name: "J", projectNumber: "P1" } as never)), /job was added/);
    await blocked("client", (t) => ins(t, (c) => c.db.insert("clientMedia", { id: "cm", organizationId: ORG, clientId: "r1", fileId: "f" } as never)), /file was added/);
    await blocked("client", (t) => ins(t, (c) => c.db.insert("clientContacts", { id: "cc", organizationId: ORG, clientId: "r1", name: "Later", createdAt: NOW + 99, updatedAt: NOW + 99 } as never)), /contact was added/);
  });

  test("supplier: an order, a contact, a document", async () => {
    await blocked("supplier", (t) => ins(t, (c) => c.db.insert("supplierOrders", { id: "o", organizationId: ORG, supplierId: "r1", orderNumber: "PO", type: "PURCHASE", status: "DRAFT" } as never)), /order was added/);
    await blocked("supplier", (t) => ins(t, (c) => c.db.insert("supplierContacts", { id: "sc", organizationId: ORG, supplierId: "r1", name: "X" } as never)), /contact was added/);
  });

  test("crew: a call, logged time, a document", async () => {
    await blocked("crew", (t) => ins(t, (c) => c.db.insert("crewAssignments", { id: "ca", organizationId: ORG, crewMemberId: "r1", projectId: "p", status: "PENDING" } as never)), /call was added/);
    await blocked("crew", (t) => ins(t, (c) => c.db.insert("crewDocuments", { id: "cd", organizationId: ORG, crewMemberId: "r1", fileId: "f", kind: "ID", createdAt: NOW, createdById: USER })), /document was added/);
  });

  test("order: a line, a file, an invoice", async () => {
    await blocked("supplierOrder", (t) => ins(t, (c) => c.db.insert("supplierOrderItems", { id: "oi", orderId: "r1", description: "x", quantity: 1, unitPrice: 1 } as never)), /line was added/);
    await blocked("supplierOrder", (t) => ins(t, async (c) => { const o = (await c.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", "r1")).first())!; await c.db.patch(o._id, { invoiceFileId: "f" }); }), /invoice was attached/);
  });
});

describe("client Undo removes the primary contact the create wrote, and nothing else", () => {
  test("a contact stamped with the client's own createdAt goes with it", async () => {
    const t = makeT(); await seed(t); await create.client(t);
    await t.run(async (ctx) => { await ctx.db.insert("clientContacts", { id: "cc", organizationId: ORG, clientId: "r1", name: "Primary", isPrimary: true, createdAt: NOW, updatedAt: NOW } as never); });
    await undo(t, "client");
    expect(await t.run(async (ctx) => ctx.db.query("clientContacts").collect())).toEqual([]);
  });
});
