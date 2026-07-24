/**
 * `fetch()` with an explicit timeout (POLICY.md R-9.6 / T-22 — no library-default
 * infinities on outbound network calls). Aborts after `timeoutMs` (default 10s).
 */
export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bound a non-`fetch` promise to an explicit timeout (POLICY.md R-9.6 / T-22)
 * for vendor SDKs (e.g. Resend) that expose no `AbortSignal`/timeout option of
 * their own. Unlike `fetchWithTimeout`, this can't cancel the underlying
 * in-flight call — it only stops the caller from waiting on it forever.
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
