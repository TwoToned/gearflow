import { NextResponse, type NextRequest } from "next/server";
import { authenticateRoute } from "@/lib/api/route-auth";
import { getWhoamiData } from "@/lib/api/whoami";
import { withApiVersionHeader } from "@/lib/api/version";

export const runtime = "nodejs";

/**
 * `GET /api/v1/whoami` — the "test connection" primitive (design §11), shared
 * with the MCP `whoami` curated tool via `getWhoamiData` so both surfaces
 * report identically. Org, acting user, LIVE effective permissions (re-read
 * from the `members` mirror on every call — never the token's cached `role`
 * claim, so a demotion/removal takes effect on the NEXT request, not after
 * the 60s token TTL), scopes, and rate/bulk limits.
 */
export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id");
  const auth = await authenticateRoute(request, requestId);
  if (!auth.ok) return auth.response;

  // null role = the acting user is no longer a member of this org
  // (removed/left) — every RBAC-gated call will now fail "not a member", live.
  const data = await getWhoamiData(auth.agent);

  return withApiVersionHeader(NextResponse.json({ data, requestId }));
}
