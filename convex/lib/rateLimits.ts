/**
 * Rate-limit + bulk-size numbers as PLAIN DATA (POLICY.md R-3.1 — one source of
 * truth). Split out of `rateLimiter.ts` so the numbers can be imported from
 * Node (the API dispatcher's `/api/v1/whoami`, src/lib/api/registry docs) too —
 * `rateLimiter.ts` instantiates a `@convex-dev/rate-limiter` `RateLimiter`
 * bound to a Convex component, which is not something Node code can safely
 * import; this module has no such dependency.
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;

export const AGENT_READ_LIMIT = { rate: 600, periodMs: MINUTE_MS, capacity: 200 } as const;
export const AGENT_WRITE_LIMIT = { rate: 60, periodMs: MINUTE_MS, capacity: 20 } as const;
export const BROWSER_WRITE_LIMIT = { rate: 300, periodMs: MINUTE_MS, capacity: 100 } as const;

/** Org-creation signup-code attempts (Phase B, B3/#1095, design doc §5.3 pt.3).
 *  A shared static code is brute-forceable — 5/hour per rate-limit key (see
 *  `verifyOrgCreationCode`'s key choice) makes guessing impractical while never
 *  bothering a legitimate operator who mistypes it once or twice. */
export const ORG_CREATION_CODE_ATTEMPT_LIMIT = { rate: 5, periodMs: HOUR_MS, capacity: 5 } as const;

/** Bulk-array cap for browser (human) callers. */
export const MAX_BULK_ITEMS = 500;
/** Bulk-array cap for agent (API-key) callers — an order of magnitude smaller
 *  blast radius than a deliberate human select-all (decision 7). */
export const MAX_BULK_ITEMS_AGENT = 50;
