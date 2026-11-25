import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit, assertBulkSizeOk } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { assertStrLen } from "./lib/fieldGuards";
import { emitProjectActivityEvent } from "./lib/activityEvents";
import { diffFields, readSnapshot, recordFieldEdit, undoFieldEdit, undoMarkerId, type FieldValue } from "./lib/fieldEditUndo";
import { assertWithinUndoWindow } from "./lib/undoWindow";
import * as enums from "./lib/validators";
import type { Doc } from "./_generated/dataModel";

/**
 * Native PROJECT-TASK write mutations — the deliberately basic task list:
 * title, description, status, priority, due date, one assignee (user XOR crew),
 * manual order. Nothing automated: no recurrence, stages, subtasks, links or
 * follow-up engine (all removed — see FEATUREDOCS/50). Gates on `work:update`
 * OR `project:update` (already-issued API keys only carry `project:update`).
 * Standard shape: 4 guards + per-row org re-check + atomic audit.
 *
 * UX Phase 10 (spec §8c): every write also emits an `activityEvents` row (the
 * Activity rail) and is EXACTLY undoable by ids alone. The forward write stores,
 * in its own audit row, what it changed (a per-task row id `${auditId}:${taskId}`
 * for update / delete, so a 500-task bulk never builds one oversized document);
 * the Undo (`undoCreateNative`, `undoUpdateNative`, `restoreDeletedNative`,
 * `undoReorderNative`) reads those rows back and takes no restore value from the
 * client. Each refuses on a stale target rather than clobbering a later edit.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

const TITLE_BOUNDS = { min: 1, max: 200 } as const;
const DESCRIPTION_BOUNDS = { max: 5000 } as const;

/** The fields an update can change, and so what its Undo compares and restores. */
const TRACKED_FIELDS = [
  "title",
  "description",
  "status",
  "priority",
  "dueDate",
  "assigneeUserId",
  "assigneeCrewId",
  "completedAt",
] as const;

/** The per-task audit row id a forward update / delete writes (and its Undo reads). */
const rowAuditId = (auditId: string, taskId: string) => `${auditId}:${taskId}`;

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
  a: {
    orgId: string;
    projectId: string | undefined;
    actor: Actor;
    auditId: string;
    now: number;
    action: string;
    entityId: string;
    entityName: string;
    summary: string;
    details?: unknown;
  },
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
    details: a.details,
    createdAt: a.now,
  });
}

/** One Activity-rail row for a task write. Titles are fine here (tasks are job-readable); note text never is. */
async function taskEvent(
  ctx: MutationCtx,
  a: { orgId: string; projectId: string | undefined; actor: Actor; now: number; action: string; summary: string; taskId?: string },
) {
  if (!a.projectId) return; // a legacy personal task has no job to show it on
  await emitProjectActivityEvent(ctx, {
    orgId: a.orgId,
    projectId: a.projectId,
    actor: a.actor,
    action: a.action,
    summary: a.summary,
    targetType: "task",
    targetId: a.taskId,
    now: a.now,
  });
}

const plural = (n: number) => `${n} task${n === 1 ? "" : "s"}`;

/** The full row of a task as a plain snapshot (what a delete's Undo re-inserts). */
function snapshotTask(doc: Doc<"projectTasks">): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const [k, val] of Object.entries(doc)) {
    if (k === "_id" || k === "_creationTime" || val === undefined) continue;
    out[k] = val as FieldValue;
  }
  return out;
}

/** The Undo of a forward write, read back from its own audit row: org, entity and author checked. */
async function readForwardRow(ctx: MutationCtx, orgId: string, rowId: string, taskId: string) {
  const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", rowId)).first();
  // `by_cuid` is global: the row must be this org's, for this task.
  if (!row || row.organizationId !== orgId || row.entityType !== "ProjectTask" || row.entityId !== taskId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "That change was not found, so it can't be undone." });
  }
  return row;
}

async function assertNotUndone(ctx: MutationCtx, orgId: string, rowId: string) {
  const marker = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", undoMarkerId(rowId))).first();
  if (marker && marker.organizationId === orgId) {
    throw new ConvexError({ code: "ALREADY_UNDONE", message: "That change was already undone." });
  }
}

function assertAuthorWithinWindow(authorId: string, actorId: string, serverSavedAt: number) {
  if (authorId !== actorId) {
    throw new ConvexError({ code: "NOT_AUTHOR", message: "Only the person who made a change can undo it." });
  }
  assertWithinUndoWindow(serverSavedAt, Date.now(), "change");
}

async function writeUndoMarker(
  ctx: MutationCtx,
  a: { orgId: string; projectId: string | undefined; actor: Actor; now: number; rowId: string; taskId: string; title: string; summary: string },
) {
  await logTask(ctx, {
    orgId: a.orgId,
    projectId: a.projectId,
    actor: a.actor,
    auditId: undoMarkerId(a.rowId),
    now: a.now,
    action: "UNDO",
    entityId: a.taskId,
    entityName: a.title,
    summary: a.summary,
    details: { undoOf: a.rowId },
  });
}

/** Run an Undo over several tasks: a stale one is skipped; if NONE could be undone, say why. */
async function undoEach(ids: string[], run: (id: string) => Promise<void>): Promise<{ restoredIds: string[]; skippedIds: string[] }> {
  const restoredIds: string[] = [];
  const skippedIds: string[] = [];
  let firstError: unknown;
  for (const id of ids) {
    try {
      await run(id);
      restoredIds.push(id);
    } catch (e) {
      if (!(e instanceof ConvexError)) throw e;
      firstError ??= e;
      skippedIds.push(id);
    }
  }
  if (restoredIds.length === 0 && firstError) throw firstError;
  return { restoredIds, skippedIds };
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

const undoOutcome = v.object({ restoredIds: v.array(v.string()), skippedIds: v.array(v.string()) });

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

    await logTask(ctx, {
      orgId: a.orgId, projectId: a.projectId, actor, auditId: a.auditId, now: a.now, action: "created",
      entityId: a.id, entityName: title, summary: `Added task "${title}"`,
      // What `undoCreateNative` reads back: the author and the SERVER clock.
      details: { createdTask: { authorId: actor.userId, serverSavedAt: Date.now() } },
    });
    await taskEvent(ctx, { orgId: a.orgId, projectId: a.projectId, actor, now: a.now, action: "task_created", summary: `added task "${title}"`, taskId: a.id });
    return { id: a.id };
  },
});

export const updateNative = mutation({
  returns: v.object({ id: v.string(), changed: v.boolean() }),
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

    const diff = diffFields(doc, { ...doc, ...patch }, TRACKED_FIELDS);
    if (!diff) return { id: a.id, changed: false }; // nothing changed: no write, no Undo
    await ctx.db.patch(doc._id, patch);
    const title = (patch.title as string | undefined) ?? doc.title;
    await recordFieldEdit(ctx, {
      orgId: a.orgId, entityType: "ProjectTask", entityId: a.id, entityName: title,
      auditId: rowAuditId(a.auditId, a.id), actor, summary: `Updated task "${title}"`, diff, now: a.now,
      links: { projectId: doc.projectId },
    });
    const completed = a.status === "DONE" && doc.status !== "DONE";
    await taskEvent(ctx, {
      orgId: a.orgId, projectId: doc.projectId, actor, now: a.now, taskId: a.id,
      action: completed ? "task_completed" : "task_updated",
      summary: `${completed ? "completed" : "updated"} task "${title}"`,
    });
    return { id: a.id, changed: true };
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

    const row = snapshotTask(doc);
    await ctx.db.delete(doc._id);
    await logTask(ctx, {
      orgId: a.orgId, projectId: doc.projectId, actor, auditId: rowAuditId(a.auditId, a.id), now: a.now, action: "deleted",
      entityId: a.id, entityName: doc.title, summary: `Deleted task "${doc.title}"`,
      details: { deletedTask: { authorId: actor.userId, serverSavedAt: Date.now(), row } },
    });
    await taskEvent(ctx, { orgId: a.orgId, projectId: doc.projectId, actor, now: a.now, action: "task_deleted", summary: `deleted task "${doc.title}"`, taskId: a.id });
    return { ok: true };
  },
});

export const bulkUpdateNative = mutation({
  returns: v.object({ updated: v.number(), skipped: v.number(), changedIds: v.array(v.string()) }),
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
    if (a.ids.length === 0) return { updated: 0, skipped: 0, changedIds: [] };

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
    const changedIds: string[] = [];
    for (const id of a.ids) {
      const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      if (!doc || doc.organizationId !== a.orgId) { skipped++; continue; }
      const applied: Record<string, unknown> = { ...set, updatedAt: a.now };
      if (set.status !== undefined && set.status !== doc.status) {
        applied.completedAt = set.status === "DONE" ? a.now : undefined;
      }
      projectId ??= doc.projectId;
      updated++;
      const diff = diffFields(doc, { ...doc, ...applied }, TRACKED_FIELDS);
      if (!diff) continue;
      await ctx.db.patch(doc._id, applied);
      changedIds.push(id);
      await recordFieldEdit(ctx, {
        orgId: a.orgId, entityType: "ProjectTask", entityId: id, entityName: doc.title,
        auditId: rowAuditId(a.auditId, id), actor, summary: `Updated task "${doc.title}"`, diff, now: a.now,
        links: { projectId: doc.projectId },
      });
    }

    if (changedIds.length > 0) {
      await logTask(ctx, { orgId: a.orgId, projectId, actor, auditId: a.auditId, now: a.now, action: "updated", entityId: a.ids[0], entityName: plural(changedIds.length), summary: `Bulk updated ${plural(changedIds.length)}` });
      await taskEvent(ctx, { orgId: a.orgId, projectId, actor, now: a.now, action: "task_updated", summary: `updated ${plural(changedIds.length)}` });
    }
    return { updated, skipped, changedIds };
  },
});

export const bulkDeleteNative = mutation({
  returns: v.object({ deleted: v.number(), skipped: v.number(), deletedIds: v.array(v.string()) }),
  args: { ids: v.array(v.string()), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectTask");
    await enforceBrowserWriteLimit(ctx);
    await assertBulkSizeOk(ctx, a.ids.length);
    await requireWorkOrProjectOrgUpdate(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);
    if (a.ids.length === 0) return { deleted: 0, skipped: 0, deletedIds: [] };

    let projectId: string | undefined;
    const deletedIds: string[] = [];
    for (const id of a.ids) {
      const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      if (!doc || doc.organizationId !== a.orgId) continue;
      const row = snapshotTask(doc);
      await ctx.db.delete(doc._id);
      projectId ??= doc.projectId;
      deletedIds.push(id);
      await logTask(ctx, {
        orgId: a.orgId, projectId: doc.projectId, actor, auditId: rowAuditId(a.auditId, id), now: a.now, action: "deleted",
        entityId: id, entityName: doc.title, summary: `Deleted task "${doc.title}"`,
        details: { deletedTask: { authorId: actor.userId, serverSavedAt: Date.now(), row } },
      });
    }

    if (deletedIds.length > 0) {
      await logTask(ctx, { orgId: a.orgId, projectId, actor, auditId: a.auditId, now: a.now, action: "deleted", entityId: a.ids[0], entityName: plural(deletedIds.length), summary: `Deleted ${plural(deletedIds.length)}` });
      await taskEvent(ctx, { orgId: a.orgId, projectId, actor, now: a.now, action: "task_deleted", summary: `deleted ${plural(deletedIds.length)}` });
    }
    return { deleted: deletedIds.length, skipped: a.ids.length - deletedIds.length, deletedIds };
  },
});

/**
 * Browser-direct drag-reorder — assigns sortOrder=index for each id in
 * `orderedIds` in ONE round trip. Per-item org re-check (by_cuid is global); a
 * foreign id is silently skipped. Structural only — never gated.
 *
 * With `auditId` + `actor` it also records each task's previous and new
 * `sortOrder` in ONE audit row (task id → order, a `fieldEdit` snapshot), which is
 * all `undoReorderNative` reads. `changed` is false when nothing moved.
 */
export const reorderNative = mutation({
  returns: v.object({ ok: v.boolean(), changed: v.boolean() }),
  args: {
    orgId: v.string(),
    orderedIds: v.array(v.string()),
    now: v.number(),
    auditId: v.optional(v.string()),
    actor: v.optional(actorValidator),
  },
  handler: async (ctx, { orgId, orderedIds, now, auditId, actor: suppliedActor }) => {
    await assertWritesEnabled(ctx, "projectTask");
    await enforceBrowserWriteLimit(ctx);
    await assertBulkSizeOk(ctx, orderedIds.length);
    await requireWorkOrProjectOrgUpdate(ctx, orgId);
    const actor = auditId && suppliedActor ? await resolveActor(ctx, suppliedActor) : null;
    const before: Record<string, FieldValue> = {};
    const after: Record<string, FieldValue> = {};
    let projectId: string | undefined;
    for (let index = 0; index < orderedIds.length; index++) {
      const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", orderedIds[index])).first();
      if (doc && doc.organizationId === orgId) {
        if ((doc.sortOrder ?? null) !== index) {
          before[doc.id] = doc.sortOrder ?? null;
          after[doc.id] = index;
        }
        projectId ??= doc.projectId;
        await ctx.db.patch(doc._id, { sortOrder: index, updatedAt: now });
      }
    }
    const changed = Object.keys(after).length > 0;
    if (changed && actor && auditId && projectId) {
      await recordFieldEdit(ctx, {
        orgId, entityType: "ProjectTaskOrder", entityId: projectId, entityName: "Task order", auditId, actor,
        summary: `Reordered ${plural(Object.keys(after).length)}`, diff: { before, after }, now, links: { projectId },
      });
    }
    return { ok: true as const, changed };
  },
});

/**
 * Undo a task CREATE by ids. Reads the create's own audit row (`createdTask`:
 * author + server clock). Refuses unless: it is this org's, you made it, it is
 * within the window, it was not undone, and the task is still UNEDITED
 * (`updatedAt === createdAt`). Deletes only that task.
 */
export const undoCreateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectTask");
    await enforceBrowserWriteLimit(ctx);
    await requireWorkOrProjectOrgUpdate(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);

    const row = await readForwardRow(ctx, a.orgId, a.auditId, a.id);
    const created = (row.details as { createdTask?: { authorId?: string; serverSavedAt?: number } } | undefined)?.createdTask;
    if (!created || typeof created.authorId !== "string" || typeof created.serverSavedAt !== "number") {
      throw new ConvexError({ code: "NOT_UNDOABLE", message: "That change can't be undone." });
    }
    await assertNotUndone(ctx, a.orgId, a.auditId);
    assertAuthorWithinWindow(created.authorId, actor.userId, created.serverSavedAt);

    const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "That task no longer exists." });
    }
    if (doc.updatedAt !== doc.createdAt) {
      throw new ConvexError({ code: "CHANGED_SINCE", message: "Can't undo: the task was edited since." });
    }
    await ctx.db.delete(doc._id);
    await writeUndoMarker(ctx, { orgId: a.orgId, projectId: doc.projectId, actor, now: a.now, rowId: a.auditId, taskId: a.id, title: doc.title, summary: `Undid adding task "${doc.title}"` });
    await taskEvent(ctx, { orgId: a.orgId, projectId: doc.projectId, actor, now: a.now, action: "task_deleted", summary: `removed task "${doc.title}"`, taskId: a.id });
    return { id: a.id };
  },
});

/**
 * Undo an UPDATE (single or bulk) by the forward call's `auditId` and the task
 * ids it CHANGED (`updateNative` / `bulkUpdateNative` return them). Per task the
 * shared `undoFieldEdit` refuses unless every changed field still holds what the
 * forward write left. A stale task is skipped and reported; with none restored
 * the first refusal is thrown so the toast can say why.
 */
export const undoUpdateNative = mutation({
  returns: undoOutcome,
  args: { orgId: v.string(), auditId: v.string(), ids: v.array(v.string()), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectTask");
    await enforceBrowserWriteLimit(ctx);
    await assertBulkSizeOk(ctx, a.ids.length);
    await requireWorkOrProjectOrgUpdate(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);

    return await undoEach(a.ids, async (id) => {
      let title = id;
      await undoFieldEdit<Doc<"projectTasks">>(ctx, {
        orgId: a.orgId, entityType: "ProjectTask", entityId: id, entityName: title, auditId: rowAuditId(a.auditId, id), actor, now: a.now,
        load: async () => {
          const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", id)).first();
          if (!doc || doc.organizationId !== a.orgId) return null;
          title = doc.title;
          return doc;
        },
        apply: async (doc, plan) => {
          const patch: Record<string, unknown> = { ...plan.set, updatedAt: a.now };
          for (const f of plan.clear) patch[f] = undefined;
          // A restored assignee may have left the org since: drop it rather than fail the Undo.
          for (const f of ["assigneeUserId", "assigneeCrewId"] as const) {
            if (typeof patch[f] !== "string") continue;
            try {
              await assertAssigneeInOrg(ctx, a.orgId, f === "assigneeUserId" ? (patch[f] as string) : null, f === "assigneeCrewId" ? (patch[f] as string) : null);
            } catch {
              patch[f] = undefined;
            }
          }
          await ctx.db.patch(doc._id, patch);
        },
      });
    });
  },
});

/**
 * Undo a DELETE (single or bulk) by the forward call's `auditId` and the ids it
 * deleted. Re-inserts each task from the snapshot its own delete row stored, with
 * its original id and `sortOrder`. Skips a task that exists again; refuses a
 * project that left the org; drops an assignee who is no longer valid. Once per
 * task (marker row). Never touches stored files (a task owns none).
 */
export const restoreDeletedNative = mutation({
  returns: undoOutcome,
  args: { orgId: v.string(), auditId: v.string(), ids: v.array(v.string()), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectTask");
    await enforceBrowserWriteLimit(ctx);
    await assertBulkSizeOk(ctx, a.ids.length);
    await requireWorkOrProjectOrgUpdate(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);

    return await undoEach(a.ids, async (id) => {
      const rowId = rowAuditId(a.auditId, id);
      const row = await readForwardRow(ctx, a.orgId, rowId, id);
      const deleted = (row.details as { deletedTask?: { authorId?: string; serverSavedAt?: number; row?: Record<string, unknown> } } | undefined)?.deletedTask;
      if (!deleted?.row || typeof deleted.authorId !== "string" || typeof deleted.serverSavedAt !== "number") {
        throw new ConvexError({ code: "NOT_UNDOABLE", message: "That change can't be undone." });
      }
      await assertNotUndone(ctx, a.orgId, rowId);
      assertAuthorWithinWindow(deleted.authorId, actor.userId, deleted.serverSavedAt);

      const snap = deleted.row as unknown as Doc<"projectTasks">;
      if (snap.organizationId !== a.orgId || snap.id !== id) {
        throw new ConvexError({ code: "NOT_UNDOABLE", message: "That change can't be undone." });
      }
      const again = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      if (again) throw new ConvexError({ code: "CHANGED_SINCE", message: "That task already exists again." });
      const project = snap.projectId
        ? await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", snap.projectId!)).first()
        : null;
      if (snap.projectId && (!project || project.organizationId !== a.orgId)) {
        throw new ConvexError({ code: "NOT_FOUND", message: "The job this task belonged to no longer exists." });
      }
      const restored = { ...snap } as Record<string, unknown>;
      for (const f of ["assigneeUserId", "assigneeCrewId"] as const) {
        if (typeof restored[f] !== "string") continue;
        try {
          await assertAssigneeInOrg(ctx, a.orgId, f === "assigneeUserId" ? (restored[f] as string) : null, f === "assigneeCrewId" ? (restored[f] as string) : null);
        } catch {
          delete restored[f];
        }
      }
      await ctx.db.insert("projectTasks", { ...(restored as Omit<Doc<"projectTasks">, "_id" | "_creationTime">), updatedAt: a.now });
      await writeUndoMarker(ctx, { orgId: a.orgId, projectId: snap.projectId, actor, now: a.now, rowId, taskId: id, title: snap.title, summary: `Restored task "${snap.title}"` });
      await taskEvent(ctx, { orgId: a.orgId, projectId: snap.projectId, actor, now: a.now, action: "task_restored", summary: `restored task "${snap.title}"`, taskId: id });
    });
  },
});

/**
 * Undo a REORDER by the forward call's `auditId` and the `projectId`. The forward
 * row stored task id → previous / new `sortOrder`; the shared `undoFieldEdit` treats
 * each task id as a "field" and restores only tasks still where the forward write
 * left them (refuses as a whole otherwise, so a later reorder is never clobbered).
 */
export const undoReorderNative = mutation({
  returns: v.object({ restored: v.number() }),
  args: { orgId: v.string(), auditId: v.string(), projectId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectTask");
    await enforceBrowserWriteLimit(ctx);
    await requireWorkOrProjectOrgUpdate(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);

    const byId = new Map<string, Doc<"projectTasks">>();
    const { restored } = await undoFieldEdit<Record<string, FieldValue>>(ctx, {
      orgId: a.orgId, entityType: "ProjectTaskOrder", entityId: a.projectId, entityName: "Task order", auditId: a.auditId, actor, now: a.now,
      load: async () => {
        // The synthetic "doc": task id → current sortOrder, org-checked per task.
        const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", a.auditId)).first();
        const snap = row && row.organizationId === a.orgId ? readSnapshot(row.details) : null;
        if (!snap) return null;
        const current: Record<string, FieldValue> = {};
        for (const id of Object.keys(snap.after)) {
          const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", id)).first();
          if (doc && doc.organizationId === a.orgId && doc.projectId === a.projectId) {
            byId.set(id, doc);
            current[id] = doc.sortOrder ?? null;
          }
        }
        return current;
      },
      apply: async (_doc, plan) => {
        for (const [id, order] of Object.entries(plan.set)) {
          const doc = byId.get(id);
          if (doc) await ctx.db.patch(doc._id, { sortOrder: order as number, updatedAt: a.now });
        }
        for (const id of plan.clear) {
          const doc = byId.get(id);
          if (doc) await ctx.db.patch(doc._id, { sortOrder: undefined, updatedAt: a.now });
        }
      },
    });
    return { restored: restored.length };
  },
});

export const agentOps: AgentOpsAnnotations = {
  bulkDeleteNative: { danger: "high" },
  bulkUpdateNative: { danger: "medium" },
  createNative: { danger: "medium" },
  deleteNative: { danger: "high" },
  updateNative: { danger: "medium" },
  reorderNative: { summary: "Reassign sortOrder for a set of tasks after a drag-reorder.", danger: "low", mcpTier: 3 },
  undoCreateNative: { summary: "Undo adding a task by its audit id: deletes only that task, only while it is unedited. Once.", danger: "high", mcpTier: 3 },
  undoUpdateNative: { summary: "Undo a task update (single or bulk) by its audit id and the changed task ids: restores only fields still as that write left them. Once per task.", danger: "medium", mcpTier: 3 },
  restoreDeletedNative: { summary: "Undo a task delete (single or bulk) by its audit id and the deleted task ids: re-creates each task from the snapshot the delete stored. Once per task.", danger: "medium", mcpTier: 3 },
  undoReorderNative: { summary: "Undo a task reorder by its audit id: puts each task back to its previous order only where it is still as that write left it. Once.", danger: "low", mcpTier: 3 },
};
