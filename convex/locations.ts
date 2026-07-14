import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for Location (Convex table "locations"). GENERATED — Phase 2/5.
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
      .query("locations")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

/**
 * Asset + bulk-asset + kit counts per location (locationId → { assets, bulkAssets,
 * kits }) for the locations table — browser-native replacement for the
 * getLocationCounts server action. Tallies every org asset/bulkAsset/kit that has a
 * locationId (parity with the action, no filter). Fetched ONE-SHOT by the table
 * (counts have no liveness need) → not a reactive org-wide subscription (Appendix B).
 */
export const counts = query({
  args: { orgId: v.string() },
  returns: v.record(
    v.string(),
    v.object({ assets: v.number(), bulkAssets: v.number(), kits: v.number() }),
  ),
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    const out: Record<string, { assets: number; bulkAssets: number; kits: number }> = {};
    const ensure = (id: string) => (out[id] ??= { assets: 0, bulkAssets: 0, kits: 0 });

    const assets = await ctx.db
      .query("assets")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
    for (const a of assets) if (a.locationId) ensure(a.locationId).assets++;

    const bulkAssets = await ctx.db
      .query("bulkAssets")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
    for (const b of bulkAssets) if (b.locationId) ensure(b.locationId).bulkAssets++;

    const kits = await ctx.db
      .query("kits")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
    for (const k of kits) if (k.locationId) ensure(k.locationId).kits++;

    return out;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    address: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    type: v.optional(enums.LocationType),
    isDefault: v.optional(v.boolean()),
    parentId: v.optional(v.string()),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("locations", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    address: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    type: v.optional(enums.LocationType),
    isDefault: v.optional(v.boolean()),
    parentId: v.optional(v.string()),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("locations", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      name: v.optional(v.string()),
      address: v.optional(v.string()),
      latitude: v.optional(v.number()),
      longitude: v.optional(v.number()),
      type: v.optional(enums.LocationType),
      isDefault: v.optional(v.boolean()),
      parentId: v.optional(v.string()),
      notes: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("locations not found: " + id);
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
    const doc = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("locations not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
