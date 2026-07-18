import { getConvexClient } from "@/lib/convex-client";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { api } from "../../convex/_generated/api";

/**
 * File storage on Convex `_storage` (replaces the self-hosted Garage/S3 box). The
 * public API shape (uploadToS3 / deleteFromS3 / getProxyUrl / getFileAsDataUri) is
 * kept so callers don't change — the "storageKey" is now a Convex storageId, and the
 * `/api/files/{storageId}` proxy authorises a serve via the file's `storedFiles` org
 * record (see convex/files.ts + the /api/files route). Uploads are server-side: mint a
 * Convex upload URL, POST the bytes to it, then register the org association.
 */

export interface UploadResult {
  storageKey: string;
  url: string;
}

/**
 * No-op — Convex storage needs no bucket. Retained so existing callers don't change.
 * @deprecated Legacy S3/Garage-era name; storage is Convex now. Removal condition: rename
 * callers to Convex-storage terminology, then delete. Tracked: POLICY.md R-4.4 / R-8.10.2.
 */
export async function ensureBucket(): Promise<void> {}

/**
 * @deprecated S3-era name — routes to Convex `_storage`, not S3 (the Garage/S3 box is
 * decommissioned). Removal condition: rename callers to `uploadFile`/Convex terminology,
 * then delete this alias. Tracked: POLICY.md R-4.4 / R-8.10.2.
 */
export async function uploadToS3(
  file: Buffer,
  options: {
    organizationId: string;
    folder: string;
    entityId: string;
    fileName: string;
    mimeType: string;
  },
): Promise<UploadResult> {
  const convex = await getConvexClient();
  const uploadUrl = await convex.mutation(api.files.generateUploadUrl, {});
  const res = await fetchWithTimeout(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": options.mimeType },
    // Buffer isn't in the DOM BodyInit types; a plain Uint8Array view is.
    body: new Uint8Array(file),
  });
  if (!res.ok) throw new Error(`Convex storage upload failed: ${res.status}`);
  const { storageId } = (await res.json()) as { storageId: string };

  await convex.mutation(api.files.register, {
    storageId,
    organizationId: options.organizationId,
    folder: options.folder,
    fileName: options.fileName,
    createdAt: Date.now(),
  });

  return { storageKey: storageId, url: `/api/files/${storageId}` };
}

/**
 * @deprecated S3-era name — deletes from Convex `_storage`, not S3. Removal condition:
 * rename callers to `deleteFile`/Convex terminology, then delete this alias. Tracked:
 * POLICY.md R-4.4 / R-8.10.2.
 */
export async function deleteFromS3(storageKey: string): Promise<void> {
  const convex = await getConvexClient();
  await convex.mutation(api.files.deleteFile, { storageId: storageKey });
}

export interface ServeInfo {
  organizationId: string;
  url: string;
  contentType: string | null;
  size: number | null;
  fileName: string | null;
}

/** Auth + streaming info for the /api/files proxy. Null → the storageId has no record. */
export async function getServeInfo(storageKey: string): Promise<ServeInfo | null> {
  const convex = await getConvexClient();
  return await convex.query(api.files.getServeInfo, { storageId: storageKey });
}

export function getProxyUrl(storageKey: string): string {
  return `/api/files/${storageKey}`;
}

/** Extract storage key from a proxy URL like /api/files/{key} */
export function storageKeyFromUrl(proxyUrl: string): string | null {
  const prefix = "/api/files/";
  const idx = proxyUrl.indexOf(prefix);
  if (idx === -1) return null;
  return proxyUrl.slice(idx + prefix.length);
}

/** Read a file (by proxy URL) and return it as a base64 data URI (for PDF embedding). */
export async function getFileAsDataUri(proxyUrl: string): Promise<string | null> {
  const key = storageKeyFromUrl(proxyUrl);
  if (!key) return null;
  const info = await getServeInfo(key);
  if (!info) return null;
  try {
    // Cache policy (R-9.9): no-cache — called rarely (data-URI generation, e.g. PDF
    // embedding), not a hot path. File bytes are immutable per storageId, so a TTL
    // cache keyed on storageId is safe to add here if this ever becomes frequent.
    const res = await fetchWithTimeout(info.url);
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    const contentType = info.contentType || "image/png";
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}
