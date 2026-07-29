/**
 * CORS for the machine-to-machine surface (`/api/v1/mcp`, `/.well-known/oauth-*`,
 * `/api/v1/oauth/*`). These endpoints are bearer-token-only with no cookie path
 * (R-8.11.1), so there is no CSRF/credentialed-request risk a wildcard origin
 * could reintroduce — a foreign page can't read another origin's Authorization
 * header, it has to already hold the token. Browser-based MCP clients (the
 * Streamable HTTP transport spec calls this out explicitly) call this surface
 * with `fetch()` from their own origin, which the browser blocks pre-flight
 * without these headers — this is what let a same-origin curl "work" while
 * every real client failed with a generic "couldn't connect".
 */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version, WWW-Authenticate",
  "Access-Control-Max-Age": "86400",
};

export function withCors(response: Response): Response {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

/** Shared `OPTIONS` handler for a route exporting `withCors`-wrapped responses. */
export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
