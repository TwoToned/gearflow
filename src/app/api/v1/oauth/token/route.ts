import { type NextRequest } from "next/server";
import { oauthErrorResponse } from "@/lib/api/oauth/oauth-errors";
import { parseFormBody } from "@/lib/api/oauth/form-body";
import { redeemAuthorizationCode } from "@/lib/api/oauth/authorization-code";
import { verifyPkce } from "@/lib/api/oauth/pkce";
import { mintOAuthGrant, refreshOAuthGrant, RefreshGrantError } from "@/lib/api/oauth/grant";
import { authenticateClientRequest, type OAuthClientRecord } from "@/lib/api/oauth/client-registration";
import { withCors, corsPreflight } from "@/lib/api/cors";

export const runtime = "nodejs";

/**
 * `POST /api/v1/oauth/token` (Phase 7, #1003) — the token endpoint for both
 * `authorization_code` (+ PKCE) and `refresh_token` grants. Standard OAuth
 * `application/x-www-form-urlencoded` body (RFC 6749 §4.1.3), not JSON — this
 * is the documented exception to `withValidatedBody` (CLAUDE.md: a route that
 * needs a non-JSON body validates directly). No implicit flow, ever
 * (acceptance criteria) — only these two grant types are recognised.
 */

async function handleAuthorizationCode(form: URLSearchParams, client: OAuthClientRecord) {
  const code = form.get("code");
  const redirectUri = form.get("redirect_uri");
  const codeVerifier = form.get("code_verifier");
  if (!code || !redirectUri || !codeVerifier) {
    return oauthErrorResponse("invalid_request", "`code`, `redirect_uri` and `code_verifier` are all required.");
  }

  const redeemed = await redeemAuthorizationCode(code);
  if (!redeemed) return oauthErrorResponse("invalid_grant", "The authorization code is invalid, expired, or already used.");

  // Every check below happens AFTER redemption (the code is single-use either
  // way) so a mismatched replay can't be used to probe validity repeatedly.
  if (redeemed.clientId !== client.id) return oauthErrorResponse("invalid_grant", "This code was not issued to this client.");
  if (redeemed.redirectUri !== redirectUri) return oauthErrorResponse("invalid_grant", "redirect_uri does not match the authorization request.");
  if (!verifyPkce(codeVerifier, redeemed.codeChallenge)) {
    return oauthErrorResponse("invalid_grant", "code_verifier does not match the code_challenge.");
  }

  const tokens = await mintOAuthGrant({
    organizationId: redeemed.organizationId,
    actingUserId: redeemed.userId,
    createdById: redeemed.userId,
    clientId: redeemed.clientId,
    clientName: client.clientName ?? client.id,
    scopes: redeemed.scopes,
  });
  return withCors(Response.json(tokens, { status: 200, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } }));
}

async function handleRefreshToken(form: URLSearchParams) {
  const refreshToken = form.get("refresh_token");
  if (!refreshToken) return oauthErrorResponse("invalid_request", "`refresh_token` is required.");
  try {
    const tokens = await refreshOAuthGrant(refreshToken);
    return withCors(Response.json(tokens, { status: 200, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } }));
  } catch (err) {
    if (err instanceof RefreshGrantError) return oauthErrorResponse("invalid_grant", err.message);
    throw err;
  }
}

export async function POST(request: NextRequest) {
  const form = await parseFormBody(request);
  if (!form) return oauthErrorResponse("invalid_request", "Expected an application/x-www-form-urlencoded body.");

  const grantType = form.get("grant_type");
  if (grantType !== "authorization_code" && grantType !== "refresh_token") {
    return oauthErrorResponse("unsupported_grant_type", "Only authorization_code and refresh_token are supported.");
  }

  const auth = await authenticateClientRequest(request, form);
  if (!auth.ok) {
    const message = auth.reason === "missing_client_id" ? "client_id is required." : "Client authentication failed.";
    return oauthErrorResponse("invalid_client", message);
  }

  if (grantType === "authorization_code") return handleAuthorizationCode(form, auth.client);
  return handleRefreshToken(form);
}

export const OPTIONS = corsPreflight;
