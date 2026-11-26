/**
 * The photos of a maintenance record (UX Phase 14, 14b-3; Phase 13 review add-on).
 *
 * `maintenanceRecords.photos` holds `/api/files/{storageId}` URLs from the form's uploader. Attaching one is the
 * dangerous half of a file's life (removing the record deletes the bytes it points at), so a NEW photo on a write
 * is proven with THE attach rule, `assertAttachableUpload` (`lib/attachableUpload.ts`, the `checkPhotos` proof
 * generalised): it is the ACTOR's own recent upload, this org's, in the {@link MAINTENANCE_PHOTO_FOLDER} folder, and
 * held by nothing. A photo already on the record is NOT re-validated on a save (a file that was valid when it was
 * attached stays valid, however old or shared it has since become).
 *
 * Removal never deletes bytes directly: a photo dropped from a record (or a deleted record's photos) goes through
 * `deleteStoredFileIfUnreferenced`, AFTER the record's own row has been changed, so a file anything else still holds
 * survives. A removed URL's upload row is found by a bounded scan of the org's uploads (there is no URL index);
 * when it cannot be found or the scan is truncated the bytes are left alone (an orphan, never a wrong delete).
 * An Undo NEVER deletes a stored file. Every read is org-scoped and bounded. ConvexError only.
 */
import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import { ATTACH_UPLOAD_MAX_AGE_MS, assertAttachableUpload } from "./attachableUpload";
import { storageIdOf } from "./checkPhotos";
import { deleteStoredFileIfUnreferenced } from "./deleteStoredFile";
import { MAINTENANCE_PHOTO_FOLDER } from "./maintenancePhotoFolder";
import { collectCapped } from "./pagination";

/** This actor's recent uploads read to find one photo; one more means truncated. */
const MAX_ACTOR_UPLOADS = 1000;
/** The org's uploads scanned to find a REMOVED photo's upload row. */
const ORG_UPLOAD_SCAN_CAP = 5000;

const refuse = (why: string) => new ConvexError({ code: "INVALID_PHOTO", message: `A photo ${why}: upload it again from the job.` });

/** The `fileUploads` id of one of THIS actor's recent uploads, found by the URL's storage id. */
async function recentUploadIdOf(ctx: MutationCtx, a: { actorUserId: string }, url: string): Promise<string> {
  const storageId = storageIdOf(url);
  if (!storageId) throw refuse("must be an uploaded file");
  const mine = await ctx.db
    .query("fileUploads")
    .withIndex("by_uploadedById", (q) => q.eq("uploadedById", a.actorUserId).gte("_creationTime", Date.now() - ATTACH_UPLOAD_MAX_AGE_MS))
    .order("desc")
    .take(MAX_ACTOR_UPLOADS + 1);
  const row = mine.find((u) => storageIdOf(u.url) === storageId);
  if (!row) throw refuse(mine.length > MAX_ACTOR_UPLOADS ? "can't be verified (too many recent uploads)" : "isn't one of your uploads from the last few minutes");
  return row.id;
}

/**
 * Prove every photo that is NEW on this write (not already on the record) is attachable. `existing` is the record's
 * current photos (empty on a create); an unchanged photo is skipped, so a save never re-validates what is there.
 */
export async function assertNewMaintenancePhotos(
  ctx: MutationCtx,
  a: { orgId: string; actorUserId: string; photos: string[] | undefined; existing: string[] },
): Promise<void> {
  const held = new Set(a.existing);
  const added = [...new Set((a.photos ?? []).filter((url) => !held.has(url)))];
  for (const url of added) {
    const fileId = await recentUploadIdOf(ctx, a, url);
    await assertAttachableUpload(ctx.db, { orgId: a.orgId, actorUserId: a.actorUserId, fileId, folder: MAINTENANCE_PHOTO_FOLDER });
  }
}

/**
 * Delete the bytes of photos a write dropped, ONLY through `deleteStoredFileIfUnreferenced`. Call it AFTER the record
 * has been patched or deleted in the same transaction, so the reference scan sees the world without those photos.
 * Returns how many files were deleted.
 */
export async function releaseRemovedMaintenancePhotos(ctx: MutationCtx, a: { orgId: string; before: string[]; after: string[] }): Promise<number> {
  const keep = new Set(a.after);
  const removed = [...new Set(a.before.filter((url) => !keep.has(url)))];
  if (removed.length === 0) return 0;
  const uploads = await collectCapped(ctx.db.query("fileUploads").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)), ORG_UPLOAD_SCAN_CAP);
  let deleted = 0;
  for (const url of removed) {
    const storageId = storageIdOf(url);
    const row = storageId ? uploads.rows.find((u) => storageIdOf(u.url) === storageId) : undefined;
    if (!row) continue; // not found (or past the scan cap): leave the bytes, never guess
    if (await deleteStoredFileIfUnreferenced(ctx, a.orgId, row.id)) deleted += 1;
  }
  return deleted;
}
