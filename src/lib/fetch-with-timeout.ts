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
