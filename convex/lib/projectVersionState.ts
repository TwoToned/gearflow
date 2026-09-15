import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * `projectVersions` read helpers — #1226, Phase 1 of "Project versioning v2"
 * (parent #1221, docs/designs/project-versioning-v2.md §4.2/§6/§7).
 *
 * Phase 1 adds ONLY the table, the new columns and the backfill
 * (`convex/backfillProjectVersions.ts`) — nothing else in the app reads this
 * table yet. These two helpers exist because the backfill itself needs an
 * org-checked read (its idempotency check + its verification query), and
 * because CLAUDE.md's `by_cuid` note applies equally to any OTHER global
 * index on a Convex table: `projectVersions.by_projectId_number` is keyed on
 * `projectId`, a cuid that is unique per row but NOT partitioned by org at
 * the index level (the same shape as `quotes.by_projectId_version` —
 * `convex/lib/quoteState.ts` — which this file deliberately mirrors), so a
 * caller supplying a `projectId` belonging to another org must never see
 * that org's version rows back. Every function here re-checks
 * `organizationId` against the caller-supplied `orgId` — never trust the
 * index alone. See `convex/projectVersionState.xtenant.test.ts`.
 */

/** Every `projectVersions` row for a project, org-checked. `by_projectId_number`
 *  is a global index (shared across orgs the same `projectId` cuid could
 *  theoretically collide on) — the org filter after the index range scan is
 *  what actually keeps this org-scoped, not the index by itself. */
export async function listProjectVersions(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  projectId: string,
): Promise<Doc<"projectVersions">[]> {
  const rows = await ctx.db
    .query("projectVersions")
    .withIndex("by_projectId_number", (q) => q.eq("projectId", projectId))
    .collect();
  return rows.filter((r) => r.organizationId === orgId);
}

/** The single `projectVersions` row at `(projectId, number)`, org-checked. Point
 *  lookup on the composite index, with the org check applied to the result
 *  before it's ever handed back — same shape as `quoteState.ts`'s
 *  `findQuoteAtRevision`. */
export async function findVersionByNumber(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  projectId: string,
  number: number,
): Promise<Doc<"projectVersions"> | null> {
  const row = await ctx.db
    .query("projectVersions")
    .withIndex("by_projectId_number", (q) => q.eq("projectId", projectId).eq("number", number))
    .first();
  return row && row.organizationId === orgId ? row : null;
}

/** Every `projectVersions` row for an org, org-checked. `by_organizationId` is
 *  already scoped to the query's own `orgId` argument — the check here is
 *  belt-and-braces against a future caller accidentally passing a
 *  caller-supplied value that was never verified against the caller's own
 *  membership (the `requireOrgRead`/`requireOrgReadFor` job, done by whoever
 *  calls this — this helper can't see the auth context itself). */
export async function listOrgVersions(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
): Promise<Doc<"projectVersions">[]> {
  const rows = await ctx.db
    .query("projectVersions")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
    .collect();
  return rows.filter((r) => r.organizationId === orgId);
}
