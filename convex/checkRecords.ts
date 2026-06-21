import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for CheckRecord (Convex table "checkRecords"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (browser writes rejected — RBAC stays in the Next.js server
 * actions, which still own permission/validation/audit). Reads are
 * service-only (not on the browser-readable allowlist). Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54 and docs/designs/convex-phase5-auth-bridge.md.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("checkRecords")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("checkRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

/**
 * All check records for one asset within an org (newest-first sort done in the
 * caller). Backs getCheckHistory's read-rewire to Convex (Phase A). Uses the
 * composite by_organizationId_assetId index.
 */
export const listByOrgAndAsset = query({
  args: { orgId: v.string(), assetId: v.string() },
  handler: async (ctx, { orgId, assetId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("checkRecords")
      .withIndex("by_organizationId_assetId", (q) =>
        q.eq("organizationId", orgId).eq("assetId", assetId),
      )
      .collect();
  },
});

export const listRecentByAssetAndCheckItem = query({
  args: { orgId: v.string(), assetId: v.string(), checkItemId: v.string(), take: v.number() },
  handler: async (ctx, { orgId, assetId, checkItemId, take }) => {
    await requireService(ctx);
    const rows = await ctx.db
      .query("checkRecords")
      .withIndex("by_organizationId_assetId", (q) =>
        q.eq("organizationId", orgId).eq("assetId", assetId),
      )
      .collect();
    return rows
      .filter((r) => r.checkItemId === checkItemId)
      .sort((a, b) => (b.performedAt ?? 0) - (a.performedAt ?? 0))
      .slice(0, take);
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    context: enums.CheckContext,
    lineItemId: v.optional(v.string()),
    lineItemUnitId: v.optional(v.string()),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    kitId: v.optional(v.string()),
    checkItemId: v.string(),
    checkItemLabelSnapshot: v.string(),
    checkItemTypeSnapshot: enums.CheckItemType,
    result: enums.CheckResult,
    value: v.optional(v.string()),
    notes: v.optional(v.string()),
    photos: v.optional(v.array(v.string())),
    performedById: v.string(),
    performedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("checkRecords", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    context: enums.CheckContext,
    lineItemId: v.optional(v.string()),
    lineItemUnitId: v.optional(v.string()),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    kitId: v.optional(v.string()),
    checkItemId: v.string(),
    checkItemLabelSnapshot: v.string(),
    checkItemTypeSnapshot: enums.CheckItemType,
    result: enums.CheckResult,
    value: v.optional(v.string()),
    notes: v.optional(v.string()),
    photos: v.optional(v.array(v.string())),
    performedById: v.string(),
    performedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("checkRecords").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("checkRecords", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      context: v.optional(enums.CheckContext),
      lineItemId: v.optional(v.string()),
      lineItemUnitId: v.optional(v.string()),
      assetId: v.optional(v.string()),
      bulkAssetId: v.optional(v.string()),
      kitId: v.optional(v.string()),
      checkItemId: v.optional(v.string()),
      checkItemLabelSnapshot: v.optional(v.string()),
      checkItemTypeSnapshot: v.optional(enums.CheckItemType),
      result: v.optional(enums.CheckResult),
      value: v.optional(v.string()),
      notes: v.optional(v.string()),
      photos: v.optional(v.array(v.string())),
      performedById: v.optional(v.string()),
      performedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("checkRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("checkRecords not found: " + id);
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
    const doc = await ctx.db.query("checkRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("checkRecords not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
