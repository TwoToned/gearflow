import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { undoFieldEdit } from "./lib/fieldEditUndo";
import { LOCKED_PROJECT_FIELDS, assertPricingUnlocked } from "./lib/projectLocks";
import { recalcIfInputsWritten } from "./projectWrites";

/**
 * The exact Undo of a job edit (UX Phase 9 follow-up): the edit sheet's Save writes ONE audit row
 * carrying the before/after of only the fields it changed (`projectWrites.auditProjectEdit`, via
 * `recordFieldEdit`); this reads that row back, ids only. It refuses as a whole, changing nothing, unless
 * the caller is the person who saved it, it is inside the server-clock window, it has not been undone, and
 * EVERY changed field still holds exactly what the save left (a later edit by anyone is never clobbered).
 * Restoring a locked money field (`discountPercent`, `taxRate`) on a pricing-locked job refuses like any
 * write to it, and a restore that touches a total's input recalculates in the same transaction.
 */
const actorValidator = v.object({ userId: v.string(), userName: v.string() });

export const undoUpdateNative = mutation({
  returns: v.object({ restored: v.array(v.string()) }),
  args: { orgId: v.string(), projectId: v.string(), auditId: v.string(), actor: actorValidator, now: v.number() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "project", "update");
    const actor = await resolveActor(ctx, a.actor);
    return undoFieldEdit(ctx, {
      orgId: a.orgId, entityType: "project", entityId: a.projectId, entityName: a.projectId, auditId: a.auditId, actor, now: a.now,
      load: async () => {
        const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", a.projectId)).first();
        return p && p.organizationId === a.orgId ? p : null;
      },
      apply: async (project, plan) => {
        if (LOCKED_PROJECT_FIELDS.some((f) => f in plan.set || plan.clear.includes(f))) assertPricingUnlocked(project);
        const patch: Record<string, unknown> = { ...plan.set, updatedAt: a.now };
        for (const f of plan.clear) patch[f] = undefined;
        await ctx.db.patch(project._id, patch);
        await recalcIfInputsWritten(ctx, a.orgId, a.projectId, plan.set, plan.clear, a.now);
      },
    });
  },
});

export const agentOps: AgentOpsAnnotations = {
  undoUpdateNative: { summary: "Undo a job edit from the audit id its save returned: restores exactly the fields that edit changed, refusing if any changed since, outside the window, or by another user.", danger: "medium" },
};
