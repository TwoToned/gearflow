import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit, assertBulkSizeOk } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { assertArrayMax, assertNumRange, assertStrLen } from "./lib/fieldGuards";
import * as enums from "./lib/validators";
import { defaultStageForProjectStatus, type WorkStage, type WorkItemStatus, type WorkItemPriority, type WorkItemKind } from "./lib/workVocabulary";
import { computeNextOccurrenceDueDate, type WorkRecurrenceSpec } from "./lib/workRecurrence";
import { resolveOrgQuoteConfig } from "./lib/orgSettings";
import { automationForHumanChange, reconcileFollowUps } from "./lib/followUpReconcile";
import { insertClientActivity } from "./clientTimelineWrites";
import { startOfDayInTimezone } from "./lib/quoteDates";

/** Bound on watcherUserIds — mirrors the cap other free-form id arrays on this
 *  table use (tags, checklist); a browser-direct caller bypassing client Zod
 *  must not be able to write an unbounded array (R-8.6.2). */
const MAX_WATCHERS = 50;

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
  // The span's opening end. A row with both dates RUNS from startDate to
  // dueDate — it draws as a bar on the Work tab's calendar and stays visible
  // in every list for the whole stretch. It is NOT a defer/"not before" date:
  // nothing hides a row until its start (the schema's original Phase-1 comment
  // said otherwise, but the field was never wired to anything, so this is the
  // first and only meaning it has ever had). `assertDateSpanOrdered` below is
  // what keeps it from outliving its own end.
  startDate: v.optional(v.union(v.number(), v.null())),
  assigneeUserId: v.optional(v.union(v.string(), v.null())),
  assigneeCrewId: v.optional(v.union(v.string(), v.null())),
  checklist: v.optional(v.union(v.array(v.any()), v.null())),
  kind: v.optional(enums.ProjectTaskKind),
  // #1244 — recurrence never lives on a subtask (same as stage); a client
  // clearing recurrence passes `null`, matching every other clearable field
  // on this table's Convex convention (`undefined` omits, `null` clears).
  recurrence: v.optional(v.union(enums.ProjectTaskRecurrence, v.null())),
  watcherUserIds: v.optional(v.union(v.array(v.string()), v.null())),
};

/**
 * A span cannot end before it begins.
 *
 * Checked against the RESULTING row, not the incoming args, because an update
 * that moves only one end still has to hold against the end already stored —
 * patching `dueDate` earlier than an untouched `startDate` is exactly the
 * inversion a naive "both args present" check waves through. The browser-direct
 * `*Native` mutations are callable by anyone with a session, so this lives here
 * and not only in the client Zod schema (see "The write security bar",
 * FEATUREDOCS/54).
 */
function assertDateSpanOrdered(start: number | undefined, due: number | undefined): void {
  if (start == null || due == null) return;
  if (start > due) throw new ConvexError("Work cannot start after it is due");
}

/** Validate every watcher id is an org member. Mirrors assertAssigneeInOrg's
 *  shape but for an array — a watcher is always a user, never crew (design
 *  §8.2 has no "crew watches a task" concept). */
async function assertWatchersInOrg(ctx: MutationCtx, orgId: string, watcherUserIds: string[] | undefined) {
  if (!watcherUserIds || watcherUserIds.length === 0) return;
  assertArrayMax(watcherUserIds, "watcherUserIds", MAX_WATCHERS);
  for (const userId of new Set(watcherUserIds)) {
    const member = await ctx.db
      .query("members")
      .withIndex("by_org_user", (q) => q.eq("organizationId", orgId).eq("userId", userId))
      .first();
    if (!member) throw new ConvexError("A watcher must be a member of this organization");
  }
}

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
  dueDate?: number | null; startDate?: number | null;
  assigneeUserId?: string | null; assigneeCrewId?: string | null;
  checklist?: RawChecklistItem[] | null; kind?: WorkItemKind; now: number; actor: { userId: string };
  recurrence?: WorkRecurrenceSpec | null; watcherUserIds?: string[] | null;
}

// Convex's optional-field convention: `undefined` omits the field, a stored
// `null` doesn't. These normalise a client-supplied null/empty value to
// `undefined` in ONE branch each, so calling them repeatedly below adds no
// complexity to the caller (R-3.6) — only the two helpers themselves branch.
const orUndef = <T,>(v: T | null | undefined): T | undefined => v ?? undefined;
const falsyOrUndef = (v: string | null | undefined): string | undefined => v || undefined;
const trimmedOrUndef = (v: string | null | undefined): string | undefined => v?.trim() || undefined;

/**
 * A personal item — no project AND no parent — with no explicit assignee
 * defaults to its creator.
 *
 * Without this the row is written with neither an owner nor a project, and
 * NOTHING reads it: `projectTasks.myOpenTasks` only range-scans
 * `by_assigneeUserId_status`/`by_assigneeCrewId_status`, and every project
 * surface needs a `projectId`. `/my-tasks` is a redirect and work isn't in
 * `globalSearch`, so such a row is invisible permanently — which is exactly
 * what Today's quick-add produced (`create({ title })`). See
 * `docs/designs/work-layer-v2-integration.md` §3, the routing rule: every item
 * has an owner, a project, or both.
 *
 * The fallback is the VERIFIED actor, who already passed
 * `requireWorkOrProjectOrgUpdate` for this org, so it can't introduce an
 * assignee `assertAssigneeInOrg` would have rejected. It's deliberately the
 * backstop rather than the only guard — the composer states the destination up
 * front (§4.1) — because every other writer (templates, Mira, the MCP create
 * tool) funnels through here too, and a default in one shared mutation covers
 * all of them.
 *
 * Deliberately NOT applied when a project IS set: unowned project work is a
 * legitimate state, made visible by the rail's "Nobody" lane and the Overview
 * card's unowned count rather than silently absorbed by whoever typed it.
 * A subtask is excluded because it never renders as a standalone row — it
 * shows nested under its parent, which carries the ownership.
 */
function resolvePersonalOwnerFallback(
  a: NewTaskFields,
  placement: { projectId: string | undefined },
): string | undefined {
  if (placement.projectId || a.parentId) return undefined;
  if (falsyOrUndef(a.assigneeUserId) || falsyOrUndef(a.assigneeCrewId)) return undefined;
  return a.actor.userId;
}

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
    startDate: orUndef(a.startDate),
    assigneeUserId: falsyOrUndef(a.assigneeUserId) ?? resolvePersonalOwnerFallback(a, placement),
    assigneeCrewId: falsyOrUndef(a.assigneeCrewId),
    checklist: orUndef(normaliseChecklist(a.checklist)),
    kind: a.kind,
    // A subtask never carries its own recurrence, same rule as stage.
    recurrence: a.parentId ? undefined : orUndef(a.recurrence),
    watcherUserIds: orUndef(a.watcherUserIds),
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
    await assertWatchersInOrg(ctx, a.orgId, a.watcherUserIds ?? undefined);
    assertDateSpanOrdered(orUndef(a.startDate), orUndef(a.dueDate));

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
    await assertWatchersInOrg(ctx, a.orgId, a.watcherUserIds ?? undefined);

    // Clears use `undefined` (Convex removes the optional field) — the schema
    // columns are v.optional(...) and reject an explicit null.
    const patch: Record<string, unknown> = { updatedAt: a.now };
    if (a.title !== undefined) patch.title = a.title.trim();
    if (a.description !== undefined) patch.description = a.description?.trim() || undefined;
    if (a.status !== undefined) patch.status = a.status;
    if (a.priority !== undefined) patch.priority = a.priority;
    if (a.dueDate !== undefined) patch.dueDate = a.dueDate ?? undefined;
    if (a.startDate !== undefined) patch.startDate = a.startDate ?? undefined;
    if (a.assigneeUserId !== undefined) patch.assigneeUserId = a.assigneeUserId || undefined;
    if (a.assigneeCrewId !== undefined) patch.assigneeCrewId = a.assigneeCrewId || undefined;
    if (a.checklist !== undefined) patch.checklist = normaliseChecklist(a.checklist);
    if (a.kind !== undefined) patch.kind = a.kind;
    // A subtask never carries its own stage/recurrence (design doc §10.1) —
    // silently ignore either patch on a child row rather than erroring on
    // what's a client no-op.
    if (a.stage !== undefined && !doc.parentId) patch.stage = a.stage ?? undefined;
    if (a.recurrence !== undefined && !doc.parentId) patch.recurrence = a.recurrence ?? undefined;
    if (a.watcherUserIds !== undefined) patch.watcherUserIds = a.watcherUserIds ?? undefined;
    // Against the row as it will BE, not as it arrived: moving one end has to
    // hold against the end already stored.
    assertDateSpanOrdered(
      (a.startDate !== undefined ? (a.startDate ?? undefined) : doc.startDate),
      (a.dueDate !== undefined ? (a.dueDate ?? undefined) : doc.dueDate),
    );
    if (a.status !== undefined && a.status !== doc.status) {
      patch.completedAt = a.status === "DONE" ? a.now : undefined;
    }
    // Enforce user-XOR-crew on the MERGED row (assertAssigneeInOrg only sees the
    // incoming fields): assigning one clears the other so a task can't end up with both.
    if (patch.assigneeUserId) patch.assigneeCrewId = undefined;
    else if (patch.assigneeCrewId) patch.assigneeUserId = undefined;
    // Follow-up automation (design §8.2): a human edit locks the field; a close
    // records how it was closed so the ladder advances or stops.
    const automation = automationForHumanChange(doc, {
      status: a.status,
      dueDate: a.dueDate !== undefined && (a.dueDate ?? undefined) !== doc.dueDate,
      title: a.title !== undefined && a.title.trim() !== doc.title,
      assignee: a.assigneeUserId !== undefined || a.assigneeCrewId !== undefined,
    }, actor.userId);
    if (automation) patch.automation = automation;

    await ctx.db.patch(doc._id, patch);
    if (automation) await reconcileFollowUps(ctx, { orgId: a.orgId, projectId: doc.projectId, now: a.now });
    const title = (patch.title as string | undefined) ?? doc.title;
    await logTask(ctx, { orgId: a.orgId, projectId: doc.projectId, actor, auditId: a.auditId, now: a.now, action: "updated", entityId: a.id, entityName: title, summary: `Updated task "${title}"` });

    // #1244 — "the next occurrence is created when the current one is done
    // ... never pre-generated" (design §8.2, the Todoist model). Only on an
    // ACTUAL transition into DONE (never a re-save that's already DONE).
    // Re-fetches the just-patched doc rather than hand-merging `doc`+`patch`
    // field by field (R-3.6: keeps this handler's own complexity down, and
    // is trivially correct — it's exactly what got written, not a
    // reconstruction of it).
    const becameDone = a.status === "DONE" && doc.status !== "DONE";
    if (becameDone) {
      const patched = await ctx.db.get(doc._id);
      if (patched?.recurrence) await spawnNextOccurrence(ctx, patched, patched.recurrence, actor, a.now);
    }

    return { id: a.id };
  },
});

/** Create the next occurrence of a recurring task once the current one is
 *  marked DONE — audited like any other creation, but triggered as a system
 *  side effect of the DONE write rather than its own RBAC/rate-limit pass
 *  (those already ran for the mutation that triggered it). */
async function spawnNextOccurrence(
  ctx: MutationCtx,
  current: { organizationId: string; projectId?: string; title: string; description?: string; priority?: string; stage?: string; assigneeUserId?: string; assigneeCrewId?: string; dueDate?: number; tags?: string[]; watcherUserIds?: string[] },
  recurrence: WorkRecurrenceSpec,
  actor: Actor,
  now: number,
) {
  const config = await resolveOrgQuoteConfig(ctx, current.organizationId);
  const nextDueDate = computeNextOccurrenceDueDate(current.dueDate ?? now, recurrence, config.timezone);
  const id = createId();
  await ctx.db.insert("projectTasks", {
    id,
    organizationId: current.organizationId,
    projectId: current.projectId,
    title: current.title,
    description: current.description,
    status: "TODO",
    priority: (current.priority as WorkItemPriority | undefined) ?? "NORMAL",
    dueDate: nextDueDate,
    stage: current.stage as WorkStage | undefined,
    assigneeUserId: current.assigneeUserId,
    assigneeCrewId: current.assigneeCrewId,
    tags: current.tags,
    watcherUserIds: current.watcherUserIds,
    recurrence,
    createdById: actor.userId,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  });
  await logTask(ctx, {
    orgId: current.organizationId,
    projectId: current.projectId,
    actor,
    auditId: createId(),
    now,
    action: "created",
    entityId: id,
    entityName: current.title,
    summary: `Recurring task "${current.title}" — next occurrence created`,
  });
}

/** Delete one task row. An automated follow-up is SOFT-deleted instead: its
 *  tombstone is what stops that rung coming back on the next reconcile
 *  (follow-up automation design §8.2). Returns true when it was automated. */
async function removeTaskRow(ctx: MutationCtx, doc: Doc<"projectTasks">, userId: string, now: number): Promise<boolean> {
  const automation = automationForHumanChange(doc, { deleted: true }, userId);
  if (!automation) {
    await ctx.db.delete(doc._id);
    return false;
  }
  await ctx.db.patch(doc._id, { status: "CANCELLED", completedAt: now, updatedAt: now, automation });
  return true;
}

/** Bulk delete body: per-row org re-check, soft-delete for automated rows,
 *  then ONE reconcile per project that had one (never inside the loop). */
async function removeTaskRows(ctx: MutationCtx, ids: string[], orgId: string, userId: string, now: number) {
  const projectIds = new Set<string>();
  const automatedProjectIds = new Set<string>();
  let deleted = 0;
  for (const id of ids) {
    const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!doc || doc.organizationId !== orgId) continue;
    const automated = await removeTaskRow(ctx, doc, userId, now);
    if (doc.projectId) (automated ? automatedProjectIds : projectIds).add(doc.projectId);
    deleted++;
  }
  for (const projectId of automatedProjectIds) {
    projectIds.add(projectId);
    await reconcileFollowUps(ctx, { orgId, projectId, now });
  }
  return { projectIds, deleted, skipped: ids.length - deleted };
}

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

    if (await removeTaskRow(ctx, doc, actor.userId, a.now)) {
      await reconcileFollowUps(ctx, { orgId: a.orgId, projectId: doc.projectId, now: a.now });
    }
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
    const automatedProjectIds = new Set<string>();
    let updated = 0;
    let skipped = 0;
    for (const id of a.ids) {
      const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      if (!doc || doc.organizationId !== a.orgId) { skipped++; continue; }
      const applied: Record<string, unknown> = { ...set, updatedAt: a.now };
      if (set.status !== undefined && set.status !== doc.status) {
        applied.completedAt = set.status === "DONE" ? a.now : undefined;
      }
      const automation = automationForHumanChange(doc, {
        status: a.status,
        dueDate: a.dueDate !== undefined,
        assignee: a.assigneeUserId !== undefined || a.assigneeCrewId !== undefined,
      }, actor.userId);
      if (automation) {
        applied.automation = automation;
        if (doc.projectId) automatedProjectIds.add(doc.projectId);
      }
      await ctx.db.patch(doc._id, applied);
      if (doc.projectId) projectIds.add(doc.projectId);
      updated++;
    }
    // Once per distinct project, after the loop — never inside it.
    for (const projectId of automatedProjectIds) await reconcileFollowUps(ctx, { orgId: a.orgId, projectId, now: a.now });

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

    const { projectIds, deleted, skipped } = await removeTaskRows(ctx, a.ids, a.orgId, actor.userId, a.now);

    if (deleted > 0) {
      await logTask(ctx, { orgId: a.orgId, projectId: [...projectIds][0], actor, auditId: a.auditId, now: a.now, action: "deleted", entityId: a.ids[0], entityName: `${deleted} task${deleted === 1 ? "" : "s"}`, summary: `Deleted ${deleted} task${deleted === 1 ? "" : "s"}` });
    }
    return { deleted, skipped };
  },
});

/**
 * Browser-direct drag-reorder (#1244, design §8.3) — assigns sortOrder=index
 * for each id in `orderedIds`, in ONE mutation round trip, exactly the shape
 * `lineItemWrites.reorderNative` already established (see that file's own
 * comment). The existing `reorderMany` in `convex/projectTasks.ts` stays
 * `requireService`-gated and untouched — it has no production caller and
 * this is its browser-reachable sibling, not a replacement.
 *
 * Scope: `orderedIds` is exactly the set of siblings being reordered — a
 * stage column on the Work tab, or one project's flat list. Per-item org
 * re-check (by_cuid is global); a foreign id is silently skipped, mirroring
 * reorderMany's own posture, rather than failing the whole drag over one bad
 * id. Structural only (sortOrder, never money or status) — never gated.
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

/** Toggle the CALLING user's own watcher membership on a task — the common
 *  "watch this" / "stop watching" UI action, split out from updateNative's
 *  general watcherUserIds patch (which stays for bulk/admin edits of the
 *  whole list) so a single click never risks clobbering someone else's
 *  concurrent watch/unwatch. `requireWorkOrProjectOrgUpdate` (not self-scope):
 *  watching is task-collaboration, gated the same as every other task edit —
 *  not a personal-only surface like workSignalStates. */
export const setWatchingNative = mutation({
  returns: v.object({ watching: v.boolean() }),
  args: { id: v.string(), orgId: v.string(), userId: v.string(), watching: v.boolean(), now: v.number() },
  handler: async (ctx, { id, orgId, userId, watching, now }) => {
    await assertWritesEnabled(ctx, "projectTask");
    await enforceBrowserWriteLimit(ctx);
    await requireWorkOrProjectOrgUpdate(ctx, orgId);

    const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!doc || doc.organizationId !== orgId) throw new ConvexError("Task not found");

    const member = await ctx.db.query("members").withIndex("by_org_user", (q) => q.eq("organizationId", orgId).eq("userId", userId)).first();
    if (!member) throw new ConvexError("Not a member of this organization");

    const current = new Set(doc.watcherUserIds ?? []);
    if (watching) current.add(userId);
    else current.delete(userId);
    const next = [...current];
    assertArrayMax(next, "watcherUserIds", MAX_WATCHERS);

    await ctx.db.patch(doc._id, { watcherUserIds: next.length > 0 ? next : undefined, updatedAt: now });
    return { watching };
  },
});

const FOLLOW_UP_NOTE_BOUNDS = { max: 500 } as const;

/** An automated follow-up that is still open, org-checked (by_cuid is global). */
async function loadOpenAutomatedTask(ctx: MutationCtx, id: string, orgId: string): Promise<Doc<"projectTasks">> {
  const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  if (!doc || doc.organizationId !== orgId) throw new ConvexError("Task not found");
  if (!doc.automation) throw new ConvexError({ code: "NOT_AUTOMATED", message: "Only automated follow-ups record an outcome." });
  if (doc.status === "DONE" || doc.status === "CANCELLED") {
    throw new ConvexError({ code: "ALREADY_CLOSED", message: "This follow-up is already closed." });
  }
  return doc;
}

async function applyFollowUpOutcome(
  ctx: MutationCtx,
  doc: Doc<"projectTasks">,
  outcome: "no_reply" | "parked",
  nextDate: number | undefined,
  userId: string,
  now: number,
): Promise<void> {
  const automation = doc.automation!;
  if (outcome === "no_reply") {
    await ctx.db.patch(doc._id, {
      status: "DONE",
      completedAt: now,
      updatedAt: now,
      automation: { ...automation, resolution: "no_reply", resolvedBy: userId, nextDate },
    });
    return;
  }
  if (nextDate === undefined) throw new ConvexError({ code: "VALIDATION_FAILED", message: "Choose a date to come back to it." });
  const { timezone } = await resolveOrgQuoteConfig(ctx, doc.organizationId);
  await ctx.db.patch(doc._id, {
    dueDate: startOfDayInTimezone(nextDate, timezone),
    snoozedUntil: nextDate,
    automation: { ...automation, lockedFields: [...new Set([...automation.lockedFields, "dueDate"])] },
    updatedAt: now,
  });
}

/** The outcome as a row on the linked client's timeline (the existing
 *  `next_step_completed` substrate, FEATUREDOCS/80). */
async function logFollowUpOutcomeOnTimeline(
  ctx: MutationCtx,
  doc: Doc<"projectTasks">,
  a: { outcome: "no_reply" | "parked"; nextDate?: number; note?: string; actor: Actor; now: number },
): Promise<void> {
  const links = await ctx.db.query("workItemLinks").withIndex("by_workItemId", (q) => q.eq("workItemId", doc.id)).take(100);
  const clientLink = links.find((l) => l.organizationId === doc.organizationId && l.entityType === "client");
  if (!clientLink) return;
  const what = a.outcome === "parked" ? "Parked" : "Followed up — no reply yet";
  const note = a.note?.trim();
  await insertClientActivity(ctx, {
    orgId: doc.organizationId, clientId: clientLink.entityId, actor: a.actor, now: a.now,
    action: "next_step_completed",
    summary: note ? `${what}: ${note}` : what,
    metadata: { workItemId: doc.id, title: doc.title, outcome: a.outcome, nextDate: a.nextDate },
  });
}

/**
 * Record what happened on an automated follow-up (docs/designs/follow-up-automation.md
 * §8.3). Two outcomes only — the ones that keep the loop open:
 *  - `no_reply`: I followed up, no answer yet. Closes this rung; the engine
 *    opens the next one, due on `nextDate` when given, else on the ladder.
 *  - `parked`: the client asked us to come back later. Keeps the row open and
 *    moves (and locks) its due date to `nextDate`.
 * WON and LOST are deliberately NOT outcomes here: they go through the existing
 * `quotesWrites.markAcceptedNative` / `markDeclinedNative` (invoice:publish,
 * danger high), which close the loop themselves via the reconciler.
 */
export const recordFollowUpOutcomeNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    outcome: v.union(v.literal("no_reply"), v.literal("parked")),
    nextDate: v.optional(v.number()),
    note: v.optional(v.string()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectTask");
    await enforceBrowserWriteLimit(ctx);
    await requireWorkOrProjectOrgUpdate(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);
    assertStrLen(a.note, "note", FOLLOW_UP_NOTE_BOUNDS);
    assertNumRange(a.nextDate, "nextDate", { min: a.now - 86_400_000, max: a.now + 366 * 86_400_000 });

    const doc = await loadOpenAutomatedTask(ctx, a.id, a.orgId);

    await applyFollowUpOutcome(ctx, doc, a.outcome, a.nextDate, actor.userId, a.now);
    await logFollowUpOutcomeOnTimeline(ctx, doc, { outcome: a.outcome, nextDate: a.nextDate, note: a.note, actor, now: a.now });
    const summary = a.outcome === "parked" ? `Parked follow-up "${doc.title}"` : `Logged a follow-up with no reply on "${doc.title}"`;
    await logTask(ctx, { orgId: a.orgId, projectId: doc.projectId, actor, auditId: a.auditId, now: a.now, action: "updated", entityId: doc.id, entityName: doc.title, summary });
    await reconcileFollowUps(ctx, { orgId: a.orgId, projectId: doc.projectId, now: a.now });
    return { id: doc.id };
  },
});

export const agentOps: AgentOpsAnnotations = {
  recordFollowUpOutcomeNative: { summary: "Record \"no reply\" or \"parked until a date\" on an automated quote follow-up; the engine schedules the next step.", danger: "medium", mcpTier: 2 },
  bulkDeleteNative: { danger: "high" },
  bulkUpdateNative: { danger: "medium" },
  createNative: { danger: "medium" },
  deleteNative: { danger: "high" },
  updateNative: { danger: "medium" },
  reorderNative: { summary: "Reassign sortOrder for a set of tasks after a drag-reorder.", danger: "low", mcpTier: 3 },
  setWatchingNative: { summary: "Watch or unwatch a task.", danger: "low", mcpTier: 3 },
};
