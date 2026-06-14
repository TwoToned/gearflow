/**
 * Resilient access-token fetch for the Convex browser auth bridge.
 *
 * `ConvexProviderWithAuth` (src/components/providers/convex-provider.tsx) calls
 * this to get the user's ES256 JWT for the Convex WebSocket. The subtle, costly
 * contract: returning `null` tells Convex the user is **logged out** — it de-auths
 * the client, and every LIVE subscription (e.g. the warehouse `version` vector)
 * immediately re-runs with no identity, so each Convex guard throws "Unauthorized:
 * authentication required." In a production deployment that surfaces to the client
 * as the generic InternalServerError — i.e. the "random client crash."
 *
 * So a TRANSIENT failure of `GET /api/auth/token` must NOT collapse to `null`.
 * That endpoint mints the token via Better Auth's jwt plugin, whose `definePayload`
 * does a DB read (org + membership) on EVERY mint — so a brief 5xx, a cold start,
 * a connection-pool stall, or a network blip can make a perfectly logged-in user's
 * token fetch fail for a moment. We retry those; we only surrender the token (return
 * `null`) on a genuine 401/403 (really logged out) or once the retries are spent.
 *
 * `fetchImpl` / `sleep` are injectable for tests; production uses the globals.
 */
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 150;

export async function fetchConvexAccessToken(
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<string | null> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetchImpl("/api/auth/token", {
        method: "GET",
        credentials: "include",
        headers: { "cache-control": "no-store" },
      });
      if (res.ok) {
        const data = (await res.json()) as { token?: string };
        return data.token ?? null;
      }
      // A genuine auth failure — the session is gone/invalid. Don't retry: the
      // user really is logged out, and de-authing Convex is the correct response.
      if (res.status === 401 || res.status === 403) return null;
      // Anything else (5xx / 429 / 408 …) is transient — fall through to retry.
    } catch {
      // Network blip / abort — transient, fall through to retry.
    }
    if (attempt < MAX_ATTEMPTS) await sleep(BACKOFF_MS * attempt);
  }
  return null;
}
