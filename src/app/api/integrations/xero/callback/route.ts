import { NextRequest, NextResponse } from "next/server";
import { completeXeroConnection } from "@/server/xero";
import { XeroOAuthStateError } from "@/lib/xero-oauth-state";
import { logger } from "@/lib/logger";
import { env } from "@/env";

/**
 * Xero OAuth2 callback — PUBLIC route (added to `src/middleware.ts`
 * publicRoutes) because the redirect back from Xero's servers is a fresh
 * top-level navigation that shouldn't have to depend on the Better Auth
 * session cookie surviving the external round trip. Auth is instead the
 * HMAC-signed `state` param minted by `getXeroAuthorizeUrl()` (see
 * src/lib/xero-oauth-state.ts) — it carries the orgId/userId and is verified
 * before anything else happens.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // NOT request.url: behind the prod reverse proxy, Next.js's Node process
  // sees an internal Host header, so new URL(..., request.url) resolves to
  // http://localhost:3000 instead of the public https://flow.rvlt.app --
  // exactly the localhost redirect this route was producing after a real,
  // successful token exchange. env.NEXT_PUBLIC_APP_URL is the same trusted
  // base xeroRedirectUri() (src/server/xero.ts) already builds the Xero-side
  // redirect_uri from, so both halves of the round trip agree.
  const settingsUrl = new URL("/settings/xero", env.NEXT_PUBLIC_APP_URL);

  if (error) {
    settingsUrl.searchParams.set("xero_error", error);
    return NextResponse.redirect(settingsUrl);
  }
  if (!code || !state) {
    settingsUrl.searchParams.set("xero_error", "missing_code_or_state");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    await completeXeroConnection(code, state);
    settingsUrl.searchParams.set("xero_connected", "1");
  } catch (err) {
    const message = err instanceof XeroOAuthStateError ? err.message : err instanceof Error ? err.message : "Unknown error";
    logger.error("[Xero] OAuth callback failed", { error: message });
    settingsUrl.searchParams.set("xero_error", message);
  }

  return NextResponse.redirect(settingsUrl);
}
