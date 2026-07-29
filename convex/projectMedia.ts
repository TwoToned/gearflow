import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService, requireOrgPermission } from "./lib/auth";
import * as enums from "./lib/validators";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Thin CRUD for ProjectMedia (Convex table "projectMedia"). GENERATED — Phase 2/5.
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
    // Widened (Phase 5 domain slice, #1001): org-scoped read of media METADATA
    // (fileId/type/displayName/sortOrder), no special sensitivity — org-scoped via
    // by_organizationId. Actual file bytes are gated separately by files.ts/storage.
    await requireOrgPermission(ctx, orgId, "project", "read");
    return await ctx.db
      .query("projectMedia")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: aggregation — org-wide primary-media map — see docs/exceptions.md R-8.3.3
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    // NOT widened: point-read by GLOBAL by_cuid index with no orgId arg to check
    // the result against. See agentOps below.
    await requireService(ctx);
    return await ctx.db.query("projectMedia").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

export const listByParent = query({
  args: { parentId: v.string() },
  handler: async (ctx, { parentId }) => {
    // NOT widened: `by_projectId` is a GLOBAL index and this query takes no orgId
    // arg at all — there is nothing to check a caller-supplied parentId against,
    // so any agent could read another org's media by guessing a foreign
    // projectId. See agentOps below.
    await requireService(ctx);
    return await ctx.db
      .query("projectMedia")
      .withIndex("by_projectId", (q) => q.eq("projectId", parentId))
      .collect();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    fileId: v.string(),
    type: v.optional(enums.ProjectMediaType),
    displayName: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("projectMedia", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    fileId: v.string(),
    type: v.optional(enums.ProjectMediaType),
    displayName: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("projectMedia").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("projectMedia", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      projectId: v.optional(v.string()),
      fileId: v.optional(v.string()),
      type: v.optional(enums.ProjectMediaType),
      displayName: v.optional(v.string()),
      sortOrder: v.optional(v.number()),
      createdAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("projectMedia").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("projectMedia not found: " + id);
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
    const doc = await ctx.db.query("projectMedia").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("projectMedia not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ─── agentOps annotations (Phase 5 domain slice, #1001) ──────────────────────
export const agentOps: AgentOpsAnnotations = {
  list: { summary: "List all project media metadata rows for an org.", danger: "low", mcpTier: 3 },
  getById: { agentAccess: "denied", reason: "Point-read by global by_cuid with no orgId arg to verify the result against — would let an agent read another org's media row by guessing its cuid." },
  listByParent: { agentAccess: "denied", reason: "by_projectId is a global index and the query takes no orgId arg, so a caller-supplied parentId can't be checked against the caller's org." },
};
