/**
 * Shared constants for the Convex auth bridge (Phase 5).
 *
 * Dependency-light (no imports) so both the Better Auth config (src/lib/auth.ts)
 * and the service-token minter (src/lib/convex-auth.ts) can use them without an
 * import cycle. The Convex side (convex/lib/auth.ts) hard-codes the SAME literals
 * — keep them in sync.
 */

/** JWT `aud` claim. Convex's customJwt provider requires this applicationID. */
export const CONVEX_JWT_AUDIENCE = "convex";

/**
 * `sub` of the server-side service token. A token is treated as the trusted
 * RVLT Flow backend ONLY when BOTH `sub === SERVICE_SUBJECT` AND `svc === true`
 * (strict, defense-in-depth — see codex review notes in the design doc). User
 * tokens carry the real user id as `sub` and never set `svc`.
 */
export const SERVICE_SUBJECT = "gearflow-service";

/** Custom claim marking the service token. Never present on a user token. */
export const SERVICE_CLAIM = "svc";

/** Service token TTL. Short — it is the revocation window for the trusted path. */
export const SERVICE_TOKEN_TTL = "5m";

/** User token TTL. Short — also the membership-change revocation window. */
export const USER_TOKEN_TTL = "15m";

/** JWKS signing algorithm. Convex's customJwt provider accepts only RS256/ES256
 *  (not Better Auth's default EdDSA) — shared by `auth.ts`'s jwt plugin and
 *  `convex-service-signer.ts`'s so both sign/verify against the same key type. */
export const JWKS_ALG = "ES256";
