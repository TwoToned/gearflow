import { NextRequest, NextResponse } from "next/server";
import { authenticateApiRequest, toErrorEnvelope, API_DOCS_URL } from "@/lib/api/http";

// The API layer runs guarded server actions inside an AsyncLocalStorage actor
// (node:async_hooks), so this route must not be edge-rendered.
export const runtime = "nodejs";

/**
 * GET /api/v1/whoami
 *
 * The "Test connection" endpoint for the agent-accessible API. Authenticates the
 * bearer key and echoes back the identity + scopes it resolves to, so an operator
 * (or their agent) can confirm the key works and see exactly what it can do before
 * making a real call. See docs/designs/api-mcp-agent-access.md.
 */
export async function GET(request: NextRequest) {
  try {
    const actor = await authenticateApiRequest(
      request.headers.get("authorization"),
    );

    return NextResponse.json(
      {
        apiVersion: "v1",
        organizationId: actor.organizationId,
        actingUserId: actor.userId,
        actingUserName: actor.userName,
        actorType: actor.actorType,
        apiKeyId: actor.apiKeyId ?? null,
        scopes: actor.scopes ?? [],
        documentation_url: API_DOCS_URL,
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-GearFlow-API-Version": "v1",
        },
      },
    );
  } catch (err) {
    const { status, body } = toErrorEnvelope(err);
    return NextResponse.json(body, {
      status,
      headers: { "X-GearFlow-API-Version": "v1" },
    });
  }
}
