"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * One-shot, non-reactive server-action read (Phase 6 of the Convex migration —
 * React Query removal).
 *
 * Drop-in replacement for `@tanstack/react-query`'s `useQuery` for GearFlow
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
 * is never invalidated anywhere: not in any `invalidateQueries` call, and not in
 * `use-realtime.ts`'s SSE key map. The count datums (`supplier-counts`,
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

  // Derive during render: a result fetched under a different key is stale.
  const isCurrent = result.fetchedKey === keyStr;
  const data = isCurrent ? result.data : undefined;
  const error = isCurrent ? result.error : null;
  const isLoading = enabled && !isCurrent;

  const refetch = useCallback(() => setReloadNonce((n) => n + 1), []);

  return { data, isLoading, error, refetch };
}
