import { NextResponse, type NextRequest } from "next/server";
import { authenticateRoute } from "@/lib/api/route-auth";
import { listOperationsPage } from "@/lib/api/operations-listing";
import { withApiVersionHeader } from "@/lib/api/version";

export const runtime = "nodejs";

/**
 * `GET /api/v1/operations` — the paginated registry listing (design §11,
 * R-9.8), shared with the MCP `list_operations` discovery tool via
 * `listOperationsPage`. Bearer-gated like the rest of `/api/v1` (a key's own
 * surface discovery, not a public sitemap). Filterable by `resource`/`kind`;
 * `danger` filtering lands with the Phase 4 (#1000) danger-tier
 * classification — every operation is undifferentiated by risk today.
 *
 * Always the AGENT-REACHABLE surface only — the ~800 SERVICE-only operations
 * are invisible here exactly as they are to `/ops/{operation}` (404), so this
 * endpoint can never be used to enumerate what a leaked token can't reach.
 */
export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id");
  const auth = await authenticateRoute(request, requestId);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const page = listOperationsPage({
    resource: url.searchParams.get("resource"),
    kind: url.searchParams.get("kind"),
    cursor: Number.parseInt(url.searchParams.get("cursor") ?? "0", 10) || 0,
    limit: Number.parseInt(url.searchParams.get("limit") ?? "", 10) || undefined,
  });

  return withApiVersionHeader(NextResponse.json({ ...page, requestId }));
}
