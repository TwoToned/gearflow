/**
 * The photos of an ad-hoc check (`checkRecordWrites.saveAdHocCheck` and its exact Undo,
 * overseer ruling 2026-11-23; hardened after review B1).
 *
 * A FAIL carries a required photo (#898), uploaded through `/api/uploads` for THIS save.
 * The Undo deletes those files with the records that held them, so nothing is left
 * orphaned. Because deleting a file is destructive, the SAVE proves each photo is one
 * the check may own, and records exactly those storage ids on its own audit row:
 *  - the URL is `/api/files/{storageId}`;
 *  - it names a `fileUploads` row of THIS org, uploaded by THIS actor, in the last
 *    {@link PHOTO_MAX_AGE_MS} (a check's photos are taken during the check);
 *  - its `storedFiles` row is this org's and in the {@link CHECK_PHOTO_FOLDER} folder
 *    (a quote/invoice PDF, model media or anything else uploaded elsewhere is refused);
 *  - no check record already references it (scanned back to the upload's time).
 * The Undo deletes only the ids on that row, and still skips any another record on the
 * asset, or any record saved since, references.
 *
 * A photo is stored as `/api/files/{storageId}` (`src/lib/storage.ts`). Each upload is
 * one `storedFiles` row per `_storage` blob (original + thumbnail) and one `fileUploads`
 * row naming both. Every read is org re-checked; reads are bounded. ConvexError only.
 */
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** The upload folder the check-item photo picker sends (`PhotoGridInput folder`). */
export const CHECK_PHOTO_FOLDER = "check-photos";
/** A check's photo must have been uploaded within this long before the save. */
export const PHOTO_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Other check records on the asset scanned for a shared photo. */
const MAX_ASSET_CHECKS = 500;
/** Maintenance links on the asset scanned for a shared photo. */
const MAX_ASSET_LINKS = 200;
/** The org's newest uploads searched for a photo's `fileUploads` row. */
const MAX_RECENT_UPLOADS = 500;
/** The org's newest check records scanned for an existing reference. */
const MAX_RECENT_CHECKS = 1000;

const FILE_URL = /^\/api\/files\/([A-Za-z0-9_-]+)$/;

/** The `_storage` id a photo URL names, or null for anything else. */
export function storageIdOf(url: string | undefined): string | null {
  const m = url ? FILE_URL.exec(url) : null;
  return m ? m[1] : null;
}

function idsOf(urls: (string[] | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const list of urls) for (const u of list ?? []) {
    const id = storageIdOf(u);
    if (id) out.add(id);
  }
  return out;
}

async function recentUploads(ctx: MutationCtx, orgId: string): Promise<Doc<"fileUploads">[]> {
  return await ctx.db.query("fileUploads").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).order("desc").take(MAX_RECENT_UPLOADS);
}

/** Storage ids any check record in the org created at/after `since` references. */
async function referencedByChecksSince(ctx: MutationCtx, orgId: string, since: number, exclude: string[] = []): Promise<Set<string>> {
  const lists: (string[] | undefined)[] = [];
  const recent = await ctx.db.query("checkRecords").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).order("desc").take(MAX_RECENT_CHECKS);
  for (const r of recent) {
    if (r._creationTime < since) break;
    if (!exclude.includes(r.id)) lists.push(r.photos);
  }
  return idsOf(lists);
}

const refuse = (why: string) => new ConvexError(`A check photo ${why}: upload it again from the check`);

/** One photo's upload, proven fit for this check (see the module doc). */
async function ownedUpload(
  ctx: MutationCtx,
  a: { orgId: string; actorUserId: string; serverNow: number },
  url: string,
  uploads: Doc<"fileUploads">[],
): Promise<{ storageId: string; at: number }> {
  const storageId = storageIdOf(url);
  if (!storageId) throw refuse("must be an uploaded file");
  const row = uploads.find((u) => storageIdOf(u.url) === storageId);
  if (!row || row.organizationId !== a.orgId) throw refuse("isn't a recent upload in this organisation");
  if (row.uploadedById !== a.actorUserId) throw refuse("was uploaded by someone else");
  const at = row.createdAt ?? 0;
  if (a.serverNow - at > PHOTO_MAX_AGE_MS) throw refuse("is too old");
  const stored = await ctx.db.query("storedFiles").withIndex("by_storageId", (q) => q.eq("storageId", storageId)).unique();
  if (!stored || stored.organizationId !== a.orgId || stored.folder !== CHECK_PHOTO_FOLDER) throw refuse("wasn't uploaded as a check photo");
  return { storageId, at };
}

/**
 * Save-time proof (review B1): every photo on the checks is a fresh check-photo upload by
 * this actor in this org that no check record references yet. Returns exactly those
 * storage ids, for the forward audit row.
 */
export async function assertOwnedCheckPhotos(
  ctx: MutationCtx,
  a: { orgId: string; actorUserId: string; serverNow: number; checks: { photos?: string[] }[] },
): Promise<string[]> {
  const urls = [...new Set(a.checks.flatMap((c) => c.photos ?? []))];
  if (urls.length === 0) return [];
  const uploads = await recentUploads(ctx, a.orgId);
  const owned = [];
  for (const url of urls) owned.push(await ownedUpload(ctx, a, url, uploads));
  const used = await referencedByChecksSince(ctx, a.orgId, Math.min(...owned.map((o) => o.at)));
  const reused = owned.find((o) => used.has(o.storageId));
  if (reused) throw refuse("is already on another check");
  return owned.map((o) => o.storageId);
}

/** Storage ids still referenced by records this save did NOT create. */
async function referencedElsewhere(
  ctx: MutationCtx,
  a: { orgId: string; assetId: string; ownRecordIds: string[]; ownMaintenanceIds: string[]; savedAt: number },
): Promise<Set<string>> {
  const checks = await ctx.db
    .query("checkRecords")
    .withIndex("by_organizationId_assetId", (q) => q.eq("organizationId", a.orgId).eq("assetId", a.assetId))
    .order("desc")
    .take(MAX_ASSET_CHECKS);
  const lists = checks.filter((r) => !a.ownRecordIds.includes(r.id)).map((r) => r.photos);
  const links = await ctx.db.query("maintenanceRecordAssets").withIndex("by_assetId", (q) => q.eq("assetId", a.assetId)).take(MAX_ASSET_LINKS);
  for (const l of links) {
    if (a.ownMaintenanceIds.includes(l.maintenanceRecordId)) continue;
    const m = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", l.maintenanceRecordId)).first();
    if (m && m.organizationId === a.orgId) lists.push(m.photos);
  }
  const since = await referencedByChecksSince(ctx, a.orgId, a.savedAt, a.ownRecordIds);
  return new Set([...idsOf(lists), ...since]);
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

/** The photo's `fileUploads` row (and its thumbnail blob), found among the org's newest. */
async function deleteUploadRow(ctx: MutationCtx, orgId: string, storageId: string, recent: Doc<"fileUploads">[]): Promise<void> {
  const row = recent.find((u) => u.organizationId === orgId && storageIdOf(u.url) === storageId);
  if (!row) return;
  const thumb = storageIdOf(row.thumbnailUrl);
  if (thumb) await deleteStored(ctx, orgId, thumb);
  await ctx.db.delete(row._id);
}

/**
 * Delete exactly the storage ids the forward save recorded, unless a record it didn't
 * create references them (on the asset, or anywhere since the save). Returns how many.
 */
export async function deleteSavePhotos(
  ctx: MutationCtx,
  a: { orgId: string; assetId: string; storageIds: string[]; ownRecordIds: string[]; ownMaintenanceIds: string[]; savedAt: number },
): Promise<number> {
  if (a.storageIds.length === 0) return 0;
  const shared = await referencedElsewhere(ctx, a);
  const recent = await recentUploads(ctx, a.orgId);
  let deleted = 0;
  for (const id of a.storageIds) {
    if (shared.has(id)) continue;
    if (!(await deleteStored(ctx, a.orgId, id))) continue;
    await deleteUploadRow(ctx, a.orgId, id, recent);
    deleted += 1;
  }
  return deleted;
}
