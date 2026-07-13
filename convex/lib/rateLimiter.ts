import { RateLimiter, MINUTE } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import { getAuthContext } from "./auth";

/**
 * Rate limiting for the browser-direct mutation surface (Phase 3 security baseline).
 *
 * Once the browser calls Convex mutations directly there is no server-action tier in
 * front to throttle abuse, so a runaway/hostile USER token could hammer the public
 * mutation surface. This caps sustained per-user write rate while still allowing
 * legitimate bursts (rapid optimistic edits; a bulk action is ONE array mutation, so
 * it costs one token regardless of item count).
 *
 * SERVICE-token (trusted backend) writes are NOT limited — the server does its own
 * throttling and runs legitimate bulk/backfill operations.
 *
 * `limit(..., { throws: true })` throws a `ConvexError` whose payload has
 * `kind: "RateLimited"` (detectable client-side via `isRateLimitError`) plus a
 * `retryAfter` — that payload survives the production boundary, unlike a plain Error.
 */
export const rateLimiter = new RateLimiter(components.rateLimiter, {
  // Per-user browser-direct write budget. Token bucket = burst up to `capacity`,
  // refilling at `rate` per `period`. 300/min sustained (5/s) with a 100-op burst
  // comfortably covers rapid optimistic editing yet stops a runaway client loop.
  browserWrite: { kind: "token bucket", rate: 300, period: MINUTE, capacity: 100 },
});

/**
 * Enforce the per-user browser-direct write budget for USER-token callers only.
 * No-op for service/anonymous (service = trusted backend; anonymous is rejected by
 * the mutation's own auth guard). Keyed on the VERIFIED token subject — a client
 * can't dodge its budget by supplying a different id. Throws when the budget is
 * exceeded. Call it FIRST in every browser-direct mutation, alongside
 * `assertWritesEnabled`.
 */
export async function enforceBrowserWriteLimit(ctx: MutationCtx): Promise<void> {
  const auth = await getAuthContext(ctx);
  if (!auth || auth.kind !== "user") return;
  await rateLimiter.limit(ctx, "browserWrite", { key: auth.userId, throws: true });
}
