import { NextResponse } from "next/server";

/**
 * The STANDARD OAuth 2.1 error vocabulary (RFC 6749 §5.2 / §4.1.2.1) — deliberately
 * NOT the bespoke `ApiErrorEnvelope` (src/lib/api/errors.ts) the REST/MCP
 * dispatcher uses. OAuth clients (claude.ai, desktop connectors, generic OAuth
 * libraries) expect `{ error, error_description }`; inventing a different shape
 * here would break every off-the-shelf OAuth client this phase exists to unlock.
 */

export type OAuthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "invalid_scope"
  | "access_denied"
  | "server_error";

const STATUS_FOR_CODE: Record<OAuthErrorCode, number> = {
  invalid_request: 400,
  invalid_client: 401,
  invalid_grant: 400,
  unauthorized_client: 400,
  unsupported_grant_type: 400,
  invalid_scope: 400,
  access_denied: 403,
  server_error: 500,
};

export function oauthErrorResponse(code: OAuthErrorCode, description?: string): NextResponse {
  return NextResponse.json(
    { error: code, ...(description ? { error_description: description } : {}) },
    { status: STATUS_FOR_CODE[code], headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
  );
}
