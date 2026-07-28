import { NextResponse } from "next/server";
import { authenticateAgentRequest, parseBearerToken, type AgentRequestContext } from "./agent-auth";
import { toErrorEnvelope, statusForError } from "./errors";

export type RouteAuthResult =
  | { ok: true; agent: AgentRequestContext }
  | { ok: false; response: NextResponse };

/**
 * Shared bearer-auth entry point for the non-dispatch `/api/v1/*` routes
 * (`/operations`, `/whoami`, …). `dispatch()` in dispatcher.ts inlines the same
 * two calls because it needs the request-id/logging plumbing around them; this
 * is the version for routes that just need "who is this, or reject."
 */
export async function authenticateRoute(
  request: Request,
  requestId: string | null,
): Promise<RouteAuthResult> {
  const rawToken = parseBearerToken(request.headers.get("authorization"));
  if (!rawToken) {
    return {
      ok: false,
      response: NextResponse.json(
        toErrorEnvelope(Object.assign(new Error("Missing bearer token."), { code: "MISSING_CREDENTIALS" }), { requestId }),
        { status: 401 },
      ),
    };
  }
  try {
    const agent = await authenticateAgentRequest(rawToken);
    return { ok: true, agent };
  } catch (err) {
    return {
      ok: false,
      response: NextResponse.json(toErrorEnvelope(err, { requestId }), { status: statusForError(err) }),
    };
  }
}
