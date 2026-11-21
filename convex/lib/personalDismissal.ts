import type { MutationCtx } from "../_generated/server";

/** The two one-bit, per-(org, user) dashboard checklist dismissals. */
type DismissalTable = "orgSetupDismissals" | "orgActivationDismissals";

/**
 * The exact reverse of a checklist `dismissNative` (UX Phase 11, §6c.2: "Dismiss
 * now has Undo"). Deletes ONE row: the one whose cuid the caller's own Dismiss
 * created, and only when that row belongs to the caller's verified org and user
 * (`organizationId` / `userId` come from the verified token at the call site).
 * `by_cuid` is a GLOBAL index, so both are checked on the row. Never "every row
 * of mine": a second, older dismissal (the newest-wins defense-in-depth row
 * `mine()` tolerates) is not this Undo's to remove.
 *
 * The caller runs the guards first, in its own handler, as `dismissNative` does
 * (write kill-switch, browser write limit, signed-in member with an active org,
 * `requireSelfScope(ctx, "write")`), so the registry classifier sees them.
 * Idempotent: a missing row (already undone, or never created) is `removed: false`.
 */
export async function deleteOwnDismissal(
  ctx: MutationCtx,
  table: DismissalTable,
  id: string,
  owner: { organizationId: string; userId: string },
): Promise<{ removed: boolean }> {
  const rows = await ctx.db
    .query(table)
    .withIndex("by_cuid", (q) => q.eq("id", id))
    .take(1);
  const row = rows[0];
  if (!row || row.organizationId !== owner.organizationId || row.userId !== owner.userId) return { removed: false };
  await ctx.db.delete(row._id);
  return { removed: true };
}
