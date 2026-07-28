import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getServeInfo } from "@/lib/storage";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

/**
 * Streaming half of the two finance artifact routes (#987) — shared so the
 * org check, the header shape and the "no regeneration path" guarantee exist
 * exactly once (R-3.1). Each route resolves ITS OWN row (org-checked in Convex)
 * and hands the storage id here.
 *
 * There is deliberately no fallback that renders a PDF when the bytes are
 * missing: a route that can regenerate is a route that can hand the client a
 * different document under the same name, which is the defect this program
 * exists to remove. A missing artifact is a 404 the UI turns into a retry.
 */

/** 404 body used for "no such row" and "row has no artifact" alike — the UI
 *  distinguishes them from the row it already has, and a cross-tenant probe
 *  learns nothing either way. */
export function artifactNotFound(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 });
}

export async function streamStoredArtifact(options: {
  storageId: string;
  fileName: string;
  organizationId: string;
}): Promise<NextResponse> {
  const { storageId, fileName, organizationId } = options;

  const info = await getServeInfo(storageId);
  if (!info) return artifactNotFound("Stored document not found.");
  // Belt-and-braces on top of the row's own org check (R-8.4.3): the file record
  // must also belong to the caller's org before a single byte is streamed.
  if (info.organizationId !== organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const upstream = await fetchWithTimeout(info.url);
    if (!upstream.ok || !upstream.body) return artifactNotFound("Stored document not found.");

    const encodedName = encodeURIComponent(fileName);
    const headers: Record<string, string> = {
      "Content-Type": info.contentType || "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"; filename*=UTF-8''${encodedName}`,
      // The bytes behind a storage id never change — but the URL is org-private,
      // so it stays out of shared caches.
      "Cache-Control": "private, max-age=3600",
    };
    if (info.size) headers["Content-Length"] = String(info.size);

    return new NextResponse(upstream.body, { headers });
  } catch (error) {
    logger.error("Finance artifact serve error", { error });
    return artifactNotFound("Stored document not found.");
  }
}
