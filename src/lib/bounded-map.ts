/**
 * Concurrency-bounded async map (POLICY.md R-9.7): runs `fn` over `items` with at
 * most `limit` promises in flight, preserving input order. Use this — never an
 * unbounded `Promise.all(items.map(...))` — for any fan-out over unbounded or
 * collection-sized input, especially calls to a single external vendor/host.
 *
 *   const results = await boundedMap(ids, 8, (id) => fetchThing(id));
 */
export async function boundedMap<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (limit < 1) throw new Error("boundedMap: limit must be >= 1");
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}
