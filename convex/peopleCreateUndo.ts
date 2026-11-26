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
import { referenceBlocker } from "./lib/peopleReferences";

/**
 * The EXACT Undo of a person / company / order CREATED from its sheet (UX Phase 13, slice 4). Ids only: the forward
 * create wrote `details.rowOp` (`recordRowOp`), and `claimRowOpUndo` proves the caller is its author, it is inside the
 * server window, it was not undone before and it belongs to this org, entity and table.
 *
 * It deletes the new record ONLY while it is still exactly as created: never edited (`updatedAt === createdAt`) and
 * with nothing referencing it (every table in `lib/peopleReferences.ts`). Anything attached refuses the whole
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

const NOT_UNDOABLE = (what: string) => new ConvexError({ code: "CHANGED_SINCE", message: `Can't undo: ${what}.` });

async function loadFor(ctx: MutationCtx, k: Kind, orgId: string, id: string) {
  const table = CFG[k].table;
  const row = await ctx.db.query(table).withIndex("by_cuid", (q) => q.eq("id", id)).first();
  return row && row.organizationId === orgId ? row : null;
}

/**
 * Why this record is no longer exactly as created, or null. The foreign keys come from ONE table
 * (`lib/peopleReferences.ts`, with a schema-walk test that fails for a missing one); only what is not a foreign key lives here.
 */
async function blockerOf(ctx: MutationCtx, k: Kind, orgId: string, row: Doc<"clients"> | Doc<"suppliers"> | Doc<"crewMembers"> | Doc<"supplierOrders">): Promise<string | null> {
  if (row.updatedAt !== row.createdAt) return "it was edited";
  if (k === "supplierOrder" && (row as Doc<"supplierOrders">).invoiceFileId) return "an invoice was attached to this order";
  return referenceBlocker(ctx, k, orgId, { id: row.id, _creationTime: row._creationTime });
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
