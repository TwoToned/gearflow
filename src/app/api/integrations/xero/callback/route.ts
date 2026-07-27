import { NextRequest, NextResponse } from "next/server";
import { completeXeroConnection } from "@/server/xero";
import { XeroOAuthStateError } from "@/lib/xero-oauth-state";
import { logger } from "@/lib/logger";

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

  const settingsUrl = new URL("/settings/xero", request.url);

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
