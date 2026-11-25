import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { isFileReferenced } from "./attachableUpload";
import { storageIdOf } from "./checkPhotos";

/** Delete one `_storage` object and its `storedFiles` record (idempotent). */
async function deleteStorageObject(ctx: MutationCtx, storageId: string): Promise<void> {
  const rec = await ctx.db.query("storedFiles").withIndex("by_storageId", (q) => q.eq("storageId", storageId)).unique();
  if (rec) await ctx.db.delete(rec._id);
  try {
    await ctx.storage.delete(storageId as Id<"_storage">);
  } catch {
    // already gone: idempotent
  }
}

/**
 * Delete a `fileUploads` row, its `storedFiles` record, the stored bytes and its thumbnail's bytes. The row
 * is fetched by the GLOBAL `by_cuid` index, so it is org-checked here (a foreign or missing file is a no-op,
 * never a cross-tenant delete). Idempotent. Only a CONFIRMED removal verb calls this: an Undo never does
 * (stored bytes cannot be restored). Removal paths call {@link deleteStoredFileIfUnreferenced}, not this.
 */
export async function deleteStoredFile(ctx: MutationCtx, fileId: string, orgId: string): Promise<boolean> {
  const file = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", fileId)).first();
  if (!file || file.organizationId !== orgId) return false;
  await deleteStorageObject(ctx, file.storageKey);
  const thumb = file.thumbnailUrl ? storageIdOf(file.thumbnailUrl) : null;
  if (thumb) await deleteStorageObject(ctx, thumb);
  await ctx.db.delete(file._id);
  return true;
}

/**
 * Delete a file's bytes ONLY when nothing holds it any more. Call it AFTER the caller's own row is deleted
 * (or swapped away) in the same transaction, so `isFileReferenced` sees the world without that row. A
 * legacy file that two rows share (or that a media row, an invoice or a photo array still holds) survives
 * the removal of one of them. Returns whether a file was deleted (false: it was held, or is not this org's).
 */
export async function deleteStoredFileIfUnreferenced(ctx: MutationCtx, orgId: string, fileId: string): Promise<boolean> {
  if (await isFileReferenced(ctx.db, orgId, fileId)) return false;
  return await deleteStoredFile(ctx, fileId, orgId);
}
