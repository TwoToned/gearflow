import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for SupplierOrder (Convex table "supplierOrders"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (service-only mirror/read helpers; the browser-direct write path with RBAC +
 * validation + audit enforced inside Convex lives in the *Writes.ts mutations — see FEATUREDOCS/54). Org-scoped reads
 * accept the service token OR a user token scoped to the same org. Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("supplierOrders")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

/**
 * A supplier's orders for the supplier detail table (Phase 3 browser-direct — replaces
 * the getSupplierOrders server action's supplier-scoped read). Newest first, with the
 * project reference + item count each row renders. Scoped to (org, supplier) via the
 * composite index (org-checked implicitly); the project join is org-re-checked.
 */
export const listBySupplier = query({
  args: { orgId: v.string(), supplierId: v.string() },
  handler: async (ctx, { orgId, supplierId }) => {
    await requireOrgRead(ctx, orgId);
    const orders = await ctx.db
      .query("supplierOrders")
      .withIndex("by_organizationId_supplierId", (q) => q.eq("organizationId", orgId).eq("supplierId", supplierId))
      .collect();
    orders.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)); // createdAt desc (default sort)

    const out = [];
    for (const o of orders) {
      const items = await ctx.db.query("supplierOrderItems").withIndex("by_orderId", (q) => q.eq("orderId", o.id)).collect();
      let project: { id: string; name: string; projectNumber: string } | null = null;
      if (o.projectId) {
        const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", o.projectId as string)).first();
        project = p && p.organizationId === orgId ? { id: p.id, name: p.name, projectNumber: p.projectNumber } : null;
      }
      out.push({
        id: o.id,
        orderNumber: o.orderNumber,
        type: o.type,
        status: o.status ?? "DRAFT",
        orderDate: o.orderDate ?? null,
        total: o.total ?? null,
        project,
        _count: { items: items.length },
      });
    }
    return { orders: out, total: out.length };
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    supplierId: v.string(),
    orderNumber: v.string(),
    type: enums.SupplierOrderType,
    status: v.optional(enums.SupplierOrderStatus),
    orderDate: v.optional(v.number()),
    expectedDate: v.optional(v.number()),
    receivedDate: v.optional(v.number()),
    subtotal: v.optional(v.number()),
    taxAmount: v.optional(v.number()),
    total: v.optional(v.number()),
    projectId: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdById: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("supplierOrders", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    supplierId: v.string(),
    orderNumber: v.string(),
    type: enums.SupplierOrderType,
    status: v.optional(enums.SupplierOrderStatus),
    orderDate: v.optional(v.number()),
    expectedDate: v.optional(v.number()),
    receivedDate: v.optional(v.number()),
    subtotal: v.optional(v.number()),
    taxAmount: v.optional(v.number()),
    total: v.optional(v.number()),
    projectId: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdById: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("supplierOrders", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      supplierId: v.optional(v.string()),
      orderNumber: v.optional(v.string()),
      type: v.optional(enums.SupplierOrderType),
      status: v.optional(enums.SupplierOrderStatus),
      orderDate: v.optional(v.number()),
      expectedDate: v.optional(v.number()),
      receivedDate: v.optional(v.number()),
      subtotal: v.optional(v.number()),
      taxAmount: v.optional(v.number()),
      total: v.optional(v.number()),
      projectId: v.optional(v.string()),
      notes: v.optional(v.string()),
      createdById: v.optional(v.string()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("supplierOrders not found: " + id);
    const safePatch = { ...patch };
    delete safePatch.organizationId;
    await ctx.db.patch(doc._id, safePatch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("supplierOrders not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
