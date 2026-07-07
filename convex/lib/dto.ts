/**
 * Allowlist DTO projection for browser-facing composite queries (§3.5).
 *
 * The detail/browser composites (projectEquipment, equipmentTab, warehouseDetail,
 * kitDetail, assetDetail) join several tables and return them to a user token
 * (RBAC-gated). Most of those tables are ALREADY browser-readable via the generated
 * thin CRUD (`api.<table>.list`/`getById` on the BROWSER_READABLE allowlist), so
 * re-returning their raw docs in a composite is not a new exposure — parity with the
 * server action, and a future secret column on such a table must be redacted at the
 * generator's REDACTED_FIELDS layer (where crewMembers.icalToken already lives), not
 * here.
 *
 * The exceptions are the tables a composite pulls in that are NOT browser-readable
 * AND carry sensitive columns:
 *   • `users` (Better-Auth, EXCLUDED from CRUD) — the kit page shows a scan's
 *     "scanned by", which needs only { id, name }. The raw row also holds email,
 *     role, banReason, twoFactorEnabled, … — never send those to the browser.
 *   • `fileUploads` — media rendering needs the URLs (+ name/size/type on the asset
 *     page); the raw row also holds `storageKey` (the S3/blob object key) and
 *     `uploadedById`. Never send the storage key to the browser.
 *
 * `pick` returns an explicit ALLOWLIST projection: only the named fields survive, so
 * a column added to one of these tables later can't leak without editing the
 * allowlist. Convex meta (`_id`, `_creationTime`) is dropped too (not in the list).
 * Absent optional fields stay absent (the consumer's `?? default` handles them).
 */

/** Project `doc` down to exactly the allowlisted keys (undefined/absent keys skipped). */
export function pick<T extends Record<string, unknown>, K extends keyof T>(
  doc: T,
  keys: readonly K[],
): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) {
    if (k in doc) out[k] = doc[k];
  }
  return out;
}

/** Browser-safe `users` projection — identity only, no PII. */
export const USER_PUBLIC_FIELDS = ["id", "name"] as const;

/** Browser-safe `fileUploads` projection for URL-only media (kit page). */
export const FILE_URL_FIELDS = ["id", "url", "thumbnailUrl"] as const;

/** Browser-safe `fileUploads` projection incl. display metadata (asset page). */
export const FILE_META_FIELDS = ["id", "fileName", "fileSize", "mimeType", "url", "thumbnailUrl"] as const;
