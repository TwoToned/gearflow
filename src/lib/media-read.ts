import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { MEDIA_SPECS, type MediaKind } from "@/lib/media-mirror";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import type { MediaType, ProjectMediaType } from "@/generated/prisma/client";

/**
 * Server-side read helpers for the `*_media` domains (Phase 6 decommission).
 *
 * The `*_media` tables are dual-written (see {@link file:./media-mirror.ts}), so
 * the reactive lists' primary-photo grafts can read the Convex mirror instead of
 * a Prisma `*_media` + `file_upload` join. Only the photo GRAFTS move here —
 * `getModelCounts` / `getKitCounts` / `getAssetRegistryPhotos`, which already
 * feed a Convex-subscribed list via a separate non-reactive server call. The
 * read keeps its exact prior SHAPE (a `{ url, thumbnailUrl }` map keyed by
 * parent id); only the backing store changes from Prisma to Convex.
 *
 * Detail-page media galleries (composed inside large cross-domain Prisma detail
 * queries) and the dead standalone gallery actions stay on Prisma — splitting a
 * `media` include out of a non-reactive cross-domain query is gratuitous risk.
 *
 * NO Prisma fallback on a mirror miss — a missing file yields a null url, the
 * same as a Prisma join against a deleted row; falling back would hide mirror
 * drift. See FEATUREDOCS/54 "Phase 6 — Decommission".
 */

export type PhotoMeta = { url: string | null; thumbnailUrl: string | null };

type MediaRow = {
  type?: string | null;
  isPrimary?: boolean | null;
  fileId?: string | null;
  [k: string]: unknown;
};
type FileRow = { id: string; url?: string | null; thumbnailUrl?: string | null };

/**
 * Pure core: from an org's media rows + its file rows, build the primary-photo
 * map keyed by the parent foreign key. Mirrors the old Prisma read
 * `findMany({ where: { type: "PHOTO", isPrimary: true }, select: { <fk>, file } })`:
 * a parent appears iff it has a PHOTO row flagged primary, and its url/thumbnail
 * come from the joined file (absent file → nulls). Extracted so the filtering /
 * join logic is unit-testable without a live Convex backend.
 */
export function buildPrimaryPhotoMap(
  fk: string,
  mediaRows: MediaRow[],
  fileRows: FileRow[],
): Record<string, PhotoMeta> {
  const fileMap = new Map(fileRows.map((f) => [f.id, f]));
  const out: Record<string, PhotoMeta> = {};
  for (const m of mediaRows) {
    if (m.type !== "PHOTO" || !m.isPrimary) continue;
    const parentId = m[fk];
    if (typeof parentId !== "string") continue;
    const file = m.fileId ? fileMap.get(m.fileId) : undefined;
    out[parentId] = { url: file?.url ?? null, thumbnailUrl: file?.thumbnailUrl ?? null };
  }
  return out;
}

/**
 * Primary-photo maps for one or more media kinds, sourced from the Convex
 * mirror. Fetches the org's `fileUploads` ONCE (shared across kinds — the file
 * list is the largest collection, so a caller wanting two kinds, e.g. the asset
 * registry's asset + model photos, must not collect it twice) plus each kind's
 * media rows, then runs the pure {@link buildPrimaryPhotoMap} per kind. Replaces
 * the cross-domain Prisma `prisma.<kind>Media.findMany({ where: { type: "PHOTO",
 * isPrimary: true } })`.
 *
 * Like every org-scoped Convex read in the migration this `.collect()`s the
 * org's rows (the same pattern as getModelsByOrg / getSuppliersByOrg); a future
 * optimization is an indexed primary-photo-only query, but that needs a
 * hand-maintained Convex function the CRUD generator would overwrite.
 */
export async function getPrimaryPhotoMaps<K extends MediaKind>(
  kinds: readonly K[],
  orgId: string,
): Promise<Record<K, Record<string, PhotoMeta>>> {
  const convex = await getConvexClient();
  const [fileRows, ...mediaLists] = await Promise.all([
    convex.query(api.fileUploads.list, { orgId }),
    ...kinds.map((k) => convex.query(MEDIA_SPECS[k].convex.list, { orgId })),
  ]);
  const out = {} as Record<K, Record<string, PhotoMeta>>;
  kinds.forEach((k, i) => {
    out[k] = buildPrimaryPhotoMap(MEDIA_SPECS[k].fk, mediaLists[i] as MediaRow[], fileRows as FileRow[]);
  });
  return out;
}

/** Primary-photo map for a single media kind. Thin wrapper over
 * {@link getPrimaryPhotoMaps} (one `fileUploads` collect). */
export async function getPrimaryPhotoMap(
  kind: MediaKind,
  orgId: string,
): Promise<Record<string, PhotoMeta>> {
  return (await getPrimaryPhotoMaps([kind], orgId))[kind];
}

/* ------------------------------------------------------------------------- *
 * Standalone gallery getters (Phase A read-rewiring)
 *
 * The dead-no-longer standalone gallery server actions — getAssetMedia /
 * getModelMedia / getKitMedia / getProjectMedia — now read the Convex mirror
 * instead of a Prisma `*_media` + `file_upload` join. They reconstruct the EXACT
 * prior serialized shape: an array of media rows (ordered by sortOrder asc, the
 * Prisma `orderBy`), each with a nested `file` object, and `Date` values for
 * every timestamp (the old read ran `serialize()`, which preserves `Date`; the
 * Convex mirror stores epoch-ms, so we convert back to `Date` here).
 *
 * The Convex `*_media` columns `type` / `isPrimary` / `sortOrder` / `createdAt`
 * are stored `v.optional()` (they're Prisma-defaulted), so we coerce them to the
 * Prisma defaults (PHOTO / OTHER, false, 0, epoch) — never null — to match the
 * non-null Prisma row.
 *
 * The detail-page composites (`assets.ts:getAsset`, `kits.ts:getKit`,
 * `models.ts:getModel`) compose their galleries inside large cross-domain Prisma
 * detail queries and STAY on Prisma — documented terminus, see media-mirror.ts.
 * Only these four standalone getters move.
 *
 * NO Prisma fallback on a Convex miss — a missing file id reads `file: null`,
 * the same as a Prisma join against a deleted row.
 * ------------------------------------------------------------------------- */

/** The nested `file` shape the old `include: { file: true }` produced, with the
 * mirror's epoch-ms timestamps converted back to `Date`. */
export type GalleryFile = {
  id: string;
  organizationId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  storageKey: string;
  url: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  uploadedById: string;
  createdAt: Date;
  updatedAt: Date;
};

type GalleryMediaBase = {
  id: string;
  organizationId: string;
  fileId: string;
  displayName: string | null;
  sortOrder: number;
  createdAt: Date;
  file: GalleryFile | null;
};

export type AssetGalleryMedia = GalleryMediaBase & { assetId: string; type: MediaType; isPrimary: boolean };
export type ModelGalleryMedia = GalleryMediaBase & { modelId: string; type: MediaType; isPrimary: boolean };
export type KitGalleryMedia = GalleryMediaBase & { kitId: string; type: MediaType; isPrimary: boolean };
export type ProjectGalleryMedia = GalleryMediaBase & { projectId: string; type: ProjectMediaType };

/** Map a Convex `fileUploads` doc to the nested `file` shape (epoch-ms → Date,
 * absent → null for the nullable columns). */
export function mapGalleryFile(doc: Doc<"fileUploads"> | null): GalleryFile | null {
  if (!doc) return null;
  return {
    id: doc.id,
    organizationId: doc.organizationId,
    fileName: doc.fileName,
    fileSize: doc.fileSize,
    mimeType: doc.mimeType,
    storageKey: doc.storageKey,
    url: doc.url,
    thumbnailUrl: doc.thumbnailUrl ?? null,
    width: doc.width ?? null,
    height: doc.height ?? null,
    uploadedById: doc.uploadedById,
    createdAt: new Date(doc.createdAt ?? 0),
    updatedAt: new Date(doc.updatedAt ?? 0),
  };
}

/** Shared media-row fields (everything but the parent FK + photo `type`/`isPrimary`). */
function mapGalleryBase(
  m: { id: string; organizationId: string; fileId: string; displayName?: string | null; sortOrder?: number | null; createdAt?: number | null },
  file: GalleryFile | null,
): GalleryMediaBase {
  return {
    id: m.id,
    organizationId: m.organizationId,
    fileId: m.fileId,
    displayName: m.displayName ?? null,
    sortOrder: m.sortOrder ?? 0,
    createdAt: new Date(m.createdAt ?? 0),
    file,
  };
}

/** Pure sort replicating Prisma `orderBy: { sortOrder: "asc" }` (coercing the
 * Prisma-defaulted `sortOrder` to 0). Stable so ties keep input order. */
export function sortGalleryBySortOrder<T extends { sortOrder?: number | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

/**
 * Resolve the nested `file` for a set of media rows from the Convex mirror.
 * Fetches each distinct `fileId` once via `fileUploads.getById` (per-parent
 * media sets are small; a per-parent gallery has at most a handful of files, so
 * a few targeted lookups beat pulling the whole org file list).
 */
async function fetchGalleryFiles(fileIds: string[]): Promise<Map<string, GalleryFile>> {
  const unique = [...new Set(fileIds)];
  if (unique.length === 0) return new Map();
  const convex = await getConvexClient();
  const docs = await Promise.all(unique.map((id) => convex.query(api.fileUploads.getById, { id })));
  const out = new Map<string, GalleryFile>();
  unique.forEach((id, i) => {
    const mapped = mapGalleryFile(docs[i]);
    if (mapped) out.set(id, mapped);
  });
  return out;
}

async function getGalleryRows<K extends MediaKind>(
  kind: K,
  parentId: string,
): Promise<Array<Doc<"assetMedia"> | Doc<"modelMedia"> | Doc<"kitMedia"> | Doc<"projectMedia">>> {
  const convex = await getConvexClient();
  return withConvexReadRetry(
    async () =>
      (await convex.query(MEDIA_SPECS[kind].convex.listByParent, { parentId })) as Array<
        Doc<"assetMedia"> | Doc<"modelMedia"> | Doc<"kitMedia"> | Doc<"projectMedia">
      >,
  );
}

/** Asset gallery — replaces `prisma.assetMedia.findMany({ where: { assetId },
 * include: { file }, orderBy: { sortOrder: "asc" } })`. */
export async function getAssetMediaFromConvex(assetId: string): Promise<AssetGalleryMedia[]> {
  const rows = sortGalleryBySortOrder((await getGalleryRows("asset", assetId)) as Doc<"assetMedia">[]);
  const files = await fetchGalleryFiles(rows.map((r) => r.fileId));
  return rows.map((m) => ({
    ...mapGalleryBase(m, files.get(m.fileId) ?? null),
    assetId: m.assetId,
    type: (m.type ?? "PHOTO") as MediaType,
    isPrimary: m.isPrimary ?? false,
  }));
}

/** Model gallery — Convex equivalent of the old `prisma.modelMedia` getter. */
export async function getModelMediaFromConvex(modelId: string): Promise<ModelGalleryMedia[]> {
  const rows = sortGalleryBySortOrder((await getGalleryRows("model", modelId)) as Doc<"modelMedia">[]);
  const files = await fetchGalleryFiles(rows.map((r) => r.fileId));
  return rows.map((m) => ({
    ...mapGalleryBase(m, files.get(m.fileId) ?? null),
    modelId: m.modelId,
    type: (m.type ?? "PHOTO") as MediaType,
    isPrimary: m.isPrimary ?? false,
  }));
}

/** Kit gallery — Convex equivalent of the old `prisma.kitMedia` getter. */
export async function getKitMediaFromConvex(kitId: string): Promise<KitGalleryMedia[]> {
  const rows = sortGalleryBySortOrder((await getGalleryRows("kit", kitId)) as Doc<"kitMedia">[]);
  const files = await fetchGalleryFiles(rows.map((r) => r.fileId));
  return rows.map((m) => ({
    ...mapGalleryBase(m, files.get(m.fileId) ?? null),
    kitId: m.kitId,
    type: (m.type ?? "PHOTO") as MediaType,
    isPrimary: m.isPrimary ?? false,
  }));
}

/** Project gallery — Convex equivalent of the old `prisma.projectMedia` getter.
 * Project media has NO `isPrimary` and uses `ProjectMediaType` (default OTHER). */
export async function getProjectMediaFromConvex(projectId: string): Promise<ProjectGalleryMedia[]> {
  const rows = sortGalleryBySortOrder((await getGalleryRows("project", projectId)) as Doc<"projectMedia">[]);
  const files = await fetchGalleryFiles(rows.map((r) => r.fileId));
  return rows.map((m) => ({
    ...mapGalleryBase(m, files.get(m.fileId) ?? null),
    projectId: m.projectId,
    type: (m.type ?? "OTHER") as ProjectMediaType,
  }));
}
