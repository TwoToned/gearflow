/**
 * Bounded-concurrency helpers. Use these instead of a bare `Promise.all(...)`
 * when the fan-out size is unbounded (cross-org / GDPR sweeps, whole-platform
 * prunes): firing thousands of concurrent Convex/HTTP requests can hit
 * connection/rate limits and make the whole batch reject — leaving a cleanup
 * half-done. Batching caps the in-flight count while still parallelizing.
 */

/** Run async thunks in batches of `limit` at a time (default 20). */
export async function runWithConcurrency<T>(
  thunks: Array<() => Promise<T>>,
  limit = 20,
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < thunks.length; i += limit) {
    results.push(...(await Promise.all(thunks.slice(i, i + limit).map((t) => t()))));
  }
  return results;
}

/** Map `items` through `fn` in batches of `limit` at a time (default 20). */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  fn: (item: T) => Promise<R>,
  limit = 20,
): Promise<R[]> {
  return runWithConcurrency(
    items.map((item) => () => fn(item)),
    limit,
  );
}
