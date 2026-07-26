import "server-only";

/**
 * In-process response cache + HTTP cache headers for `GET /api/auth/jwks` (#803).
 *
 * Better Auth's jwt-plugin JWKS endpoint reads the `Jwks` table on EVERY request
 * and sets no `Cache-Control` header, so every fetch is a full dynamic origin
 * round trip (measured 0.9–5.6s TTFB from us-east, where Convex Cloud runs).
 * Convex's customJwt provider fetches this URL (`CONVEX_AUTH_JWKS_URL`) to
 * verify the ES256 token attached to every single Convex function call — an
 * uncached, slow JWKS endpoint is the one fixed per-call cost shared by ALL
 * Convex ops, which is exactly the uniform ~1s p95 signature #803 diagnosed.
 *
 * Cache policy (R-9.9): the signing key set effectively never changes — Better
 * Auth creates one ES256 key at bootstrap and no rotation is configured. Two
 * layers, both bounded at 5 minutes:
 *   • In-process memo — removes the per-fetch DB read + handler work, so the
 *     origin answers from memory (and stops competing for DB pool connections
 *     with real queries — the pool-contention shape #804 observed).
 *   • `Cache-Control: public, max-age=300, s-maxage=300, stale-while-revalidate`
 *     — lets standards-respecting JWKS fetchers (jose's createRemoteJWKSet,
 *     CDNs with a cache rule) reuse the response instead of re-fetching.
 * Worst-case staleness if a NEW key ever appears (bootstrap-only today) is
 * memo TTL + client max-age = 10 minutes; verifiers that see an unknown `kid`
 * re-fetch on their own. JWKS bodies are public signing keys — public caching
 * is safe by construction (private keys never leave the `Jwks` table).
 *
 * Failure posture matches `single-org.ts`: on a downstream error, serve the
 * last-known-good key set (keys this stable are better stale than absent —
 * a 500 here takes down auth for every Convex call) and let the next request
 * retry.
 */

export const JWKS_ROUTE_PATH = "/api/auth/jwks";
export const JWKS_TTL_MS = 5 * 60 * 1000;
export const JWKS_CACHE_CONTROL =
  "public, max-age=300, s-maxage=300, stale-while-revalidate=86400";

type RouteHandler = (request: Request) => Promise<Response>;

let cached: { body: string; at: number } | null = null;

/** Test/teardown hook — drop the memoized response so the next call re-fetches. */
export function resetJwksResponseCache(): void {
  cached = null;
}

function jwksResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": JWKS_CACHE_CONTROL,
    },
  });
}

/**
 * Wrap the Better Auth catch-all GET handler: requests to `/api/auth/jwks` are
 * served from the in-process memo (with cache headers); every other auth route
 * passes through untouched.
 */
export function withJwksResponseCache(handler: RouteHandler): RouteHandler {
  return async (request: Request): Promise<Response> => {
    let pathname: string;
    try {
      pathname = new URL(request.url).pathname;
    } catch {
      return handler(request);
    }
    if (pathname !== JWKS_ROUTE_PATH) return handler(request);

    const now = Date.now();
    if (cached && now - cached.at < JWKS_TTL_MS) return jwksResponse(cached.body);

    try {
      const response = await handler(request);
      if (!response.ok) {
        // Serve stale on a downstream failure; surface the error only if we
        // have never successfully loaded the key set.
        return cached ? jwksResponse(cached.body) : response;
      }
      const body = await response.text();
      cached = { body, at: now };
      return jwksResponse(body);
    } catch (error) {
      if (cached) return jwksResponse(cached.body);
      throw error;
    }
  };
}
