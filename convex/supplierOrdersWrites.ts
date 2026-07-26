import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { assertStrLen } from "./lib/fieldGuards";
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

    await writeActivityLog(ctx, {
      id: a.auditId,
      organizationId: a.orgId,
      action: "CREATE",
      entityType: "supplierOrder",
      entityId: a.id,
      entityName: a.orderNumber,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Created order ${a.orderNumber}`,
      createdAt: a.now,
    });

    return { id: a.id };
  },
});

// ─── Status machine (WS7 #946) ── DRAFT -> ORDERED -> PARTIAL -> RECEIVED, with
// CANCELLED reachable from any active (non-terminal) state. RECEIVED/CANCELLED
// are terminal — mirrors the VALID_TRANSITIONS pattern in subHiresWrites.ts.
const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["ORDERED", "CANCELLED"],
  ORDERED: ["PARTIAL", "RECEIVED", "CANCELLED"],
  PARTIAL: ["RECEIVED", "CANCELLED"],
  RECEIVED: [],
  CANCELLED: [],
};

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
    if (a.status !== previousStatus) {
      const validTargets = VALID_TRANSITIONS[previousStatus] ?? [];
      if (!validTargets.includes(a.status)) {
        throw new ConvexError(`Cannot transition from ${previousStatus} to ${a.status}`);
      }
    }

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

    await writeActivityLog(ctx, {
      id: a.auditId,
      organizationId: a.orgId,
      action: "UPDATE",
      entityType: "supplierOrder",
      entityId: a.id,
      entityName: order.orderNumber,
      userId: actor.userId,
      userName: actor.userName,
      summary: a.status !== previousStatus
        ? `Changed order ${order.orderNumber} status to ${a.status}`
        : `Updated order ${order.orderNumber}`,
      createdAt: a.now,
    });

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
    if (order.invoiceFileId) await deleteFileById(ctx, order.invoiceFileId, a.orgId);

    await ctx.db.delete(order._id);

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

    const file = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", a.fileId)).first();
    if (!file || file.organizationId !== a.orgId) throw new ConvexError("File not found");

    if (order.invoiceFileId && order.invoiceFileId !== a.fileId) {
      await deleteFileById(ctx, order.invoiceFileId, a.orgId);
    }

    await ctx.db.patch(order._id, { invoiceFileId: a.fileId, updatedAt: a.now });

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

    await deleteFileById(ctx, order.invoiceFileId, a.orgId);
    await ctx.db.patch(order._id, { invoiceFileId: undefined, updatedAt: a.now });

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

/** Delete a fileUploads row + its stored bytes/storedFiles record (org re-checked). */
async function deleteFileById(ctx: MutationCtx, fileId: string, orgId: string): Promise<void> {
  const file = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", fileId)).first();
  if (!file || file.organizationId !== orgId) return;
  const rec = await ctx.db.query("storedFiles").withIndex("by_storageId", (q) => q.eq("storageId", file.storageKey)).unique();
  if (rec) await ctx.db.delete(rec._id);
  try {
    await ctx.storage.delete(file.storageKey as Id<"_storage">);
  } catch {
    // already gone — idempotent
  }
  await ctx.db.delete(file._id);
}
