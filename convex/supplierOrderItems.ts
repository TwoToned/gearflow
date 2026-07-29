import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Thin CRUD for SupplierOrderItem (Convex table "supplierOrderItems"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (service-only mirror/read helpers; the browser-direct write path with RBAC +
 * validation + audit enforced inside Convex lives in the *Writes.ts mutations — see FEATUREDOCS/54). Reads are
 * service-only (not on the browser-readable allowlist). Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54.
 */

export const list = query({
  args: { orderId: v.string() },
  handler: async (ctx, { orderId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("supplierOrderItems")
      .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("supplierOrderItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

/**
 * Items across many orders in one round trip — for the supplier-orders LIST view
 * which needs an item count per order (no org column; items are order-scoped).
 * HAND-ADDED for the Phase A supplier-orders read-rewiring.
 */
export const listByOrderIds = query({
  args: { orderIds: v.array(v.string()) },
  handler: async (ctx, { orderIds }) => {
    await requireService(ctx);
    const out = [];
    for (const orderId of orderIds) {
      const rows = await ctx.db
        .query("supplierOrderItems")
        .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
        .collect();
      out.push(...rows);
    }
    return out;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    orderId: v.string(),
    description: v.string(),
    quantity: v.optional(v.number()),
    unitPrice: v.optional(v.number()),
    lineTotal: v.optional(v.number()),
    modelId: v.optional(v.string()),
    assetId: v.optional(v.string()),
    notes: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("supplierOrderItems", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    orderId: v.string(),
    description: v.string(),
    quantity: v.optional(v.number()),
    unitPrice: v.optional(v.number()),
    lineTotal: v.optional(v.number()),
    modelId: v.optional(v.string()),
    assetId: v.optional(v.string()),
    notes: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("supplierOrderItems").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("supplierOrderItems", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      orderId: v.optional(v.string()),
      description: v.optional(v.string()),
      quantity: v.optional(v.number()),
      unitPrice: v.optional(v.number()),
      lineTotal: v.optional(v.number()),
      modelId: v.optional(v.string()),
      assetId: v.optional(v.string()),
      notes: v.optional(v.string()),
      sortOrder: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("supplierOrderItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("supplierOrderItems not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("supplierOrderItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("supplierOrderItems not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

export const agentOps: AgentOpsAnnotations = {
  list: {
    agentAccess: "denied",
    reason:
      "supplierOrderItems has no organizationId column and this query takes only an orderId (no orgId to verify) — a PARENT_JOIN table read that can't be safely org-scoped without a signature change; revisit alongside a supplierOrders-joined variant.",
  },
  getById: {
    agentAccess: "denied",
    reason:
      "Doc has no organizationId field (parent-join table), so requireOrgReadDocFor can't check it against the caller's org; would need to resolve the parent order's org first.",
  },
  listByOrderIds: {
    agentAccess: "denied",
    reason:
      "Same parent-join shape as list/getById — no organizationId column and no orgId argument to verify against.",
  },
};
