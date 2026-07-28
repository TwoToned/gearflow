import { NextResponse, type NextRequest } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { parseBearerToken, authenticateAgentRequest, type AgentRequestContext } from "@/lib/api/agent-auth";
import { toErrorEnvelope, statusForError } from "@/lib/api/errors";
import { buildMcpServer } from "@/lib/api/mcp/build-server";
import { API_VERSION, API_VERSION_HEADER } from "@/lib/api/version";

/**
 * `/api/v1/mcp` — streamable HTTP MCP over the SAME dispatcher REST uses
 * (Phase 3, #999, design §12). `runtime = "nodejs"` for the same reason every
 * other `/api/v1` route needs it: the agent-token minter uses `node:crypto`
 * via Better Auth.
 *
 * Stateless by design (`sessionIdGenerator: undefined`, `enableJsonResponse:
 * true`): a fresh `Server` + transport is built per HTTP request rather than
 * held across a session, matching how `dispatch()` already re-authenticates
 * on every call — there is no per-connection state to lose between requests,
 * so a serverless/edge-friendly Next.js route handler is exactly as capable
 * as a long-lived process here. Bearer auth is resolved ONCE up front (the
 * same 401/error shape every other `/api/v1` route returns) both to reject an
 * unauthenticated connection before touching the MCP transport at all, and to
 * answer `whoami` without a redundant `dispatch()` round-trip — every other
 * tool call still re-validates the token itself inside `dispatch()`.
 */
export const runtime = "nodejs";

function versioned(response: Response): Response {
  response.headers.set(API_VERSION_HEADER, API_VERSION);
  return response;
}

async function handle(request: NextRequest): Promise<Response> {
  const requestId = request.headers.get("x-request-id");
  const rawToken = parseBearerToken(request.headers.get("authorization"));
  if (!rawToken) {
    return versioned(
      NextResponse.json(
        toErrorEnvelope(Object.assign(new Error("Missing bearer token."), { code: "MISSING_CREDENTIALS" }), { requestId }),
        { status: 401 },
      ),
    );
  }

  let agent: AgentRequestContext;
  try {
    agent = await authenticateAgentRequest(rawToken);
  } catch (err) {
    return versioned(NextResponse.json(toErrorEnvelope(err, { requestId }), { status: statusForError(err) }));
  }

  const server = buildMcpServer({ agent, authorizationHeader: request.headers.get("authorization"), requestId });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return versioned(await transport.handleRequest(request));
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
