import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { assertStrLen } from "./lib/fieldGuards";
import { requireClientInOrg } from "./lib/clientScope";
import { getUserColor } from "./lib/collaborationColors";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { automationForHumanChange, reconcileFollowUps } from "./lib/followUpReconcile";

/**
 * Browser-direct writes for the client relationship layer (#1245, design
 * §8.4): logging a call/email/note (a RECORD of something that happened
 * OUTSIDE Flow — Flow still never emails a client from this feature, D3),
 * and setting/completing a client's "next step" (a `follow_up`-kind
 * `projectTasks` row, linked to the client via `workItemLinks`).
 *
 * Logged entries and next-step outcomes are stored as `activityEvents` rows
 * (entityType "client", `clientId` stamped directly — no resolution needed,
 * unlike `collaboration.ts`'s comment threads) rather than a new table: the
 * client timeline read model (`convex/clientTimeline.ts`) already unions
 * `activityEvents` for its comments/mentions bucket, so a human-logged touch
 * is exactly the same "a plain activity row about this client" shape (R-3.1
 * — one substrate for "things that happened to a client", not two).
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });
const NOTE_BOUNDS = { min: 1, max: 4000 };
const OUTCOME_BOUNDS = { min: 1, max: 500 };
const TITLE_BOUNDS = { min: 1, max: 200 };

async function requireClientOrgUpdate(ctx: MutationCtx, orgId: string): Promise<void> {
  // Logging a touch or setting a next step is a "work" action on the client,
  // not a client-record edit — gate on `work:create` (same resource/tier the
  // rest of the work-layer program uses), not `client:update`.
  await requireOrgPermission(ctx, orgId, "work", "create");
}

export async function insertClientActivity(
  ctx: MutationCtx,
  a: {
    orgId: string;
    clientId: string;
    actor: { userId: string; userName: string };
    action: string;
    summary: string;
    metadata?: unknown;
    now: number;
  },
) {
  await ctx.db.insert("activityEvents", {
    orgId: a.orgId,
    actorUserId: a.actor.userId,
    actorName: a.actor.userName,
    actorColor: getUserColor(a.actor.userId),
    entityType: "client",
    entityId: a.clientId,
    action: a.action,
    summary: a.summary,
    metadata: a.metadata,
    clientId: a.clientId,
    createdAt: a.now,
  });
}

const logFields = {
  orgId: v.string(),
  clientId: v.string(),
  note: v.string(),
  now: v.number(),
  actor: actorValidator,
};

export const logCallNative = mutation({
  returns: v.null(),
  args: logFields,
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "clientTimeline");
    await enforceBrowserWriteLimit(ctx);
    await requireClientOrgUpdate(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);
    const note = a.note.trim();
    assertStrLen(note, "note", NOTE_BOUNDS);
    const client = await requireClientInOrg(ctx, a.clientId, a.orgId);
    await insertClientActivity(ctx, {
      orgId: a.orgId, clientId: a.clientId, actor, now: a.now,
      action: "call_logged",
      summary: note,
      metadata: { clientName: client.name },
    });
    return null;
  },
});

export const logEmailNative = mutation({
  returns: v.null(),
  args: logFields,
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "clientTimeline");
    await enforceBrowserWriteLimit(ctx);
    await requireClientOrgUpdate(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);
    const note = a.note.trim();
    assertStrLen(note, "note", NOTE_BOUNDS);
    const client = await requireClientInOrg(ctx, a.clientId, a.orgId);
    await insertClientActivity(ctx, {
      orgId: a.orgId, clientId: a.clientId, actor, now: a.now,
      action: "email_logged",
      summary: note,
      metadata: { clientName: client.name },
    });
    return null;
  },
});

export const addNoteNative = mutation({
  returns: v.null(),
  args: logFields,
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "clientTimeline");
    await enforceBrowserWriteLimit(ctx);
    await requireClientOrgUpdate(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);
    const note = a.note.trim();
    assertStrLen(note, "note", NOTE_BOUNDS);
    const client = await requireClientInOrg(ctx, a.clientId, a.orgId);
    await insertClientActivity(ctx, {
      orgId: a.orgId, clientId: a.clientId, actor, now: a.now,
      action: "note_added",
      summary: note,
      metadata: { clientName: client.name },
    });
    return null;
  },
});

/**
 * Set a client's next step: a `follow_up`-kind `projectTasks` row (no
 * project required — a next step can be purely client-scoped) linked to the
 * client via `workItemLinks`, in one transaction so a next step can never
 * exist as a task with no client link or vice versa.
 */
export const setNextStepNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    orgId: v.string(),
    clientId: v.string(),
    title: v.string(),
    dueDate: v.number(),
    projectId: v.optional(v.string()),
    notes: v.optional(v.string()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "clientTimeline");
    await enforceBrowserWriteLimit(ctx);
    await requireClientOrgUpdate(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);

    const title = a.title.trim();
    assertStrLen(title, "title", TITLE_BOUNDS);

    const client = await requireClientInOrg(ctx, a.clientId, a.orgId);
    if (a.projectId) {
      const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", a.projectId as string)).first();
      if (!project || project.organizationId !== a.orgId) throw new ConvexError("Project not found");
    }

    const id = createId();
    await ctx.db.insert("projectTasks", {
      id,
      organizationId: a.orgId,
      projectId: a.projectId,
      title,
      description: a.notes?.trim() || undefined,
      status: "TODO",
      priority: "NORMAL",
      kind: "follow_up",
      dueDate: a.dueDate,
      assigneeUserId: actor.userId,
      createdById: actor.userId,
      sortOrder: 0,
      createdAt: a.now,
      updatedAt: a.now,
    });
    await ctx.db.insert("workItemLinks", {
      id: createId(),
      organizationId: a.orgId,
      workItemId: id,
      entityType: "client",
      entityId: a.clientId,
      createdAt: a.now,
    });

    await insertClientActivity(ctx, {
      orgId: a.orgId, clientId: a.clientId, actor, now: a.now,
      action: "next_step_set",
      summary: `Next step: ${title}`,
      metadata: { workItemId: id, dueDate: a.dueDate, clientName: client.name },
    });
    return { id };
  },
});

/**
 * Complete a next step. Requires a one-line outcome (design §8.4: "completing
 * a next step asks for a one-line outcome, which becomes a timeline row") —
 * marks the work item DONE and records the outcome, atomically, so a
 * completed next step can never be silently outcome-less.
 */
export const completeNextStepNative = mutation({
  returns: v.null(),
  args: {
    orgId: v.string(),
    workItemId: v.string(),
    outcome: v.string(),
    now: v.number(),
    actor: actorValidator,
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "clientTimeline");
    await enforceBrowserWriteLimit(ctx);
    await requireClientOrgUpdate(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);

    const outcome = a.outcome.trim();
    assertStrLen(outcome, "outcome", OUTCOME_BOUNDS);

    const task = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", a.workItemId)).first();
    if (!task || task.organizationId !== a.orgId) throw new ConvexError({ code: "NOT_FOUND", message: "Work item not found." });

    const automation = automationForHumanChange(task, { status: "DONE" }, actor.userId);
    await ctx.db.patch(task._id, { status: "DONE", completedAt: a.now, updatedAt: a.now, ...(automation ? { automation } : {}) });
    if (automation) await reconcileFollowUps(ctx, { orgId: a.orgId, projectId: task.projectId, now: a.now });

    const link = await ctx.db
      .query("workItemLinks")
      .withIndex("by_workItemId", (q) => q.eq("workItemId", a.workItemId))
      .filter((q) => q.eq(q.field("entityType"), "client"))
      .first();
    if (link) {
      await insertClientActivity(ctx, {
        orgId: a.orgId, clientId: link.entityId, actor, now: a.now,
        action: "next_step_completed",
        summary: outcome,
        metadata: { workItemId: a.workItemId, title: task.title },
      });
    }
    return null;
  },
});

export const agentOps: AgentOpsAnnotations = {
  logCallNative: { summary: "Log a call with a client (a record, not a channel — Flow never calls out).", danger: "low", mcpTier: 2 },
  logEmailNative: { summary: "Log an email exchanged with a client outside Flow.", danger: "low", mcpTier: 2 },
  addNoteNative: { summary: "Add a free-text note to a client's timeline.", danger: "low", mcpTier: 2 },
  setNextStepNative: { summary: "Set a client's next follow-up step with a due date.", danger: "medium", mcpTier: 2 },
  completeNextStepNative: { summary: "Complete a client's next step with a one-line outcome.", danger: "medium", mcpTier: 2 },
};
