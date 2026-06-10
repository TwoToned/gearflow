import { getConvexClient } from "@/lib/convex-client";
import { MEDIA_SPECS, type MediaKind } from "@/lib/media-mirror";
import { api } from "../../convex/_generated/api";

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
