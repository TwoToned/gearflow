import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireService } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Batch per-org stats for the site-admin org list (#1078, A8): last-activity
 * timestamp and whether the org has ANY activation milestone (a model, an
 * asset, or a real project — ever). Both feed the "never activated" filter
 * (design doc §5.4's predicate, reused here even though the full Phase B
 * lifecycle — the email ladder, the daily dormancy-sweep cron, archiving on
 * a timer — is out of scope for Phase A):
 *
 *   never activated == exactly 1 member
 *                    && !hasAnyMilestone
 *                    && lastActivityAt == null
 *                    && createdAt < now - 30 days
 *
 * The member-count and createdAt legs live in Postgres (site-admin.ts's
 * getAllOrganizations already returns both) — this query supplies only the
 * two legs that live in Convex.
 *
 * One batched call for the whole visible page of orgs, not N+1 — the admin
 * list can show up to a page of orgs at once (see getAllOrganizations).
 */
export const getBatchOrgStats = query({
  args: { organizationIds: v.array(v.string()) },
  handler: async (ctx, { organizationIds }) => {
    await requireService(ctx);
    const results: {
      organizationId: string;
      lastActivityAt: number | null;
      hasAnyMilestone: boolean;
    }[] = [];

    for (const organizationId of organizationIds) {
      const [lastActivity, model, asset, projects] = await Promise.all([
        ctx.db
          .query("activityLogs")
          .withIndex("by_organizationId_createdAt", (q) => q.eq("organizationId", organizationId))
          .order("desc")
          .first(),
        ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).first(),
        ctx.db.query("assets").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).first(),
        // A template doesn't count as activation — but templates are rare
        // enough that reading a bounded page and filtering in JS is cheap;
        // this table doesn't need its own by_organizationId_isTemplate index
        // just for this. An org past this many rows already has a model or
        // an asset in virtually every real case, so hasAnyMilestone is
        // already true before this leg matters.
        ctx.db.query("projects").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).take(20),
      ]);
      const hasRealProject = projects.some((p) => !p.isTemplate);

      results.push({
        organizationId,
        lastActivityAt: lastActivity?.createdAt ?? null,
        hasAnyMilestone: !!model || !!asset || hasRealProject,
      });
    }

    return results;
  },
});

const orgAdminStatsDenyReason =
  "Site-admin-only aggregate over every org's activity/milestones — not a per-caller-org read, no scope model.";

export const agentOps: AgentOpsAnnotations = {
  getBatchOrgStats: { agentAccess: "denied", reason: orgAdminStatsDenyReason },
};
