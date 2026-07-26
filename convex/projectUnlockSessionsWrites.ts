import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { assertStrLen } from "./lib/fieldGuards";
import { writeActivityLog } from "./lib/audit";
import { recalcProjectTotals } from "./lib/recalc";
import { resolveOrgDefaultTaxRate } from "./lib/orgSettings";
import { getOpenUnlockSession, requireHardLockOverrideAllowed } from "./lib/projectLocks";
import { captureProjectSnapshot, restoreProjectSnapshot } from "./lib/projectSnapshots";

/**
 * Native PROJECT-UNLOCK-SESSION write mutations (#957 Phase B/D — #791's FINANCIAL
 * scope + #792's FULL scope share this one lifecycle: open (justify + snapshot) →
 * either "Save & relock" (COMMITTED) or "Discard changes" (DISCARDED, restores
 * from the open snapshot). At most one OPEN session per project (enforced here).
 *
 * FULL-scope open/commit/discard is restricted to org admins/owners + the
 * project's assigned PM(s) (#792) — narrower than the general `project:update`
 * permission FINANCIAL scope uses (#791: "any user with project:update can
 * unlock"). Both write an audit entry with the justification in `metadata` in
 * the SAME transaction as the domain change (never a UI-only confirm).
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });
const JUSTIFICATION_BOUNDS = { min: 10, max: 1000 } as const;

async function requireProjectInOrg(ctx: MutationCtx, id: string, orgId: string) {
  const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  if (!p || p.organizationId !== orgId) throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
  return p;
}

function assertJustification(justification: string): void {
  const trimmed = justification.trim();
  if (trimmed.length < JUSTIFICATION_BOUNDS.min) {
    throw new ConvexError({
      code: "INVALID_FIELD",
      message: `Justification must be at least ${JUSTIFICATION_BOUNDS.min} characters.`,
    });
  }
  assertStrLen(trimmed, "justification", JUSTIFICATION_BOUNDS);
}

export const openNative = mutation({
  returns: v.object({ sessionId: v.string(), snapshotId: v.string() }),
  args: {
    projectId: v.string(),
    orgId: v.string(),
    scope: v.union(v.literal("FINANCIAL"), v.literal("FULL")),
    justification: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "project", "update");
    const actor = await resolveActor(ctx, a.actor);

    const project = await requireProjectInOrg(ctx, a.projectId, a.orgId);
    assertJustification(a.justification);

    if (a.scope === "FULL") {
      await requireHardLockOverrideAllowed(ctx, a.orgId, a.projectId, actor.userId);
    }

    const existing = await getOpenUnlockSession(ctx, a.orgId, a.projectId);
    if (existing) {
      throw new ConvexError({
        code: "SESSION_ALREADY_OPEN",
        message: "An unlock session is already open on this project.",
      });
    }

    const snapshotId = await captureProjectSnapshot(ctx, {
      orgId: a.orgId,
      project,
      reason: "UNLOCK",
      actor,
      now: a.now,
    });

    const sessionId = createId();
    const justification = a.justification.trim();
    await ctx.db.insert("projectUnlockSessions", {
      id: sessionId,
      organizationId: a.orgId,
      projectId: a.projectId,
      scope: a.scope,
      justification,
      openedBy: actor.userId,
      openedByName: actor.userName,
      openedAt: a.now,
      snapshotId,
      outcome: "OPEN",
    });

    await writeActivityLog(ctx, {
      id: a.auditId,
      organizationId: a.orgId,
      action: "UNLOCK_OPENED",
      entityType: "project",
      entityId: a.projectId,
      entityName: project.projectNumber,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Opened a ${a.scope === "FULL" ? "full" : "financial"} unlock session on ${project.projectNumber}`,
      metadata: { justification, scope: a.scope, sessionId },
      projectId: a.projectId,
      createdAt: a.now,
    });

    return { sessionId, snapshotId };
  },
});

export const commitNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    projectId: v.string(),
    orgId: v.string(),
    note: v.optional(v.string()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "project", "update");
    const actor = await resolveActor(ctx, a.actor);

    const project = await requireProjectInOrg(ctx, a.projectId, a.orgId);
    const session = await getOpenUnlockSession(ctx, a.orgId, a.projectId);
    if (!session) throw new ConvexError({ code: "NO_OPEN_SESSION", message: "No open unlock session on this project." });
    if (session.scope === "FULL") await requireHardLockOverrideAllowed(ctx, a.orgId, a.projectId, actor.userId);

    assertStrLen(a.note, "note", { max: 1000 });
    await ctx.db.patch(session._id, {
      outcome: "COMMITTED",
      closedAt: a.now,
      closedBy: actor.userId,
      closeNote: a.note,
    });

    await writeActivityLog(ctx, {
      id: a.auditId,
      organizationId: a.orgId,
      action: "UNLOCK_COMMITTED",
      entityType: "project",
      entityId: a.projectId,
      entityName: project.projectNumber,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Saved & relocked (${session.scope.toLowerCase()} unlock session) on ${project.projectNumber}`,
      metadata: { sessionId: session.id, note: a.note },
      projectId: a.projectId,
      createdAt: a.now,
    });

    return { ok: true };
  },
});

export const discardNative = mutation({
  returns: v.object({ ok: v.boolean(), conflicts: v.array(v.string()) }),
  args: {
    projectId: v.string(),
    orgId: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "project", "update");
    const actor = await resolveActor(ctx, a.actor);

    const project = await requireProjectInOrg(ctx, a.projectId, a.orgId);
    const session = await getOpenUnlockSession(ctx, a.orgId, a.projectId);
    if (!session) throw new ConvexError({ code: "NO_OPEN_SESSION", message: "No open unlock session on this project." });
    if (session.scope === "FULL") await requireHardLockOverrideAllowed(ctx, a.orgId, a.projectId, actor.userId);

    const { conflicts } = await restoreProjectSnapshot(ctx, {
      orgId: a.orgId,
      project,
      snapshotId: session.snapshotId,
      scope: session.scope,
      now: a.now,
    });

    await ctx.db.patch(session._id, {
      outcome: "DISCARDED",
      closedAt: a.now,
      closedBy: actor.userId,
    });

    const taxRate = await resolveOrgDefaultTaxRate(ctx, a.orgId);
    await recalcProjectTotals(ctx, a.projectId, a.orgId, taxRate, a.now);

    await writeActivityLog(ctx, {
      id: a.auditId,
      organizationId: a.orgId,
      action: "UNLOCK_DISCARDED",
      entityType: "project",
      entityId: a.projectId,
      entityName: project.projectNumber,
      userId: actor.userId,
      userName: actor.userName,
      summary:
        `Discarded changes (${session.scope.toLowerCase()} unlock session) on ${project.projectNumber}` +
        (conflicts.length > 0 ? ` — ${conflicts.length} item(s) need manual review` : ""),
      metadata: { sessionId: session.id, conflicts },
      projectId: a.projectId,
      createdAt: a.now,
    });

    return { ok: true, conflicts };
  },
});

/**
 * Auto-commit any open session on a forward status transition (#791/#792: "a
 * session never silently spans a status change"). Called from
 * `projectWrites.ts`'s `updateStatusNative` inside the SAME transaction — a
 * no-op when no session is open. Does not re-check RBAC/audience (the calling
 * mutation already authorized the status change).
 */
export async function autoCommitOpenSession(
  ctx: MutationCtx,
  orgId: string,
  projectId: string,
  projectNumber: string,
  actor: Actor,
  now: number,
): Promise<void> {
  const session = await getOpenUnlockSession(ctx, orgId, projectId);
  if (!session) return;
  await ctx.db.patch(session._id, {
    outcome: "COMMITTED",
    closedAt: now,
    closedBy: actor.userId,
    closeNote: "Auto-committed by a forward status transition.",
  });
  await writeActivityLog(ctx, {
    id: createId(),
    organizationId: orgId,
    action: "UNLOCK_AUTO_COMMITTED",
    entityType: "project",
    entityId: projectId,
    entityName: projectNumber,
    userId: actor.userId,
    userName: actor.userName,
    summary: `Auto-committed the open ${session.scope.toLowerCase()} unlock session on ${projectNumber} (status changed)`,
    metadata: { sessionId: session.id },
    projectId,
    createdAt: now,
  });
}
