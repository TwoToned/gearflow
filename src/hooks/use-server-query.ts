"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * One-shot, non-reactive server-action read (Phase 6 of the Convex migration —
 * React Query removal).
 *
 * Drop-in replacement for `@tanstack/react-query`'s `useQuery` for RVLT Flow
 * datums that have **NO liveness requirement** — cross-domain count/aggregate
 * badges, previews, and other reads that nothing ever invalidates. The
 * object-config API (`{ queryKey, queryFn, enabled }`) mirrors React Query's so
 * a call site converts with a one-line swap (`useQuery` → `useServerQuery` +
 * import).
 *
 * **When NOT to use this.** If the datum must update live (a table list, a
 * detail page, anything another user's write should reflect), subscribe to a
 * reactive Convex `useQuery` hook (`src/hooks/use-*.ts`) instead — that pushes
 * over the WebSocket. Reach for `useServerQuery` ONLY after confirming the datum
 * is never invalidated anywhere in any `invalidateQueries` call. The count datums
 * (`supplier-counts`,
 * `category-counts`, …) qualify — they were never invalidated under React Query
 * either, so a mount-time fetch is data-identical.
 *
 * Behaviour: re-runs `queryFn` whenever the serialized `queryKey` changes (the
 * key is the cache identity, exactly like React Query — `queryFn` identity is
 * ignored, so an inline arrow is fine). `data` is cleared on key change so a
 * value fetched under a previous key (e.g. a previous org) is never surfaced
 * under a new one. `enabled: false` skips the fetch and yields `undefined` data.
 *
 * Lives in src/hooks (NOT convex/) like the other migration hooks. See
 * FEATUREDOCS/54.
 */
export interface ServerQueryOptions<T> {
  queryKey: ReadonlyArray<unknown>;
  queryFn: () => Promise<T>;
  enabled?: boolean;
  /**
   * Re-run `queryFn` every N ms while mounted (and `enabled`), mirroring React
   * Query's `refetchInterval`. For datums whose freshness is a periodic POLL, not
   * a reactive push — e.g. the notification bell's cross-domain aggregate
   * (`getNotifications` scans 9 domains; a precise Convex trigger would be a
   * fragile multi-table version vector, so a 60s poll is the right design). Omit
   * for a one-shot read.
   */
  refetchInterval?: number;
}

export interface ServerQueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

export function useServerQuery<T>({
  queryKey,
  queryFn,
  enabled = true,
  refetchInterval,
}: ServerQueryOptions<T>): ServerQueryResult<T> {
  // The serialized key is the cache identity — sidesteps a spread-in-deps lint
  // warning and mirrors React Query's structural queryKey comparison.
  const keyStr = JSON.stringify(queryKey);

  const [reloadNonce, setReloadNonce] = useState(0);

  // The result is tagged with the key it was fetched FOR. Staleness is derived
  // during render (below) rather than cleared via setState in the effect — that
  // avoids the "synchronous setState in an effect" cascading-render warning while
  // still guaranteeing a previous key's value is never surfaced under a new one
  // (React Query's per-queryKey isolation). `fetchedKey: null` = nothing fetched
  // yet, so the first render reads as loading.
  const [result, setResult] = useState<{
    fetchedKey: string | null;
    data: T | undefined;
    error: Error | null;
  }>({ fetchedKey: null, data: undefined, error: null });

  // Keep the latest queryFn without retriggering the effect (call sites pass an
  // inline closure each render). Seeded at init for first-render correctness,
  // refreshed in an effect — writing a ref during render trips react-compiler.
  const queryFnRef = useRef(queryFn);
  useEffect(() => {
    queryFnRef.current = queryFn;
  });

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    queryFnRef
      .current()
      .then((next) => {
        if (!cancelled) setResult({ fetchedKey: keyStr, data: next, error: null });
      })
      .catch((e) => {
        if (!cancelled)
          setResult({ fetchedKey: keyStr, data: undefined, error: toError(e) });
      });

    return () => {
      cancelled = true;
    };
  }, [keyStr, enabled, reloadNonce]);

  // Optional polling: bump the reload nonce every `refetchInterval` ms while
  // mounted + enabled (mirrors React Query's refetchInterval). The fetch effect
  // above re-runs off the nonce. Skip the tick while the tab is hidden — matching
  // React Query's `refetchIntervalInBackground: false` default, so an idle
  // background tab doesn't keep hitting the server — but refetch once when the tab
  // becomes visible again so it isn't stale for up to a full interval (codex review).
  useEffect(() => {
    if (!enabled || !refetchInterval) return;
    const bump = () => setReloadNonce((n) => n + 1);
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      bump();
    }, refetchInterval);
    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden) bump();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }
    return () => {
      clearInterval(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  }, [enabled, refetchInterval]);

  // Derive during render: a result fetched under a different key is stale.
  const isCurrent = result.fetchedKey === keyStr;
  const data = isCurrent ? result.data : undefined;
  const error = isCurrent ? result.error : null;
  const isLoading = enabled && !isCurrent;

  const refetch = useCallback(() => setReloadNonce((n) => n + 1), []);

  return { data, isLoading, error, refetch };
}
