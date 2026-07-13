import { ShardedCounter } from "@convex-dev/sharded-counter";
import { components } from "../_generated/api";
import type { QueryCtx, MutationCtx } from "../_generated/server";

/**
 * Sharded dashboard counters (Phase 3, gate #3).
 *
 * The six per-org dashboard tallies (convex/dashboardCounters.ts) were maintained by
 * read-then-patching a SINGLE `dashboardCounters` row on every counted asset / bulk /
 * project / crew write. That single row is a hot-row OCC-contention point the moment
 * high-write domains (warehouse checkout/checkin, line-items, bulk) go browser-direct
 * with concurrency: two concurrent mutations both patch the row → the second conflicts
 * and Convex retries the whole mutation.
 *
 * A sharded counter spreads each (org, field) count across N shard docs; a write hits
 * one random shard, so concurrent writes rarely collide. Reads sum the shards.
 *
 * SHARD COUNT: 4 (vs the component default 16). The counts are small integers read on
 * the dashboard bundle — which ALREADY collects whole-org projects + maintenance for
 * its date-derived metrics — so a handful of extra tiny shard reads is noise, while 4
 * shards still gives ~4× write throughput. Bumping this later only helps throughput;
 * it needs a `rebalance` to redistribute existing counts across the new shards.
 *
 * The `dashboardCounters` ROW is retained as the reconcile snapshot + `updatedAt`
 * freshness marker (reconcileIfStale gates on it) + the "countersReady" signal — but
 * the LIVE truth is the sharded sum, not the row's stale-between-reconciles fields.
 */
export const dashboardCounter = new ShardedCounter(components.shardedCounter, {
  defaultShards: 4,
});

/** Sharded-counter key for one org's one counter field. */
export function counterKey(orgId: string, field: string): string {
  return `${orgId}:${field}`;
}

/**
 * Apply a signed delta to an org's sharded counter for `field`. No hot-row read —
 * the increment lands on one shard. Unlike the old row patch this does NOT clamp at
 * 0 (a sharded counter has no single value to clamp); a transient negative is clamped
 * on READ and corrected by the next `reconcile` (which sets the absolute value).
 */
export async function addToCounter(
  ctx: MutationCtx,
  orgId: string,
  field: string,
  delta: number,
): Promise<void> {
  if (!delta) return;
  await dashboardCounter.add(ctx, counterKey(orgId, field), delta);
}

/** Read one org's one counter field (sum of shards), clamped at 0. */
export async function readCounter(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  field: string,
): Promise<number> {
  const n = await dashboardCounter.count(ctx, counterKey(orgId, field));
  return Math.max(0, n);
}

/**
 * Set an org's one counter field to an ABSOLUTE value (reconcile / backfill): clear
 * the shards then seed the value. Used by the drift backstop + the one-time backfill
 * so the sharded truth matches a fresh source recompute.
 */
export async function setCounter(
  ctx: MutationCtx,
  orgId: string,
  field: string,
  value: number,
): Promise<void> {
  const key = counterKey(orgId, field);
  await dashboardCounter.reset(ctx, key);
  if (value) await dashboardCounter.add(ctx, key, value);
}
