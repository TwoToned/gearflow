import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService, requireOrgPermission } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Thin CRUD for ModelBulkAccessory (Convex table "modelBulkAccessories"). GENERATED — Phase 2/5.
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
    return await ctx.db.query("modelBulkAccessories").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    bulkAssetId: v.string(),
    quantity: v.number(),
    sortOrder: v.optional(v.number()),
    notes: v.optional(v.string()),
    addedAt: v.optional(v.number()),
    addedById: v.string(),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("modelBulkAccessories", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    bulkAssetId: v.string(),
    quantity: v.number(),
    sortOrder: v.optional(v.number()),
    notes: v.optional(v.string()),
    addedAt: v.optional(v.number()),
    addedById: v.string(),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("modelBulkAccessories").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("modelBulkAccessories", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      modelId: v.optional(v.string()),
      bulkAssetId: v.optional(v.string()),
      quantity: v.optional(v.number()),
      sortOrder: v.optional(v.number()),
      notes: v.optional(v.string()),
      addedAt: v.optional(v.number()),
      addedById: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("modelBulkAccessories").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("modelBulkAccessories not found: " + id);
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
    const doc = await ctx.db.query("modelBulkAccessories").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("modelBulkAccessories not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

/**
 * All accessories for a model + org, sorted by sortOrder, with the bulk asset's
 * modelId and assetTag attached (N+1 but bounded — typically < 20 per model).
 */
export const listByModelId = query({
  args: { modelId: v.string(), organizationId: v.string() },
  handler: async (ctx, { modelId, organizationId }) => {
    await requireOrgPermission(ctx, organizationId, "model", "read"); // Phase 5 SERVICE-only triage widen (#1001)
    const rows = await ctx.db
      .query("modelBulkAccessories")
      .withIndex("by_modelId", (q) => q.eq("modelId", modelId))
      .filter((q) => q.eq(q.field("organizationId"), organizationId))
      .collect();
    rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    return await Promise.all(
      rows.map(async (row) => {
        const bulkAsset = await ctx.db
          .query("bulkAssets")
          .withIndex("by_cuid", (q) => q.eq("id", row.bulkAssetId))
          .unique();
        return { ...row, bulkAssetModelId: bulkAsset?.modelId ?? null, bulkAssetAssetTag: bulkAsset?.assetTag ?? null };
      }),
    );
  },
});

/** Check for an existing (modelId, bulkAssetId) pair within an org. */
export const getByModelAndBulkAsset = query({
  args: { modelId: v.string(), bulkAssetId: v.string(), organizationId: v.string() },
  handler: async (ctx, { modelId, bulkAssetId, organizationId }) => {
    await requireOrgPermission(ctx, organizationId, "model", "read"); // Phase 5 SERVICE-only triage widen (#1001)
    return await ctx.db
      .query("modelBulkAccessories")
      .withIndex("by_modelId_bulkAssetId", (q) => q.eq("modelId", modelId).eq("bulkAssetId", bulkAssetId))
      .filter((q) => q.eq(q.field("organizationId"), organizationId))
      .first();
  },
});

// ─── agentOps annotations (Phase 5 domain slice, #1001) ──────────────────────
// Triage: `listByModelId` and `getByModelAndBulkAsset` both take `organizationId`
// directly, so they widen cleanly. `getById` does NOT — it fetches by a global
// by_cuid index with no org argument to check against; widening it would need a
// parent-derivation step rather than the plain guard swap this triage covers.
export const agentOps: AgentOpsAnnotations = {
  getById: { agentAccess: "denied", reason: "No orgId/organizationId arg; fetched by a global by_cuid index with no org check to swap in without a parent-derivation step — revisit." },
  listByModelId: { summary: "List a model's bulk accessories (with bulk-asset assetTag/modelId attached), sorted by sortOrder.", danger: "low", mcpTier: 2 },
  getByModelAndBulkAsset: { summary: "Look up one model-accessory join row by (model, bulk asset) pair.", danger: "low", mcpTier: 3 },
};
