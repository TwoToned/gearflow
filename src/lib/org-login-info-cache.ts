import "server-only";

/**
 * In-process TTL cache for the public login page's org/SSO lookup (#804).
 *
 * `getOrgLoginInfo` (src/server/sso.ts) is a PUBLIC, pre-auth server action:
 * every login-page visit — human or bot — runs `Organization.findUnique` +
 * `SsoProvider.findMany` (Prisma) + `orgSettings:getByOrg` (a Convex round
 * trip) with no caching. `SsoProvider.findMany` from this path is the single
 * query breaching the T-9 slow_query p95 incident line, and its multi-second
 * tail on a tiny indexed table is pool-contention-shaped — repeated public
 * hits holding pooled connections amplify exactly that.
 *
 * Cache policy (R-9.9): org branding + SSO provider config change on the
 * order of "an admin edited settings", so a short 60s TTL removes nearly all
 * of the repeated load while keeping the login page at most a minute stale.
 * The SSO settings/provider mutations in src/server/sso.ts additionally
 * invalidate explicitly, so the common admin path (edit → check login page)
 * is fresh immediately; provider CRUD that goes through Better Auth's own API
 * (e.g. `registerSSOProvider`) is covered by the TTL alone.
 *
 * The map is bounded because the slug is CALLER-SUPPLIED on a public action:
 * unknown slugs (null results) are cached too — so bots probing the login
 * endpoint can't force a DB read per request — but evicted oldest-first past
 * MAX_ENTRIES so arbitrary slugs can't grow memory. Single-org app: the real
 * working set is 1 entry.
 *
 * Failure posture matches `single-org.ts`: on a loader error, serve the
 * last-known value for the slug if there is one (the login page staying up
 * beats strict freshness); rethrow only when there is nothing to serve.
 *
 * The types live here (a plain lib module), NOT in src/server/sso.ts — a
 * `"use server"` file must only export async functions, and re-exporting
 * types from one crashes SSR (see CLAUDE.md "Server Actions").
 */

export interface OrgLoginProviderInfo {
  providerId: string;
  issuer: string;
  domain: string;
  type: "saml" | "oidc";
  displayName: string;
  icon: string;
}

export interface OrgLoginInfo {
  orgId: string;
  orgName: string;
  orgSlug: string;
  orgLogo: string | null;
  hasSSO: boolean;
  ssoEnabled: boolean;
  enforceSSO: boolean;
  allowPasswordLogin: boolean;
  providers: OrgLoginProviderInfo[];
}

export const ORG_LOGIN_INFO_TTL_MS = 60 * 1000;
export const ORG_LOGIN_INFO_MAX_ENTRIES = 20;

const cache = new Map<string, { value: OrgLoginInfo | null; at: number }>();

/**
 * Serve `load(slug)` through the cache. Null results (unknown slug) are
 * cached like real ones.
 */
export async function withOrgLoginInfoCache(
  slug: string,
  load: (slug: string) => Promise<OrgLoginInfo | null>,
): Promise<OrgLoginInfo | null> {
  const now = Date.now();
  const hit = cache.get(slug);
  if (hit && now - hit.at < ORG_LOGIN_INFO_TTL_MS) return hit.value;

  let value: OrgLoginInfo | null;
  try {
    value = await load(slug);
  } catch (error) {
    if (hit) return hit.value; // stale-on-error
    throw error;
  }

  // Re-insert so Map iteration order doubles as oldest-first eviction order.
  cache.delete(slug);
  cache.set(slug, { value, at: now });
  while (cache.size > ORG_LOGIN_INFO_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return value;
}

/** Invalidate one slug's entry, or the whole cache when no slug is given. */
export function invalidateOrgLoginInfoCache(slug?: string): void {
  if (slug === undefined) cache.clear();
  else cache.delete(slug);
}
