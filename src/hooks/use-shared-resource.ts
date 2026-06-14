"use client";

import { useEffect, useState } from "react";

/**
 * Shared, deduped, module-level store for a per-org server-action read with
 * MULTIPLE cross-component readers AND writers (Phase 6 of the Convex migration —
 * React Query removal).
 *
 * **Why not `useServerQuery`.** `useServerQuery` is per-component: each call site
 * holds its own copy, so a `refetch()` in one component never updates another's
 * data. That is fine for an isolated read, but WRONG for a datum that is read by
 * several components at once and must stay in sync when any one of them writes —
 * the exact behaviour React Query's shared cache gave a `["key", orgId]` query,
 * where one writer's `invalidateQueries(["key"])` refreshed every reader.
 *
 * GearFlow has two such auth/RBAC datums that stay in Prisma forever (Convex is
 * never the authZ source of truth) but are genuinely multi-reader/multi-writer:
 * - **organization** — read by the always-mounted layout `BrandingProvider` +
 *   `DynamicFavicon` (so a settings edit must live-update the layout) plus the
 *   settings pages, and written by several of them.
 * - **custom-roles** — read across six RBAC surfaces, written by the role manager.
 *
 * This factory gives each a single module-level store keyed by orgId: every
 * mounted reader subscribes, the fetch is deduped to one in-flight request, and
 * any writer calls the module-level `refresh(orgId)` to push fresh data to ALL
 * subscribers — reproducing the shared-cache invalidation without React Query.
 *
 * Modelled on `use-notifications-feed.ts` (same subscribe/dedup shape) but with
 * NO polling: these datums are not in the SSE map and were never polled — their
 * only refresh trigger is a same-app write, handled by the writer calling
 * `refresh`. Lives in src/hooks (NOT convex/) like the other migration hooks.
 * See FEATUREDOCS/54.
 */

interface Store<T> {
  data: T | undefined;
  subscribers: Set<() => void>;
  inFlight: Promise<void> | null;
}

export interface SharedResource<T> {
  /** Subscribe a component to the shared store for `key`. */
  use: (key: string | undefined) => {
    data: T | undefined;
    isLoading: boolean;
    /** Re-fetch and push to every subscriber (the writer's invalidate analogue). */
    refresh: () => void;
  };
  /** Module-level refresh for writers that don't read the datum themselves. */
  refresh: (key: string | undefined) => void;
}

/**
 * Build a shared-resource hook for a per-key read. `fetcher` receives the store
 * `key` and returns the datum. For per-org datums whose server action derives the
 * org from the session (e.g. `getOrganization`), the fetcher simply ignores the
 * key and the key is the orgId (matching the old `["key", orgId]` React Query
 * key). For per-entity datums the fetcher uses the key directly (e.g.
 * `(projectId) => getProject(projectId)`), matching `["project", …, projectId]`.
 */
export function createSharedResource<T>(
  fetcher: (key: string) => Promise<T>
): SharedResource<T> {
  const stores = new Map<string, Store<T>>();

  function storeFor(key: string): Store<T> {
    let s = stores.get(key);
    if (!s) {
      s = { data: undefined, subscribers: new Set(), inFlight: null };
      stores.set(key, s);
    }
    return s;
  }

  /** Fetch once, sharing a single in-flight request across concurrent callers. */
  function refresh(key: string | undefined): Promise<void> {
    if (!key) return Promise.resolve();
    const s = storeFor(key);
    if (s.inFlight) return s.inFlight;
    s.inFlight = fetcher(key)
      .then((data) => {
        s.data = data;
        s.subscribers.forEach((cb) => cb());
      })
      .catch(() => {
        // Keep last-known data on failure (same as React Query's stale-on-error).
      })
      .finally(() => {
        s.inFlight = null;
      });
    return s.inFlight;
  }

  function use(key: string | undefined) {
    const [, force] = useState(0);

    useEffect(() => {
      if (!key) return;
      const s = storeFor(key);
      const cb = () => force((n) => n + 1);
      s.subscribers.add(cb);

      void refresh(key); // ensure data on first subscribe (deduped)

      return () => {
        s.subscribers.delete(cb);
      };
    }, [key]);

    const data = key ? stores.get(key)?.data : undefined;
    return {
      data,
      isLoading: !!key && data === undefined,
      refresh: () => {
        void refresh(key);
      },
    };
  }

  return {
    use,
    refresh: (orgId) => {
      void refresh(orgId);
    },
  };
}
