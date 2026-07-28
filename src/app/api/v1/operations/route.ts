import { NextResponse, type NextRequest } from "next/server";
import { API_REGISTRY } from "@/lib/api/registry.generated";
import { toPublicOperation } from "@/lib/api/public-operation";
import { authenticateRoute } from "@/lib/api/route-auth";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * `GET /api/v1/operations` — the paginated registry listing (design §11,
 * R-9.8). Bearer-gated like the rest of `/api/v1` (a key's own surface
 * discovery, not a public sitemap). Filterable by `resource`/`kind`; `danger`
 * filtering lands with the Phase 4 (#1000) danger-tier classification — every
 * operation is undifferentiated by risk today.
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
  const resourceFilter = url.searchParams.get("resource");
  const kindFilter = url.searchParams.get("kind");
  const cursor = Math.max(0, Number.parseInt(url.searchParams.get("cursor") ?? "0", 10) || 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "", 10) || DEFAULT_LIMIT));

  const reachable = API_REGISTRY.filter((op) => {
    if (!op.agentReachable) return false;
    if (resourceFilter && op.resource !== resourceFilter) return false;
    if (kindFilter && op.kind !== kindFilter) return false;
    return true;
  });

  const page = reachable.slice(cursor, cursor + limit).map(toPublicOperation);
  const nextCursor = cursor + limit < reachable.length ? cursor + limit : null;

  return NextResponse.json({
    data: page,
    total: reachable.length,
    cursor,
    nextCursor,
    requestId,
  });
}
