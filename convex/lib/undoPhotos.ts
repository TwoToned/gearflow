/**
 * The photos of an ad-hoc check (`checkRecordWrites.saveAdHocCheck` and its exact Undo,
 * overseer ruling 2026-11-23; hardened after reviews B1 and the 4d20f989 round).
 *
 * A FAIL carries a required photo (#898), uploaded through `/api/uploads` for THIS save.
 * The Undo deletes those files with the records that held them, so nothing is left
 * orphaned. Because deleting a file is destructive, the SAVE proves each photo is one
 * the check may own, and records exactly those uploads on its own audit row:
 *  - the URL is `/api/files/{storageId}`;
 *  - it is one of THIS actor's uploads from the last {@link PHOTO_MAX_AGE_MS}, found
 *    exactly on `fileUploads.by_uploadedById` bounded by `_creationTime` (a check's
 *    photos are taken during the check), and the row is this org's;
 *  - its `storedFiles` row is this org's and in the {@link CHECK_PHOTO_FOLDER} folder
 *    (a quote/invoice PDF, model media or anything else uploaded elsewhere is refused);
 *  - nothing references it yet ({@link findReferences}).
 *
 * "References" means: a check record or a maintenance record (its photos or
 * attachments) in the org, or any media row (`modelMedia`, `assetMedia`, …) naming the
 * upload. A URL can only be referenced after it was uploaded, so the record scans are
 * bounded below by the upload time on an existing index (`_creationTime`); a
 * maintenance record EDITED since then is found through its `maintenance` activity
 * rows (every maintenance write logs one). Every scan is capped, and a capped scan
 * FAILS CLOSED: the save is refused, and the Undo keeps every file ("photos kept").
 *
 * The Undo re-runs the same search (records created or edited since the upload, minus
 * the records this save created) and deletes a file only when nothing else uses it.
 * Every read is org re-checked; reads are bounded. ConvexError only.
 */
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** The upload folder the check-item photo picker sends (`PhotoGridInput folder`). */
export const CHECK_PHOTO_FOLDER = "check-photos";
/** A check's photo must have been uploaded within this long before the save. */
export const PHOTO_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Rows any one reference scan reads; one more than this means it was truncated. */
const MAX_SCAN = 1000;

/** Each media table, all keyed `fileId` = the `fileUploads` row id, all with `by_fileId`. */
const MEDIA_TABLES = ["modelMedia", "assetMedia", "kitMedia", "projectMedia", "clientMedia", "locationMedia", "subHireMedia"] as const;

const FILE_URL = /^\/api\/files\/([A-Za-z0-9_-]+)$/;

/** One photo the save proved it owns, as its audit row records it. */
export interface CheckPhotoUpload {
  storageId: string;
  /** The `fileUploads` row id (exact lookup for the Undo). */
  uploadId: string;
  /** When it was uploaded (`_creationTime`): the lower bound of every reference scan. */
  at: number;
}

/** The `_storage` id a photo URL names, or null for anything else. */
export function storageIdOf(url: string | undefined): string | null {
  const m = url ? FILE_URL.exec(url) : null;
  return m ? m[1] : null;
}

function addIds(out: Set<string>, urls: string[] | undefined): void {
  for (const u of urls ?? []) {
    const id = storageIdOf(u);
    if (id) out.add(id);
  }
}

const refuse = (why: string) => new ConvexError(`A check photo ${why}: upload it again from the check`);

/** What is referenced, and whether every scan read to the end. */
interface References {
  storageIds: Set<string>;
  uploadIds: Set<string>;
  complete: boolean;
}

/** Check records created since `since` (minus `exclude`). */
async function scanChecks(ctx: MutationCtx, orgId: string, since: number, exclude: string[], out: References): Promise<void> {
  const rows = await ctx.db
    .query("checkRecords")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId).gte("_creationTime", since))
    .take(MAX_SCAN + 1);
  if (rows.length > MAX_SCAN) out.complete = false;
  for (const r of rows) if (!exclude.includes(r.id)) addIds(out.storageIds, r.photos);
}

/** Maintenance records created OR edited since `since` (minus `exclude`): photos and attachments. */
async function scanMaintenance(ctx: MutationCtx, orgId: string, since: number, exclude: string[], out: References): Promise<void> {
  const created = await ctx.db
    .query("maintenanceRecords")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId).gte("_creationTime", since))
    .take(MAX_SCAN + 1);
  const logs = await ctx.db
    .query("activityLogs")
    .withIndex("by_organizationId_entityType", (q) => q.eq("organizationId", orgId).eq("entityType", "maintenance").gte("_creationTime", since))
    .take(MAX_SCAN + 1);
  if (created.length > MAX_SCAN || logs.length > MAX_SCAN) out.complete = false;
  const seen = new Set(created.map((m) => m.id));
  const records = [...created];
  for (const l of logs) {
    if (!l.entityId || seen.has(l.entityId)) continue;
    seen.add(l.entityId);
    const m = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", l.entityId!)).first();
    if (m && m.organizationId === orgId) records.push(m);
  }
  for (const m of records) {
    if (exclude.includes(m.id)) continue;
    addIds(out.storageIds, m.photos);
    addIds(out.storageIds, m.attachments);
  }
}

/** Media rows (any table, any org) naming one of the uploads. */
async function scanMedia(ctx: MutationCtx, uploadIds: string[], out: References): Promise<void> {
  for (const id of uploadIds) {
    for (const table of MEDIA_TABLES) {
      const row = await ctx.db.query(table).withIndex("by_fileId", (q) => q.eq("fileId", id)).first();
      if (row) out.uploadIds.add(id);
    }
  }
}

/** Everything in the org referencing these uploads, other than the records in `exclude`. */
async function findReferences(
  ctx: MutationCtx,
  a: { orgId: string; uploads: CheckPhotoUpload[]; excludeRecordIds?: string[]; excludeMaintenanceIds?: string[] },
): Promise<References> {
  const out: References = { storageIds: new Set(), uploadIds: new Set(), complete: true };
  const since = Math.min(...a.uploads.map((u) => u.at));
  await scanChecks(ctx, a.orgId, since, a.excludeRecordIds ?? [], out);
  await scanMaintenance(ctx, a.orgId, since, a.excludeMaintenanceIds ?? [], out);
  await scanMedia(ctx, a.uploads.map((u) => u.uploadId), out);
  return out;
}

const isReferenced = (refs: References, u: CheckPhotoUpload) => refs.storageIds.has(u.storageId) || refs.uploadIds.has(u.uploadId);

/** One photo's upload, proven fit for this check (see the module doc). */
async function ownedUpload(ctx: MutationCtx, a: { orgId: string; actorUserId: string; serverNow: number }, url: string): Promise<CheckPhotoUpload> {
  const storageId = storageIdOf(url);
  if (!storageId) throw refuse("must be an uploaded file");
  // Exact: this actor's uploads in the age window only (an older one is simply not found).
  const mine = await ctx.db
    .query("fileUploads")
    .withIndex("by_uploadedById", (q) => q.eq("uploadedById", a.actorUserId).gte("_creationTime", a.serverNow - PHOTO_MAX_AGE_MS))
    .order("desc")
    .take(MAX_SCAN + 1);
  const row = mine.find((u) => storageIdOf(u.url) === storageId);
  if (!row && mine.length > MAX_SCAN) throw refuse("can't be verified (too many uploads in the last 6 hours)");
  if (!row || row.organizationId !== a.orgId) throw refuse("isn't one of your uploads from the last 6 hours in this organisation");
  const stored = await ctx.db.query("storedFiles").withIndex("by_storageId", (q) => q.eq("storageId", storageId)).unique();
  if (!stored || stored.organizationId !== a.orgId || stored.folder !== CHECK_PHOTO_FOLDER) throw refuse("wasn't uploaded as a check photo");
  return { storageId, uploadId: row.id, at: row._creationTime };
}

/**
 * Save-time proof: every photo on the checks is a fresh check-photo upload by this actor
 * in this org that nothing references yet. Returns exactly those uploads, for the
 * forward audit row. A truncated scan refuses (fails closed).
 */
export async function assertOwnedCheckPhotos(
  ctx: MutationCtx,
  a: { orgId: string; actorUserId: string; serverNow: number; checks: { photos?: string[] }[] },
): Promise<CheckPhotoUpload[]> {
  const urls = [...new Set(a.checks.flatMap((c) => c.photos ?? []))];
  if (urls.length === 0) return [];
  const owned: CheckPhotoUpload[] = [];
  for (const url of urls) owned.push(await ownedUpload(ctx, a, url));
  const refs = await findReferences(ctx, { orgId: a.orgId, uploads: owned });
  if (!refs.complete) throw refuse("can't be verified right now (too much activity since it was uploaded)");
  if (owned.some((u) => isReferenced(refs, u))) throw refuse("is already in use elsewhere");
  return owned;
}

/** Delete one blob and its `storedFiles` row — only when that row is this org's. */
async function deleteStored(ctx: MutationCtx, orgId: string, storageId: string): Promise<boolean> {
  const rec = await ctx.db.query("storedFiles").withIndex("by_storageId", (q) => q.eq("storageId", storageId)).unique();
  if (!rec || rec.organizationId !== orgId) return false;
  await ctx.db.delete(rec._id);
  try {
    await ctx.storage.delete(storageId as Id<"_storage">);
  } catch {
    // bytes already gone — the record is what mattered
  }
  return true;
}

/** Delete one proven upload: its blob, its thumbnail blob, their `storedFiles` rows and its `fileUploads` row. */
async function deleteUpload(ctx: MutationCtx, orgId: string, u: CheckPhotoUpload): Promise<boolean> {
  const row = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", u.uploadId)).first();
  if (!row || row.organizationId !== orgId || storageIdOf(row.url) !== u.storageId) return false;
  if (!(await deleteStored(ctx, orgId, u.storageId))) return false;
  const thumb = storageIdOf(row.thumbnailUrl);
  if (thumb) await deleteStored(ctx, orgId, thumb);
  await ctx.db.delete(row._id);
  return true;
}

/**
 * Delete exactly the uploads the forward save recorded, unless anything this save didn't
 * create references them. A truncated scan keeps every file. Returns how many were
 * deleted and how many kept.
 */
export async function deleteSavePhotos(
  ctx: MutationCtx,
  orgId: string,
  save: { photoUploads?: CheckPhotoUpload[]; photoStorageIds?: string[]; recordIds: string[]; createdMaintenanceIds: string[] },
): Promise<{ deleted: number; kept: number }> {
  const uploads = save.photoUploads ?? [];
  // A save recorded before uploads were (storage ids only) has nothing exact to find the rows by: keep them.
  if (uploads.length === 0) return { deleted: 0, kept: (save.photoStorageIds ?? []).length };
  const refs = await findReferences(ctx, {
    orgId, uploads, excludeRecordIds: save.recordIds, excludeMaintenanceIds: save.createdMaintenanceIds,
  });
  if (!refs.complete) return { deleted: 0, kept: uploads.length };
  let deleted = 0;
  for (const u of uploads) {
    if (!isReferenced(refs, u) && (await deleteUpload(ctx, orgId, u))) deleted += 1;
  }
  return { deleted, kept: uploads.length - deleted };
}
