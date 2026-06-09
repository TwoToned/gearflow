/**
 * Convex auth provider configuration.
 *
 * Phases 0–4: NO browser-facing user auth on Convex. Every write flows through a
 * Next.js server action that (a) authenticates the user via Better Auth, (b)
 * enforces permissions with requirePermission(), then (c) calls the Convex
 * mutation using the server-side admin key (CONVEX_SELF_HOSTED_ADMIN_KEY). The
 * browser never calls Convex mutations directly, so Convex itself needs no
 * identity provider yet.
 *
 * Phase 5 (Auth Bridge) adds a Better Auth -> Convex JWT provider here so the
 * browser can do direct, identity-scoped reads/optimistic writes. See
 * docs/designs/convex-hybrid-migration.md (Phase 5).
 */
export default {
  providers: [],
};
