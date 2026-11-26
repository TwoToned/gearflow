import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { writeActivityLog } from "./lib/audit";
import { assertStrLen } from "./lib/fieldGuards";
import { diffFields, recordFieldEdit, undoFieldEdit } from "./lib/fieldEditUndo";
import { recordRowOp } from "./lib/rowOpUndo";
import { isLegalOrderMove, RECEIVED_STATUSES } from "./lib/orderStatusMachine";
import { deleteStoredFileIfUnreferenced } from "./lib/deleteStoredFile";
import { MAX_FILES_PER_ORDER, SUPPLIER_INVOICE_FOLDER } from "./lib/supplierRecordCore";
import { assertAttachableUpload } from "./lib/attachableUpload";
import * as enums from "./lib/validators";

/**
 * Native SUPPLIER-ORDER write mutations (Phase 3 browser-direct — replaces the
 * createSupplierOrder server action in src/server/supplier-orders.ts). create/
 * attachInvoice/removeInvoice were live from #789 (the OLD update/status/delete +
 * item CRUD server actions were dead — 0 consumers — and were dropped with the
 * file). WS7 #946 adds the REAL header edit (`updateNative`, with a status machine)
 * and delete (`deleteNative`, with FK guards) this domain had never actually had a
 * browser path for — see FEATUREDOCS/22, which previously (incorrectly) documented
 * these as already built. Item CRUD lives in `convex/supplierOrderItemsWrites.ts`.
 * Gates on `supplier:create`/`supplier:update`/`supplier:delete`. Standard shape: 4
 * guards + per-row org re-check on the supplier/order/file + atomic audit. The
 * form's supplierOrderSchema validates before submit; dates arrive as epoch-ms
 * from the hook.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

/**
 * Mirrors `supplierOrderSchema`'s (src/lib/validations/supplier-order.ts) string-length
 * bounds — `v.string()` only enforces type, not `.min()`/`.max()`. The form's Zod parse
 * runs client-side only; a browser-direct caller invoking this mutation skips it
 * entirely (R-8.6.2).
 */
function assertSupplierOrderFields(f: { orderNumber?: string; notes?: string }): void {
  if (f.orderNumber != null) assertStrLen(f.orderNumber, "orderNumber", { min: 1, max: 100 });
  assertStrLen(f.notes, "notes", { max: 2000 });
}

export const createNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    supplierId: v.string(),
    orderNumber: v.string(),
    type: enums.SupplierOrderType,
    status: v.optional(enums.SupplierOrderStatus),
    orderDate: v.optional(v.number()),
    expectedDate: v.optional(v.number()),
    receivedDate: v.optional(v.number()),
    projectId: v.optional(v.string()),
    notes: v.optional(v.string()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "supplierOrder");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "supplier", "create");
    const actor = await resolveActor(ctx, a.actor);

    // The id is client-minted now (browser-direct). Reject a collision with ANY existing
    // order (by_cuid is global) — else a caller could reuse a foreign order's id, and the
    // item-count join in listBySupplier (by_orderId, not org-scoped) would leak that
    // order's count; a duplicate id also breaks .unique() by_cuid reads.
    const dup = await ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (dup) throw new ConvexError("Order already exists");
    assertSupplierOrderFields(a);

    // WS7 #946 latent-bug fix: orderNumber was documented as "unique per org"
    // (FEATUREDOCS/22) but never actually checked — two orders with the same number
    // could silently coexist. by_organizationId_orderNumber already existed as an
    // index with no consumer enforcing uniqueness against it.
    const dupNumber = await ctx.db
      .query("supplierOrders")
      .withIndex("by_organizationId_orderNumber", (q) => q.eq("organizationId", a.orgId).eq("orderNumber", a.orderNumber))
      .first();
    if (dupNumber) throw new ConvexError(`Order number "${a.orderNumber}" already exists.`);

    const supplier = await ctx.db.query("suppliers").withIndex("by_cuid", (q) => q.eq("id", a.supplierId)).first();
    if (!supplier || supplier.organizationId !== a.orgId) throw new ConvexError("Supplier not found");

    if (a.projectId) {
      const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", a.projectId as string)).first();
      if (!project || project.organizationId !== a.orgId) throw new ConvexError("Project not found");
    }

    await ctx.db.insert("supplierOrders", {
      id: a.id,
      organizationId: a.orgId,
      supplierId: a.supplierId,
      orderNumber: a.orderNumber,
      type: a.type,
      status: a.status ?? undefined,
      orderDate: a.orderDate ?? undefined,
      expectedDate: a.expectedDate ?? undefined,
      receivedDate: a.receivedDate ?? undefined,
      projectId: a.projectId || undefined,
      notes: a.notes || undefined,
      createdById: actor.userId,
      createdAt: a.now,
      updatedAt: a.now,
    });

    // The audit row is also what the sheet's create Undo reads (`peopleCreateUndo.undoCreateNative`).
    await recordRowOp(ctx, {
      orgId: a.orgId, entityType: "supplierOrder", entityId: a.id, entityName: a.orderNumber, auditId: a.auditId, actor, now: a.now,
      action: "CREATE", summary: `Created order ${a.orderNumber}`, op: { op: "add", table: "supplierOrders", rowId: a.id, snapshot: null },
    });

    return { id: a.id };
  },
});

// The status machine is `lib/orderStatusMachine.ts` (shared with the Undo and the order sheet's status select).

// Header-edit args (status/orderDate/expectedDate/notes only — NOT
// supplierId/orderNumber/type/projectId, which the order keeps for its lifetime).
// Exported so the validation-drift guard (R-8.6.1) can pair it with
// `supplierOrderUpdateSchema` (src/lib/validations/supplier-order.ts).
export const updateFields = {
  status: enums.SupplierOrderStatus,
  orderDate: v.optional(v.number()),
  expectedDate: v.optional(v.number()),
  notes: v.optional(v.string()),
};

/**
 * updateNative — the order HEADER edit FEATUREDOCS/22 documented as "Not built"
 * (issue #789 shipped read + invoice-attach only). Status machine guard (no-op
 * transition, i.e. resubmitting the same status, is always allowed — this is an
 * edit form, not a one-shot action); auto-sets `receivedDate` the moment status
 * BECOMES RECEIVED (transition-only — a later edit that keeps status RECEIVED does
 * not re-stamp it). orderDate/expectedDate/notes are full-form fields (the edit
 * form always resubmits current values), so absent = cleared, matching how the
 * order's own create path treats these dates. supplier:update.
 */
export const updateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), ...updateFields, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "supplierOrder");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "supplier", "update");
    const actor = await resolveActor(ctx, a.actor);

    const order = await ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!order || order.organizationId !== a.orgId) throw new ConvexError("Order not found");
    assertStrLen(a.notes, "notes", { max: 2000 }); // R-8.6.2: mirror supplierOrderUpdateSchema

    const previousStatus = order.status ?? "DRAFT";
    if (!isLegalOrderMove(previousStatus, a.status)) throw new ConvexError(`Cannot transition from ${previousStatus} to ${a.status}`);

    const patch: Record<string, unknown> = {
      status: a.status,
      orderDate: a.orderDate ?? undefined,
      expectedDate: a.expectedDate ?? undefined,
      notes: a.notes ?? undefined,
      updatedAt: a.now,
    };
    if (a.status === "RECEIVED" && previousStatus !== "RECEIVED") {
      patch.receivedDate = a.now;
    }

    await ctx.db.patch(order._id, patch);

    const summary = a.status !== previousStatus ? `Changed order ${order.orderNumber} status to ${a.status}` : `Updated order ${order.orderNumber}`;
    // The before/after of ONLY the changed fields, for the sheet's exact Undo (`undoHireChangeNative` is field-agnostic).
    const diff = diffFields(order, { ...order, ...patch }, ["status", "orderDate", "expectedDate", "notes", "receivedDate"]);
    if (diff) {
      await recordFieldEdit(ctx, { orgId: a.orgId, entityType: "supplierOrder", entityId: a.id, entityName: order.orderNumber, auditId: a.auditId, actor, now: a.now, diff, summary });
    } else {
      await writeActivityLog(ctx, { id: a.auditId, organizationId: a.orgId, action: "UPDATE", entityType: "supplierOrder", entityId: a.id, entityName: order.orderNumber, userId: actor.userId, userName: actor.userName, summary, createdAt: a.now });
    }

    return { id: a.id };
  },
});

/**
 * deleteNative — guards: an order with any asset linked to it (assets.by_supplierOrderId)
 * or a sub-hire linked to it (subHires.by_supplierOrderId, the WS7 #946 FK) cannot be
 * deleted — either would be left with a dangling reference. Cascades the order's OWN
 * items + invoice file (nothing else references them). supplier:delete.
 */
export const deleteNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "supplierOrder");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "supplier", "delete");
    const actor = await resolveActor(ctx, a.actor);

    const order = await ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!order || order.organizationId !== a.orgId) throw new ConvexError("Order not found");

    const linkedAssets = await ctx.db.query("assets").withIndex("by_supplierOrderId", (q) => q.eq("supplierOrderId", a.id)).collect();
    if (linkedAssets.some((asset) => asset.organizationId === a.orgId)) {
      throw new ConvexError("Cannot delete an order with assets linked to it");
    }
    const linkedSubHires = await ctx.db.query("subHires").withIndex("by_supplierOrderId", (q) => q.eq("supplierOrderId", a.id)).collect();
    if (linkedSubHires.some((sh) => sh.organizationId === a.orgId)) {
      throw new ConvexError("Cannot delete an order linked to a sub-hire");
    }

    const items = await ctx.db.query("supplierOrderItems").withIndex("by_orderId", (q) => q.eq("orderId", a.id)).collect();
    for (const it of items) await ctx.db.delete(it._id);
    await deleteOrderFiles(ctx, a.orgId, a.id);

    await ctx.db.delete(order._id);
    // After the order is gone, so the invoice file is no longer held by it; deleted only if nothing else holds it.
    if (order.invoiceFileId) await deleteStoredFileIfUnreferenced(ctx, a.orgId, order.invoiceFileId);

    await writeActivityLog(ctx, {
      id: a.auditId,
      organizationId: a.orgId,
      action: "DELETE",
      entityType: "supplierOrder",
      entityId: a.id,
      entityName: order.orderNumber,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Deleted order ${order.orderNumber}`,
      createdAt: a.now,
    });

    return { id: a.id };
  },
});

/**
 * attachInvoiceNative / removeInvoiceNative — the order's invoice is a plain 1:1 FK
 * (`invoiceFileId`) rather than a *Media join table (see the schema.ts comment on
 * `supplierOrders.invoiceFileId`), so these mutations own the whole lifecycle
 * directly instead of going through convex/mediaWrites.ts's multi-file dispatch.
 * Gates on `supplier:update` (the order's parent resource). Replacing an existing
 * invoice — or removing one — deletes the superseded file's stored bytes +
 * `storedFiles` record + `fileUploads` row (mirrors files.deleteFile /
 * mediaWrites.removeNative; no ref-counting needed since invoiceFileId is the file's
 * only referrer).
 */
export const attachInvoiceNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), fileId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "supplierOrder");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "supplier", "update");
    const actor = await resolveActor(ctx, a.actor);

    const order = await ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!order || order.organizationId !== a.orgId) throw new ConvexError("Order not found");

    // Re-attaching the file the order already holds is a no-op; any other file must be the actor's own recent
    // upload into the invoice folder, so a replace/remove can only ever delete a file this order just received
    // (never another order's invoice, a check photo or someone else's upload).
    if (order.invoiceFileId !== a.fileId) {
      await assertAttachableUpload(ctx.db, { orgId: a.orgId, actorUserId: actor.userId, fileId: a.fileId, folder: SUPPLIER_INVOICE_FOLDER });
    }

    await ctx.db.patch(order._id, { invoiceFileId: a.fileId, updatedAt: a.now });
    // After the swap, so the superseded file is no longer held by this order; deleted only if nothing else holds it.
    if (order.invoiceFileId && order.invoiceFileId !== a.fileId) {
      await deleteStoredFileIfUnreferenced(ctx, a.orgId, order.invoiceFileId);
    }

    await writeActivityLog(ctx, {
      id: a.auditId,
      organizationId: a.orgId,
      action: "UPDATE",
      entityType: "supplierOrder",
      entityId: a.id,
      entityName: order.orderNumber,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Attached invoice to order ${order.orderNumber}`,
      createdAt: a.now,
    });

    return { id: a.id };
  },
});

export const removeInvoiceNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "supplierOrder");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "supplier", "update");
    const actor = await resolveActor(ctx, a.actor);

    const order = await ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!order || order.organizationId !== a.orgId) throw new ConvexError("Order not found");
    if (!order.invoiceFileId) return { id: a.id }; // idempotent — nothing to remove

    await ctx.db.patch(order._id, { invoiceFileId: undefined, updatedAt: a.now });
    await deleteStoredFileIfUnreferenced(ctx, a.orgId, order.invoiceFileId);

    await writeActivityLog(ctx, {
      id: a.auditId,
      organizationId: a.orgId,
      action: "UPDATE",
      entityType: "supplierOrder",
      entityId: a.id,
      entityName: order.orderNumber,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Removed invoice from order ${order.orderNumber}`,
      createdAt: a.now,
    });

    return { id: a.id };
  },
});

/** An order's PO / docket / other files go with it, stored bytes included (B3). */
async function deleteOrderFiles(ctx: MutationCtx, orgId: string, orderId: string): Promise<void> {
  const files = await ctx.db.query("supplierOrderFiles").withIndex("by_orderId", (q) => q.eq("orderId", orderId)).take(MAX_FILES_PER_ORDER + 1);
  for (const f of files.filter((x) => x.organizationId === orgId)) {
    await ctx.db.delete(f._id);
    await deleteStoredFileIfUnreferenced(ctx, orgId, f.fileId);
  }
}

// ─── Hire return (UX Phase 13, D71) ── `Mark returned` and `Extend hire` ────────────
// Each is ONE field edit recorded by `recordFieldEdit` and reversed by the shared
// `undoFieldEdit` (ids only; refuses outside the server window, for another user, a second
// time, or when the field moved since). `Extend hire` moves ONLY `returnDueDate`: it never
// touches a sub-hire's `hireEnd` (that is our client-facing window, a different date).

const DAY = 24 * 60 * 60 * 1000;
const HIRE_FIELDS = ["returnDueDate", "returnedDate"] as const;

async function loadHireOrder(ctx: MutationCtx, orgId: string, id: string) {
  const order = await ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  if (!order || order.organizationId !== orgId) throw new ConvexError("Order not found");
  return order;
}

function assertOnHire(order: { type?: string; status?: string; returnedDate?: number }) {
  if (order.type !== "SUBHIRE") throw new ConvexError("Only a sub-hire order has a return date.");
  if (order.status !== "RECEIVED" && order.status !== "PARTIAL") throw new ConvexError("The order has not been received, so it is not on hire.");
  if (order.returnedDate != null) throw new ConvexError("This order is already marked returned.");
}

const hireArgs = { id: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() };

export const markReturnedNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { ...hireArgs, returnedDate: v.number() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "supplierOrder");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "supplier", "update");
    const actor = await resolveActor(ctx, a.actor);
    const order = await loadHireOrder(ctx, a.orgId, a.id);
    assertOnHire(order);
    if (order.orderDate != null && a.returnedDate < order.orderDate) throw new ConvexError("It can't have been returned before it was ordered.");
    if (a.returnedDate > Date.now() + DAY) throw new ConvexError("The return date can't be in the future.");
    const diff = diffFields(order, { ...order, returnedDate: a.returnedDate }, HIRE_FIELDS);
    if (!diff) return { id: a.id };
    await ctx.db.patch(order._id, { returnedDate: a.returnedDate, updatedAt: a.now });
    await recordFieldEdit(ctx, { orgId: a.orgId, entityType: "supplierOrder", entityId: a.id, entityName: order.orderNumber, auditId: a.auditId, actor, now: a.now, diff, summary: `Marked order ${order.orderNumber} returned` });
    return { id: a.id };
  },
});

export const extendHireNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { ...hireArgs, returnDueDate: v.number() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "supplierOrder");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "supplier", "update");
    const actor = await resolveActor(ctx, a.actor);
    const order = await loadHireOrder(ctx, a.orgId, a.id);
    assertOnHire(order);
    if (order.returnDueDate != null && a.returnDueDate <= order.returnDueDate) throw new ConvexError("The new return date must be after the current one.");
    if (order.orderDate != null && a.returnDueDate < order.orderDate) throw new ConvexError("The return date can't be before the order date.");
    const diff = diffFields(order, { ...order, returnDueDate: a.returnDueDate }, HIRE_FIELDS);
    if (!diff) return { id: a.id };
    await ctx.db.patch(order._id, { returnDueDate: a.returnDueDate, updatedAt: a.now });
    await recordFieldEdit(ctx, { orgId: a.orgId, entityType: "supplierOrder", entityId: a.id, entityName: order.orderNumber, auditId: a.auditId, actor, now: a.now, diff, summary: `Extended hire on order ${order.orderNumber}` });
    return { id: a.id };
  },
});

/**
 * What an Undo of an order edit may NOT do (UX Phase 13 slice 4 review): the status machine is not bypassed, and an
 * order is never left in a state a forward write could not reach.
 *  - Stepping a status back is a move the machine forbids (RECEIVED and CANCELLED are terminal), so it is allowed only
 *    when the forward write is the LAST thing that happened to the order (`updatedAt` is still what that write stamped:
 *    every later write, a return, an extension, an invoice, bumps it) and nothing hangs off the receipt (no asset linked).
 *  - Whatever the path, the result may not be an order that is not on hire yet still carries a `returnedDate`.
 */
async function assertOrderUndoLegal(
  ctx: MutationCtx,
  order: { _id: unknown; id: string; status?: string; returnedDate?: number; updatedAt?: number },
  plan: { set: Record<string, unknown>; clear: string[] },
  forward: { createdAt?: number } | null,
): Promise<void> {
  const target = typeof plan.set.status === "string" ? plan.set.status : null;
  const from = order.status ?? "DRAFT";
  if (target && !isLegalOrderMove(from, target)) {
    if (order.updatedAt == null || order.updatedAt !== forward?.createdAt) throw new ConvexError({ code: "CHANGED_SINCE", message: "Can't undo: the order was changed since, so its status can't be stepped back." });
    const linked = await ctx.db.query("assets").withIndex("by_supplierOrderId", (q) => q.eq("supplierOrderId", order.id)).first();
    if (linked) throw new ConvexError({ code: "CHANGED_SINCE", message: "Can't undo: an asset was linked to this order since it was received." });
  }
  const status = target ?? from;
  const returned = "returnedDate" in plan.set ? plan.set.returnedDate : plan.clear.includes("returnedDate") ? undefined : order.returnedDate;
  if (!RECEIVED_STATUSES.includes(status) && returned != null) throw new ConvexError({ code: "CHANGED_SINCE", message: "Can't undo: the order was marked returned since, so it can't go back to a status before it was received." });
}

/** The exact Undo of either: ids only (the FORWARD `auditId`); the shared helper refuses as a whole unless it is still exact. */
export const undoHireChangeNative = mutation({
  returns: v.object({ restored: v.array(v.string()) }),
  args: { id: v.string(), orgId: v.string(), forwardAuditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "supplierOrder");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "supplier", "update");
    const actor = await resolveActor(ctx, a.actor);
    const order = await loadHireOrder(ctx, a.orgId, a.id);
    return await undoFieldEdit(ctx, {
      orgId: a.orgId, entityType: "supplierOrder", entityId: a.id, entityName: order.orderNumber, auditId: a.forwardAuditId, actor, now: a.now,
      load: async () => loadHireOrder(ctx, a.orgId, a.id),
      apply: async (doc, plan) => {
        const forward = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", a.forwardAuditId)).first();
        await assertOrderUndoLegal(ctx, doc, plan, forward);
        const patch: Record<string, unknown> = { ...plan.set, updatedAt: a.now };
        for (const f of plan.clear) patch[f] = undefined;
        await ctx.db.patch(doc._id, patch);
      },
    });
  },
});

export const agentOps: AgentOpsAnnotations = {
  markReturnedNative: { danger: "medium" },
  extendHireNative: { danger: "low" },
  undoHireChangeNative: { danger: "medium" },
  // Attaching an invoice is recoverable (removeInvoiceNative / re-attach) — not a
  // financial issue/void action.
  attachInvoiceNative: { danger: "medium" },
  createNative: { danger: "medium" },
  deleteNative: { danger: "high" },
  removeInvoiceNative: { danger: "medium" },
  // RECEIVED/CANCELLED are terminal (VALID_TRANSITIONS has no way out), and RECEIVED
  // is a real-world stock-received event — same lock-lifecycle-sensitive shape as
  // projectWrites.updateStatusNative / subHiresWrites.updateSubHireStatusNative.
  updateNative: { danger: "high" },
};
