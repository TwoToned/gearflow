import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * The single source of truth for "is this org's Xero connection live" (WS1
 * #940). Shared by every server-side Xero-gated check (coding-cascade
 * resolution, push eligibility) — the CLIENT-side twin is
 * `src/hooks/use-xero-linked.ts`'s `useXeroLinked()`, which reads the same
 * `isConnected` flag via `api.xeroIntegrations.getForOrg`. Keeping both reads
 * of the identical flag (never duplicating the "linked" definition) is what
 * makes "fields absent when unlinked" a real, testable invariant instead of
 * two independently-drifting checks.
 */
export async function isXeroLinked(ctx: QueryCtx | MutationCtx, orgId: string): Promise<boolean> {
  const row = await ctx.db
    .query("xeroIntegrations")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
    .unique();
  return row?.isConnected === true;
}
