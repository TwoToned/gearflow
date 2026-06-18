import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";

/**
 * Thin CRUD for WarehouseClose (Convex table "warehouseCloses"). GENERATED — Phase 2/5.
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
      .query("warehouseCloses")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("warehouseCloses").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    closedById: v.string(),
    closedAt: v.optional(v.number()),
    storedCount: v.optional(v.number()),
    damagedCount: v.optional(v.number()),
    lostCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("warehouseCloses", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    closedById: v.string(),
    closedAt: v.optional(v.number()),
    storedCount: v.optional(v.number()),
    damagedCount: v.optional(v.number()),
    lostCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("warehouseCloses").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("warehouseCloses", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      projectId: v.optional(v.string()),
      closedById: v.optional(v.string()),
      closedAt: v.optional(v.number()),
      storedCount: v.optional(v.number()),
      damagedCount: v.optional(v.number()),
      lostCount: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("warehouseCloses").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("warehouseCloses not found: " + id);
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
    const doc = await ctx.db.query("warehouseCloses").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("warehouseCloses not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ── CUSTOM (Phase C) — NOT emitted by the CRUD generator. Re-add if regenerating
// convex/warehouseCloses.ts via `pnpm convex:crud`. ──────────────────────────

/**
 * Look up the (at most one) close-out for a project. Powers the "already closed"
 * banner — replaces the `prisma.warehouseClose.findFirst` residual read in
 * `getCloseOutSummary` now that warehouseCloses is Convex-only.
 */
export const getByProject = query({
  args: { orgId: v.string(), projectId: v.string() },
  handler: async (ctx, { orgId, projectId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("warehouseCloses")
      .withIndex("by_projectId_organizationId", (q) =>
        q.eq("projectId", projectId).eq("organizationId", orgId),
      )
      .first();
  },
});

/**
 * Race-safe close-out insert. Enforces the [projectId, organizationId]
 * uniqueness invariant the dropped Prisma unique constraint used to guarantee:
 * Convex mutations are serializable, so a concurrent close reads the same index
 * range this insert writes → OCC forces the loser to retry and observe the
 * existing row. Returns `{ alreadyClosed }` (rather than throwing on the dup) so
 * the server action maps it to the existing user-facing message.
 */
export const closeOutIfNotClosed = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    closedById: v.string(),
    closedAt: v.number(),
    storedCount: v.number(),
    damagedCount: v.number(),
    lostCount: v.number(),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db
      .query("warehouseCloses")
      .withIndex("by_projectId_organizationId", (q) =>
        q.eq("projectId", args.projectId).eq("organizationId", args.organizationId),
      )
      .first();
    if (existing) return { alreadyClosed: true as const, id: existing.id };
    await ctx.db.insert("warehouseCloses", args);
    return { alreadyClosed: false as const, id: args.id };
  },
});
