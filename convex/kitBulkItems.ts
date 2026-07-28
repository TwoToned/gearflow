import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService, requireOrgPermission, requireOrgReadDocFor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Thin CRUD for KitBulkItem (Convex table "kitBulkItems"). GENERATED — Phase 2/5.
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
    await requireOrgPermission(ctx, orgId, "kit", "read"); // Phase 5 domain slice (#1001) — org-scoped via by_organizationId
    return await ctx.db
      .query("kitBulkItems")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: reactive/full-org read (perf design); reviewed, accepted R-9.8 tradeoff — revisit with pagination if per-org rows grow large — see docs/exceptions.md R-8.3.3
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    // No orgId arg — doc-fetch shape (mirrors kits.getById).
    const doc = await ctx.db.query("kitBulkItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDocFor(ctx, doc, "kit"); // Phase 5 domain slice (#1001)
    return doc;
  },
});

/** Cross-org GDPR sweep lookup — mirrors assetScanLogs.listByScannedById/testTagRecords.listByTestedById.
 *  NOT org-scoped by design (see agentOps denial below). */
export const listByAddedById = query({
  args: { addedById: v.string() },
  handler: async (ctx, { addedById }) => {
    await requireService(ctx);
    return await ctx.db
      .query("kitBulkItems")
      .withIndex("by_addedById", (q) => q.eq("addedById", addedById))
      .collect();
  },
});

/**
 * Kit bulk-item members for ONE kit (via by_kitId), org-filtered. Replaces
 * getKitBulkItemsByOrg + JS `.filter(kitId === id)` in the getKit composite.
 */
export const listByKitId = query({
  args: { orgId: v.string(), kitId: v.string() },
  handler: async (ctx, { orgId, kitId }) => {
    await requireOrgPermission(ctx, orgId, "kit", "read"); // Phase 5 domain slice (#1001) — result is JS-filtered to this orgId below
    const rows = await ctx.db
      .query("kitBulkItems")
      .withIndex("by_kitId", (q) => q.eq("kitId", kitId))
      .collect();
    return rows.filter((r) => r.organizationId === orgId);
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    kitId: v.string(),
    bulkAssetId: v.string(),
    quantity: v.number(),
    position: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    addedAt: v.optional(v.number()),
    addedById: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("kitBulkItems", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    kitId: v.string(),
    bulkAssetId: v.string(),
    quantity: v.number(),
    position: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    addedAt: v.optional(v.number()),
    addedById: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("kitBulkItems").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("kitBulkItems", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      kitId: v.optional(v.string()),
      bulkAssetId: v.optional(v.string()),
      quantity: v.optional(v.number()),
      position: v.optional(v.string()),
      sortOrder: v.optional(v.number()),
      addedAt: v.optional(v.number()),
      addedById: v.optional(v.string()),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("kitBulkItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("kitBulkItems not found: " + id);
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
    const doc = await ctx.db.query("kitBulkItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("kitBulkItems not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ─── agentOps annotations (Phase 5 domain slice, #1001) ──────────────────────
export const agentOps: AgentOpsAnnotations = {
  list: { summary: "List all kit bulk-item memberships visible to the caller's org.", danger: "low", mcpTier: 3 },
  getById: { summary: "Get one kit bulk-item membership row by id.", danger: "low", mcpTier: 3 },
  listByKitId: { summary: "List bulk-item members of one kit.", danger: "low", mcpTier: 2 },
  listByAddedById: {
    agentAccess: "denied",
    reason: "Cross-org GDPR-cascade lookup by addedById with no org filter at all — an internal user-delete helper, not a real read surface.",
  },
};
