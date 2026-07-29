import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService, requireOrgPermission, requireOrgReadDocFor } from "./lib/auth";
import * as enums from "./lib/validators";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Thin CRUD for LocationMedia (Convex table "locationMedia"). GENERATED — Phase 2/5.
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
    await requireOrgPermission(ctx, orgId, "location", "read"); // Phase 5 domain slice (#1001) — org-scoped via by_organizationId
    return await ctx.db
      .query("locationMedia")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: aggregation — org-wide primary-media map
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    // No orgId arg — doc-fetch shape (mirrors locations.getById).
    const doc = await ctx.db.query("locationMedia").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDocFor(ctx, doc, "location"); // Phase 5 domain slice (#1001)
    return doc;
  },
});

export const listByParent = query({
  args: { parentId: v.string() },
  handler: async (ctx, { parentId }) => {
    // No orgId arg either — org-check against the parent LOCATION (by_locationId is
    // a global index). Deliberately NOT requireOrgReadDocFor's "doc not found ->
    // nothing to leak" shortcut: what's protected is the MEDIA ROWS under parentId,
    // not the parent doc itself, so an orphaned/missing parent must not silently
    // allow a cross-org read of leftover rows through.
    const parent = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", parentId)).unique();
    await requireOrgPermission(ctx, parent?.organizationId ?? "", "location", "read"); // Phase 5 domain slice (#1001)
    return await ctx.db
      .query("locationMedia")
      .withIndex("by_locationId", (q) => q.eq("locationId", parentId))
      .collect();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    locationId: v.string(),
    fileId: v.string(),
    type: v.optional(enums.MediaType),
    displayName: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("locationMedia", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    locationId: v.string(),
    fileId: v.string(),
    type: v.optional(enums.MediaType),
    displayName: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("locationMedia").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("locationMedia", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      locationId: v.optional(v.string()),
      fileId: v.optional(v.string()),
      type: v.optional(enums.MediaType),
      displayName: v.optional(v.string()),
      sortOrder: v.optional(v.number()),
      createdAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("locationMedia").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("locationMedia not found: " + id);
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
    const doc = await ctx.db.query("locationMedia").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("locationMedia not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ─── agentOps annotations (Phase 5 domain slice, #1001) ──────────────────────
export const agentOps: AgentOpsAnnotations = {
  list: { summary: "List all location media rows visible to the caller's org.", danger: "low", mcpTier: 3 },
  getById: { summary: "Get one location media row by id.", danger: "low", mcpTier: 3 },
  listByParent: { summary: "List media rows attached to one location.", danger: "low", mcpTier: 3 },
};
