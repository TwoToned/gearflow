import { NextResponse, type NextRequest } from "next/server";
import { authenticateRoute } from "@/lib/api/route-auth";
import { describeOperation } from "@/lib/api/operations-listing";
import { toErrorEnvelope } from "@/lib/api/errors";
import { withApiVersionHeader } from "@/lib/api/version";

export const runtime = "nodejs";

/**
 * `GET /api/v1/operations/{operation}` — one operation's schema, scope, and
 * error codes (design §11), shared with the MCP `describe_operation`
 * discovery tool via `describeOperation`. Same closed-by-default rule as the
 * dispatcher: an unknown OR non-agent-reachable name is a 404, never a "this
 * exists but you can't use it" 403 — that would leak the SERVICE-only
 * surface's existence.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ operation: string }> },
) {
  const requestId = request.headers.get("x-request-id");
  const auth = await authenticateRoute(request, requestId);
  if (!auth.ok) return auth.response;

  const { operation } = await params;
  const described = describeOperation(operation);
  if (!described) {
    return withApiVersionHeader(NextResponse.json(
      toErrorEnvelope(Object.assign(new Error(`No such operation: "${operation}".`), { code: "UNKNOWN_OPERATION" }), { requestId }),
      { status: 404 },
    ));
  }

  return withApiVersionHeader(NextResponse.json({ data: described, requestId }));
}
