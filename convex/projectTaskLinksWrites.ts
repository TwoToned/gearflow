import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { emitProjectActivityEvent } from "./lib/activityEvents";
import { undoMarkerId } from "./lib/fieldEditUndo";
import { assertWithinUndoWindow } from "./lib/undoWindow";
import { assertLinkTarget, linkTargetLabel, MAX_LINKS_PER_TASK, type LinkKind } from "./lib/taskLinkTargets";

/**
 * Link / unlink a task to a line item, a file or a discussion thread on its own job
 * (UX Phase 10 Slice E, FEATUREDOCS/50). A link is only a pointer (`projectTaskLinks`).
 *
 * Every write is EXACTLY undoable by ids alone. The forward write stores what it
 * changed in its own audit row (`details.taskLink`: the author, the SERVER clock and,
 * for an unlink, the whole row); the Undo takes ids only and refuses, changing
 * nothing, unless the row is this org's, it is the author's, within the window, not
 * already undone and the link is still as that write left it. An Undo never touches a
 * stored file: a link points at a file, it does not own one.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });
const LinkKindV = v.union(v.literal("lineItem"), v.literal("file"), v.literal("discussion"));

async function requireWorkOrProjectOrgUpdate(ctx: MutationCtx, orgId: string): Promise<void> {
  try {
    await requireOrgPermission(ctx, orgId, "work", "update");
  } catch {
    await requireOrgPermission(ctx, orgId, "project", "update");
  }
}

async function taskInOrg(ctx: MutationCtx, orgId: string, taskId: string): Promise<Doc<"projectTasks">> {
  const task = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", taskId)).first();
  if (!task || task.organizationId !== orgId) throw new ConvexError("Task not found");
  return task;
}

async function linkInOrg(ctx: MutationCtx, orgId: string, id: string): Promise<Doc<"projectTaskLinks"> | null> {
  const link = await ctx.db.query("projectTaskLinks").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  return link && link.organizationId === orgId ? link : null;
}

async function pairExists(ctx: MutationCtx, taskId: string, kind: LinkKind, linkedId: string): Promise<Doc<"projectTaskLinks"> | null> {
  const rows = await ctx.db.query("projectTaskLinks").withIndex("by_taskId", (q) => q.eq("taskId", taskId)).take(MAX_LINKS_PER_TASK + 1);
  return rows.find((r) => r.linkedKind === kind && r.linkedId === linkedId) ?? null;
}

async function logLink(
  ctx: MutationCtx,
  a: { orgId: string; projectId: string | undefined; actor: Actor; auditId: string; now: number; action: string; linkId: string; taskTitle: string; summary: string; details: unknown },
) {
  await writeActivityLog(ctx, {
    id: a.auditId,
    organizationId: a.orgId,
    action: a.action,
    entityType: "ProjectTaskLink",
    entityId: a.linkId,
    entityName: a.taskTitle,
    projectId: a.projectId,
    userId: a.actor.userId,
    userName: a.actor.userName,
    summary: a.summary,
    details: a.details,
    createdAt: a.now,
  });
}

async function linkEvent(ctx: MutationCtx, a: { orgId: string; projectId: string | undefined; actor: Actor; now: number; action: string; summary: string; taskId: string }) {
  if (!a.projectId) return;
  await emitProjectActivityEvent(ctx, { orgId: a.orgId, projectId: a.projectId, actor: a.actor, now: a.now, action: a.action, summary: a.summary, targetType: "task", targetId: a.taskId });
}

/** The forward row an Undo reads: this org's, for this link, and the snapshot block it carries. */
async function readForward(ctx: MutationCtx, orgId: string, auditId: string, linkId: string) {
  const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", auditId)).first();
  // `by_cuid` is global: the row must be this org's, for this link.
  if (!row || row.organizationId !== orgId || row.entityType !== "ProjectTaskLink" || row.entityId !== linkId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "That change was not found, so it can't be undone." });
  }
  const d = (row.details as { taskLink?: { authorId?: string; serverSavedAt?: number; row?: Record<string, unknown> } } | undefined)?.taskLink;
  if (!d || typeof d.authorId !== "string" || typeof d.serverSavedAt !== "number") {
    throw new ConvexError({ code: "NOT_UNDOABLE", message: "That change can't be undone." });
  }
  const marker = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", undoMarkerId(auditId))).first();
  if (marker && marker.organizationId === orgId) throw new ConvexError({ code: "ALREADY_UNDONE", message: "That change was already undone." });
  return { row, authorId: d.authorId, serverSavedAt: d.serverSavedAt, snapshot: d.row };
}

function assertAuthorWithinWindow(authorId: string, actorId: string, serverSavedAt: number) {
  if (authorId !== actorId) throw new ConvexError({ code: "NOT_AUTHOR", message: "Only the person who made a change can undo it." });
  assertWithinUndoWindow(serverSavedAt, Date.now(), "change");
}

async function writeMarker(ctx: MutationCtx, a: { orgId: string; projectId: string | undefined; actor: Actor; now: number; auditId: string; linkId: string; title: string; summary: string }) {
  await logLink(ctx, {
    orgId: a.orgId, projectId: a.projectId, actor: a.actor, auditId: undoMarkerId(a.auditId), now: a.now, action: "UNDO",
    linkId: a.linkId, taskTitle: a.title, summary: a.summary, details: { undoOf: a.auditId },
  });
}

/** Link a task to a target on its own job. Idempotent: an existing pair is returned with `created: false` (no write, no Undo). */
export const linkNative = mutation({
  returns: v.object({ id: v.string(), created: v.boolean() }),
  args: { id: v.string(), orgId: v.string(), taskId: v.string(), linkedKind: LinkKindV, linkedId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectTask");
    await enforceBrowserWriteLimit(ctx);
    await requireWorkOrProjectOrgUpdate(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);

    const task = await taskInOrg(ctx, a.orgId, a.taskId);
    if (!task.projectId) throw new ConvexError("Only a task on a job can link to its items");
    const existing = await pairExists(ctx, a.taskId, a.linkedKind, a.linkedId);
    if (existing) return { id: existing.id, created: false };

    const count = (await ctx.db.query("projectTaskLinks").withIndex("by_taskId", (q) => q.eq("taskId", a.taskId)).take(MAX_LINKS_PER_TASK + 1)).length;
    if (count >= MAX_LINKS_PER_TASK) throw new ConvexError(`A task can link to at most ${MAX_LINKS_PER_TASK} items`);
    const label = await assertLinkTarget(ctx, a.orgId, task.projectId, a.linkedKind, a.linkedId);

    await ctx.db.insert("projectTaskLinks", { id: a.id, organizationId: a.orgId, taskId: a.taskId, linkedKind: a.linkedKind, linkedId: a.linkedId, createdById: actor.userId, createdAt: a.now });
    await logLink(ctx, {
      orgId: a.orgId, projectId: task.projectId, actor, auditId: a.auditId, now: a.now, action: "created", linkId: a.id, taskTitle: task.title,
      summary: `Linked task "${task.title}" to ${linkTargetLabel(a.linkedKind)} "${label}"`,
      details: { taskLink: { authorId: actor.userId, serverSavedAt: Date.now() } },
    });
    await linkEvent(ctx, { orgId: a.orgId, projectId: task.projectId, actor, now: a.now, action: "task_linked", summary: `linked task "${task.title}" to ${linkTargetLabel(a.linkedKind)} "${label}"`, taskId: a.taskId });
    return { id: a.id, created: true };
  },
});

/** Remove one link. Its Undo (`undoUnlinkNative`) re-creates it from the snapshot this write stores. */
export const unlinkNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: { id: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectTask");
    await enforceBrowserWriteLimit(ctx);
    await requireWorkOrProjectOrgUpdate(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);

    const link = await linkInOrg(ctx, a.orgId, a.id);
    if (!link) throw new ConvexError("Link not found");
    const task = await taskInOrg(ctx, a.orgId, link.taskId);
    const row = { id: link.id, organizationId: link.organizationId, taskId: link.taskId, linkedKind: link.linkedKind, linkedId: link.linkedId, createdById: link.createdById, createdAt: link.createdAt };
    await ctx.db.delete(link._id);
    await logLink(ctx, {
      orgId: a.orgId, projectId: task.projectId, actor, auditId: a.auditId, now: a.now, action: "deleted", linkId: link.id, taskTitle: task.title,
      summary: `Unlinked task "${task.title}" from a ${linkTargetLabel(link.linkedKind)}`,
      details: { taskLink: { authorId: actor.userId, serverSavedAt: Date.now(), row } },
    });
    await linkEvent(ctx, { orgId: a.orgId, projectId: task.projectId, actor, now: a.now, action: "task_unlinked", summary: `unlinked task "${task.title}" from a ${linkTargetLabel(link.linkedKind)}`, taskId: task.id });
    return { ok: true };
  },
});

/** Undo a link by its audit id: deletes only that link, only while it still exists. Once. */
export const undoLinkNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: { id: v.string(), orgId: v.string(), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectTask");
    await enforceBrowserWriteLimit(ctx);
    await requireWorkOrProjectOrgUpdate(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);

    const fwd = await readForward(ctx, a.orgId, a.auditId, a.id);
    if (fwd.row.action !== "created") throw new ConvexError({ code: "NOT_UNDOABLE", message: "That change can't be undone." });
    assertAuthorWithinWindow(fwd.authorId, actor.userId, fwd.serverSavedAt);
    const link = await linkInOrg(ctx, a.orgId, a.id);
    if (!link) throw new ConvexError({ code: "CHANGED_SINCE", message: "That link was already removed." });
    await ctx.db.delete(link._id);
    await writeMarker(ctx, { orgId: a.orgId, projectId: fwd.row.projectId, actor, now: a.now, auditId: a.auditId, linkId: a.id, title: fwd.row.entityName, summary: `Undid: ${fwd.row.summary}` });
    return { ok: true };
  },
});

/** Undo an unlink by its audit id: re-creates the link from the snapshot that unlink stored (same id). Once. */
export const undoUnlinkNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "projectTask");
    await enforceBrowserWriteLimit(ctx);
    await requireWorkOrProjectOrgUpdate(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);

    const fwd = await readForward(ctx, a.orgId, a.auditId, a.id);
    const snap = fwd.snapshot as Doc<"projectTaskLinks"> | undefined;
    if (fwd.row.action !== "deleted" || !snap || snap.id !== a.id || snap.organizationId !== a.orgId) {
      throw new ConvexError({ code: "NOT_UNDOABLE", message: "That change can't be undone." });
    }
    assertAuthorWithinWindow(fwd.authorId, actor.userId, fwd.serverSavedAt);
    if (await linkInOrg(ctx, a.orgId, a.id)) throw new ConvexError({ code: "CHANGED_SINCE", message: "That link already exists again." });
    const task = await taskInOrg(ctx, a.orgId, snap.taskId).catch(() => {
      throw new ConvexError({ code: "CHANGED_SINCE", message: "The task no longer exists." });
    });
    if (await pairExists(ctx, snap.taskId, snap.linkedKind, snap.linkedId)) throw new ConvexError({ code: "CHANGED_SINCE", message: "That link already exists again." });
    // The target must still be on this job: a link never points off-job or at another org's row.
    await assertLinkTarget(ctx, a.orgId, task.projectId ?? "", snap.linkedKind, snap.linkedId).catch(() => {
      throw new ConvexError({ code: "CHANGED_SINCE", message: "What it linked to no longer exists." });
    });
    await ctx.db.insert("projectTaskLinks", { id: snap.id, organizationId: snap.organizationId, taskId: snap.taskId, linkedKind: snap.linkedKind, linkedId: snap.linkedId, createdById: snap.createdById, createdAt: snap.createdAt });
    await writeMarker(ctx, { orgId: a.orgId, projectId: fwd.row.projectId, actor, now: a.now, auditId: a.auditId, linkId: a.id, title: fwd.row.entityName, summary: `Undid: ${fwd.row.summary}` });
    return { id: snap.id };
  },
});

export const agentOps: AgentOpsAnnotations = {
  linkNative: { summary: "Link a task to a line item, file or discussion thread on its own job. Idempotent.", danger: "low", mcpTier: 3 },
  unlinkNative: { summary: "Remove one task link.", danger: "medium", mcpTier: 3 },
  undoLinkNative: { summary: "Undo a task link by its audit id: deletes only that link. Once, by its author, within the undo window.", danger: "medium", mcpTier: 3 },
  undoUnlinkNative: { summary: "Undo a task unlink by its audit id: re-creates the link from the snapshot the unlink stored. Once.", danger: "medium", mcpTier: 3 },
};
