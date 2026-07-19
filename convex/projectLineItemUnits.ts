import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for ProjectLineItemUnit (Convex table "projectLineItemUnits"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (service-only mirror/read helpers; the browser-direct write path with RBAC +
 * validation + audit enforced inside Convex lives in the *Writes.ts mutations — see FEATUREDOCS/54). Reads are
 * service-only (not on the browser-readable allowlist). Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("projectLineItemUnits")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: reactive/full-org read (perf design); reviewed, accepted R-9.8 tradeoff — revisit with pagination if per-org rows grow large
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

/**
 * Units for ONE asset within an org (all statuses), via the
 * `by_organizationId_assetId_status` index — replaces a whole-org
 * `projectLineItemUnits.list` + JS `.filter(u => u.assetId === …)` on the
 * add-line-item double-booking check.
 */
export const listByOrgAndAsset = query({
  args: { orgId: v.string(), assetId: v.string() },
  handler: async (ctx, { orgId, assetId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("projectLineItemUnits")
      .withIndex("by_organizationId_assetId_status", (q) => q.eq("organizationId", orgId).eq("assetId", assetId))
      .collect();
  },
});

export const listByLineItem = query({
  args: { lineItemId: v.string() },
  handler: async (ctx, { lineItemId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("projectLineItemUnits")
      .withIndex("by_lineItemId", (q) => q.eq("lineItemId", lineItemId))
      .collect();
  },
});

/**
 * Batch variant of {@link listByLineItem}: collect units for many line items in
 * one round-trip (N index scans, server-side). Feeds the Phase A line-item-tree
 * reconstruction (`src/lib/project-line-item-read.ts`) — a project's units are
 * fetched by its line-item ids rather than an org-wide collect. Service-only,
 * matching the rest of this module's reads.
 */
export const listByLineItemIds = query({
  args: { lineItemIds: v.array(v.string()) },
  handler: async (ctx, { lineItemIds }) => {
    await requireService(ctx);
    const out = [];
    for (const lineItemId of lineItemIds) {
      const rows = await ctx.db
        .query("projectLineItemUnits")
        .withIndex("by_lineItemId", (q) => q.eq("lineItemId", lineItemId))
        .collect();
      out.push(...rows);
    }
    return out;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    lineItemId: v.string(),
    ordinal: v.number(),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    parentUnitAssetId: v.optional(v.string()),
    quantity: v.optional(v.number()),
    returnedQuantity: v.optional(v.number()),
    status: v.optional(enums.LineItemStatus),
    prepStatus: v.optional(enums.PrepStatus),
    prepContainer: v.optional(v.string()),
    checkedOutAt: v.optional(v.number()),
    checkedOutById: v.optional(v.string()),
    returnedAt: v.optional(v.number()),
    returnedById: v.optional(v.string()),
    returnCondition: v.optional(enums.ReturnCondition),
    returnStatus: v.optional(enums.ReturnStatus),
    returnNotes: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("projectLineItemUnits", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    lineItemId: v.string(),
    ordinal: v.number(),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    parentUnitAssetId: v.optional(v.string()),
    quantity: v.optional(v.number()),
    returnedQuantity: v.optional(v.number()),
    status: v.optional(enums.LineItemStatus),
    prepStatus: v.optional(enums.PrepStatus),
    prepContainer: v.optional(v.string()),
    checkedOutAt: v.optional(v.number()),
    checkedOutById: v.optional(v.string()),
    returnedAt: v.optional(v.number()),
    returnedById: v.optional(v.string()),
    returnCondition: v.optional(enums.ReturnCondition),
    returnStatus: v.optional(enums.ReturnStatus),
    returnNotes: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("projectLineItemUnits", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      lineItemId: v.optional(v.string()),
      ordinal: v.optional(v.number()),
      assetId: v.optional(v.string()),
      bulkAssetId: v.optional(v.string()),
      parentUnitAssetId: v.optional(v.string()),
      quantity: v.optional(v.number()),
      returnedQuantity: v.optional(v.number()),
      status: v.optional(enums.LineItemStatus),
      prepStatus: v.optional(enums.PrepStatus),
      prepContainer: v.optional(v.string()),
      checkedOutAt: v.optional(v.number()),
      checkedOutById: v.optional(v.string()),
      returnedAt: v.optional(v.number()),
      returnedById: v.optional(v.string()),
      returnCondition: v.optional(enums.ReturnCondition),
      returnStatus: v.optional(enums.ReturnStatus),
      returnNotes: v.optional(v.string()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("projectLineItemUnits not found: " + id);
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
    const doc = await ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("projectLineItemUnits not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
