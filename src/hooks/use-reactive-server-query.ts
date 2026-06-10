"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Reactive server-action read, triggered by a Convex "version vector" (Phase 6 of
 * the Convex migration — React Query removal, the bucket-B reactive-composite
 * keystone).
 *
 * This is the read hook for SSE-live DETAIL composites — pages whose data must
 * update when ANOTHER user writes (the keys in `use-realtime.ts`'s
 * `getInvalidationKeys` SSE map: kit / asset / project / warehouse-…). Those pages
 * are served by a server action that composes data Convex can't hold (Better Auth
 * users, cross-domain joins), so a pure Convex `useQuery` subscription is
 * infeasible. Instead:
 *
 *   • `watch` is a CHEAP reactive Convex value (a `useQuery(api.<x>Detail.version)`
 *     result) — a "version vector" that changes whenever any row the composite
 *     reads changes. Convex pushes it to every subscriber over the WebSocket.
 *   • `queryFn` is the UNCHANGED server action (e.g. `getKit(id)`) — byte-identical
 *     payload, zero data-shape drift.
 *
 * The hook re-runs `queryFn` whenever the serialized `watch` changes, so a
 * cross-user write that moves the vector live-refreshes the page — replacing the
 * SSE `*:updated` → `invalidateQueries` path. The version vector MUST be a superset
 * of what the old SSE event covered, or a refresh is silently dropped (staleness);
 * that contract lives in the Convex `version` query, not here.
 *
 * Semantics (codex-reviewed):
 *   • Fetches when `watch` first becomes defined (NOT on mount before the
 *     subscription resolves — that would double-fetch and race the connect). While
 *     `watch` is `undefined` (connecting), `isLoading` is true.
 *   • `queryKey` is the data's IDENTITY (e.g. `["kit", orgId, id]`). On a same-id
 *     `[id]` route the App Router re-renders this component with new params WITHOUT
 *     remounting, so `id` changes in place — when `queryKey` changes, the previous
 *     identity's data is NOT surfaced (isLoading flips true, like a React Query key
 *     change) so the page never briefly shows the WRONG entity. A `watch` change at
 *     the SAME identity is a background refresh: data stays visible, no skeleton flash.
 *   • Request-sequenced AND identity-tagged: overlapping runs (a manual `refetch()`
 *     racing a `watch` tick, or a fast id flip) settle latest-wins, and a result is
 *     only surfaced if it was fetched for the CURRENT `queryKey`.
 *   • `refetch()` forces an immediate re-run. Same-view writes flow through the
 *     vector automatically (the mutation changes a watched row), but callers SHOULD
 *     still call `refetch()` in a mutation's `onSuccess` — it re-reads the Prisma
 *     source of truth instantly and doesn't depend on the Convex mirror write
 *     landing first. The extra watch-driven fetch that follows is harmless
 *     (sequenced, same data).
 *
 * Lives in src/hooks (NOT convex/) like the other migration hooks. See FEATUREDOCS/54.
 */
export interface ReactiveServerQueryOptions<T> {
  /** Reactive Convex value; `undefined` while the subscription is connecting. */
  watch: unknown;
  /** Identity of the data (e.g. `["kit", orgId, id]`). A change suppresses the
   * previous identity's data so a `[id]`-route navigation never shows the wrong entity. */
  queryKey: ReadonlyArray<unknown>;
  queryFn: () => Promise<T>;
  enabled?: boolean;
}

export interface ReactiveServerQueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

export function useReactiveServerQuery<T>({
  watch,
  queryKey,
  queryFn,
  enabled = true,
}: ReactiveServerQueryOptions<T>): ReactiveServerQueryResult<T> {
  // `null` ⇒ the subscription hasn't resolved yet (watch === undefined); we hold
  // off the first fetch until it does. Otherwise the serialized vector is the
  // refetch trigger — a new value (cross-user or same-view write) re-runs queryFn.
  const watchKey = watch === undefined ? null : JSON.stringify(watch ?? null);
  // The identity the data belongs to. A change means we're now showing a different
  // entity → the previous identity's data must not be surfaced.
  const identityKey = JSON.stringify(queryKey);

  const [reloadNonce, setReloadNonce] = useState(0);
  // Tag each result with the identity it was fetched FOR. Staleness is derived
  // during render (below) rather than cleared via setState in the effect — that
  // dodges the cascading-render warning while still guaranteeing a previous
  // identity's value is never surfaced under a new one. `identity: null` = nothing
  // fetched yet → first render reads as loading.
  const [result, setResult] = useState<{
    identity: string | null;
    data: T | undefined;
    error: Error | null;
  }>({ identity: null, data: undefined, error: null });

  // Keep the latest queryFn without retriggering the effect (call sites pass an
  // inline closure each render). Seeded at init, refreshed in an effect — writing
  // a ref during render trips react-compiler.
  const queryFnRef = useRef(queryFn);
  useEffect(() => {
    queryFnRef.current = queryFn;
  });

  // Latest-call-wins: a slow earlier run can't overwrite a newer one's result.
  const callSeqRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    if (watchKey === null) return; // wait for the subscription to resolve

    const callId = ++callSeqRef.current;
    const fetchedFor = identityKey; // tag this run with the identity at start
    let cancelled = false;
    queryFnRef
      .current()
      .then((next) => {
        if (!cancelled && callId === callSeqRef.current)
          setResult({ identity: fetchedFor, data: next, error: null });
      })
      .catch((e) => {
        if (!cancelled && callId === callSeqRef.current)
          setResult({ identity: fetchedFor, data: undefined, error: toError(e) });
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, identityKey, watchKey, reloadNonce]);

  // Derive during render: a result fetched for a different identity is stale and
  // must not be surfaced (a same-identity watch refresh keeps its data visible).
  const isCurrent = result.identity === identityKey;
  const data = isCurrent ? result.data : undefined;
  const error = isCurrent ? result.error : null;
  const isLoading = enabled && !isCurrent;

  const refetch = useCallback(() => setReloadNonce((n) => n + 1), []);

  return { data, isLoading, error, refetch };
}
