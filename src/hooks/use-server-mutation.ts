"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Server-action mutation hook (Phase 6 of the Convex migration — React Query
 * removal).
 *
 * Drop-in replacement for `@tanstack/react-query`'s `useMutation` for RVLT Flow's
 * write paths. Writes always flow **browser → server action → Convex** (browser
 * writes are rejected at Convex by design — Phase 5), so a mutation is just an
 * `async` server-action call. The object-config API intentionally mirrors React
 * Query's so converting a call site is a one-line swap (`useMutation` →
 * `useServerMutation` + import) — no restructuring of `mutate()` / `isPending` /
 * `onSuccess` usage.
 *
 * **No cache invalidation.** Unlike React Query, there is nothing to invalidate:
 * the reads that back a converted UI are Convex `useQuery` subscriptions, and the
 * server action's Convex write pushes a live update to every subscriber over the
 * WebSocket automatically. `onSuccess` is for view-local side effects only —
 * toasts, closing a dialog, resetting a form, `router.refresh()`. When converting
 * a React Query call site, the old `queryClient.invalidateQueries(...)` lines drop
 * out (the Convex subscription replaces them) — but ONLY once every reader of that
 * data is also on Convex (convert a domain's readers AND writers together, or a
 * still-React-Query reader loses its post-write refresh).
 *
 * Lives in src/hooks (NOT convex/) like the other reactive hooks. See
 * FEATUREDOCS/54.
 */
export interface ServerMutationOptions<TData, TVariables> {
  mutationFn: (variables: TVariables) => Promise<TData>;
  // Callbacks return `unknown` (like React Query) so the ubiquitous
  // `onError: (e) => toast.error(e.message)` one-liner (toast returns an id)
  // type-checks without forcing a braced body. Any returned promise is awaited.
  onSuccess?: (data: TData, variables: TVariables) => unknown;
  onError?: (error: Error, variables: TVariables) => unknown;
  onSettled?: (
    data: TData | undefined,
    error: Error | null,
    variables: TVariables
  ) => unknown;
}

export interface ServerMutationResult<TData, TVariables> {
  mutate: (variables: TVariables) => void;
  mutateAsync: (variables: TVariables) => Promise<TData>;
  isPending: boolean;
  error: Error | null;
  data: TData | undefined;
  reset: () => void;
}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

export function useServerMutation<TData = unknown, TVariables = void>(
  options: ServerMutationOptions<TData, TVariables>
): ServerMutationResult<TData, TVariables> {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<TData | undefined>(undefined);

  // Keep the latest options without re-creating mutate/mutateAsync each render
  // (call sites pass inline closures/objects). A ref avoids stale callbacks while
  // keeping the returned functions referentially stable. The ref is seeded at
  // init (first-render correctness) and refreshed after each commit in an effect
  // — writing a ref during render trips react-compiler's lint rule, and mutate()
  // only ever fires from event handlers (post-commit), so the effect-updated ref
  // is always current by the time it's read.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  // Guard against setting state after unmount (the await can outlive the view).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Concurrency bookkeeping (codex steer): `inFlight` counts overlapping calls so
  // a single hook instance driving N row-level mutations
  // (`remove.mutate(id)` per row) reports `isPending` until the LAST one settles,
  // not the first. `callSeq` makes `data`/`error` latest-call-wins so a slow
  // earlier call can't clobber a faster later one's result.
  const inFlightRef = useRef(0);
  const callSeqRef = useRef(0);

  const mutateAsync = useCallback(
    async (variables: TVariables): Promise<TData> => {
      const opts = optionsRef.current;
      const callId = ++callSeqRef.current;
      inFlightRef.current += 1;
      if (mountedRef.current) setIsPending(true);

      const runCallback = async (cb: (() => unknown) | undefined) => {
        // Side-effect callbacks (toasts, dialog close, router.refresh) must never
        // turn a successful mutation into a rejection — log and continue, unlike
        // merging them with the mutationFn error. Intentional, documented behavior.
        if (!cb) return;
        try {
          await cb();
        } catch (cbErr) {
          console.error("useServerMutation callback threw:", cbErr);
        }
      };

      const settle = async (data: TData | undefined, error: Error | null) => {
        inFlightRef.current -= 1;
        if (mountedRef.current && inFlightRef.current === 0) setIsPending(false);
        // onSettled is success-path cleanup (close dialog, reset, navigate). If the
        // view already unmounted, its work is moot — and skipping it avoids a
        // post-unmount navigation. See onSuccess note below.
        if (!mountedRef.current) return;
        await runCallback(
          opts.onSettled
            ? () => opts.onSettled!(data, error, variables)
            : undefined
        );
      };

      try {
        const result = await opts.mutationFn(variables);
        if (mountedRef.current && callId === callSeqRef.current) {
          setData(result);
          setError(null);
        }
        // Gate onSuccess on still-mounted. ~24 call sites navigate in onSuccess
        // (`router.push(...)`); if the user left the page while the mutation was in
        // flight, an ungated onSuccess fires router.push on the now-unmounted view
        // and SNAPS them back to the entity/list page. A successful mutation on a
        // torn-down view has nothing to do (its toasts/nav/reset are all view-local;
        // the Convex subscription already pushed the data), so skipping is safe.
        if (mountedRef.current) {
          await runCallback(
            opts.onSuccess ? () => opts.onSuccess!(result, variables) : undefined
          );
        }
        await settle(result, null);
        return result;
      } catch (e) {
        const err = toError(e);
        if (mountedRef.current && callId === callSeqRef.current) setError(err);
        // onError stays ungated: a failure toast is still worth showing even if the
        // triggering view unmounted, and onError never navigates.
        await runCallback(
          opts.onError ? () => opts.onError!(err, variables) : undefined
        );
        await settle(undefined, err);
        throw err;
      }
    },
    []
  );

  const mutate = useCallback(
    (variables: TVariables) => {
      // Fire-and-forget: swallow rejection (onError already ran). Matches React
      // Query's mutate() which never throws.
      void mutateAsync(variables).catch(() => {});
    },
    [mutateAsync]
  );

  const reset = useCallback(() => {
    setIsPending(false);
    setError(null);
    setData(undefined);
  }, []);

  return { mutate, mutateAsync, isPending, error, data, reset };
}
