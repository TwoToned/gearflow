# Media & File Storage

## Upload Flow
1. Client sends multipart form to `POST /api/uploads`
2. Server uploads to S3 under `{orgId}/{folder}/{entityId}/{uuid}-{filename}`
3. Returns `FileUpload` record with `storageKey, url, mimeType, fileSize`
4. Entity-specific media join table created (e.g., `ModelMedia`)

## File Proxy (`GET /api/files/[...path]`)
- Validates `storageKey` starts with the single org's ID (via `getTheOrg()`)
- Returns 403 if org mismatch (prevents unauthorized access)
- Exception: `avatars/` prefix allowed without org validation (global)
- Streams file from S3

## Photo Resolution Cascade
- `resolveAssetPhotoUrl(asset, model)`: asset primary photo → model primary photo → null
- `resolveModelPhotoUrl(model)`: model primary photo → null

## Media Join Tables
`ModelMedia`, `AssetMedia`, `KitMedia`, `ProjectMedia`, `ClientMedia`, `LocationMedia` — each links entity to `FileUpload` with `type`, `isPrimary`, `displayName`, `sortOrder`.

## Components
- **MediaUploader** (`src/components/media/media-uploader.tsx`) — Drag-to-reorder, primary marking, bulk upload
- **MediaThumbnail** (`src/components/media/media-thumbnail.tsx`) — Image with fallback placeholder
- **MediaLightbox** (`src/components/media/media-lightbox.tsx`) — Full-screen image viewer
