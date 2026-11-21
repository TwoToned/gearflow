import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { requireCanUnlockPricing, pricingLockRaiseFields } from "./lib/projectLocks";
import { assertUnlockPricingAllowed } from "./lib/agentArgs";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * The two verbs on `projects.pricingLocked` (#1230, Phase 4 of "Project
 * versioning v2", parent #1221) — the entire lock-tier system (unlock
 * sessions, per-edit justification, HARD_LOCKED) collapses to these. See
 * `convex/lib/projectLocks.ts` for the guard every money-write mutation calls,
 * and FEATUREDOCS/78's Phase 4 section for the full model.
 *
 * `lockPricingNative` is `danger: "low"` (re-locking never destroys anything —
 * it only starts rejecting future money writes). `unlockPricingNative` is
 * `danger: "high"` per CLAUDE.md's danger-classification rules (lock-softening
 * is explicitly high) — the API dispatcher's confirmation gate requires
 * `confirm: true` before the call reaches Convex at all, and Mira is never
 * given a `confirm` parameter, so an agent cannot self-approve clearing it.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

async function requireProjectInOrg(ctx: MutationCtx, id: string, orgId: string) {
  const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  if (!p || p.organizationId !== orgId) throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
  return p;
}

/**
 * LOCK — sets `pricingLocked: true`. Re-locking is UNGATED (any caller with
 * `project:update` may re-lock; only clearing the lock needs the narrower
 * `canUnlockPricing` audience, D42). Idempotent — locking an already-locked
 * project is a no-op patch, no duplicate audit noise beyond the one row.
 */
export const lockPricingNative = mutation({
  returns: v.object({ id: v.string(), pricingLocked: v.boolean() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const project = await requireProjectInOrg(ctx, id, orgId);
    if (project.pricingLocked === true) return { id, pricingLocked: true };

    await ctx.db.patch(project._id, { ...pricingLockRaiseFields(actor, now), updatedAt: now });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "PRICING_LOCKED",
      entityType: "project",
      entityId: id,
      entityName: project.projectNumber,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Locked pricing on ${project.projectNumber}`,
      projectId: id,
      createdAt: now,
    });

    return { id, pricingLocked: true };
  },
});

/**
 * UNLOCK — clears `pricingLocked`. Restricted to `canUnlockPricing`'s
 * audience (D42: owner/admin/manager, or this job's own PM) — narrower than
 * the general `project:update` permission `lockPricingNative` uses. Writes an
 * activity row on every successful clear (Done-when: "clearing the lock
 * writes an activity row").
 */
export const unlockPricingNative = mutation({
  returns: v.object({ id: v.string(), pricingLocked: v.boolean(), undoToken: v.optional(v.string()) }),
  args: {
    id: v.string(),
    orgId: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const project = await requireProjectInOrg(ctx, id, orgId);
    await requireCanUnlockPricing(ctx, orgId, id, actor.userId);
    // The one true agent escape hatch (#1230, successor to the deleted
    // `projectUnlockSessions` mechanism's UNLOCK_SESSION_SCOPE) — unconditional
    // for agent-kind callers regardless of the ordinary RBAC check above.
    await assertUnlockPricingAllowed(ctx);

    if (project.pricingLocked !== true) return { id, pricingLocked: false };

    // What this unlock removed, kept on its own audit row: the ONLY source
    // `undoUnlockPricingNative` restores from (never client-supplied values).
    const previous = {
      pricingLockedAt: project.pricingLockedAt ?? null,
      pricingLockedById: project.pricingLockedById ?? null,
      pricingLockedByName: project.pricingLockedByName ?? null,
    };

    await ctx.db.patch(project._id, {
      pricingLocked: false,
      pricingLockedAt: undefined,
      pricingLockedById: undefined,
      pricingLockedByName: undefined,
      updatedAt: now,
    });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "PRICING_UNLOCKED",
      entityType: "project",
      entityId: id,
      entityName: project.projectNumber,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Unlocked pricing on ${project.projectNumber}`,
      details: { previous },
      projectId: id,
      createdAt: now,
    });

    // `undoToken` is this unlock's audit row id: the toast's Undo hands it to
    // `undoUnlockPricingNative`, which reverses exactly this unlock or refuses.
    return { id, pricingLocked: false, undoToken: auditId };
  },
});

/** How far back the undo looks for its own unlock row before failing closed. */
const UNDO_UNLOCK_SCAN_LIMIT = 200;

/** A later write that cleared the lock again (a second unlock, or a quote recall that unlocked). */
function clearedLockAgain(row: { action: string; metadata?: unknown }): boolean {
  if (row.action === "PRICING_UNLOCKED") return true;
  const meta = row.metadata as { pricingUnlocked?: unknown } | undefined;
  return row.action === "QUOTE_RECALLED" && meta?.pricingUnlocked === true;
}

const refuseUndo = (message: string) => new ConvexError({ code: "UNDO_STALE", message });

const numberOrUndefined = (x: unknown) => (typeof x === "number" ? x : undefined);
const stringOrUndefined = (x: unknown) => (typeof x === "string" ? x : undefined);

/**
 * The lock fields `unlockAuditId` removed, read from its own audit row.
 * `by_cuid` is global, so the org, the project and the action are all checked.
 */
async function loadUnlockedLock(ctx: MutationCtx, orgId: string, projectId: string, unlockAuditId: string) {
  const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", unlockAuditId)).first();
  const previous = (row?.details as { previous?: Record<string, unknown> } | undefined)?.previous;
  const ours = row?.organizationId === orgId && row.entityId === projectId && row.action === "PRICING_UNLOCKED";
  if (!ours || !previous) throw refuseUndo("That unlock can't be undone.");
  return {
    pricingLockedAt: numberOrUndefined(previous.pricingLockedAt),
    pricingLockedById: stringOrUndefined(previous.pricingLockedById),
    pricingLockedByName: stringOrUndefined(previous.pricingLockedByName),
  };
}

/** Nothing cleared the lock after `unlockAuditId` (newest rows first, bounded, fails closed). */
async function assertLockUntouchedSince(ctx: MutationCtx, orgId: string, projectId: string, unlockAuditId: string) {
  const newest = await ctx.db
    .query("activityLogs")
    .withIndex("by_organizationId_projectId", (q) => q.eq("organizationId", orgId).eq("projectId", projectId))
    .order("desc")
    .take(UNDO_UNLOCK_SCAN_LIMIT);
  const at = newest.findIndex((r) => r.id === unlockAuditId);
  if (at < 0) throw refuseUndo("Too much has changed since that unlock. Lock pricing again instead.");
  if (newest.slice(0, at).some(clearedLockAgain)) throw refuseUndo("The lock changed after that unlock, so it can't be undone.");
}

/**
 * UNDO UNLOCK (UX Phase 7) — the Undo on the header's `Unlock pricing` toast.
 * It reverses EXACTLY one unlock (`unlockAuditId`, the `undoToken` that unlock
 * returned): it restores the lock's own `pricingLockedAt/ById/ByName` from that
 * unlock's audit row, never from the caller.
 *
 * It refuses if the lock state has changed since:
 *  - the project is locked again (a re-lock, a quote send or a status move raised it); or
 *  - anything cleared the lock after that unlock (a second unlock, or a recall
 *    that unlocked), found by reading this project's newer audit rows.
 * Every path that clears `pricingLocked` writes one of those two rows
 * (`unlockPricingNative`, `quotesWrites.recallNative`); a new clearing path must
 * be added to `clearedLockAgain`. If the unlock row is not among the newest
 * `UNDO_UNLOCK_SCAN_LIMIT` rows for the project, it fails closed.
 *
 * Gated like re-locking (`project:update`): it can only ever restore a lock.
 */
export const undoUnlockPricingNative = mutation({
  returns: v.object({ id: v.string(), pricingLocked: v.boolean() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    unlockAuditId: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, unlockAuditId, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "update");
    const actor = await resolveActor(ctx, suppliedActor);
    const project = await requireProjectInOrg(ctx, id, orgId);

    if (project.pricingLocked === true) throw refuseUndo("Pricing is locked again, so there is nothing to undo.");
    const previous = await loadUnlockedLock(ctx, orgId, id, unlockAuditId);
    await assertLockUntouchedSince(ctx, orgId, id, unlockAuditId);

    await ctx.db.patch(project._id, { pricingLocked: true, ...previous, updatedAt: now });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "PRICING_UNLOCK_UNDONE",
      entityType: "project",
      entityId: id,
      entityName: project.projectNumber,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Undid the pricing unlock on ${project.projectNumber}`,
      details: { unlockAuditId },
      projectId: id,
      createdAt: now,
    });

    return { id, pricingLocked: true };
  },
});

/** Phase 4 danger classification (docs/designs/api-mcp-reimplementation.md §9). */
export const agentOps: AgentOpsAnnotations = {
  lockPricingNative: { danger: "low" },
  unlockPricingNative: { danger: "high" },
  // Restores a lock only (never softens one), and refuses unless it reverses exactly one unlock.
  undoUnlockPricingNative: { danger: "low" },
};
