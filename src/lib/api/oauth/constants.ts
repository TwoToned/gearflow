/**
 * Shared constants for the MCP OAuth 2.1 adapter (Phase 7, #1003).
 * docs/designs/api-mcp-reimplementation.md §14 Phase 7 / decision 9.
 */

/** Authorization code lifetime — short; it is redeemed within one HTTP round trip. */
export const AUTH_CODE_TTL_SECONDS = 120;

/** OAuth access token lifetime. Short, per the acceptance criteria ("short
 *  access-token TTL with refresh") — this is the `apiKeys.expiresAt` an
 *  OAuth-issued key carries, checked by the SAME `getApiKeyActorContext` path
 *  every bearer key goes through. A manually-minted key defaults to no expiry;
 *  an OAuth grant always has one. */
export const OAUTH_ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

/** Refresh token lifetime. Rotated (single-use) on every successful refresh. */
export const OAUTH_REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export const OAUTH_ACCESS_TOKEN_PREFIX = "gf_oauth_";
export const OAUTH_REFRESH_TOKEN_PREFIX = "gf_refresh_";
export const OAUTH_CLIENT_SECRET_PREFIX = "gf_client_secret_";

/** RFC 7591 client_id / DCR-issued identifiers use the same cuid2 shape as
 *  every other entity id in this codebase (createId()) — no separate scheme. */

/**
 * Redirect URI allowlist rule (OAuth 2.1 §4.1.1 / the MCP auth spec): exact
 * string match at redemption time (no prefix/pattern matching — a documented
 * OAuth vulnerability class), and at REGISTRATION time every URI must be
 * either `https://`, or a loopback (`http://127.0.0.1[:port]` /
 * `http://localhost[:port]`) URI for native/CLI clients (claude.ai's desktop
 * connector, the local stdio proxy). Plain `http://` to a non-loopback host is
 * never accepted.
 */
export function isAllowedRedirectUri(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") {
    return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  }
  return false;
}
