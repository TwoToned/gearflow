import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import * as enums from "./lib/validators";

/**
 * Native SUPPLIER-ORDER write mutations (Phase 3 browser-direct — replaces the
 * createSupplierOrder server action in src/server/supplier-orders.ts). Only create is
 * live (the update/status/delete + item CRUD server actions were dead — 0 consumers —
 * and were dropped with the file). Gates on `supplier:create`. Standard shape: 4 guards
 * + per-row org re-check on the supplier + atomic audit. The form's supplierOrderSchema
 * validates before submit; dates arrive as epoch-ms from the hook.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

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
