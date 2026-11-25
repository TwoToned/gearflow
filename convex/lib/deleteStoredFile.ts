import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/**
 * Delete a `fileUploads` row, its `storedFiles` record and the stored bytes. The row is
 * fetched by the GLOBAL `by_cuid` index, so it is org-checked here (a foreign or missing
 * file is a no-op, never a cross-tenant delete). Idempotent. Only a CONFIRMED removal verb
 * calls this: an Undo never does (stored bytes cannot be restored).
 */
export async function deleteStoredFile(ctx: MutationCtx, fileId: string, orgId: string): Promise<void> {
  const file = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", fileId)).first();
  if (!file || file.organizationId !== orgId) return;
  const rec = await ctx.db.query("storedFiles").withIndex("by_storageId", (q) => q.eq("storageId", file.storageKey)).unique();
  if (rec) await ctx.db.delete(rec._id);
  try {
    await ctx.storage.delete(file.storageKey as Id<"_storage">);
  } catch {
    // already gone — idempotent
  }
  await ctx.db.delete(file._id);
}
