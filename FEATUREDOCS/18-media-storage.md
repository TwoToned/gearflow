# Media & File Storage

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

## Upload Flow
1. Client sends multipart form to `POST /api/uploads` (`src/app/api/uploads/route.ts`)
2. Server uploads to S3 under `{orgId}/{folder}/{entityId}/{uuid}-{filename}`
3. Creates the `FileUpload` record Convex-only (`api.fileUploads.createIfMissing`) and returns it with `storageKey, url, mimeType, fileSize` — there is no Prisma `FileUpload` table anymore
4. Entity-specific media join table created (e.g., `ModelMedia` — also Convex-only, `convex/modelMedia.ts` / `convex/mediaWrites.ts`)

## Upload Response Validation
`uploadToS3()` (`src/lib/storage.ts`) Zod-parses the Convex upload-URL response
(`{ storageId: string }`, via `convexUploadResponseSchema`) instead of casting it —
vendor responses are untrusted input (POLICY.md R-8.10.3), same pattern as
`resendSendResponseSchema` in `email.ts` and `placeResultSchema` in `address-input.tsx`.

## File Proxy (`GET /api/files/[...path]`)
- Record-based auth (replaced the old S3 org-prefixed-key path check): looks up the
  file's org via `getServeInfo(storageKey)` (`src/lib/storage.ts`, backed by the
  Convex `api.files.getServeInfo` query) rather than checking the key prefix against
  `getTheOrg()`
- Returns 403 if org mismatch (prevents unauthorized access); 404 if no matching file record
- Exception: `organizationId === "avatars"` allowed without org validation (global)
- Streams file from S3

## Photo Resolution Cascade
- `resolveAssetPhotoUrl(asset, model)`: asset primary photo → model primary photo → null
- `resolveModelPhotoUrl(model)`: model primary photo → null

## Media Join Tables
`ModelMedia`, `AssetMedia`, `KitMedia`, `ProjectMedia`, `ClientMedia`, `LocationMedia` — each links entity to `FileUpload` with `type`, `isPrimary`, `displayName`, `sortOrder`.

## Components
- **MediaUploader** (`src/components/media/media-uploader.tsx`) — Bulk upload + primary marking. Manual drag-to-reorder was removed (`chore/remove-pdf-builder-and-dnd`, `@dnd-kit` dropped); media keeps its existing `sortOrder`. The `onReorder` prop is retained on the interface but unused.
- **MediaThumbnail** (`src/components/media/media-thumbnail.tsx`) — Image with fallback placeholder
- **MediaLightbox** (`src/components/media/media-lightbox.tsx`) — Full-screen image viewer
