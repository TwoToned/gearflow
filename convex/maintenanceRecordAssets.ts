import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * Thin CRUD for MaintenanceRecordAsset (Convex table "maintenanceRecordAssets"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (service-only mirror/read helpers; the browser-direct write path with RBAC +
 * validation + audit enforced inside Convex lives in the *Writes.ts mutations — see FEATUREDOCS/54). Reads are
 * service-only (not on the browser-readable allowlist). Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54.
 */

export const list = query({
  args: { maintenanceRecordId: v.string() },
  handler: async (ctx, { maintenanceRecordId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("maintenanceRecordAssets")
      .withIndex("by_maintenanceRecordId", (q) => q.eq("maintenanceRecordId", maintenanceRecordId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("maintenanceRecordAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

/**
 * Join rows for many maintenance records in one round trip. The maintenance reads
 * (`attachJoins`, `getRecentActivity`) need the asset links for a whole result set;
 * fetching per-record would be N round trips. HAND-ADDED for Phase B write
 * inversion (bucket-2 maintenance-join).
 */
export const listByMaintenanceRecordIds = query({
  args: { maintenanceRecordIds: v.array(v.string()) },
  handler: async (ctx, { maintenanceRecordIds }) => {
    await requireService(ctx);
    const out = [];
    for (const recordId of maintenanceRecordIds) {
      const rows = await ctx.db
        .query("maintenanceRecordAssets")
        .withIndex("by_maintenanceRecordId", (q) => q.eq("maintenanceRecordId", recordId))
        .collect();
      out.push(...rows);
    }
    return out;
  },
});

/**
 * Join rows for many assets in one round trip — the `releaseAssets` "is any other
 * active record still holding this asset?" cross-check (old Prisma
 * `findMany({ where: { assetId: { in } } })`). The record-status side of that
 * `where` (maintenanceRecord.status IN holding) is re-applied in JS by the caller
 * against the Convex record rows. HAND-ADDED for Phase B write inversion.
 */
export const listByAssetIds = query({
  args: { assetIds: v.array(v.string()) },
  handler: async (ctx, { assetIds }) => {
    await requireService(ctx);
    const out = [];
    for (const assetId of assetIds) {
      const rows = await ctx.db
        .query("maintenanceRecordAssets")
        .withIndex("by_assetId", (q) => q.eq("assetId", assetId))
        .collect();
      out.push(...rows);
    }
    return out;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    maintenanceRecordId: v.string(),
    assetId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("maintenanceRecordAssets", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    maintenanceRecordId: v.string(),
    assetId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("maintenanceRecordAssets").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("maintenanceRecordAssets", args);
    return { _id, created: true };
  },
});

/**
 * Create many maintenance→asset links in ONE round trip (bulk single-call invariant —
 * linking N assets to a record is one user action; the server was looping `create` per
 * asset). Idempotent per `id`. maintenanceRecordAssets have no org column (they are
 * parent-scoped), so defense-in-depth: every distinct `maintenanceRecordId` is verified
 * to belong to `organizationId` before ANY insert (fail-closed via `.unique()`; a bad
 * parent aborts the whole batch — a record's link set is a single logical write).
 */
export const createManyIfMissing = mutation({
  args: {
    organizationId: v.string(),
    links: v.array(
      v.object({ id: v.string(), maintenanceRecordId: v.string(), assetId: v.string() }),
    ),
  },
  handler: async (ctx, { organizationId, links }) => {
    await requireService(ctx);

    const verifiedParents = new Map<string, boolean>();
    for (const link of links) {
      if (!verifiedParents.has(link.maintenanceRecordId)) {
        const parent = await ctx.db
          .query("maintenanceRecords")
          .withIndex("by_cuid", (q) => q.eq("id", link.maintenanceRecordId))
          .unique();
        const ok = !!parent && parent.organizationId === organizationId;
        verifiedParents.set(link.maintenanceRecordId, ok);
        if (!ok) {
          throw new ConvexError(
            "Forbidden: maintenance record not found in organization: " + link.maintenanceRecordId,
          );
        }
      }
    }

    let created = 0;
    for (const link of links) {
      const existing = await ctx.db
        .query("maintenanceRecordAssets")
        .withIndex("by_cuid", (q) => q.eq("id", link.id))
        .unique();
      if (existing) continue;
      await ctx.db.insert("maintenanceRecordAssets", link);
      created += 1;
    }
    return { created };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      maintenanceRecordId: v.optional(v.string()),
      assetId: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("maintenanceRecordAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("maintenanceRecordAssets not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("maintenanceRecordAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("maintenanceRecordAssets not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
