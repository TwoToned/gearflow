import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { ConvexError } from "convex/values";
import { fileReferenceState, fileReferenceStates } from "./attachableUpload";
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
 * (or swapped away) in the same transaction, so `fileReferenceState` sees the world without that row. A
 * legacy file that two rows share (or that a media row, an invoice or a photo array still holds) survives
 * the removal of one of them. Returns whether a file was deleted (false: it was held, or is not this org's).
 *
 * When this org has too many records to PROVE the file unreferenced (`unverifiable`) it THROWS
 * `FILE_REFS_UNVERIFIABLE` rather than quietly keeping the bytes: the caller's mutation is one transaction, so
 * its own row removal rolls back too and nothing changes. Silently keeping the bytes would orphan them (for
 * identity files, retained past their row) while the UI says the file is deleted.
 */
export async function deleteStoredFileIfUnreferenced(ctx: MutationCtx, orgId: string, fileId: string): Promise<boolean> {
  const refs = await fileReferenceState(ctx.db, orgId, fileId);
  if (refs === "unverifiable") throw new ConvexError({ code: "FILE_REFS_UNVERIFIABLE", message: "Too many records to check this file safely" });
  if (refs === "held") return false;
  return await deleteStoredFile(ctx, fileId, orgId);
}

/**
 * {@link deleteStoredFileIfUnreferenced} for a SET of files (a cascade): the holder scans that have no index are
 * read ONCE for the whole set, not once per file, so a member with 100 documents stays inside a transaction's read
 * limits. Same rule: ANY file that cannot be proven free throws `FILE_REFS_UNVERIFIABLE` before anything is deleted.
 * Returns how many files were deleted.
 */
export async function deleteStoredFilesIfUnreferenced(ctx: MutationCtx, orgId: string, fileIds: string[]): Promise<number> {
  const states = await fileReferenceStates(ctx.db, orgId, fileIds);
  if ([...states.values()].includes("unverifiable")) throw new ConvexError({ code: "FILE_REFS_UNVERIFIABLE", message: "Too many records to check this file safely" });
  let deleted = 0;
  for (const [fileId, refs] of states) if (refs === "free" && (await deleteStoredFile(ctx, fileId, orgId))) deleted += 1;
  return deleted;
}
