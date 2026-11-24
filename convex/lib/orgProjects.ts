import type { QueryCtx } from "../_generated/server";

/**
 * The org's project rows, shared by the Jobs reads (`projects.listPage` / `segmentCounts` /
 * `needsYouIds`) and the People lists' derived facts (`clients.peoplePage`): one org-wide
 * read, one place to bound later. Extracted from `convex/projects.ts` unchanged (UX Phase 13).
 */
export async function loadOrgProjects(ctx: QueryCtx, orgId: string) {
  return await ctx.db
    .query("projects")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: T3-style pagination rework approved but unshipped (no search index on projects yet) — see docs/exceptions.md R-8.3.3
    .collect();
}
