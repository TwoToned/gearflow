"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConvex } from "convex/react";
import type { FunctionReference, OptionalRestArgs } from "convex/server";

const SLOW_INTERVAL_MS = 5 * 60_000;

/**
 * One-shot Convex read, refreshed on tab focus and a slow interval — never a
 * live subscription. Today's day rail and needs-you rail are the first
 * consumers (work-layer phase 0.5, #1242): the app shell holds NO always-on
 * subscriptions today, and three live queries over org-wide/PM-scoped ranges
 * on a page nobody closes is the read-cost shape that produced a 4.66 GB/month
 * query (work-layer.md §10.7/R13). Mirrors `use-notifications-feed.ts`'s
 * visibility-aware poll, generalised to any Convex query function — signature
 * modelled on `useAuthedQuery`'s `Query extends FunctionReference<"query">`
 * pattern so the args/return types stay exact.
 *
 * Never blanks while refreshing — `data` keeps the last good value and only a
 * fresh `asOf` timestamp changes, so a caller can show a muted "as of" stamp
 * without the list flashing empty.
 *
 * Pass `"skip"` for `args` to hold off (mirrors `useQuery`'s own convention).
 */
export function useFocusPolledQuery<Query extends FunctionReference<"query">>(
  fn: Query,
  args: Query["_args"] | "skip",
): {
  data: Query["_returnType"] | undefined;
  asOf: number | undefined;
  error: Error | null;
  isLoading: boolean;
  refresh: () => void;
} {
  const convex = useConvex();
  const [data, setData] = useState<Query["_returnType"] | undefined>(undefined);
  const [asOf, setAsOf] = useState<number | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const skip = args === "skip";
  const argsKey = skip ? "skip" : JSON.stringify(args);

  const refresh = useCallback(() => {
    if (skip || inFlightRef.current) return;
    inFlightRef.current = convex
      .query(fn, ...([args] as OptionalRestArgs<Query>))
      .then((res) => {
        setData(res);
        setAsOf(Date.now());
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))))
      .finally(() => {
        inFlightRef.current = null;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- argsKey is the real dependency (args is a fresh object every render)
  }, [convex, fn, skip, argsKey]);

  useEffect(() => {
    if (skip) return;
    refresh();
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, SLOW_INTERVAL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      clearInterval(timer);
    };
  }, [skip, argsKey, refresh]);

  return { data, asOf, error, isLoading: data === undefined && !error, refresh };
}
