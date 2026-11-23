/**
 * The photo half of the ad-hoc check's exact Undo (`checkRecordWrites.
 * undoAdHocCheckNative`, overseer ruling 2026-11-23). A FAIL carries a required photo
 * (#898), uploaded through `/api/uploads` for THIS save. When its author reverses the
 * save inside the 10-minute window, the files go with the records that held them, so
 * nothing is left orphaned in `_storage`. A file is deleted only when nothing else
 * references it: no other check record or maintenance record on the asset names it.
 * The restored draft comes back without photos (the page says so).
 *
 * A photo is stored as `/api/files/{storageId}` (`src/lib/storage.ts`). Each upload is
 * one `storedFiles` row per `_storage` blob (original + thumbnail) and one
 * `fileUploads` row naming both. Every read is org re-checked; reads are bounded.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** Other check records on the asset scanned for a shared photo. */
const MAX_ASSET_CHECKS = 500;
/** Maintenance links on the asset scanned for a shared photo. */
const MAX_ASSET_LINKS = 200;
/** The org's newest uploads searched for the photo's `fileUploads` row (it is < 10 min old). */
const MAX_RECENT_UPLOADS = 200;

const FILE_URL = /\/api\/files\/([A-Za-z0-9_-]+)$/;

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

/** Storage ids still referenced on the asset by records this save did NOT create. */
async function referencedElsewhere(
  ctx: MutationCtx,
  a: { orgId: string; assetId: string; ownRecordIds: string[]; ownMaintenanceIds: string[] },
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
  return idsOf(lists);
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
 * Delete the files this save's records reference, unless another record on the asset
 * references them too. Returns how many photos were deleted.
 */
export async function deleteSavePhotos(
  ctx: MutationCtx,
  a: { orgId: string; assetId: string; photos: (string[] | undefined)[]; ownRecordIds: string[]; ownMaintenanceIds: string[] },
): Promise<number> {
  const mine = idsOf(a.photos);
  if (mine.size === 0) return 0;
  const shared = await referencedElsewhere(ctx, a);
  const recent = await ctx.db
    .query("fileUploads")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId))
    .order("desc")
    .take(MAX_RECENT_UPLOADS);
  let deleted = 0;
  for (const id of mine) {
    if (shared.has(id)) continue;
    if (!(await deleteStored(ctx, a.orgId, id))) continue;
    await deleteUploadRow(ctx, a.orgId, id, recent);
    deleted += 1;
  }
  return deleted;
}
