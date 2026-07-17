"use client";

import { useConvexAuth } from "convex/react";
import type { OptionalRestArgsOrSkip } from "convex/react";
// Phase 0: use the CACHE package's useQuery (keep-alive across navigation) rather
// than convex/react's — `ConvexQueryCacheProvider` is mounted in convex-provider.tsx
// but only these hooks read it, so the default hooks left this cache inert.
// Signature is identical, so it stays a drop-in and auth-gating below is unchanged.
import { useQuery } from "convex-helpers/react/cache/hooks";
import type { FunctionReference } from "convex/server";

/**
 * Auth-gated drop-in for Convex's `useQuery` — holds the subscription until the
 * browser's Convex USER token is actually attached, then re-runs.
 *
 * ## The bug this fixes
 *
 * Every browser-readable Convex query enforces identity server-side
 * (`requireOrgRead` / `requireOrgReadDoc` in `convex/lib/auth.ts`). Those guards
 * THROW `ConvexError("Unauthorized: authentication required.")` whenever
 * `ctx.auth.getUserIdentity()` is null. A thrown error from a `useQuery`
 * subscription is surfaced as an UNCAUGHT error and crashes the page (the
 * "Uncaught ConvexError: Unauthorized" report).
 *
 * The token only attaches AFTER Better Auth's `useSession()` resolves: the
 * provider (`convex-provider.tsx`) sets `isAuthenticated = !!session`, and Convex
 * only `setAuth()`s — which PAUSES the socket while the first token is fetched —
 * once that flips true. So there is a window on first paint where the socket is
 * live but unauthenticated.
 *
 * The `list` / `getById` hooks dodge this by accident: their arg is `orgId`, which
 * is derived from `useActiveOrganization()` and therefore `undefined` (→ `"skip"`)
 * until the session loads. But the reactive DETAIL `version` hooks key off a ROUTE
 * PARAM (`projectId` / `id`) that is defined on the very first
 * render — so on a hard navigation / refresh of a detail page they subscribe over
 * the still-unauthenticated socket and the guard throws. Same class of failure
 * for any query keyed off something available before the session (route params,
 * SSR props). It also recurs mid-session if a token refresh fails and Convex
 * de-auths the client (`isAuthenticated` flips back to false).
 *
 * ## The fix
 *
 * Gate EVERY browser query on `useConvexAuth().isAuthenticated` so it stays
 * `"skip"` until the token is confirmed attached. Convex automatically re-runs all
 * subscriptions when auth state changes, so the query runs the instant auth lands
 * — no manual refetch. This removes the entire bug class deterministically rather
 * than relying on each query's arg happening to be session-gated. The server
 * guards stay strict (a genuine anonymous direct call is still rejected — the
 * Phase-5 invariant), this just stops the browser from ever sending a read before
 * it has a token.
 *
 * Signature is identical to `useQuery`, so it is a literal drop-in.
 */
export function useAuthedQuery<Query extends FunctionReference<"query">>(
  query: Query,
  ...args: OptionalRestArgsOrSkip<Query>
): Query["_returnType"] | undefined {
  const { isAuthenticated } = useConvexAuth();
  const skip = ["skip"] as unknown as OptionalRestArgsOrSkip<Query>;
  return useQuery(query, ...(isAuthenticated ? args : skip));
}
