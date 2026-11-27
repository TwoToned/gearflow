import { v, ConvexError } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { assertRefInOrg, assertClientContactBelongsToClient } from "./lib/orgRef";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { undoFieldEdit } from "./lib/fieldEditUndo";
import { assertDatesMovable } from "./lib/projectDatesLock";
import { LOCKED_PROJECT_FIELDS, assertPricingUnlocked } from "./lib/projectLocks";
import { recalcIfInputsWritten, PROJECT_UPDATE_IMMUTABLE } from "./projectWrites";

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

/**
 * Only fields the edit sheet may write are restorable. `updateNative` is also reachable directly (it records
 * whatever it was given), so a `status` or server-owned entry in the snapshot must never be raw-patched back:
 * that would skip `transitionProjectStatus`'s gates, snapshot and counters, or rewind a counter/pointer.
 */
const NEVER_RESTORE: ReadonlySet<string> = new Set<string>([...PROJECT_UPDATE_IMMUTABLE, "status", "packerUserId", "id", "organizationId"]);

function assertRestorable(plan: { set: Record<string, unknown>; clear: string[] }): void {
  const bad = [...Object.keys(plan.set), ...plan.clear].filter((f) => NEVER_RESTORE.has(f));
  if (bad.length > 0) {
    throw new ConvexError({ code: "NOT_UNDOABLE", message: `That change touched ${bad.join(", ")}, which an edit Undo never restores.` });
  }
}

/** A restored reference must still be in this org (the value in the snapshot is old, the check is now). */
async function assertRestoredRefsInOrg(
  ctx: MutationCtx, orgId: string, project: Doc<"projects">, plan: { set: Record<string, unknown> },
): Promise<void> {
  const { clientId, locationId, clientContactId } = plan.set;
  if (typeof clientId === "string") await assertRefInOrg(ctx, "clients", clientId, orgId);
  if (typeof locationId === "string") await assertRefInOrg(ctx, "locations", locationId, orgId);
  if (typeof clientContactId === "string") {
    const client = typeof clientId === "string" ? clientId : project.clientId;
    if (!client) throw new ConvexError({ code: "FORBIDDEN", message: "Referenced client contact not found on this project's client." });
    await assertClientContactBelongsToClient(ctx, clientContactId, client, orgId);
  }
}

/**
 * A move that opted into the dates lock (`updateNative` `lockDates`, recorded on its audit row) is
 * undone under the SAME rule: if the job's gear is now out (or it is finished) and the undo would put
 * dates back, it refuses with `DATES_LOCKED` instead of rewriting a deployed job's dates.
 */
async function assertDatesStillMovable(
  ctx: MutationCtx,
  a: { orgId: string; auditId: string },
  project: Doc<"projects">,
  plan: { set: Record<string, unknown>; clear: string[] },
): Promise<void> {
  const audit = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", a.auditId)).first();
  const details = audit && audit.organizationId === a.orgId ? (audit.details as { lockDates?: boolean } | undefined) : undefined;
  if (details?.lockDates === true) assertDatesMovable(project.status, [...Object.keys(plan.set), ...plan.clear]);
}

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
        assertRestorable(plan);
        await assertDatesStillMovable(ctx, a, project, plan);
        await assertRestoredRefsInOrg(ctx, a.orgId, project, plan);
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
