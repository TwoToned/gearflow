import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import { getAuthContext, isMemberAuth, requireSelfScope } from "./auth";
import { assertWritesEnabled } from "./writeGuard";
import { enforceBrowserWriteLimit } from "./rateLimiter";

/** The two one-bit, per-(org, user) dashboard checklist dismissals. */
type DismissalTable = "orgSetupDismissals" | "orgActivationDismissals";

/**
 * The exact reverse of a checklist `dismissNative` (UX Phase 11, §6c.2: "Dismiss
 * now has Undo"). Deletes ONE row: the one whose cuid the caller's own Dismiss
 * created, and only when that row belongs to the caller's verified org and user.
 * `by_cuid` is a GLOBAL index, so both are checked on the row. Never "every row
 * of mine": a second, older dismissal (the newest-wins defense-in-depth row
 * `mine()` tolerates) is not this Undo's to remove.
 *
 * Same guards as `dismissNative`: the feature's own write kill-switch domain, the
 * browser write limit, a signed-in member with an active org, `self:write`.
 * Idempotent: a missing row (already undone, or never created) is `removed: false`.
 */
export async function undismissOwnRow(
  ctx: MutationCtx,
  table: DismissalTable,
  domain: string,
  id: string,
): Promise<{ removed: boolean }> {
  await assertWritesEnabled(ctx, domain);
  await enforceBrowserWriteLimit(ctx);
  const auth = await getAuthContext(ctx);
  if (!isMemberAuth(auth)) {
    throw new ConvexError("Unauthorized: a signed-in user is required.");
  }
  if (!auth.orgId) {
    throw new ConvexError("Forbidden: no active organization.");
  }
  await requireSelfScope(ctx, "write");
  const rows = await ctx.db
    .query(table)
    .withIndex("by_cuid", (q) => q.eq("id", id))
    .take(1);
  const row = rows[0];
  if (!row || row.organizationId !== auth.orgId || row.userId !== auth.userId) return { removed: false };
  await ctx.db.delete(row._id);
  return { removed: true };
}
