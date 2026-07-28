import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService, requireOrgPermission } from "./lib/auth";
import * as enums from "./lib/validators";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Thin CRUD for ModelMedia (Convex table "modelMedia"). GENERATED — Phase 2/5.
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
    await requireOrgPermission(ctx, orgId, "model", "read"); // Phase 5 SERVICE-only triage widen (#1001)
    return await ctx.db
      .query("modelMedia")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: aggregation — org-wide primary-media map — see docs/exceptions.md R-8.3.3
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("modelMedia").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

export const listByParent = query({
  args: { parentId: v.string() },
  handler: async (ctx, { parentId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("modelMedia")
      .withIndex("by_modelId", (q) => q.eq("modelId", parentId))
      .collect();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    fileId: v.string(),
    type: v.optional(enums.MediaType),
    isPrimary: v.optional(v.boolean()),
    displayName: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("modelMedia", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    fileId: v.string(),
    type: v.optional(enums.MediaType),
    isPrimary: v.optional(v.boolean()),
    displayName: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("modelMedia").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("modelMedia", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      modelId: v.optional(v.string()),
      fileId: v.optional(v.string()),
      type: v.optional(enums.MediaType),
      isPrimary: v.optional(v.boolean()),
      displayName: v.optional(v.string()),
      sortOrder: v.optional(v.number()),
      createdAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("modelMedia").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("modelMedia not found: " + id);
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
    const doc = await ctx.db.query("modelMedia").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("modelMedia not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ── CUSTOM (Phase C) — NOT emitted by the CRUD generator; re-add on regen. ──
// Atomic single-primary-photo invariant (replaces the Prisma updateMany+update tx).
export const setPrimary = mutation({
  args: { parentId: v.string(), mediaId: v.string() },
  handler: async (ctx, { parentId, mediaId }) => {
    await requireService(ctx);
    const rows = await ctx.db
      .query("modelMedia")
      .withIndex("by_modelId", (q) => q.eq("modelId", parentId))
      .collect();
    for (const r of rows) {
      if (r.id === mediaId) {
        if (!r.isPrimary) await ctx.db.patch(r._id, { isPrimary: true });
      } else if (r.type === "PHOTO" && r.isPrimary) {
        await ctx.db.patch(r._id, { isPrimary: false });
      }
    }
  },
});

// Atomic reorder: set sortOrder = array index (replaces the Prisma update-per-id tx).
export const reorder = mutation({
  args: { orgId: v.string(), orderedIds: v.array(v.string()) },
  handler: async (ctx, { orgId, orderedIds }) => {
    await requireService(ctx);
    for (let i = 0; i < orderedIds.length; i++) {
      const doc = await ctx.db
        .query("modelMedia")
        .withIndex("by_cuid", (q) => q.eq("id", orderedIds[i]))
        .unique();
      // Per-item org re-check (by_cuid is a GLOBAL index).
      if (doc && doc.organizationId === orgId) await ctx.db.patch(doc._id, { sortOrder: i });
    }
  },
});

// ─── agentOps annotations (Phase 5 domain slice, #1001) ──────────────────────
// Triage: `list` takes `orgId` directly, so it widens cleanly. `getById` and
// `listByParent` do NOT take an orgId — they fetch by a GLOBAL index (by_cuid /
// by_modelId) with no org argument to check against. Widening those would need
// a new org-derivation step (fetch the parent model to learn its org) rather
// than the plain guard swap this triage covers — left service-only, revisit.
export const agentOps: AgentOpsAnnotations = {
  list: { summary: "List all media (photos/manuals) for models in the caller's org.", danger: "low", mcpTier: 3 },
  getById: { agentAccess: "denied", reason: "No orgId arg; fetched by a global by_cuid index with no org check to swap in without a parent-derivation step — revisit." },
  listByParent: { agentAccess: "denied", reason: "No orgId arg; modelId is a global foreign key with no org check to swap in without fetching the parent model first — revisit." },
};
