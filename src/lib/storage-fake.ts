/**
 * In-memory fake for file storage (POLICY.md R-8.10.4 — every adapter should
 * have a local/fake implementation for tests). Mirrors the `uploadToS3` /
 * `deleteFromS3` / `getServeInfo` / `getProxyUrl` surface (`@/lib/storage`) so
 * tests can assert what was stored without hitting Convex `_storage`.
 */
import type { ServeInfo, UploadResult } from "@/lib/storage";

export interface FakeStoredFile {
  storageKey: string;
  bytes: Buffer;
  organizationId: string;
  folder: string;
  entityId: string;
  fileName: string;
  mimeType: string;
  url: string;
}

export interface FakeStorage {
  /** Drop-in for `uploadToS3` — records the bytes and returns a stable key. */
  upload: (
    file: Buffer,
    options: {
      organizationId: string;
      folder: string;
      entityId: string;
      fileName: string;
      mimeType: string;
    },
  ) => Promise<UploadResult>;
  /** Drop-in for `deleteFromS3`. */
  delete: (storageKey: string) => Promise<void>;
  /** Drop-in for `getServeInfo`. Null if the key was never uploaded (or was deleted). */
  getServeInfo: (storageKey: string) => Promise<ServeInfo | null>;
  /** Everything currently stored, in upload order. */
  readonly files: readonly FakeStoredFile[];
  /** Reset captured state between tests. */
  clear: () => void;
}

export function createFakeStorage(): FakeStorage {
  const byKey = new Map<string, FakeStoredFile>();
  let counter = 0;

  return {
    upload: async (file, options) => {
      counter += 1;
      const storageKey = `fake-storage-${counter}`;
      const url = `/api/files/${storageKey}`;
      byKey.set(storageKey, { storageKey, bytes: file, url, ...options });
      return { storageKey, url };
    },
    delete: async (storageKey) => {
      byKey.delete(storageKey);
    },
    getServeInfo: async (storageKey) => {
      const file = byKey.get(storageKey);
      if (!file) return null;
      return {
        organizationId: file.organizationId,
        url: file.url,
        contentType: file.mimeType,
        size: file.bytes.length,
        fileName: file.fileName,
      };
    },
    get files() {
      return Array.from(byKey.values());
    },
    clear: () => {
      byKey.clear();
    },
  };
}
