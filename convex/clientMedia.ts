import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService, requireOrgPermission } from "./lib/auth";
import * as enums from "./lib/validators";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Thin CRUD for ClientMedia (Convex table "clientMedia"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (service-only mirror/read helpers; the browser-direct write path with RBAC +
 * validation + audit enforced inside Convex lives in the *Writes.ts mutations — see FEATUREDOCS/54).
 * Lookups use the cuid (`id`) via by_cuid. See FEATUREDOCS/54.
 *
 * Part B triage (#1001 Phase 5): `list` is a plain org-scoped read (org-keyed index,
 * `orgId` argument to check) — widened to `requireOrgPermission`. `getById` /
 * `listByParent` are NOT widened: neither takes an `orgId` argument, and both fetch via
 * a GLOBAL index (`by_cuid` / `by_clientId`) with no org re-check on the returned row(s)
 * — opening them as-is would let an agent in one org read another org's client media by
 * guessing/enumerating a media id or client id (R-8.4.3 IDOR). See `agentOps` below.
 */

export const agentOps: AgentOpsAnnotations = {
  list: { summary: "List a client's media metadata for the org.", danger: "low", mcpTier: 3 },
  getById: { agentAccess: "denied", reason: "Fetches by global cuid index with no orgId argument to check against; opening it risks a cross-tenant read (R-8.4.3)." },
  listByParent: { agentAccess: "denied", reason: "Fetches by global by_clientId index with no orgId argument to check against; opening it risks a cross-tenant read (R-8.4.3)." },
};

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgPermission(ctx, orgId, "client", "read");
    return await ctx.db
      .query("clientMedia")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: aggregation — org-wide primary-media map — see docs/exceptions.md R-8.3.3
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("clientMedia").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

export const listByParent = query({
  args: { parentId: v.string() },
  handler: async (ctx, { parentId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("clientMedia")
      .withIndex("by_clientId", (q) => q.eq("clientId", parentId))
      .collect();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    clientId: v.string(),
    fileId: v.string(),
    type: v.optional(enums.MediaType),
    displayName: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("clientMedia", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    clientId: v.string(),
    fileId: v.string(),
    type: v.optional(enums.MediaType),
    displayName: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("clientMedia").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("clientMedia", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      clientId: v.optional(v.string()),
      fileId: v.optional(v.string()),
      type: v.optional(enums.MediaType),
      displayName: v.optional(v.string()),
      sortOrder: v.optional(v.number()),
      createdAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("clientMedia").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("clientMedia not found: " + id);
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
    const doc = await ctx.db.query("clientMedia").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("clientMedia not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
