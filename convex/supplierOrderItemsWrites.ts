import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { assertStrLen, assertNumRange } from "./lib/fieldGuards";
import { assertRefInOrg } from "./lib/orgRef";
import { recalcOrderTotals } from "./lib/recalcOrderTotals";

/**
 * Native SUPPLIER-ORDER-ITEM write mutations (WS7 #946 — there was previously NO
 * browser path for `supplierOrderItems` at all; the table existed with a schema
 * and a service-only generated CRUD file, but no consumer could add/edit/remove a
 * line item on a purchase order). Mirrors `subHireItems`' add/update/remove/reorder
 * shape in `convex/subHiresWrites.ts` (4 guards + per-row org re-check via the
 * parent order + atomic audit + the money recalc every write funnels through).
 * Gates on `supplier:update` (the order's parent resource — mirrors
 * attachInvoiceNative/removeInvoiceNative; no separate `supplierOrderItem` RBAC
 * resource per the spec decision to stay on `supplier`).
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });
const round = (v: number): number => Math.round(v * 100) / 100;

async function requireOrderInOrg(ctx: MutationCtx, orderId: string, orgId: string): Promise<Doc<"supplierOrders">> {
  const o = await ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", orderId)).first();
  if (!o || o.organizationId !== orgId) throw new ConvexError("Order not found");
  return o;
}

// Shared item-input args (add + update). Exported so the validation-drift guard
// (convex/validationDrift.test.ts, POLICY.md R-8.6.1) can assert this stays in sync
// with `supplierOrderItemSchema` (src/lib/validations/supplier-order.ts).
export const itemFields = {
  description: v.string(),
  quantity: v.number(),
  unitPrice: v.number(),
  modelId: v.optional(v.string()),
  assetId: v.optional(v.string()),
  notes: v.optional(v.string()),
};

/** R-8.6.2: mirror supplierOrderItemSchema's bounds server-side — the client Zod
 *  parse is bypassable by any caller invoking this mutation directly. */
function assertItemFields(a: { description: string; quantity: number; unitPrice: number; notes?: string }): void {
  if (!a.description) throw new ConvexError("Description is required");
  assertStrLen(a.description, "Description", { max: 500 });
  assertNumRange(a.quantity, "Quantity", { min: 1, integer: true });
  assertNumRange(a.unitPrice, "Unit price", { min: 0 });
  assertStrLen(a.notes, "Notes", { max: 1000 });
}

async function logItem(
  ctx: MutationCtx,
  a: { orgId: string; actor: Actor; auditId: string; now: number; action: string; orderId: string; orderNumber: string; summary: string },
): Promise<void> {
  await writeActivityLog(ctx, {
    id: a.auditId,
    organizationId: a.orgId,
    action: a.action,
    entityType: "supplierOrder",
    entityId: a.orderId,
    entityName: a.orderNumber,
    userId: a.actor.userId,
    userName: a.actor.userName,
    summary: a.summary,
    createdAt: a.now,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// addSupplierOrderItemNative — insert item (nextSort over the order's items,
// lineTotal computed server-side = quantity × unitPrice — the client total is
// never trusted, R-9.3) + recalcOrderTotals. supplier:update.
// ─────────────────────────────────────────────────────────────────────────────
export const addSupplierOrderItemNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), orderId: v.string(), ...itemFields, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "supplierOrder");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "supplier", "update");
    const actor = await resolveActor(ctx, a.actor);

    const order = await requireOrderInOrg(ctx, a.orderId, a.orgId);
    assertItemFields(a);
    if (a.modelId) await assertRefInOrg(ctx, "models", a.modelId, a.orgId);
    if (a.assetId) await assertRefInOrg(ctx, "assets", a.assetId, a.orgId);

    // Idempotent retry: same cuid + same parent → skip; a collision with an
    // unrelated item is a hard error. COLLECT all matches (by_cuid is global +
    // non-unique).
    const dups = await ctx.db.query("supplierOrderItems").withIndex("by_cuid", (q) => q.eq("id", a.id)).collect();
    for (const d of dups) if (d.orderId !== a.orderId) throw new ConvexError("Order item already exists");
    if (dups.length > 0) return { id: a.id };

    const existing = await ctx.db.query("supplierOrderItems").withIndex("by_orderId", (q) => q.eq("orderId", a.orderId)).collect();
    const nextSort = existing.reduce((m, r) => Math.max(m, r.sortOrder ?? 0), -1) + 1;

    await ctx.db.insert("supplierOrderItems", {
      id: a.id,
      orderId: a.orderId,
      description: a.description,
      quantity: a.quantity,
      unitPrice: a.unitPrice,
      lineTotal: round(a.quantity * a.unitPrice),
      ...(a.modelId ? { modelId: a.modelId } : {}),
      ...(a.assetId ? { assetId: a.assetId } : {}),
      ...(a.notes ? { notes: a.notes } : {}),
      sortOrder: nextSort,
    });

    await recalcOrderTotals(ctx, a.orderId, a.orgId, a.now);

    await logItem(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now,
      action: "CREATE", orderId: a.orderId, orderNumber: order.orderNumber,
      summary: `Added item "${a.description}" to order ${order.orderNumber}`,
    });

    return { id: a.id };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// updateSupplierOrderItemNative — patch item (modelId/assetId/notes set-or-clear
// unconditionally) + recompute lineTotal + recalcOrderTotals. supplier:update.
// ─────────────────────────────────────────────────────────────────────────────
export const updateSupplierOrderItemNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { itemId: v.string(), orgId: v.string(), ...itemFields, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "supplierOrder");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "supplier", "update");
    const actor = await resolveActor(ctx, a.actor);

    const item = await ctx.db.query("supplierOrderItems").withIndex("by_cuid", (q) => q.eq("id", a.itemId)).first();
    if (!item) throw new ConvexError("Order item not found");
    // The item table carries no org — org-check via the parent order.
    const order = await requireOrderInOrg(ctx, item.orderId, a.orgId);
    assertItemFields(a);
    if (a.modelId) await assertRefInOrg(ctx, "models", a.modelId, a.orgId);
    if (a.assetId) await assertRefInOrg(ctx, "assets", a.assetId, a.orgId);

    await ctx.db.patch(item._id, {
      description: a.description,
      quantity: a.quantity,
      unitPrice: a.unitPrice,
      lineTotal: round(a.quantity * a.unitPrice),
      modelId: a.modelId ? a.modelId : undefined,
      assetId: a.assetId ? a.assetId : undefined,
      notes: a.notes ? a.notes : undefined,
    });

    await recalcOrderTotals(ctx, item.orderId, a.orgId, a.now);

    await logItem(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now,
      action: "UPDATE", orderId: item.orderId, orderNumber: order.orderNumber,
      summary: `Updated item "${a.description}" on order ${order.orderNumber}`,
    });

    return { id: a.itemId };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// removeSupplierOrderItemNative — delete item + recalcOrderTotals. supplier:update.
// ─────────────────────────────────────────────────────────────────────────────
export const removeSupplierOrderItemNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { itemId: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "supplierOrder");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "supplier", "update");
    const actor = await resolveActor(ctx, a.actor);

    const item = await ctx.db.query("supplierOrderItems").withIndex("by_cuid", (q) => q.eq("id", a.itemId)).first();
    if (!item) throw new ConvexError("Order item not found");
    const order = await requireOrderInOrg(ctx, item.orderId, a.orgId);

    await ctx.db.delete(item._id);
    await recalcOrderTotals(ctx, item.orderId, a.orgId, a.now);

    await logItem(ctx, {
      orgId: a.orgId, actor, auditId: a.auditId, now: a.now,
      action: "DELETE", orderId: item.orderId, orderNumber: order.orderNumber,
      summary: `Removed item from order ${order.orderNumber}`,
    });

    return { id: a.itemId };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// reorderSupplierOrderItemsNative — sortOrder = index per id (org via the parent
// order + item.orderId match). Empty → no-op. NO recalc (reordering doesn't change
// money), NO audit (parity with reorderSubHireItemsNative). supplier:update.
// ─────────────────────────────────────────────────────────────────────────────
export const reorderSupplierOrderItemsNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: { orgId: v.string(), orderId: v.string(), itemIds: v.array(v.string()), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "supplierOrder");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "supplier", "update");
    await resolveActor(ctx, a.actor);
    if (a.itemIds.length === 0) return { ok: true };

    await requireOrderInOrg(ctx, a.orderId, a.orgId);

    for (let i = 0; i < a.itemIds.length; i++) {
      const doc = await ctx.db.query("supplierOrderItems").withIndex("by_cuid", (q) => q.eq("id", a.itemIds[i])).first();
      if (doc && doc.orderId === a.orderId) {
        await ctx.db.patch(doc._id, { sortOrder: i });
      }
    }
    return { ok: true };
  },
});
