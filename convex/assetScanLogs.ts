import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for AssetScanLog (Convex table "assetScanLogs"). GENERATED — Phase 2/5.
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
      .query("assetScanLogs")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: reactive/full-org read (perf design); reviewed, accepted R-9.8 tradeoff — revisit with pagination if per-org rows grow large
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("assetScanLogs").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

/** List scan logs for a project (paginator/scan-log view). Filters org in JS since there's no composite index. */
export const listByProject = query({
  args: { orgId: v.string(), projectId: v.string() },
  handler: async (ctx, { orgId, projectId }) => {
    await requireService(ctx);
    const rows = await ctx.db
      .query("assetScanLogs")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();
    return rows.filter((r) => r.organizationId === orgId);
  },
});

/**
 * Scan logs for ONE kit (via by_kitId), org-filtered. Replaces the org-wide
 * assetScanLogs.list + JS `.filter(kitId === id)` in the getKit composite. Returns
 * raw rows; ordering/limit (scannedAt desc, take 20) stays in the caller.
 */
export const listByKitId = query({
  args: { orgId: v.string(), kitId: v.string() },
  handler: async (ctx, { orgId, kitId }) => {
    await requireService(ctx);
    const rows = await ctx.db
      .query("assetScanLogs")
      .withIndex("by_kitId", (q) => q.eq("kitId", kitId))
      .collect();
    return rows.filter((r) => r.organizationId === orgId);
  },
});

/** List scan logs for a single asset within an org. */
export const listByOrgAndAsset = query({
  args: { orgId: v.string(), assetId: v.string() },
  handler: async (ctx, { orgId, assetId }) => {
    await requireService(ctx);
    const rows = await ctx.db
      .query("assetScanLogs")
      .withIndex("by_assetId", (q) => q.eq("assetId", assetId))
      .collect();
    return rows.filter((r) => r.organizationId === orgId);
  },
});

/** List scan logs for a user (for user-delete cascade). */
export const listByScannedById = query({
  args: { scannedById: v.string() },
  handler: async (ctx, { scannedById }) => {
    await requireService(ctx);
    return await ctx.db
      .query("assetScanLogs")
      .withIndex("by_scannedById", (q) => q.eq("scannedById", scannedById))
      .collect();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    kitId: v.optional(v.string()),
    projectId: v.optional(v.string()),
    action: enums.ScanAction,
    scannedById: v.string(),
    scannedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    location: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("assetScanLogs", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    kitId: v.optional(v.string()),
    projectId: v.optional(v.string()),
    action: enums.ScanAction,
    scannedById: v.string(),
    scannedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    location: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("assetScanLogs").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("assetScanLogs", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      assetId: v.optional(v.string()),
      bulkAssetId: v.optional(v.string()),
      kitId: v.optional(v.string()),
      projectId: v.optional(v.string()),
      action: v.optional(enums.ScanAction),
      scannedById: v.optional(v.string()),
      scannedAt: v.optional(v.number()),
      notes: v.optional(v.string()),
      location: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("assetScanLogs").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("assetScanLogs not found: " + id);
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
    const doc = await ctx.db.query("assetScanLogs").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("assetScanLogs not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
