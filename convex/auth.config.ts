/**
 * Convex auth provider configuration (Phase 5 — Auth Bridge).
 *
 * Both the USER token (Better Auth /api/auth/token) and the SERVICE token
 * (auth.api.signJWT, in-process) are ES256 JWTs signed by Better Auth's single
 * JWKS, with the same issuer + audience. One customJwt provider validates both;
 * convex/lib/auth.ts then distinguishes them by claim and enforces access.
 *
 * customJwt requires RS256/ES256 (not Better Auth's default EdDSA) — the jwt()
 * plugin is configured with keyPairConfig.alg = "ES256".
 *
 * Values are read from the Convex deployment env at push time:
 *   • CONVEX_AUTH_ISSUER   — must EXACTLY equal the token `iss` (= BETTER_AUTH_URL).
 *   • CONVEX_AUTH_JWKS_URL — JWKS endpoint the backend fetches. Must be reachable
 *     FROM the Convex container (local: http://host.docker.internal:3000/...).
 * applicationID pins the required `aud` ("convex") — never omit it (Convex docs
 * warn omitting it is insecure).
 */
const issuer = process.env.CONVEX_AUTH_ISSUER ?? "http://localhost:3000";
const jwks =
  process.env.CONVEX_AUTH_JWKS_URL ??
  "http://host.docker.internal:3000/api/auth/jwks";

export default {
  providers: [
    {
      type: "customJwt",
      applicationID: "convex",
      issuer,
      jwks,
      algorithm: "ES256",
    },
  ],
};
