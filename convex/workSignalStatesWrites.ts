import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { getAuthContext, isMemberAuth, requireSelfScope, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import * as enums from "./lib/validators";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assertAssigneeInOrg } from "./projectTasksWrites";

/**
 * Browser-direct USER-scoped writes for `workSignalStates` (#1243 Phase 1, design
 * doc §9/§10.3) — a human's decision (snooze/dismiss/promote) about a DERIVED
 * Triage signal. Same posture as notificationsWrites.ts: a row is owned by the
 * (organizationId, userId) baked into the VERIFIED token, so every write here only
 * ever touches the caller's OWN decisions in their active org. A signal is never
 * stored itself (§9) — only the human's reaction to it is.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

async function requireSelfAuth(ctx: MutationCtx): Promise<{ orgId: string; userId: string }> {
  const auth = await getAuthContext(ctx);
  if (!isMemberAuth(auth)) throw new ConvexError("Unauthorized: a signed-in user is required.");
  if (!auth.orgId) throw new ConvexError("Forbidden: no active organization.");
  await requireSelfScope(ctx, "write");
  return { orgId: auth.orgId, userId: auth.userId };
}

async function upsertSignalState(
  ctx: MutationCtx,
  orgId: string,
  userId: string,
  sourceKey: string,
  patch: { state: "snoozed" | "dismissed" | "promoted"; snoozedUntil?: number; promotedWorkItemId?: string },
  now: number,
) {
  const existing = await ctx.db
    .query("workSignalStates")
    .withIndex("by_organizationId_userId_sourceKey", (q) =>
      q.eq("organizationId", orgId).eq("userId", userId).eq("sourceKey", sourceKey),
    )
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, {
      state: patch.state,
      snoozedUntil: patch.snoozedUntil,
      promotedWorkItemId: patch.promotedWorkItemId,
      updatedAt: now,
    });
    return existing.id;
  }
  const id = createId();
  await ctx.db.insert("workSignalStates", {
    id,
    organizationId: orgId,
    userId,
    sourceKey,
    state: patch.state,
    snoozedUntil: patch.snoozedUntil,
    promotedWorkItemId: patch.promotedWorkItemId,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/** Snooze a signal until a given time — it stops appearing in Triage until then. */
export const snoozeSignalNative = mutation({
  returns: v.null(),
  args: { sourceKey: v.string(), snoozedUntil: v.number(), now: v.number() },
  handler: async (ctx, { sourceKey, snoozedUntil, now }) => {
    await assertWritesEnabled(ctx, "workSignalState");
    await enforceBrowserWriteLimit(ctx);
    const { orgId, userId } = await requireSelfAuth(ctx);
    await upsertSignalState(ctx, orgId, userId, sourceKey, { state: "snoozed", snoozedUntil }, now);
    return null;
  },
});

/** Dismiss a signal — it stops appearing in Triage for this user, permanently
 *  (until the underlying entity changes and produces a new signal). */
export const dismissSignalNative = mutation({
  returns: v.null(),
  args: { sourceKey: v.string(), now: v.number() },
  handler: async (ctx, { sourceKey, now }) => {
    await assertWritesEnabled(ctx, "workSignalState");
    await enforceBrowserWriteLimit(ctx);
    const { orgId, userId } = await requireSelfAuth(ctx);
    await upsertSignalState(ctx, orgId, userId, sourceKey, { state: "dismissed" }, now);
    return null;
  },
});

/**
 * Materialise a derived signal into a real `projectTasks` row (design doc §9:
 * "assigning a system signal to someone who is not its default owner requires
 * materialising it as a real work item first"). Creates the task AND records the
 * `promoted` decision against `sourceKey` in one transaction, so a signal can
 * never end up "promoted" with no row to show for it or vice versa.
 *
 * Defaults the assignee to the promoting user (the common case — someone acting
 * on their own signal) unless an explicit assigneeUserId/assigneeCrewId is given.
 */
export const promoteSignalNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    sourceKey: v.string(),
    title: v.string(),
    projectId: v.optional(v.string()),
    assigneeUserId: v.optional(v.string()),
    assigneeCrewId: v.optional(v.string()),
    dueDate: v.optional(v.number()),
    priority: v.optional(enums.ProjectTaskPriority),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "workSignalState");
    await enforceBrowserWriteLimit(ctx);
    const { orgId, userId } = await requireSelfAuth(ctx);
    const actor = await resolveActor(ctx, a.actor);

    const title = a.title.trim();
    if (!title) throw new ConvexError("Task title is required");

    if (a.projectId) {
      const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", a.projectId as string)).first();
      if (!project || project.organizationId !== orgId) throw new ConvexError("Project not found");
    }

    // Default to self only when no crew assignee is given, so the XOR
    // (user OR crew, never both) below can never be violated by the default.
    const assigneeUserId = a.assigneeCrewId ? undefined : (a.assigneeUserId ?? userId);
    await assertAssigneeInOrg(ctx, orgId, assigneeUserId, a.assigneeCrewId);

    const id = createId();
    await ctx.db.insert("projectTasks", {
      id,
      organizationId: orgId,
      projectId: a.projectId,
      title,
      status: "TODO",
      priority: a.priority ?? "NORMAL",
      dueDate: a.dueDate,
      assigneeUserId,
      assigneeCrewId: a.assigneeCrewId,
      sourceKey: a.sourceKey,
      createdById: actor.userId,
      sortOrder: 0,
      createdAt: a.now,
      updatedAt: a.now,
    });

    await writeActivityLog(ctx, {
      id: a.auditId,
      organizationId: orgId,
      action: "created",
      entityType: "ProjectTask",
      entityId: id,
      entityName: title,
      projectId: a.projectId,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Promoted a signal to task "${title}"`,
      createdAt: a.now,
    });

    await upsertSignalState(ctx, orgId, userId, a.sourceKey, { state: "promoted", promotedWorkItemId: id }, a.now);
    return { id };
  },
});

/**
 * Phase 1 danger classification (#1243). Personal-scope (self:write) signal
 * bookkeeping, mirroring notificationsWrites.ts's low classification for
 * snooze/dismiss — promote is `medium` because it creates a real, org-visible
 * work item (same tier as projectTasksWrites.createNative).
 */
export const agentOps: AgentOpsAnnotations = {
  snoozeSignalNative: { danger: "low" },
  dismissSignalNative: { danger: "low" },
  promoteSignalNative: { danger: "medium" },
};
