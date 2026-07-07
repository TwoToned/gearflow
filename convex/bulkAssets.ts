import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import { bumpCountersForTable } from "./lib/counters";
import { adjustBulkAvailability } from "./lib/inventory";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for BulkAsset (Convex table "bulkAssets"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (browser writes rejected — RBAC stays in the Next.js server
 * actions, which still own permission/validation/audit). Org-scoped reads
 * accept the service token OR a user token scoped to the same org. Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54 and docs/designs/convex-phase5-auth-bridge.md.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("bulkAssets")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

export const getByAssetTag = query({
  args: { organizationId: v.string(), assetTag: v.string() },
  handler: async (ctx, { organizationId, assetTag }) => {
    await requireOrgRead(ctx, organizationId);
    return await ctx.db
      .query("bulkAssets")
      .withIndex("by_organizationId_assetTag", (q) => q.eq("organizationId", organizationId).eq("assetTag", assetTag))
      .unique();
  },
});

export const listByModel = query({
  args: { modelId: v.string(), orgId: v.string() },
  handler: async (ctx, { modelId, orgId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("bulkAssets")
      .withIndex("by_modelId", (q) => q.eq("modelId", modelId))
      .collect();
  },
});

/**
 * Batch the per-model `by_modelId` scans for MANY models into ONE round-trip —
 * the bulk-asset counterpart of assets.listByModelIds, killing the per-model N+1
 * in availability. Deduped + capped; org-filtered.
 */
export const listByModelIds = query({
  args: { orgId: v.string(), modelIds: v.array(v.string()) },
  handler: async (ctx, { orgId, modelIds }) => {
    await requireOrgRead(ctx, orgId);
    const unique = [...new Set(modelIds)];
    if (unique.length > 1000) throw new ConvexError("bulkAssets.listByModelIds: too many modelIds (max 1000)");
    const groups = await Promise.all(
      unique.map((mid) => ctx.db.query("bulkAssets").withIndex("by_modelId", (q) => q.eq("modelId", mid)).collect()),
    );
    return groups.flat().filter((b) => b.organizationId === orgId);
  },
});

/**
 * Batch point-read bulk assets by cuid, scoped to one org — the bulk-asset
 * counterpart of assets.listByIds, so a detail composite reads only its members
 * instead of getBulkAssetsByOrg. Cross-org ids are dropped.
 */
export const listByIds = query({
  args: { orgId: v.string(), ids: v.array(v.string()) },
  handler: async (ctx, { orgId, ids }) => {
    await requireOrgRead(ctx, orgId);
    const unique = [...new Set(ids)];
    if (unique.length > 1000) throw new ConvexError("bulkAssets.listByIds: too many ids (max 1000)");
    const docs = await Promise.all(
      unique.map((id) => ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique()),
    );
    return docs.filter((d): d is NonNullable<typeof d> => d !== null && d.organizationId === orgId);
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    assetTag: v.string(),
    totalQuantity: v.optional(v.number()),
    availableQuantity: v.optional(v.number()),
    purchasePricePerUnit: v.optional(v.number()),
    locationId: v.optional(v.string()),
    status: v.optional(enums.BulkAssetStatus),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const _id = await ctx.db.insert("bulkAssets", args);
    await bumpCountersForTable(ctx, "bulkAssets", null, args);
    return _id;
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    assetTag: v.string(),
    totalQuantity: v.optional(v.number()),
    availableQuantity: v.optional(v.number()),
    purchasePricePerUnit: v.optional(v.number()),
    locationId: v.optional(v.string()),
    status: v.optional(enums.BulkAssetStatus),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("bulkAssets", args);
    await bumpCountersForTable(ctx, "bulkAssets", null, args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      modelId: v.optional(v.string()),
      assetTag: v.optional(v.string()),
      totalQuantity: v.optional(v.number()),
      availableQuantity: v.optional(v.number()),
      purchasePricePerUnit: v.optional(v.number()),
      locationId: v.optional(v.string()),
      status: v.optional(enums.BulkAssetStatus),
      notes: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      isActive: v.optional(v.boolean()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("bulkAssets not found: " + id);
    const safePatch = { ...patch };
    delete safePatch.organizationId;
    await ctx.db.patch(doc._id, safePatch);
    await bumpCountersForTable(ctx, "bulkAssets", doc, { ...doc, ...safePatch });
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("bulkAssets not found: " + id);
    await ctx.db.delete(doc._id);
    await bumpCountersForTable(ctx, "bulkAssets", doc, null);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// ── CUSTOM (Phase C — core mega-flip) — re-add on regen ──────────────────────
// ─────────────────────────────────────────────────────────────────────────────

const NEVER_CLEAR = new Set(["id", "organizationId", "modelId", "assetTag"]);

/**
 * Clear-to-null patch (the crewMembers.patchMember pattern): `set` applies values,
 * every field name in `clear[]` is removed from the doc (the generated `update`
 * can't unset an optional field — toConvexDoc drops nulls before the wire).
 */
export const patchBulkAsset = mutation({
  args: {
    id: v.string(),
    set: v.object({
      modelId: v.optional(v.string()),
      assetTag: v.optional(v.string()),
      totalQuantity: v.optional(v.number()),
      availableQuantity: v.optional(v.number()),
      purchasePricePerUnit: v.optional(v.number()),
      locationId: v.optional(v.string()),
      status: v.optional(enums.BulkAssetStatus),
      notes: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      isActive: v.optional(v.boolean()),
      updatedAt: v.optional(v.number()),
    }),
    clear: v.array(v.string()),
  },
  handler: async (ctx, { id, set, clear }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("bulkAssets not found: " + id);
    if (clear.length === 0) {
      await ctx.db.patch(doc._id, set);
      await bumpCountersForTable(ctx, "bulkAssets", doc, { ...doc, ...set });
      return doc._id;
    }
    const { _id, _creationTime, ...rest } = doc;
    const merged: Record<string, unknown> = { ...rest, ...set };
    for (const k of clear) {
      if (NEVER_CLEAR.has(k)) continue;
      delete merged[k];
    }
    await ctx.db.replace(doc._id, merged as typeof rest);
    await bumpCountersForTable(ctx, "bulkAssets", doc, merged);
    return doc._id;
  },
});

/**
 * Atomic availability adjustment(s) — the kit/accessory checkout primitive.
 * delta<0 consumes (guarded), delta>0 releases. Throws ConvexError (rolls the
 * mutation back) on insufficient stock / cross-org / missing. See lib/inventory.ts.
 */
export const adjustAvailability = mutation({
  args: {
    organizationId: v.string(),
    adjustments: v.array(v.object({ bulkAssetId: v.string(), delta: v.number() })),
  },
  handler: async (ctx, { organizationId, adjustments }) => {
    await requireService(ctx);
    await adjustBulkAvailability(ctx, organizationId, adjustments);
  },
});
