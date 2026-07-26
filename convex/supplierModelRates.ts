import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for SupplierModelRate (Convex table "supplierModelRates"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (service-only mirror/read helpers; the browser-direct write path with RBAC +
 * validation + audit enforced inside Convex lives in the *Writes.ts mutations — see FEATUREDOCS/54). Reads are
 * service-only (not on the browser-readable allowlist). Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54.
 */

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("supplierModelRates").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    supplierId: v.string(),
    modelId: v.string(),
    lastUnitCost: v.number(),
    pricingType: v.optional(enums.PricingType),
    lastUsedAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("supplierModelRates", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    supplierId: v.string(),
    modelId: v.string(),
    lastUnitCost: v.number(),
    pricingType: v.optional(enums.PricingType),
    lastUsedAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("supplierModelRates").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("supplierModelRates", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      supplierId: v.optional(v.string()),
      modelId: v.optional(v.string()),
      lastUnitCost: v.optional(v.number()),
      pricingType: v.optional(enums.PricingType),
      lastUsedAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("supplierModelRates").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("supplierModelRates not found: " + id);
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
    const doc = await ctx.db.query("supplierModelRates").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("supplierModelRates not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

export const getByComposite = query({
  args: { organizationId: v.string(), supplierId: v.string(), modelId: v.string() },
  handler: async (ctx, { organizationId, supplierId, modelId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("supplierModelRates")
      .withIndex("by_organizationId_supplierId_modelId", (q) =>
        q.eq("organizationId", organizationId).eq("supplierId", supplierId).eq("modelId", modelId),
      )
      .unique();
  },
});

export const listByModel = query({
  args: { organizationId: v.string(), modelId: v.string() },
  handler: async (ctx, { organizationId, modelId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("supplierModelRates")
      .withIndex("by_organizationId_modelId", (q) =>
        q.eq("organizationId", organizationId).eq("modelId", modelId),
      )
      .collect();
  },
});
