import { convexServiceSigner } from "./convex-service-signer";
import {
  SERVICE_SUBJECT,
  SERVICE_CLAIM,
} from "./convex-auth-constants";

/**
 * Server-side Convex SERVICE token minting (Phase 5 auth bridge).
 *
 * The trusted backend (server actions, scripts, webhooks, cron) calls Convex
 * functions. Convex now requires a valid token on every function; this mints the
 * service token that identifies the caller as the RVLT Flow backend — the explicit
 * form of the old implicit "trust the caller." Server actions still run all real
 * authorization (requirePermission/validation/logActivity) BEFORE calling Convex.
 *
 * Minted in-process via a dedicated minimal Better Auth instance's `signJWT` (a
 * path-less endpoint with no HTTP route — see `convex-service-signer.ts` and the
 * design doc), signed by the same ES256 JWKS as user tokens, so Convex's single
 * customJwt provider validates both. The claims:
 *   • sub = "gearflow-service", svc = true  (strict pair the Convex side checks)
 *   • exp = now + 5 min                      (set on the payload directly)
 *   • iss / aud                              (from the jwt() plugin defaults)
 *
 * NEVER exposed to the browser. The token is process-global (one service identity
 * for all callers), so it is safe to cache and attach to the shared
 * ConvexHttpClient singleton — there is no per-user identity to leak. Do NOT mix
 * per-user token forwarding into this path (it would create cross-request auth
 * races on the singleton — codex review).
 */

const TTL_SECONDS = 5 * 60;
// Refresh ~30s before the token actually expires to avoid a race at the boundary.
const REFRESH_SKEW_MS = 30 * 1000;

let cached: { token: string; refreshAtMs: number } | null = null;

export async function getConvexServiceToken(): Promise<string> {
  const now = Date.now();
  if (cached && now < cached.refreshAtMs) return cached.token;

  const exp = Math.floor(now / 1000) + TTL_SECONDS;
  const result = await convexServiceSigner.api.signJWT({
    body: {
      payload: {
        sub: SERVICE_SUBJECT,
        [SERVICE_CLAIM]: true,
        exp,
      },
    },
  });

  const token = (result as { token?: string } | null)?.token;
  if (!token) {
    throw new Error("Failed to mint Convex service token (no token returned).");
  }

  cached = { token, refreshAtMs: exp * 1000 - REFRESH_SKEW_MS };
  return token;
}

/** Test/teardown hook — drop the cached token so the next call re-mints. */
export function resetConvexServiceTokenCache(): void {
  cached = null;
}
