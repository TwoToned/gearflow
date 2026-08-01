"use client";

import { useCallback, useMemo, useState } from "react";
import { ConvexReactClient, ConvexProviderWithAuth } from "convex/react";
import { logger } from "@/lib/logger";
import { ConvexQueryCacheProvider } from "convex-helpers/react/cache";
import { authClient, useActiveOrganization } from "@/lib/auth-client";
import { fetchConvexAccessToken } from "@/lib/convex-token-fetch";

/**
 * Convex client provider — the reactive data layer (Phase 5: now authenticated).
 *
 * Wraps the app so components subscribe to Convex queries via useQuery from
 * "convex/react". Reads NEXT_PUBLIC_CONVEX_URL (inlined at build time).
 *
 * The browser now talks to Convex with a real identity: a USER token minted by
 * Better Auth (GET /api/auth/token), forwarded to Convex via
 * ConvexProviderWithAuth. Convex validates it (convex/auth.config.ts) and scopes
 * reads to the user's org. Writes still flow browser → server action → Convex
 * (service token); the browser cannot call Convex mutations directly.
 *
 * Inert if NEXT_PUBLIC_CONVEX_URL is unset (a deploy without the backend).
 *
 * Phase 0 (native read layer): wrapped in ConvexQueryCacheProvider from
 * convex-helpers so a query subscription survives unmount for a bounded window —
 * back-navigation reloads instantly instead of paying a cold round trip. This is
 * additive: it only affects call sites that opt in by importing the cached hooks
 * from "convex-helpers/react/cache"; the default `useQuery` from "convex/react"
 * is unchanged.
 */
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

// Bounded cache: keep an unmounted subscription alive for 5 minutes, cap the
// number of idle (unmounted-but-retained) entries so a long session can't grow
// the open-subscription set without limit.
const CACHE_EXPIRATION_MS = 5 * 60 * 1000;
const CACHE_MAX_IDLE_ENTRIES = 250;

/**
 * Bridges Better Auth → Convex. `fetchAccessToken` returns the current user's
 * ES256 JWT (or null when logged out / on error); Convex calls it on mount and
 * refreshes it before expiry (forceRefreshToken just re-fetches — the endpoint
 * always mints a fresh token from the live session).
 *
 * The org switcher's sharp edge (design doc §4.3.1, A2): `organization.setActive()`
 * updates the Better Auth session, but the JWT bakes `orgId` in as a claim
 * (`definePayload`, src/lib/auth.ts) and Convex only refetches that token on its
 * own schedule (mount + pre-expiry) — NOT on every render. Left alone, every live
 * subscription would keep serving the PREVIOUS org's data until the token happened
 * to expire: a cross-tenant read produced by the switcher itself.
 *
 * `ConvexProviderWithAuth` calls `client.setAuth(fetchAccessToken, ...)` inside a
 * `useEffect` keyed on `fetchAccessToken`'s identity (convex/react's
 * ConvexAuthState.js) — and `client.setAuth` unconditionally pauses the socket,
 * force-fetches a fresh token, and re-authenticates (authentication_manager.js
 * `setConfig`), which is exactly the reauth-and-resubscribe-everything sequence
 * needed. So including `orgId` in this callback's deps is enough to trigger it:
 * switching org changes `orgId` → `fetchAccessToken` gets a new identity → the
 * provider's effect reruns → the client force-reauthenticates. No caller (the
 * switcher, the select-organization page, OrgActivator) needs to orchestrate this
 * itself — it's centralized here, the one place a Convex identity is minted.
 */
function useBetterAuthForConvex() {
  const { data: session, isPending } = authClient.useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const fetchAccessToken = useCallback(
    // forceRefreshToken is ignored — /api/auth/token always mints a fresh token
    // from the live session, so there is nothing stale to bust. The fetch is
    // resilient: a TRANSIENT /api/auth/token failure is retried rather than
    // collapsed to null (null de-auths Convex and makes every live subscription
    // throw "Unauthorized" — the "random client crash"). See convex-token-fetch.ts.
    // `orgId` is read only to force a new callback identity on org switch — it's
    // not used in the body itself, fetchConvexAccessToken always reads the live
    // session server-side.
    async (): Promise<string | null> => fetchConvexAccessToken(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- orgId intentionally unused in body, see comment above
    [orgId],
  );

  return useMemo(
    () => ({
      isLoading: isPending,
      isAuthenticated: !!session,
      fetchAccessToken,
    }),
    [isPending, session, fetchAccessToken],
  );
}

export function ConvexClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [client] = useState(() =>
    convexUrl ? new ConvexReactClient(convexUrl) : null,
  );

  // If Convex isn't configured (e.g. a deploy without the backend yet), render
  // children unwrapped rather than crashing. useQuery sites are gated behind the
  // per-domain migration, so nothing depends on Convex until its domain lands.
  if (!client) {
    if (process.env.NODE_ENV !== "production") {
      logger.warn(
        "[convex] NEXT_PUBLIC_CONVEX_URL is not set — Convex provider is inert.",
      );
    }
    return <>{children}</>;
  }

  return (
    <ConvexProviderWithAuth client={client} useAuth={useBetterAuthForConvex}>
      <ConvexQueryCacheProvider
        expiration={CACHE_EXPIRATION_MS}
        maxIdleEntries={CACHE_MAX_IDLE_ENTRIES}
      >
        {children}
      </ConvexQueryCacheProvider>
    </ConvexProviderWithAuth>
  );
}
