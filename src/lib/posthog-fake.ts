/**
 * In-memory fake for the server-side PostHog client (POLICY.md R-8.10.4 —
 * every adapter should have a local/fake implementation for tests). Mirrors
 * the `captureServerException` / `captureServerEvent` signatures
 * (`@/lib/posthog-server`) so tests can assert what WOULD be captured without
 * hitting PostHog, and without depending on `POSTHOG_KEY` being set.
 */

export interface FakeCapturedException {
  error: unknown;
  context?: Record<string, string | number | boolean>;
}

export interface FakeCapturedEvent {
  event: string;
  properties?: Record<string, string | number | boolean>;
}

export interface FakePostHogTransport {
  /** Drop-in for `captureServerException`. */
  captureException: (
    error: unknown,
    context?: Record<string, string | number | boolean>,
  ) => Promise<void>;
  /** Drop-in for `captureServerEvent`. */
  captureEvent: (
    event: string,
    properties?: Record<string, string | number | boolean>,
  ) => Promise<void>;
  /** Exceptions captured so far, in capture order. */
  readonly exceptions: readonly FakeCapturedException[];
  /** Events captured so far, in capture order. */
  readonly events: readonly FakeCapturedEvent[];
  /** Reset captured state between tests. */
  clear: () => void;
}

export function createFakePostHog(): FakePostHogTransport {
  const exceptions: FakeCapturedException[] = [];
  const events: FakeCapturedEvent[] = [];

  return {
    captureException: async (error, context) => {
      exceptions.push({ error, context });
    },
    captureEvent: async (event, properties) => {
      events.push({ event, properties });
    },
    get exceptions() {
      return exceptions;
    },
    get events() {
      return events;
    },
    clear: () => {
      exceptions.length = 0;
      events.length = 0;
    },
  };
}
