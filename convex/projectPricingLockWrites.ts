import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { requireCanUnlockPricing } from "./lib/projectLocks";
import { assertUnlockPricingAllowed } from "./lib/agentArgs";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * The two verbs on `projects.pricingLocked` (#1230, Phase 4 of "Project
 * versioning v2", parent #1221) — the entire lock-tier system (unlock
 * sessions, per-edit justification, HARD_LOCKED) collapses to these. See
 * `convex/lib/projectLocks.ts` for the guard every money-write mutation calls,
 * and FEATUREDOCS/76's Phase 4 section for the full model.
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

    await ctx.db.patch(project._id, {
      pricingLocked: true,
      pricingLockedAt: now,
      pricingLockedById: actor.userId,
      pricingLockedByName: actor.userName,
      updatedAt: now,
    });

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
    await requireCanUnlockPricing(ctx, orgId, id, actor.userId);
    // The one true agent escape hatch (#1230, successor to the deleted
    // `projectUnlockSessions` mechanism's UNLOCK_SESSION_SCOPE) — unconditional
    // for agent-kind callers regardless of the ordinary RBAC check above.
    await assertUnlockPricingAllowed(ctx);

    if (project.pricingLocked !== true) return { id, pricingLocked: false };

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
      projectId: id,
      createdAt: now,
    });

    return { id, pricingLocked: false };
  },
});

/** Phase 4 danger classification (docs/designs/api-mcp-reimplementation.md §9). */
export const agentOps: AgentOpsAnnotations = {
  lockPricingNative: { danger: "low" },
  unlockPricingNative: { danger: "high" },
};
