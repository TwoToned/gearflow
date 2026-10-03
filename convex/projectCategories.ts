import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgReadFor, requireOrgReadDocFor, requireService } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { resolveLiveVersionIdForProject, resolveVersionId, versionRows } from "./lib/versionScope";

/**
 * Thin CRUD for ProjectCategory (Convex table "projectCategories"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (service-only mirror/read helpers; the browser-direct write path with RBAC +
 * validation + audit enforced inside Convex lives in the *Writes.ts mutations — see FEATUREDOCS/54). Org-scoped reads
 * accept the service token OR a user token scoped to the same org. Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgReadFor(ctx, orgId, "project");
    return await ctx.db
      .query("projectCategories")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: bounded per-org config/catalog set — see docs/exceptions.md R-8.3.3
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("projectCategories").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDocFor(ctx, doc, "project");
    return doc;
  },
});

export const listByProject = query({
  // #1228: optional versionId, defaulting to the project's live version.
  args: { projectId: v.string(), orgId: v.string(), versionId: v.optional(v.string()) },
  handler: async (ctx, { projectId, orgId, versionId }) => {
    await requireOrgReadFor(ctx, orgId, "project");
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
    if (!project || project.organizationId !== orgId) return [];
    // by_versionId is GLOBAL — filter to the caller's org (cross-tenant guard).
    const rows = await versionRows(ctx, "projectCategories", resolveVersionId(project, versionId));
    return rows.filter((r) => r.organizationId === orgId);
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    name: v.string(),
    sortOrder: v.optional(v.number()),
    // #1228 — optional on this legacy service-only mirror mutation too.
    versionId: v.optional(v.string()),
    lineageId: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const versionId = args.versionId ?? (await resolveLiveVersionIdForProject(ctx, args.projectId, args.organizationId));
    return await ctx.db.insert("projectCategories", { ...args, versionId, lineageId: args.lineageId ?? args.id });
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    name: v.string(),
    sortOrder: v.optional(v.number()),
    versionId: v.optional(v.string()),
    lineageId: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("projectCategories").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const versionId = args.versionId ?? (await resolveLiveVersionIdForProject(ctx, args.projectId, args.organizationId));
    const _id = await ctx.db.insert("projectCategories", { ...args, versionId, lineageId: args.lineageId ?? args.id });
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
    const versionId = await resolveLiveVersionIdForProject(ctx, projectId, organizationId);
    const existing = await versionRows(ctx, "projectCategories", versionId);
    const maxSort = existing.reduce((m, c) => Math.max(m, c.sortOrder ?? -1), -1);
    const sortOrder = maxSort + 1;
    await ctx.db.insert("projectCategories", {
      id,
      organizationId,
      projectId,
      versionId,
      lineageId: id,
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
      // VERSION-SCOPE: safe — child/group rows are always stamped with their parent's versionId at write time (insert-side stamping + materializeVersionRowsNative's FK remap), and reached here only via an already-resolved, version-specific parent id — never mixes versions.
      .query("projectGroups")
      .withIndex("by_categoryId", (q) => q.eq("categoryId", categoryId))
      .collect();
    for (const g of groups) {
      const gslots = await ctx.db
        // VERSION-SCOPE: safe — categorySlots has no versionId of its own — reached only through an already version-scoped parent row (projectCategoryId/projectGroupId/subHireGroupId/lineItemId); see categorySlots' schema.ts comment.
        .query("categorySlots")
        .withIndex("by_projectGroupId", (q) => q.eq("projectGroupId", g.id))
        .collect();
      for (const s of gslots) await ctx.db.delete(s._id);
      await ctx.db.delete(g._id);
    }
    const catSlots = await ctx.db
      // VERSION-SCOPE: safe — categorySlots has no versionId of its own — reached only through an already version-scoped parent row (projectCategoryId/projectGroupId/subHireGroupId/lineItemId); see categorySlots' schema.ts comment.
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
  // VERSION-SCOPE: all-versions — a project delete purges EVERY version's
  // categories/groups/slots, not just the live one (#1228). No org filter
  // here (matches the pre-existing "callers org-scope the project first"
  // contract) — `by_projectId_number` on projectVersions is global, so this
  // is still safe only because the caller already validated project
  // ownership before invoking this cascade.
  const versions = await ctx.db
    .query("projectVersions")
    .withIndex("by_projectId_number", (q) => q.eq("projectId", projectId))
    .collect();
  const cats = (
    await Promise.all(versions.map((v) => versionRows(ctx, "projectCategories", v.id)))
  ).flat();
  for (const c of cats) {
    const catSlots = await ctx.db
      .query("categorySlots")
      .withIndex("by_projectCategoryId", (q) => q.eq("projectCategoryId", c.id))
      .collect();
    for (const s of catSlots) await ctx.db.delete(s._id);
  }
  const groups = (
    await Promise.all(versions.map((v) => versionRows(ctx, "projectGroups", v.id)))
  ).flat();
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

// ─── agentOps annotations (Phase 5 domain slice, #1001) ──────────────────────
export const agentOps: AgentOpsAnnotations = {
  list: { summary: "List all project categories for an org.", danger: "low", mcpTier: 2 },
  getById: { summary: "Get one project category by id.", danger: "low", mcpTier: 2 },
  listByProject: { summary: "List categories belonging to one project.", danger: "low", mcpTier: 1 },
};
