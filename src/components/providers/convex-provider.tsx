"use client";

import { useCallback, useMemo, useState } from "react";
import { ConvexReactClient, ConvexProviderWithAuth } from "convex/react";
import { authClient } from "@/lib/auth-client";
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
 * (service token); the browser cannot call Convex mutations directly. See
 * docs/designs/convex-phase5-auth-bridge.md.
 *
 * Inert if NEXT_PUBLIC_CONVEX_URL is unset (a deploy without the backend).
 */
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

/**
 * Bridges Better Auth → Convex. `fetchAccessToken` returns the current user's
 * ES256 JWT (or null when logged out / on error); Convex calls it on mount and
 * refreshes it before expiry (forceRefreshToken just re-fetches — the endpoint
 * always mints a fresh token from the live session).
 */
function useBetterAuthForConvex() {
  const { data: session, isPending } = authClient.useSession();

  const fetchAccessToken = useCallback(
    // forceRefreshToken is ignored — /api/auth/token always mints a fresh token
    // from the live session, so there is nothing stale to bust. The fetch is
    // resilient: a TRANSIENT /api/auth/token failure is retried rather than
    // collapsed to null (null de-auths Convex and makes every live subscription
    // throw "Unauthorized" — the "random client crash"). See convex-token-fetch.ts.
    async (): Promise<string | null> => fetchConvexAccessToken(),
    [],
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
      console.warn(
        "[convex] NEXT_PUBLIC_CONVEX_URL is not set — Convex provider is inert.",
      );
    }
    return <>{children}</>;
  }

  return (
    <ConvexProviderWithAuth client={client} useAuth={useBetterAuthForConvex}>
      {children}
    </ConvexProviderWithAuth>
  );
}
