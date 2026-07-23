import type { QueryCtx, MutationCtx } from "../_generated/server";

// `by_cuid` is a global (non-org-scoped) Convex index — this is the single accessor for
// it (R-8.3.4). Callers MUST still check the returned doc's `organizationId` before
// trusting it; this helper does not scope by org.
export async function getKitByCuid(ctx: QueryCtx | MutationCtx, id: string) {
  return await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
}
