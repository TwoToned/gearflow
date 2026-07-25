/**
 * Bounded retry-with-backoff for a single outbound vendor call (POLICY.md
 * R-8.10.3). Sized for SYNCHRONOUS in-request paths (`email.ts`, `storage.ts`)
 * where a caller is blocked waiting — seconds-scale backoff, not the
 * minutes-scale backoff of the durable webhook/scheduled-email queues
 * (`webhooks/deliver.ts`, `convex/emailActions.ts`), which retry off the
 * request path and can afford to wait longer.
 *
 * Mirrors the jittered-backoff shape already proven in `withConvexReadRetry`
 * (convex-client.ts): jitter (R-9.6) spreads retries from the same transient
 * blip instead of a synchronized retry storm against the vendor.
 */

export interface RetryOptions {
  /** Total attempts including the first. Default 3 (2 retries). */
  maxAttempts?: number;
  /** Base delay in ms before the second attempt; doubles each subsequent attempt. */
  baseDelayMs?: number;
  /** Return false to stop retrying this error immediately. Default: always retry. */
  shouldRetry?: (error: unknown) => boolean;
  /** Called before each retry (not on the final, non-retried failure). */
  onRetry?: (error: unknown, attempt: number) => void;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 300;

export async function retryWithBackoff<T>(
  run: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= maxAttempts || (opts.shouldRetry && !opts.shouldRetry(error))) {
        throw error;
      }
      opts.onRetry?.(error, attempt);
      await sleep(backoffDelayMs(baseDelayMs, attempt));
    }
  }
}

function backoffDelayMs(baseDelayMs: number, attempt: number): number {
  // Jittered exponential backoff (R-9.6) — spreads retries from the same
  // transient blip instead of a synchronized retry storm against the vendor.
  return baseDelayMs * 2 ** (attempt - 1) * (0.5 + Math.random() * 0.5);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Thrown by an HTTP-backed vendor call so `shouldRetry` can key off the status code. */
export class HttpStatusError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "HttpStatusError";
  }
}

/** 429 (rate limit) and 5xx are transient; other 4xx are the caller's fault — don't retry those. */
export function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
