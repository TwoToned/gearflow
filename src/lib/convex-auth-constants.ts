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

/**
 * Custom claim naming the `apiKeys.id` an AGENT token was minted for. Its
 * PRESENCE is what distinguishes an agent token from a user token — the Convex
 * side (`convex/lib/auth.ts` `AGENT_KEY_CLAIM`) hard-codes the same literal.
 * Never present on a user or service token.
 */
export const AGENT_KEY_CLAIM = "akid";

/**
 * Agent token TTL, in SECONDS (the payload sets `exp` directly rather than going
 * through better-auth's duration string, so the minter can pin an exact expiry).
 *
 * 60s: an agent token carries a real human's identity and is minted per request,
 * so a leaked one should be near-worthless. Revocation does not depend on it —
 * `requireAgentScope` re-reads the key document inside every guarded transaction,
 * so a revoke/expiry/deactivation lands on the next call regardless of TTL.
 */
export const AGENT_TOKEN_TTL_SECONDS = 60;

/** JWKS signing algorithm. Convex's customJwt provider accepts only RS256/ES256
 *  (not Better Auth's default EdDSA) — shared by `auth.ts`'s jwt plugin and
 *  `convex-service-signer.ts`'s so both sign/verify against the same key type. */
export const JWKS_ALG = "ES256";
