import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit, assertBulkSizeOk } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { assertStrLen } from "./lib/fieldGuards";
import * as enums from "./lib/validators";

/**
 * Native PROJECT-TASK write mutations — the deliberately basic task list:
 * title, description, status, priority, due date, one assignee (user XOR crew),
 * manual order. Nothing automated: no recurrence, stages, subtasks, links or
 * follow-up engine (all removed — see FEATUREDOCS/50). Gates on `work:update`
 * OR `project:update` (already-issued API keys only carry `project:update`).
 * Standard shape: 4 guards + per-row org re-check + atomic audit.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

const TITLE_BOUNDS = { min: 1, max: 200 } as const;
const DESCRIPTION_BOUNDS = { max: 5000 } as const;

// Same-file, literal-argument helper so scripts/generate-api-registry.mts's
// local-helper inlining picks up both scopePairs.
async function requireWorkOrProjectOrgUpdate(ctx: MutationCtx, orgId: string): Promise<void> {
  try {
    await requireOrgPermission(ctx, orgId, "work", "update");
  } catch {
    await requireOrgPermission(ctx, orgId, "project", "update");
  }
}

/** Validate an assignee (user member OR crew) belongs to the org; reject if both set. */
export async function assertAssigneeInOrg(
  ctx: MutationCtx,
  orgId: string,
  assigneeUserId?: string | null,
  assigneeCrewId?: string | null,
) {
  if (assigneeUserId && assigneeCrewId) {
    throw new ConvexError("A task can be assigned to either a user or a crew member, not both");
  }
  if (assigneeUserId) {
    const member = await ctx.db
      .query("members")
      .withIndex("by_org_user", (q) => q.eq("organizationId", orgId).eq("userId", assigneeUserId))
      .first();
    if (!member) throw new ConvexError("Assigned user is not a member of this organization");
  }
  if (assigneeCrewId) {
    const crew = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", assigneeCrewId)).first();
    if (!crew || crew.organizationId !== orgId) throw new ConvexError("Assigned crew member not found");
  }
}

async function logTask(
  ctx: MutationCtx,
  a: { orgId: string; projectId: string | undefined; actor: Actor; auditId: string; now: number; action: string; entityId: string; entityName: string; summary: string },
) {
  await writeActivityLog(ctx, {
    id: a.auditId,
    organizationId: a.orgId,
    action: a.action,
    entityType: "ProjectTask",
    entityId: a.entityId,
    entityName: a.entityName,
    projectId: a.projectId,
    userId: a.actor.userId,
    userName: a.actor.userName,
    summary: a.summary,
    createdAt: a.now,
  });
}

// Shared editable fields (title is added per-mutation: required on create, optional on update).
const taskWriteFields = {
  description: v.optional(v.union(v.string(), v.null())),
  status: v.optional(enums.ProjectTaskStatus),
  priority: v.optional(enums.ProjectTaskPriority),
  dueDate: v.optional(v.union(v.number(), v.null())),
  assigneeUserId: v.optional(v.union(v.string(), v.null())),
  assigneeCrewId: v.optional(v.union(v.string(), v.null())),
};

export const createNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    projectId: v.string(),
    orgId: v.string(),
    title: v.string(),
    ...taskWriteFields,
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectTask");
    await enforceBrowserWriteLimit(ctx);
    await requireWorkOrProjectOrgUpdate(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);

    const title = a.title.trim();
    if (!title) throw new ConvexError("Task title is required");
    assertStrLen(title, "title", TITLE_BOUNDS);
    assertStrLen(a.description ?? undefined, "description", DESCRIPTION_BOUNDS);
    await assertAssigneeInOrg(ctx, a.orgId, a.assigneeUserId, a.assigneeCrewId);

    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", a.projectId)).first();
    if (!project || project.organizationId !== a.orgId) throw new ConvexError("Project not found");
    const existing = await ctx.db.query("projectTasks").withIndex("by_projectId", (q) => q.eq("projectId", a.projectId)).collect();
    const sortOrder = existing.reduce((max, t) => Math.max(max, t.sortOrder ?? 0), 0) + 1;

    const status = a.status ?? "TODO";
    await ctx.db.insert("projectTasks", {
      id: a.id,
      organizationId: a.orgId,
      projectId: a.projectId,
      title,
      description: a.description?.trim() || undefined,
      status,
      priority: a.priority ?? "NORMAL",
      dueDate: a.dueDate ?? undefined,
      assigneeUserId: a.assigneeUserId || undefined,
      assigneeCrewId: a.assigneeCrewId || undefined,
      createdById: actor.userId,
      completedAt: status === "DONE" ? a.now : undefined,
      sortOrder,
      createdAt: a.now,
      updatedAt: a.now,
    });

    await logTask(ctx, { orgId: a.orgId, projectId: a.projectId, actor, auditId: a.auditId, now: a.now, action: "created", entityId: a.id, entityName: title, summary: `Added task "${title}"` });
    return { id: a.id };
  },
});

export const updateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    title: v.optional(v.string()),
    ...taskWriteFields,
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectTask");
    await enforceBrowserWriteLimit(ctx);
    await requireWorkOrProjectOrgUpdate(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);

    const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Task not found");

    if (a.title !== undefined && !a.title.trim()) throw new ConvexError("Task title is required");
    assertStrLen(a.title?.trim(), "title", TITLE_BOUNDS);
    assertStrLen(a.description ?? undefined, "description", DESCRIPTION_BOUNDS);
    await assertAssigneeInOrg(ctx, a.orgId, a.assigneeUserId, a.assigneeCrewId);

    // Clears use `undefined` (Convex removes the optional field).
    const patch: Record<string, unknown> = { updatedAt: a.now };
    if (a.title !== undefined) patch.title = a.title.trim();
    if (a.description !== undefined) patch.description = a.description?.trim() || undefined;
    if (a.status !== undefined) patch.status = a.status;
    if (a.priority !== undefined) patch.priority = a.priority;
    if (a.dueDate !== undefined) patch.dueDate = a.dueDate ?? undefined;
    if (a.assigneeUserId !== undefined) patch.assigneeUserId = a.assigneeUserId || undefined;
    if (a.assigneeCrewId !== undefined) patch.assigneeCrewId = a.assigneeCrewId || undefined;
    if (a.status !== undefined && a.status !== doc.status) {
      patch.completedAt = a.status === "DONE" ? a.now : undefined;
    }
    // user-XOR-crew on the MERGED row: assigning one clears the other.
    if (patch.assigneeUserId) patch.assigneeCrewId = undefined;
    else if (patch.assigneeCrewId) patch.assigneeUserId = undefined;

    await ctx.db.patch(doc._id, patch);
    const title = (patch.title as string | undefined) ?? doc.title;
    await logTask(ctx, { orgId: a.orgId, projectId: doc.projectId, actor, auditId: a.auditId, now: a.now, action: "updated", entityId: a.id, entityName: title, summary: `Updated task "${title}"` });
    return { id: a.id };
  },
});

export const deleteNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: { id: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectTask");
    await enforceBrowserWriteLimit(ctx);
    await requireWorkOrProjectOrgUpdate(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);

    const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Task not found");

    await ctx.db.delete(doc._id);
    await logTask(ctx, { orgId: a.orgId, projectId: doc.projectId, actor, auditId: a.auditId, now: a.now, action: "deleted", entityId: a.id, entityName: doc.title, summary: `Deleted task "${doc.title}"` });
    return { ok: true };
  },
});

export const bulkUpdateNative = mutation({
  returns: v.object({ updated: v.number(), skipped: v.number() }),
  args: {
    ids: v.array(v.string()),
    orgId: v.string(),
    status: v.optional(enums.ProjectTaskStatus),
    priority: v.optional(enums.ProjectTaskPriority),
    dueDate: v.optional(v.union(v.number(), v.null())),
    assigneeUserId: v.optional(v.union(v.string(), v.null())),
    assigneeCrewId: v.optional(v.union(v.string(), v.null())),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectTask");
    await enforceBrowserWriteLimit(ctx);
    await assertBulkSizeOk(ctx, a.ids.length);
    await requireWorkOrProjectOrgUpdate(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);
    if (a.ids.length === 0) return { updated: 0, skipped: 0 };

    // The shared assignee is identical across every task — validate once.
    await assertAssigneeInOrg(ctx, a.orgId, a.assigneeUserId, a.assigneeCrewId);

    const set: Record<string, unknown> = {};
    if (a.status !== undefined) set.status = a.status;
    if (a.priority !== undefined) set.priority = a.priority;
    if (a.dueDate !== undefined) set.dueDate = a.dueDate ?? undefined;
    if (a.assigneeUserId !== undefined) set.assigneeUserId = a.assigneeUserId || undefined;
    if (a.assigneeCrewId !== undefined) set.assigneeCrewId = a.assigneeCrewId || undefined;
    if (set.assigneeUserId) set.assigneeCrewId = undefined;
    else if (set.assigneeCrewId) set.assigneeUserId = undefined;

    let projectId: string | undefined;
    let updated = 0;
    let skipped = 0;
    for (const id of a.ids) {
      const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      if (!doc || doc.organizationId !== a.orgId) { skipped++; continue; }
      const applied: Record<string, unknown> = { ...set, updatedAt: a.now };
      if (set.status !== undefined && set.status !== doc.status) {
        applied.completedAt = set.status === "DONE" ? a.now : undefined;
      }
      await ctx.db.patch(doc._id, applied);
      projectId ??= doc.projectId;
      updated++;
    }

    if (updated > 0) {
      await logTask(ctx, { orgId: a.orgId, projectId, actor, auditId: a.auditId, now: a.now, action: "updated", entityId: a.ids[0], entityName: `${updated} task${updated === 1 ? "" : "s"}`, summary: `Bulk updated ${updated} task${updated === 1 ? "" : "s"}` });
    }
    return { updated, skipped };
  },
});

export const bulkDeleteNative = mutation({
  returns: v.object({ deleted: v.number(), skipped: v.number() }),
  args: { ids: v.array(v.string()), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectTask");
    await enforceBrowserWriteLimit(ctx);
    await assertBulkSizeOk(ctx, a.ids.length);
    await requireWorkOrProjectOrgUpdate(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);
    if (a.ids.length === 0) return { deleted: 0, skipped: 0 };

    let projectId: string | undefined;
    let deleted = 0;
    for (const id of a.ids) {
      const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      if (!doc || doc.organizationId !== a.orgId) continue;
      await ctx.db.delete(doc._id);
      projectId ??= doc.projectId;
      deleted++;
    }

    if (deleted > 0) {
      await logTask(ctx, { orgId: a.orgId, projectId, actor, auditId: a.auditId, now: a.now, action: "deleted", entityId: a.ids[0], entityName: `${deleted} task${deleted === 1 ? "" : "s"}`, summary: `Deleted ${deleted} task${deleted === 1 ? "" : "s"}` });
    }
    return { deleted, skipped: a.ids.length - deleted };
  },
});

/**
 * Browser-direct drag-reorder — assigns sortOrder=index for each id in
 * `orderedIds` in ONE round trip. Per-item org re-check (by_cuid is global); a
 * foreign id is silently skipped. Structural only — never gated.
 */
export const reorderNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: { orgId: v.string(), orderedIds: v.array(v.string()), now: v.number() },
  handler: async (ctx, { orgId, orderedIds, now }) => {
    await assertWritesEnabled(ctx, "projectTask");
    await enforceBrowserWriteLimit(ctx);
    await assertBulkSizeOk(ctx, orderedIds.length);
    await requireWorkOrProjectOrgUpdate(ctx, orgId);
    for (let index = 0; index < orderedIds.length; index++) {
      const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", orderedIds[index])).first();
      if (doc && doc.organizationId === orgId) {
        await ctx.db.patch(doc._id, { sortOrder: index, updatedAt: now });
      }
    }
    return { ok: true as const };
  },
});

export const agentOps: AgentOpsAnnotations = {
  bulkDeleteNative: { danger: "high" },
  bulkUpdateNative: { danger: "medium" },
  createNative: { danger: "medium" },
  deleteNative: { danger: "high" },
  updateNative: { danger: "medium" },
  reorderNative: { summary: "Reassign sortOrder for a set of tasks after a drag-reorder.", danger: "low", mcpTier: 3 },
};
