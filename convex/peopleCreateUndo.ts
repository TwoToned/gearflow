import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { claimRowOpUndo } from "./lib/rowOpUndo";
import { bumpCrewMemberCounters } from "./lib/counters";

/**
 * The EXACT Undo of a person / company / order CREATED from its sheet (UX Phase 13, slice 4). Ids only: the forward
 * create wrote `details.rowOp` (`recordRowOp`), and `claimRowOpUndo` proves the caller is its author, it is inside the
 * server window, it was not undone before and it belongs to this org, entity and table.
 *
 * It deletes the new record ONLY while it is still exactly as created: never edited (`updatedAt === createdAt`) and
 * with nothing attached since (no jobs, invoices, orders, calls, time, files...). Anything attached refuses the whole
 * Undo and names it; nothing is half-removed. The only child it removes is what the create itself wrote in the same
 * breath (a client's primary contact, stamped with the client's own `createdAt`). It never deletes a stored file.
 */
type Kind = "client" | "supplier" | "crew" | "supplierOrder";
const kind = v.union(v.literal("client"), v.literal("supplier"), v.literal("crew"), v.literal("supplierOrder"));

const CFG = {
  client: { resource: "client", entityType: "client", table: "clients" },
  supplier: { resource: "supplier", entityType: "supplier", table: "suppliers" },
  crew: { resource: "crew", entityType: "crew_member", table: "crewMembers" },
  supplierOrder: { resource: "supplier", entityType: "supplierOrder", table: "supplierOrders" },
} as const;

const NOT_UNDOABLE = (what: string) => new ConvexError({ code: "CHANGED_SINCE", message: `Can't undo: ${what} since.` });

/** `true` when any row of the index exists for this org (the indexes are global, so each row is org-checked). */
async function anyFor(rows: Promise<object[]>, orgId: string): Promise<boolean> {
  return (await rows).some((r) => { const o = (r as { organizationId?: string }).organizationId; return o === orgId || o === undefined; });
}

async function clientBlocker(ctx: MutationCtx, orgId: string, c: Doc<"clients">): Promise<string | null> {
  const by = (q: { eq: (f: "clientId", v: string) => unknown }) => q.eq("clientId", c.id);
  void by;
  if (await anyFor(ctx.db.query("projects").withIndex("by_clientId", (q) => q.eq("clientId", c.id)).take(5), orgId)) return "a job was added to this client";
  if (await anyFor(ctx.db.query("invoices").withIndex("by_clientId", (q) => q.eq("clientId", c.id)).take(5), orgId)) return "an invoice was added to this client";
  if (await anyFor(ctx.db.query("clientMedia").withIndex("by_clientId", (q) => q.eq("clientId", c.id)).take(5), orgId)) return "a file was added to this client";
  const contacts = (await ctx.db.query("clientContacts").withIndex("by_clientId", (q) => q.eq("clientId", c.id)).take(50)).filter((x) => x.organizationId === orgId);
  return contacts.some((x) => x.createdAt !== c.createdAt || x.updatedAt !== x.createdAt) ? "a contact was added or edited" : null;
}

async function supplierBlocker(ctx: MutationCtx, orgId: string, s: Doc<"suppliers">): Promise<string | null> {
  const checks: [string, Promise<object[]>][] = [
    ["an order was added to this supplier", ctx.db.query("supplierOrders").withIndex("by_organizationId_supplierId", (q) => q.eq("organizationId", orgId).eq("supplierId", s.id)).take(5)],
    ["an asset was linked to this supplier", ctx.db.query("assets").withIndex("by_supplierId", (q) => q.eq("supplierId", s.id)).take(5)],
    ["a contact was added to this supplier", ctx.db.query("supplierContacts").withIndex("by_supplierId", (q) => q.eq("supplierId", s.id)).take(5)],
    ["a document was added to this supplier", ctx.db.query("supplierDocuments").withIndex("by_supplierId", (q) => q.eq("supplierId", s.id)).take(5)],
    ["a rate was added to this supplier", ctx.db.query("supplierModelRates").withIndex("by_supplierId", (q) => q.eq("supplierId", s.id)).take(5)],
  ];
  for (const [why, rows] of checks) if (await anyFor(rows, orgId)) return why;
  return null;
}

async function crewBlocker(ctx: MutationCtx, orgId: string, m: Doc<"crewMembers">): Promise<string | null> {
  const checks: [string, Promise<object[]>][] = [
    ["a call was added for this person", ctx.db.query("crewAssignments").withIndex("by_crewMemberId", (q) => q.eq("crewMemberId", m.id)).take(5)],
    ["time was logged for this person", ctx.db.query("crewTimeEntries").withIndex("by_crewMemberId", (q) => q.eq("crewMemberId", m.id)).take(5)],
    ["availability was added for this person", ctx.db.query("crewAvailabilities").withIndex("by_crewMemberId", (q) => q.eq("crewMemberId", m.id)).take(5)],
    ["a document was added for this person", ctx.db.query("crewDocuments").withIndex("by_crewMemberId", (q) => q.eq("crewMemberId", m.id)).take(5)],
  ];
  for (const [why, rows] of checks) if (await anyFor(rows, orgId)) return why;
  return null;
}

async function orderBlocker(ctx: MutationCtx, orgId: string, o: Doc<"supplierOrders">): Promise<string | null> {
  if (o.invoiceFileId) return "an invoice was attached to this order";
  const checks: [string, Promise<object[]>][] = [
    ["a line was added to this order", ctx.db.query("supplierOrderItems").withIndex("by_orderId", (q) => q.eq("orderId", o.id)).take(5)],
    ["a file was added to this order", ctx.db.query("supplierOrderFiles").withIndex("by_orderId", (q) => q.eq("orderId", o.id)).take(5)],
    ["an asset was linked to this order", ctx.db.query("assets").withIndex("by_supplierOrderId", (q) => q.eq("supplierOrderId", o.id)).take(5)],
    ["a sub-hire was linked to this order", ctx.db.query("subHires").withIndex("by_supplierOrderId", (q) => q.eq("supplierOrderId", o.id)).take(5)],
  ];
  for (const [why, rows] of checks) if (await anyFor(rows, orgId)) return why;
  return null;
}

async function loadFor(ctx: MutationCtx, k: Kind, orgId: string, id: string) {
  const table = CFG[k].table;
  const row = await ctx.db.query(table).withIndex("by_cuid", (q) => q.eq("id", id)).first();
  return row && row.organizationId === orgId ? row : null;
}

async function blockerOf(ctx: MutationCtx, k: Kind, orgId: string, row: Doc<"clients"> | Doc<"suppliers"> | Doc<"crewMembers"> | Doc<"supplierOrders">): Promise<string | null> {
  if (row.updatedAt !== row.createdAt) return "it was edited";
  if (k === "client") return clientBlocker(ctx, orgId, row as Doc<"clients">);
  if (k === "supplier") return supplierBlocker(ctx, orgId, row as Doc<"suppliers">);
  if (k === "crew") return crewBlocker(ctx, orgId, row as Doc<"crewMembers">);
  return orderBlocker(ctx, orgId, row as Doc<"supplierOrders">);
}

async function removeFor(ctx: MutationCtx, k: Kind, orgId: string, row: Doc<"clients"> | Doc<"suppliers"> | Doc<"crewMembers"> | Doc<"supplierOrders">): Promise<void> {
  if (k === "client") {
    const contacts = await ctx.db.query("clientContacts").withIndex("by_clientId", (q) => q.eq("clientId", (row as Doc<"clients">).id)).take(50);
    for (const c of contacts.filter((x) => x.organizationId === orgId)) await ctx.db.delete(c._id);
  }
  if (k === "crew") await bumpCrewMemberCounters(ctx, orgId, row as Doc<"crewMembers">, null);
  await ctx.db.delete(row._id);
}

export const undoCreateNative = mutation({
  returns: v.object({ removed: v.boolean() }),
  args: { orgId: v.string(), kind, id: v.string(), forwardAuditId: v.string(), now: v.number(), actor: v.object({ userId: v.string(), userName: v.string() }) },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, CFG[a.kind].resource);
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, CFG[a.kind].resource, "create");
    const actor = await resolveActor(ctx, a.actor);
    const row = await loadFor(ctx, a.kind, a.orgId, a.id);
    // Gone already (deleted since): nothing to undo, and the marker is not spent.
    if (!row) throw new ConvexError({ code: "NOT_FOUND", message: "That record no longer exists." });
    const blocker = await blockerOf(ctx, a.kind, a.orgId, row);
    if (blocker) throw NOT_UNDOABLE(blocker);
    const name = "name" in row ? (row as { name: string }).name : "firstName" in row ? `${row.firstName} ${row.lastName}` : (row as Doc<"supplierOrders">).orderNumber;
    const op = await claimRowOpUndo(ctx, { orgId: a.orgId, entityType: CFG[a.kind].entityType, entityId: a.id, entityName: name, auditId: a.forwardAuditId, actor, now: a.now, table: CFG[a.kind].table });
    if (op.op !== "add" || op.rowId !== a.id) throw new ConvexError({ code: "NOT_UNDOABLE", message: "That change can't be undone." });
    await removeFor(ctx, a.kind, a.orgId, row);
    return { removed: true };
  },
});

export const agentOps: AgentOpsAnnotations = {
  undoCreateNative: { danger: "high" },
};
