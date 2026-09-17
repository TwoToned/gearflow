import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import * as enums from "./lib/validators";
import { defaultStageForProjectStatus, type WorkStage, type WorkItemStatus, type WorkItemPriority, type WorkItemKind } from "./lib/workVocabulary";

/**
 * Native PROJECT-TASK write mutations (Phase 3 browser-direct — replaces the
 * create/update/delete/bulkUpdate/bulkDeleteProjectTask server actions in
 * src/server/project-tasks.ts). Gates on `work:update` OR `project:update` (additive
 * RBAC transition, #1243 — old API keys/OAuth grants only ever carry `project:update`).
 * The old actions' Prisma seam
 * (assignee membership validation on the Better Auth member table) is eliminated — the
 * `members` mirror (by_org_user) + `crewMembers` domain table validate the assignee
 * inside the mutation. Standard shape: 4 guards + per-row org re-check + atomic audit.
 * The board refetches the task list on success, so create/update/delete return minimally.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

// Work-or-project RBAC transition (#1243): these mutations were gated on
// `project:update` before the `work` resource existed. Any already-issued API
// key/OAuth scope still carries only `project:update` — accept EITHER scope so
// old keys keep working while new grants can be issued against `work` going
// forward. Same-file, literal-argument helper so scripts/generate-api-registry.mts's
// local-helper inlining picks up both scopePairs.
async function requireWorkOrProjectOrgUpdate(ctx: MutationCtx, orgId: string): Promise<void> {
  try {
    await requireOrgPermission(ctx, orgId, "work", "update");
  } catch {
    await requireOrgPermission(ctx, orgId, "project", "update");
  }
}

/** Validate an assignee (user member OR crew) belongs to the org; reject if both set.
 *  Exported — workSignalStatesWrites.ts's promoteSignalNative shares this rather
 *  than re-declaring the same check (R-3.1). */
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

interface RawChecklistItem { id?: string; text?: string; done?: unknown }
function normaliseChecklist(checklist: RawChecklistItem[] | null | undefined): unknown {
  if (checklist === undefined) return undefined;
  if (checklist === null) return [];
  return checklist.map((c) => ({ id: c.id, text: c.text, done: !!c.done }));
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

// Shared editable fields (title is added per-mutation: required on create, optional on
// update). status/priority use the enum validators so the inserted/patched value is the
// typed union the schema expects.
const taskWriteFields = {
  description: v.optional(v.union(v.string(), v.null())),
  status: v.optional(enums.ProjectTaskStatus),
  priority: v.optional(enums.ProjectTaskPriority),
  dueDate: v.optional(v.union(v.number(), v.null())),
  assigneeUserId: v.optional(v.union(v.string(), v.null())),
  assigneeCrewId: v.optional(v.union(v.string(), v.null())),
  checklist: v.optional(v.union(v.array(v.any()), v.null())),
  kind: v.optional(enums.ProjectTaskKind),
};

/**
 * Resolves where a new top-level/subtask/personal task lands: its projectId,
 * stage, and next sortOrder. Split out of createNative (R-3.6) purely to keep
 * that handler's complexity down — the parentId/projectId/personal branching
 * is the same three-way split described on createNative's own args above.
 */
async function resolveNewTaskPlacement(
  ctx: MutationCtx,
  a: { orgId: string; projectId?: string; parentId?: string; stage?: WorkStage },
): Promise<{ projectId: string | undefined; stage: WorkStage | undefined; sortOrder: number }> {
  if (a.parentId) {
    const parent = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", a.parentId as string)).first();
    if (!parent || parent.organizationId !== a.orgId) throw new ConvexError("Parent task not found");
    const siblings = await ctx.db.query("projectTasks").withIndex("by_parentId", (q) => q.eq("parentId", a.parentId as string)).collect();
    const sortOrder = siblings.reduce((max, t) => Math.max(max, t.sortOrder ?? 0), 0) + 1;
    // inherited, never the caller's own projectId; a subtask never carries its own stage
    return { projectId: parent.projectId, stage: undefined, sortOrder };
  }
  if (a.projectId) {
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", a.projectId as string)).first();
    if (!project || project.organizationId !== a.orgId) throw new ConvexError("Project not found");
    const stage = a.stage ?? (project.status ? defaultStageForProjectStatus(project.status) : undefined);
    const existing = await ctx.db.query("projectTasks").withIndex("by_projectId", (q) => q.eq("projectId", a.projectId as string)).collect();
    const sortOrder = existing.reduce((max, t) => Math.max(max, t.sortOrder ?? 0), 0) + 1;
    return { projectId: a.projectId, stage, sortOrder };
  }
  // A personal task — no project, no parent.
  return { projectId: undefined, stage: a.stage, sortOrder: 0 };
}

interface NewTaskFields {
  id: string; orgId: string; parentId?: string;
  description?: string | null; status?: WorkItemStatus; priority?: WorkItemPriority;
  dueDate?: number | null; assigneeUserId?: string | null; assigneeCrewId?: string | null;
  checklist?: RawChecklistItem[] | null; kind?: WorkItemKind; now: number; actor: { userId: string };
}

// Convex's optional-field convention: `undefined` omits the field, a stored
// `null` doesn't. These normalise a client-supplied null/empty value to
// `undefined` in ONE branch each, so calling them repeatedly below adds no
// complexity to the caller (R-3.6) — only the two helpers themselves branch.
const orUndef = <T,>(v: T | null | undefined): T | undefined => v ?? undefined;
const falsyOrUndef = (v: string | null | undefined): string | undefined => v || undefined;
const trimmedOrUndef = (v: string | null | undefined): string | undefined => v?.trim() || undefined;

/** Split out of createNative (R-3.6) — the field-normalisation that used to
 *  sit inline in the ctx.db.insert() call. */
function buildNewTaskDoc(
  a: NewTaskFields,
  placement: { projectId: string | undefined; stage: WorkStage | undefined; sortOrder: number },
  title: string,
) {
  const status = a.status ?? "TODO";
  return {
    id: a.id,
    organizationId: a.orgId,
    projectId: placement.projectId,
    parentId: orUndef(a.parentId),
    title,
    description: trimmedOrUndef(a.description),
    status,
    priority: a.priority ?? "NORMAL",
    dueDate: orUndef(a.dueDate),
    assigneeUserId: falsyOrUndef(a.assigneeUserId),
    assigneeCrewId: falsyOrUndef(a.assigneeCrewId),
    checklist: orUndef(normaliseChecklist(a.checklist)),
    kind: a.kind,
    stage: placement.stage,
    createdById: a.actor.userId,
    completedAt: status === "DONE" ? a.now : undefined,
    sortOrder: placement.sortOrder,
    createdAt: a.now,
    updatedAt: a.now,
  };
}

export const createNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    // Absent = a personal task (Phase 1, #1243 — quick-add without a project).
    // Ignored when `parentId` is set: a subtask always inherits its parent's project.
    projectId: v.optional(v.string()),
    // A subtask — inherits organizationId/projectId from the parent and never
    // carries its own `stage` (design doc §10.1: "a child ... has no stage").
    parentId: v.optional(v.string()),
    orgId: v.string(),
    title: v.string(),
    stage: v.optional(enums.ProjectTaskStage),
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

    await assertAssigneeInOrg(ctx, a.orgId, a.assigneeUserId, a.assigneeCrewId);

    const placement = await resolveNewTaskPlacement(ctx, a);
    await ctx.db.insert("projectTasks", buildNewTaskDoc({ ...a, actor }, placement, title));

    await logTask(ctx, { orgId: a.orgId, projectId: placement.projectId, actor, auditId: a.auditId, now: a.now, action: "created", entityId: a.id, entityName: title, summary: `Added task "${title}"` });
    return { id: a.id };
  },
});

export const updateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    title: v.optional(v.string()),
    stage: v.optional(v.union(enums.ProjectTaskStage, v.null())),
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
    await assertAssigneeInOrg(ctx, a.orgId, a.assigneeUserId, a.assigneeCrewId);

    // Clears use `undefined` (Convex removes the optional field) — the schema
    // columns are v.optional(...) and reject an explicit null.
    const patch: Record<string, unknown> = { updatedAt: a.now };
    if (a.title !== undefined) patch.title = a.title.trim();
    if (a.description !== undefined) patch.description = a.description?.trim() || undefined;
    if (a.status !== undefined) patch.status = a.status;
    if (a.priority !== undefined) patch.priority = a.priority;
    if (a.dueDate !== undefined) patch.dueDate = a.dueDate ?? undefined;
    if (a.assigneeUserId !== undefined) patch.assigneeUserId = a.assigneeUserId || undefined;
    if (a.assigneeCrewId !== undefined) patch.assigneeCrewId = a.assigneeCrewId || undefined;
    if (a.checklist !== undefined) patch.checklist = normaliseChecklist(a.checklist);
    if (a.kind !== undefined) patch.kind = a.kind;
    // A subtask never carries its own stage (design doc §10.1) — silently ignore a
    // stage patch on a child row rather than erroring on what's a client no-op.
    if (a.stage !== undefined && !doc.parentId) patch.stage = a.stage ?? undefined;
    if (a.status !== undefined && a.status !== doc.status) {
      patch.completedAt = a.status === "DONE" ? a.now : undefined;
    }
    // Enforce user-XOR-crew on the MERGED row (assertAssigneeInOrg only sees the
    // incoming fields): assigning one clears the other so a task can't end up with both.
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
    // user-XOR-crew on the merged row: bulk-assigning one clears the other.
    if (set.assigneeUserId) set.assigneeCrewId = undefined;
    else if (set.assigneeCrewId) set.assigneeUserId = undefined;

    const projectIds = new Set<string>();
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
      if (doc.projectId) projectIds.add(doc.projectId);
      updated++;
    }

    if (updated > 0) {
      await logTask(ctx, { orgId: a.orgId, projectId: [...projectIds][0], actor, auditId: a.auditId, now: a.now, action: "updated", entityId: a.ids[0], entityName: `${updated} task${updated === 1 ? "" : "s"}`, summary: `Bulk updated ${updated} task${updated === 1 ? "" : "s"}` });
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
    await requireWorkOrProjectOrgUpdate(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);
    if (a.ids.length === 0) return { deleted: 0, skipped: 0 };

    const projectIds = new Set<string>();
    let deleted = 0;
    let skipped = 0;
    for (const id of a.ids) {
      const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      if (!doc || doc.organizationId !== a.orgId) { skipped++; continue; }
      await ctx.db.delete(doc._id);
      if (doc.projectId) projectIds.add(doc.projectId);
      deleted++;
    }

    if (deleted > 0) {
      await logTask(ctx, { orgId: a.orgId, projectId: [...projectIds][0], actor, auditId: a.auditId, now: a.now, action: "deleted", entityId: a.ids[0], entityName: `${deleted} task${deleted === 1 ? "" : "s"}`, summary: `Deleted ${deleted} task${deleted === 1 ? "" : "s"}` });
    }
    return { deleted, skipped };
  },
});

export const agentOps: AgentOpsAnnotations = {
  bulkDeleteNative: { danger: "high" },
  bulkUpdateNative: { danger: "medium" },
  createNative: { danger: "medium" },
  deleteNative: { danger: "high" },
  updateNative: { danger: "medium" },
};
