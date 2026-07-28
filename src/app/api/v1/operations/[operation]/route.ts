import { NextResponse, type NextRequest } from "next/server";
import { API_REGISTRY_BY_OPERATION } from "@/lib/api/registry.generated";
import { toPublicOperation } from "@/lib/api/public-operation";
import { authenticateRoute } from "@/lib/api/route-auth";
import { KNOWN_ERROR_CODES, toErrorEnvelope } from "@/lib/api/errors";

export const runtime = "nodejs";

/**
 * `GET /api/v1/operations/{operation}` — one operation's schema, scope, and
 * error codes (design §11). Same closed-by-default rule as the dispatcher: an
 * unknown OR non-agent-reachable name is a 404, never a "this exists but you
 * can't use it" 403 — that would leak the SERVICE-only surface's existence.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ operation: string }> },
) {
  const requestId = request.headers.get("x-request-id");
  const auth = await authenticateRoute(request, requestId);
  if (!auth.ok) return auth.response;

  const { operation } = await params;
  const op = API_REGISTRY_BY_OPERATION.get(operation);
  if (!op || !op.agentReachable) {
    return NextResponse.json(
      toErrorEnvelope(Object.assign(new Error(`No such operation: "${operation}".`), { code: "UNKNOWN_OPERATION" }), { requestId }),
      { status: 404 },
    );
  }

  return NextResponse.json({
    data: {
      ...toPublicOperation(op),
      // Every error code the envelope knows how to classify — not narrowed to
      // what THIS operation's guards happen to throw today (that set can grow
      // without a docs update, and the envelope degrades unknown codes safely).
      possibleErrorCodes: KNOWN_ERROR_CODES,
    },
    requestId,
  });
}
