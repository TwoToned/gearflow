import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";

/**
 * Thin CRUD for ProjectCategory (Convex table "projectCategories"). GENERATED — Phase 2/5.
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
      .query("projectCategories")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("projectCategories").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

export const listByProject = query({
  args: { projectId: v.string(), orgId: v.string() },
  handler: async (ctx, { projectId, orgId }) => {
    await requireOrgRead(ctx, orgId);
    // by_projectId is a GLOBAL index — filter to the caller's org (cross-tenant guard).
    return (await ctx.db
      .query("projectCategories")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect()).filter((r) => r.organizationId === orgId);
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    name: v.string(),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("projectCategories", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    name: v.string(),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("projectCategories").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("projectCategories", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      projectId: v.optional(v.string()),
      name: v.optional(v.string()),
      sortOrder: v.optional(v.number()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("projectCategories").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("projectCategories not found: " + id);
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
    const doc = await ctx.db.query("projectCategories").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("projectCategories not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// ── CUSTOM (Phase C — core grouping inversion) — re-add on regen ─────────────
// Purpose-built atomic mutations that replace multi-call server-action sequences.
// A single Convex mutation is fully ACID + serializable across every doc it
// touches (OCC retries the loser of a write-write race), so cascade + reorder +
// create-at-end become race-free here instead of split across N network calls.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Atomic create-at-end: compute max(sortOrder)+1 within the project and insert
 * in one transaction — no read-max-then-insert TOCTOU. Caller supplies the cuid.
 */
export const createAtEnd = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    name: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, organizationId, projectId, name, now }) => {
    await requireService(ctx);
    const existing = await ctx.db
      .query("projectCategories")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();
    const maxSort = existing.reduce((m, c) => Math.max(m, c.sortOrder ?? -1), -1);
    const sortOrder = maxSort + 1;
    await ctx.db.insert("projectCategories", {
      id,
      organizationId,
      projectId,
      name,
      sortOrder,
      createdAt: now,
      updatedAt: now,
    });
    return { id, sortOrder };
  },
});

/**
 * Atomic reorder: sortOrder = index for each id, in one transaction. Guarantees
 * contiguous ordering even if two reorders race (the serialized loser re-runs
 * against the winner's writes).
 */
export const reorder = mutation({
  args: { orgId: v.string(), orderedIds: v.array(v.string()), now: v.number() },
  handler: async (ctx, { orgId, orderedIds, now }) => {
    await requireService(ctx);
    for (let i = 0; i < orderedIds.length; i++) {
      const doc = await ctx.db
        .query("projectCategories")
        .withIndex("by_cuid", (q) => q.eq("id", orderedIds[i]))
        .unique();
      // Per-item org re-check (by_cuid is a GLOBAL index).
      if (doc && doc.organizationId === orgId) await ctx.db.patch(doc._id, { sortOrder: i, updatedAt: now });
    }
  },
});

/**
 * Atomic cascade delete of a category: every group in it (+ each group's slots),
 * every category slot, then the category itself. Returns the deleted group ids
 * so the caller can null out the (still-Prisma) line items that referenced them.
 */
export const deleteCascade = mutation({
  args: { categoryId: v.string() },
  handler: async (ctx, { categoryId }) => {
    await requireService(ctx);
    const groups = await ctx.db
      .query("projectGroups")
      .withIndex("by_categoryId", (q) => q.eq("categoryId", categoryId))
      .collect();
    for (const g of groups) {
      const gslots = await ctx.db
        .query("categorySlots")
        .withIndex("by_projectGroupId", (q) => q.eq("projectGroupId", g.id))
        .collect();
      for (const s of gslots) await ctx.db.delete(s._id);
      await ctx.db.delete(g._id);
    }
    const catSlots = await ctx.db
      .query("categorySlots")
      .withIndex("by_projectCategoryId", (q) => q.eq("projectCategoryId", categoryId))
      .collect();
    for (const s of catSlots) await ctx.db.delete(s._id);
    const cat = await ctx.db
      .query("projectCategories")
      .withIndex("by_cuid", (q) => q.eq("id", categoryId))
      .unique();
    if (cat) await ctx.db.delete(cat._id);
    return { groupIds: groups.map((g) => g.id) };
  },
});

/**
 * Atomic purge of ALL grouping rows (categories, groups, slots) for a project.
 * Used on project delete now that the Prisma FK cascade is gone (Phase C #254).
 * Read-your-writes within the mutation makes the overlapping slot deletes safe.
 */
/**
 * Body of deleteAllForProject as a plain function so mutations that can't call
 * another mutation (Convex forbids mutation→mutation) — e.g.
 * projectWrites.deleteNative — reuse the EXACT category/group/slot purge. Pure
 * ctx.db (no auth); callers org-scope the project first.
 */
export async function deleteAllForProjectCore(
  ctx: MutationCtx,
  projectId: string,
): Promise<{ categories: number; groups: number }> {
  const cats = await ctx.db
    .query("projectCategories")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .collect();
  for (const c of cats) {
    const catSlots = await ctx.db
      .query("categorySlots")
      .withIndex("by_projectCategoryId", (q) => q.eq("projectCategoryId", c.id))
      .collect();
    for (const s of catSlots) await ctx.db.delete(s._id);
  }
  const groups = await ctx.db
    .query("projectGroups")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .collect();
  for (const g of groups) {
    const gslots = await ctx.db
      .query("categorySlots")
      .withIndex("by_projectGroupId", (q) => q.eq("projectGroupId", g.id))
      .collect();
    for (const s of gslots) await ctx.db.delete(s._id);
    await ctx.db.delete(g._id);
  }
  for (const c of cats) await ctx.db.delete(c._id);
  return { categories: cats.length, groups: groups.length };
}

export const deleteAllForProject = mutation({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    await requireService(ctx);
    return await deleteAllForProjectCore(ctx, projectId);
  },
});
