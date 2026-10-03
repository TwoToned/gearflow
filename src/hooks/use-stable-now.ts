"use client";

import { useState } from "react";

/**
 * A mount-time `Date.now()` snapshot that never changes for the life of the
 * component.
 *
 * ## The bug this fixes
 *
 * A Convex subscription is keyed by `(function, args)` — `createQueryKey` in
 * `convex-helpers/react/cache/hooks` JSON-stringifies the args into the cache
 * key, and `useQueries` tears down and restarts the subscription whenever that
 * key changes. So passing a *freshly evaluated* `Date.now()` in a query's args
 * is an infinite loading loop, not a one-off read:
 *
 * ```tsx
 * // BROKEN — the page is stuck on "Loading…" forever.
 * const cards = useAuthedQuery(api.pipeline.forOrg, { orgId, now: Date.now() });
 * ```
 *
 * Render evaluates `Date.now()` → subscribe → result arrives → re-render →
 * `Date.now()` is a different millisecond → new key → the result is `undefined`
 * again → subscribe → … The query never settles, so a `result === undefined`
 * loading branch renders forever (and a `return null` branch never appears at
 * all). This is what broke `/clients/pipeline` and the client page's next-step
 * banner (#1245).
 *
 * ```tsx
 * // CORRECT
 * const now = useStableNow();
 * const cards = useAuthedQuery(api.pipeline.forOrg, { orgId, now });
 * ```
 *
 * A `no-restricted-syntax` rule in `eslint.config.mjs` fails the build on a
 * `Date.now()` evaluated inside a `useQuery`/`useAuthedQuery` call, so the
 * mistake is a lint error rather than a discipline lapse.
 *
 * ## When NOT to use it
 *
 * This is deliberately a *snapshot*, matching the several existing
 * `const [now] = useState(() => Date.now())` call sites it generalises — "what
 * time is it" as a stable query input. A surface that must tick (a live
 * countdown, a relative-time label that has to age) needs its own interval and
 * must keep that ticking value OUT of any query's args.
 */
export function useStableNow(): number {
  const [now] = useState(() => Date.now());
  return now;
}
