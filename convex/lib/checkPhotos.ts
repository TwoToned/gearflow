/**
 * The photos of an ad-hoc check (`checkRecordWrites.saveAdHocCheck`, review B1).
 *
 * A FAIL carries a required photo (#898), uploaded through `/api/uploads` from the check
 * form. The SAVE proves each photo is one the check may hold, so a check can never be
 * pointed at someone else's file:
 *  - the URL is `/api/files/{storageId}`;
 *  - it is one of THIS actor's uploads from the last {@link PHOTO_MAX_AGE_MS}, found
 *    exactly on `fileUploads.by_uploadedById` bounded by `_creationTime` (a check's
 *    photos are taken during the check), and the row is this org's;
 *  - its `storedFiles` row is this org's and in the {@link CHECK_PHOTO_FOLDER} folder
 *    (a quote/invoice PDF, model media or anything else uploaded elsewhere is refused).
 *
 * The check's Undo NEVER deletes a stored file (overseer ruling, 2026-11-24): a file
 * can be referenced from places no scan can enumerate, so the Undo deletes only the
 * records its save created and the photos stay where they are. That is also why there
 * is no "used nowhere else" scan here: it existed only to make deletion safe. An orphaned
 * check-photo upload is a known follow-up (a server-side sweep), not this module's job.
 * Every read is org re-checked; reads are bounded. ConvexError only.
 */
import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";

/** The upload folder the check-item photo picker sends (`PhotoGridInput folder`). */
export const CHECK_PHOTO_FOLDER = "check-photos";
/** A check's photo must have been uploaded within this long before the save. */
export const PHOTO_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** This actor's uploads in the age window read to find one photo; one more means truncated. */
const MAX_ACTOR_UPLOADS = 1000;

const FILE_URL = /^\/api\/files\/([A-Za-z0-9_-]+)$/;

/** The `_storage` id a photo URL names, or null for anything else. */
export function storageIdOf(url: string | undefined): string | null {
  const m = url ? FILE_URL.exec(url) : null;
  return m ? m[1] : null;
}

const refuse = (why: string) => new ConvexError(`A check photo ${why}: upload it again from the check`);

/** One photo's upload, proven fit for this check (see the module doc). */
async function assertOwnedUpload(ctx: MutationCtx, a: { orgId: string; actorUserId: string; serverNow: number }, url: string): Promise<void> {
  const storageId = storageIdOf(url);
  if (!storageId) throw refuse("must be an uploaded file");
  // Exact: this actor's uploads in the age window only (an older one is simply not found).
  const mine = await ctx.db
    .query("fileUploads")
    .withIndex("by_uploadedById", (q) => q.eq("uploadedById", a.actorUserId).gte("_creationTime", a.serverNow - PHOTO_MAX_AGE_MS))
    .order("desc")
    .take(MAX_ACTOR_UPLOADS + 1);
  const row = mine.find((u) => storageIdOf(u.url) === storageId);
  if (!row && mine.length > MAX_ACTOR_UPLOADS) throw refuse("can't be verified (too many uploads in the last 6 hours)");
  if (!row || row.organizationId !== a.orgId) throw refuse("isn't one of your uploads from the last 6 hours in this organisation");
  const stored = await ctx.db.query("storedFiles").withIndex("by_storageId", (q) => q.eq("storageId", storageId)).unique();
  if (!stored || stored.organizationId !== a.orgId || stored.folder !== CHECK_PHOTO_FOLDER) throw refuse("wasn't uploaded as a check photo");
}

/** Save-time proof: every photo on the checks is a fresh check-photo upload by this actor in this org. */
export async function assertOwnedCheckPhotos(
  ctx: MutationCtx,
  a: { orgId: string; actorUserId: string; serverNow: number; checks: { photos?: string[] }[] },
): Promise<void> {
  const urls = [...new Set(a.checks.flatMap((c) => c.photos ?? []))];
  for (const url of urls) await assertOwnedUpload(ctx, a, url);
}
