/**
 * Bound a non-`fetch` promise to an explicit timeout (POLICY.md R-9.6 / T-22)
 * for vendor SDKs (e.g. Resend) that expose no `AbortSignal`/timeout option of
 * their own. Unlike a raw `fetch` + `AbortController` (see errorReporting.ts /
 * scheduledJobs.ts), this can't cancel the underlying in-flight call — it only
 * stops the caller from waiting on it forever.
 *
 * Duplicated from `src/lib/fetch-with-timeout.ts`'s `withTimeout` (not
 * imported — convex/ is a separate deployment bundle from src/).
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs = 10_000,
  label = "operation",
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
