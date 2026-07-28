/**
 * Artifact file naming for the immutable finance documents (#987).
 *
 * ONE definition (R-3.1), shared by the three places a name is needed: the
 * upload (`src/server/finance-documents.ts`), the `Content-Disposition` on the
 * download routes, and the tests that assert what a client actually receives. A
 * second hand-maintained copy would be a defect even while in sync — and this
 * particular string is the one the client sees, so drift is visible to them.
 *
 * Names carry the REVISION, deliberately: `RVLT-2026-0087-quote-v2.pdf` and
 * `RVLT-2026-0087-quote-v3.pdf` are different documents and must never share a
 * filename in someone's downloads folder. There is no quote number of its own
 * (decision 5) — the project number plus `v<n>` IS the reference.
 */

/** Strip everything that could break a `Content-Disposition` header or escape a
 *  directory, mirroring the `/api/files` proxy's own sanitiser. */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\r\n"\\/:]/g, "_")
    .replace(/\.\./g, "_")
    .replace(/^\.+/, "")
    .trim();
  return cleaned || "document";
}

export function quoteArtifactFileName(projectNumber: string, version: number): string {
  return sanitizeFileName(`${projectNumber || "quote"}-quote-v${version}.pdf`);
}

/**
 * An issued invoice already has a unique, client-facing number, so it leads —
 * falling back to the project number for the (theoretically impossible) issued
 * row with no number rather than emitting "undefined".
 */
export function invoiceArtifactFileName(
  projectNumber: string,
  invoiceNumber: string | null,
): string {
  return sanitizeFileName(`${invoiceNumber || projectNumber || "invoice"}-invoice.pdf`);
}
