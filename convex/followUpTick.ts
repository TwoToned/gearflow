import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { collectCapped } from "./lib/pagination";
import { reconcileFollowUps } from "./lib/followUpReconcile";

/**
 * Follow-up automation — the hourly tick (docs/designs/follow-up-automation.md
 * §8.2 "Scheduled"). Write paths already reconcile the moment something
 * happens; the tick exists for what changes with TIME alone: a quote expiring
 * (→ decision rung), a deadline coming inside a week (→ urgent), an event
 * starting while the quote is still out (→ housekeeping). It is also the
 * backstop that heals anything a missed write path left behind.
 *
 * Native Convex (no HTTP hop): it only touches Convex tables. Gated on its OWN
 * flag, `ENABLE_FOLLOW_UP_CRON`, not the global `ENABLE_CONVEX_CRONS` — that
 * one also switches on org-dormancy archiving, the 15-minute email backlog, PM
 * generation and log purge (spec review round 2), none of which this needs.
 *
 * Fan-out: the tick only lists orgs and schedules one `reconcileOrg` per org,
 * so no single mutation reads more than one org's open quotes and follow-ups.
 */

const MAX_ORGS_PER_TICK = 500;
const MAX_ROWS_PER_ORG = 500;

export const tick = internalMutation({
  args: {},
  returns: v.object({ skipped: v.optional(v.boolean()), scheduled: v.number() }),
  handler: async (ctx) => {
    if (process.env.ENABLE_FOLLOW_UP_CRON !== "true") {
      console.log('[follow-up-tick] disabled (ENABLE_FOLLOW_UP_CRON != "true") — skipping');
      return { skipped: true, scheduled: 0 };
    }
    const { rows: orgs, truncated } = await collectCapped(ctx.db.query("organizations"), MAX_ORGS_PER_TICK);
    if (truncated) console.warn("[follow-up-tick] organizations truncated at the cap — the rest run next tick");
    for (const org of orgs) {
      await ctx.scheduler.runAfter(0, internal.followUpTick.reconcileOrg, { orgId: org.id });
    }
    return { scheduled: orgs.length };
  },
});

/** Reconcile every project in one org that has a quote out or an open
 *  automated follow-up. Both reads are org-prefixed indexes, capped. */
export const reconcileOrg = internalMutation({
  args: { orgId: v.string() },
  returns: v.object({ projects: v.number() }),
  handler: async (ctx, { orgId }) => {
    const now = Date.now();
    const projectIds = new Set<string>();

    for (const status of ["SENT", "PUBLISHED"] as const) {
      const { rows } = await collectCapped(
        ctx.db.query("quotes").withIndex("by_organizationId_status", (q) => q.eq("organizationId", orgId).eq("status", status)),
        MAX_ROWS_PER_ORG,
      );
      for (const q of rows) if (q.projectId) projectIds.add(q.projectId);
    }
    for (const status of ["TODO", "IN_PROGRESS"] as const) {
      const { rows } = await collectCapped(
        ctx.db.query("projectTasks").withIndex("by_organizationId_status_dueDate", (q) => q.eq("organizationId", orgId).eq("status", status)),
        MAX_ROWS_PER_ORG,
      );
      for (const t of rows) if (t.automation && t.projectId) projectIds.add(t.projectId);
    }

    for (const projectId of projectIds) await reconcileFollowUps(ctx, { orgId, projectId, now });
    return { projects: projectIds.size };
  },
});
