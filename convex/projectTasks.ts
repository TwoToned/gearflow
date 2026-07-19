import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for ProjectTask (Convex table "projectTasks"). GENERATED — Phase 2/5.
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
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("projectTasks")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: reactive/full-org read (perf design); reviewed, accepted R-9.8 tradeoff — revisit with pagination if per-org rows grow large
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
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
      .query("projectTasks")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect()).filter((r) => r.organizationId === orgId);
  },
});

// ─── Browser-direct composite reads (Phase 3 — replace the getProjectTasks /
// getTaskAssignees server actions). Assignee names come from the Convex users +
// crewMembers mirrors (the deleted action's Prisma user/member seam is gone). ────

/** People a task can be assigned to: org members (users) + crew members. */
export const assignees = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    const members = await ctx.db
      .query("members")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: reviewed, accepted R-9.8 tradeoff over the org set (aggregation/enrichment)
      .collect();
    members.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)); // Prisma orderBy createdAt asc
    const users: { id: string; name: string; image: string | null }[] = [];
    for (const m of members) {
      const u = await ctx.db.query("users").withIndex("by_cuid", (q) => q.eq("id", m.userId)).first();
      if (u) users.push({ id: u.id, name: u.name, image: u.image ?? null });
    }
    const crewDocs = await ctx.db
      .query("crewMembers")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: reviewed, accepted R-9.8 tradeoff over the org set (aggregation/enrichment)
      .collect();
    const crew = crewDocs
      .filter((c) => c.status !== "ARCHIVED")
      .map((c) => ({ id: c.id, firstName: c.firstName, lastName: c.lastName }))
      .sort((a, b) => a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName));
    return { users, crew };
  },
});

/**
 * A project's tasks (sorted sortOrder→createdAt) with the assignee join relations the
 * board renders. dueDate is returned as an ISO string (the consumer slices it to
 * YYYY-MM-DD), matching the deleted server action's serialized shape.
 */
export const listByProjectWithRelations = query({
  args: { projectId: v.string(), orgId: v.string() },
  handler: async (ctx, { projectId, orgId }) => {
    await requireOrgRead(ctx, orgId);
    const rows = (
      await ctx.db.query("projectTasks").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect()
    ).filter((t) => t.organizationId === orgId); // by_projectId is global → org re-check
    rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0));

    const out = [];
    for (const t of rows) {
      let assigneeUser: { id: string; name: string; image: string | null } | null = null;
      if (t.assigneeUserId) {
        // Only expose the user's name/image if they are a MEMBER of this org (the
        // users mirror is global — gate the join on by_org_user so a stale/foreign
        // assigneeUserId can't leak another org's user; mirrors the assigneeCrew check).
        const member = await ctx.db
          .query("members")
          .withIndex("by_org_user", (q) => q.eq("organizationId", orgId).eq("userId", t.assigneeUserId as string))
          .first();
        if (member) {
          const u = await ctx.db.query("users").withIndex("by_cuid", (q) => q.eq("id", t.assigneeUserId as string)).first();
          assigneeUser = u ? { id: u.id, name: u.name, image: u.image ?? null } : null;
        }
      }
      let assigneeCrew: { id: string; firstName: string; lastName: string } | null = null;
      if (t.assigneeCrewId) {
        const c = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", t.assigneeCrewId as string)).first();
        // Crew is org-scoped domain data; re-check org before exposing the name.
        assigneeCrew = c && c.organizationId === orgId ? { id: c.id, firstName: c.firstName, lastName: c.lastName } : null;
      }
      out.push({
        id: t.id,
        title: t.title,
        description: t.description ?? null,
        status: t.status ?? "TODO",
        priority: t.priority ?? "NORMAL",
        dueDate: t.dueDate != null ? new Date(t.dueDate).toISOString() : null,
        checklist: t.checklist ?? null,
        assigneeUserId: t.assigneeUserId ?? null,
        assigneeCrewId: t.assigneeCrewId ?? null,
        assigneeUser,
        assigneeCrew,
      });
    }
    return out;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.optional(enums.ProjectTaskStatus),
    priority: v.optional(enums.ProjectTaskPriority),
    dueDate: v.optional(v.number()),
    sortOrder: v.optional(v.number()),
    checklist: v.optional(v.any()),
    assigneeUserId: v.optional(v.string()),
    assigneeCrewId: v.optional(v.string()),
    createdById: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("projectTasks", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.optional(enums.ProjectTaskStatus),
    priority: v.optional(enums.ProjectTaskPriority),
    dueDate: v.optional(v.number()),
    sortOrder: v.optional(v.number()),
    checklist: v.optional(v.any()),
    assigneeUserId: v.optional(v.string()),
    assigneeCrewId: v.optional(v.string()),
    createdById: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("projectTasks", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      projectId: v.optional(v.string()),
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      status: v.optional(enums.ProjectTaskStatus),
      priority: v.optional(enums.ProjectTaskPriority),
      dueDate: v.optional(v.number()),
      sortOrder: v.optional(v.number()),
      checklist: v.optional(v.any()),
      assigneeUserId: v.optional(v.string()),
      assigneeCrewId: v.optional(v.string()),
      createdById: v.optional(v.string()),
      completedAt: v.optional(v.number()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("projectTasks not found: " + id);
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
    const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("projectTasks not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ─── Bulk (multi-select) operations ────────────────────────────────────────
// One mutation round-trip for an N-task bulk action instead of one server→Convex
// call per row. Org-scoped per row (by_cuid is global); foreign rows skipped.

/** Bulk-apply a shared patch to N tasks. `patch` carries the resolved shared
 *  fields (status / priority / dueDate ms / assignee); the DONE completedAt stamp
 *  is derived per row against its own current status. */
export const updateMany = mutation({
  args: { ids: v.array(v.string()), orgId: v.string(), patch: v.any(), now: v.number() },
  handler: async (ctx, { ids, orgId, patch, now }) => {
    await requireService(ctx);
    const p = patch as Record<string, unknown>;
    const projectIds = new Set<string>();
    let updated = 0;
    let skipped = 0;
    for (const id of ids) {
      const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      if (!doc || doc.organizationId !== orgId) { skipped++; continue; }
      const applied: Record<string, unknown> = { ...p, updatedAt: now };
      delete applied.organizationId;
      delete applied.id;
      if (p.status !== undefined && p.status !== doc.status) {
        applied.completedAt = p.status === "DONE" ? now : null;
      }
      await ctx.db.patch(doc._id, applied);
      projectIds.add(doc.projectId);
      updated++;
    }
    return { updated, skipped, projectIds: [...projectIds] };
  },
});

/** Bulk-delete N tasks in one pass. */
export const removeMany = mutation({
  args: { ids: v.array(v.string()), orgId: v.string() },
  handler: async (ctx, { ids, orgId }) => {
    await requireService(ctx);
    const projectIds = new Set<string>();
    let deleted = 0;
    let skipped = 0;
    for (const id of ids) {
      const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      if (!doc || doc.organizationId !== orgId) { skipped++; continue; }
      await ctx.db.delete(doc._id);
      projectIds.add(doc.projectId);
      deleted++;
    }
    return { deleted, skipped, projectIds: [...projectIds] };
  },
});

/**
 * Atomic drag-reorder: assign sortOrder = index for each id in `orderedIds`, in ONE
 * mutation round-trip (was a server loop firing one `update` per task). Per-item org
 * re-check: by_cuid is a GLOBAL index, so without the `doc.organizationId === orgId`
 * skip a caller could reorder another org's tasks (mirrors reorderLineItems' guard).
 */
export const reorderMany = mutation({
  args: { orgId: v.string(), orderedIds: v.array(v.string()), now: v.number() },
  handler: async (ctx, { orgId, orderedIds, now }) => {
    await requireService(ctx);
    for (let index = 0; index < orderedIds.length; index++) {
      const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", orderedIds[index])).unique();
      if (doc && doc.organizationId === orgId) await ctx.db.patch(doc._id, { sortOrder: index, updatedAt: now });
    }
  },
});
