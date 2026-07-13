import { createId } from "@paralleldrive/cuid2";
import { getConvexClient } from "@/lib/convex-client";
import { deleteFromS3, storageKeyFromUrl } from "@/lib/storage";
import { mapGalleryFile, type GalleryFile } from "@/lib/media-read";
import { MEDIA_SPECS, type MediaKind } from "@/lib/media-specs";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Convex-only media write helpers (Phase C — replaces the dual-write
 * media-mirror.ts + file-upload-mirror.ts). Generic over {@link MediaKind} via
 * {@link MEDIA_SPECS}. The 7 `*-media` server actions are thin wrappers around
 * these; parent-ownership checks stay in the caller (per-domain Convex lookups).
 *
 * Invariants preserved from the old Prisma paths:
 * - sortOrder = max(existing)+1 (computed from the Convex gallery; same
 *   non-atomic read-then-insert window the Prisma aggregate+create had).
 * - first PHOTO is primary; deleting the primary promotes the next PHOTO by
 *   sortOrder; set-primary / reorder run as single atomic Convex mutations.
 * - removing a media row also deletes its file_upload (1:1). subHire optionally
 *   ref-counts across all media tables first (matches the old UNION guard).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyArgs = any;

export interface AddMediaInput {
  organizationId: string;
  parentId: string;
  fileId: string;
  type: string;
  displayName?: string;
}

/** The created media row in the old `include: { file }` serialized shape. */
export interface CreatedMedia {
  id: string;
  organizationId: string;
  fileId: string;
  type: string;
  isPrimary?: boolean;
  displayName: string | null;
  sortOrder: number;
  createdAt: Date;
  file: GalleryFile | null;
  [fk: string]: unknown;
}

/** Add a media row (Convex-only). Throws if the file is missing / wrong org. */
export async function addMediaConvex(kind: MediaKind, input: AddMediaInput): Promise<CreatedMedia> {
  const spec = MEDIA_SPECS[kind];
  const convex = await getConvexClient();

  const fileDoc = (await convex.query(api.fileUploads.getById, { id: input.fileId })) as Doc<"fileUploads"> | null;
  if (!fileDoc || fileDoc.organizationId !== input.organizationId) throw new Error("File not found");

  const existing = (await convex.query(spec.convex.listByParent, { parentId: input.parentId } as AnyArgs)) as Array<{
    sortOrder?: number | null;
    type?: string | null;
  }>;
  const maxSort = existing.reduce((m, r) => Math.max(m, r.sortOrder ?? -1), -1);
  const isPrimary = spec.photo && input.type === "PHOTO"
    ? existing.filter((r) => r.type === "PHOTO").length === 0
    : false;

  const id = createId();
  const createdAt = Date.now();
  const doc: Record<string, unknown> = {
    id,
    organizationId: input.organizationId,
    [spec.fk]: input.parentId,
    fileId: input.fileId,
    type: input.type,
    sortOrder: maxSort + 1,
    createdAt,
  };
  if (input.displayName !== undefined) doc.displayName = input.displayName;
  if (spec.photo) doc.isPrimary = isPrimary;

  await convex.mutation(spec.convex.createIfMissing, doc as AnyArgs);

  return {
    id,
    organizationId: input.organizationId,
    [spec.fk]: input.parentId,
    fileId: input.fileId,
    type: input.type,
    ...(spec.photo ? { isPrimary } : {}),
    displayName: input.displayName ?? null,
    sortOrder: maxSort + 1,
    createdAt: new Date(createdAt),
    file: mapGalleryFile(fileDoc),
  };
}

/**
 * Remove a media row (Convex-only) + its file (S3 + Convex). Promotes the next
 * PHOTO if the removed one was primary. `refCountFile` (subHire) checks all media
 * tables before deleting the file. Throws if the media is missing / wrong org.
 */
export async function removeMediaConvex(
  kind: MediaKind,
  opts: { organizationId: string; mediaId: string; refCountFile?: boolean },
): Promise<void> {
  const spec = MEDIA_SPECS[kind];
  const convex = await getConvexClient();

  const media = (await convex.query(spec.convex.getById, { id: opts.mediaId } as AnyArgs)) as
    | (Record<string, unknown> & { id: string; organizationId: string; fileId: string; type?: string | null; isPrimary?: boolean | null })
    | null;
  if (!media || media.organizationId !== opts.organizationId) throw new Error("Media not found");

  const parentId = media[spec.fk] as string;
  const wasPrimary = media.isPrimary ?? false;
  const fileId = media.fileId;

  await convex.mutation(spec.convex.remove, { id: opts.mediaId } as AnyArgs);

  const fileDoc = (await convex.query(api.fileUploads.getById, { id: fileId })) as Doc<"fileUploads"> | null;
  if (fileDoc) {
    try {
      await deleteFromS3(fileDoc.storageKey);
      // The thumbnail is a separate Convex storage object with its OWN opaque id —
      // extract it from thumbnailUrl (/api/files/{thumbStorageId}), not by rewriting
      // the original key (which only worked for the old S3 path scheme).
      if (fileDoc.thumbnailUrl) {
        const thumbKey = storageKeyFromUrl(fileDoc.thumbnailUrl);
        if (thumbKey) await deleteFromS3(thumbKey);
      }
    } catch {
      // best-effort S3 cleanup
    }
    const stillReferenced = opts.refCountFile
      ? await convex.query(api.fileUploads.isReferencedByMedia, { fileId })
      : false;
    if (!stillReferenced) await convex.mutation(api.fileUploads.remove, { id: fileId });
  }

  if (spec.photo && wasPrimary && media.type === "PHOTO") {
    const rest = (await convex.query(spec.convex.listByParent, { parentId } as AnyArgs)) as Array<{
      id: string;
      type?: string | null;
      sortOrder?: number | null;
    }>;
    const next = rest
      .filter((r) => r.type === "PHOTO")
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))[0];
    if (next) await convex.mutation(spec.convex.update, { id: next.id, patch: { isPrimary: true } } as AnyArgs);
  }
}

/** Set the single primary photo for a parent (atomic Convex mutation). */
export async function setPrimaryPhotoConvex(
  kind: MediaKind,
  opts: { organizationId: string; parentId: string; mediaId: string },
): Promise<void> {
  const spec = MEDIA_SPECS[kind];
  if (!spec.photo || !spec.convex.setPrimary) throw new Error(`${kind} media has no primary photo`);
  const convex = await getConvexClient();
  const media = (await convex.query(spec.convex.getById, { id: opts.mediaId } as AnyArgs)) as
    | (Record<string, unknown> & { organizationId: string; type?: string | null })
    | null;
  if (
    !media ||
    media.organizationId !== opts.organizationId ||
    media[spec.fk] !== opts.parentId ||
    media.type !== "PHOTO"
  ) {
    throw new Error("Media not found");
  }
  await convex.mutation(spec.convex.setPrimary, { parentId: opts.parentId, mediaId: opts.mediaId } as AnyArgs);
}

/** Reorder a parent's media by the given id order (atomic Convex mutation). `orgId`
 *  scopes the per-item org re-check in the mutation (by_cuid is a GLOBAL index). */
export async function reorderMediaConvex(kind: MediaKind, orderedIds: string[], orgId: string): Promise<void> {
  const spec = MEDIA_SPECS[kind];
  if (!spec.convex.reorder) throw new Error(`${kind} media has no reorder`);
  const convex = await getConvexClient();
  await convex.mutation(spec.convex.reorder, { orgId, orderedIds } as AnyArgs);
}
