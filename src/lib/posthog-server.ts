import "server-only";
import { PostHog } from "posthog-node";
import { logger } from "@/lib/logger";

/**
 * Server-side PostHog client for exception capture (PostHog Error Tracking).
 *
 * Authenticates with the same PUBLIC write-only ingestion key as the browser
 * (`phc_…`) — no secret needed at runtime. Inert if the key is unset, so dev /
 * local runs send nothing.
 *
 * PII policy (R-8.12.4): we never attach a real user identity. Exceptions are
 * captured against a fixed `"server"` distinctId so no name/email/ip is sent;
 * PostHog does not capture local variable values, only the stack.
 *
 * Short flush window because serverless/edge-ish handlers may freeze between
 * requests — we flush after each capture rather than relying on the interval.
 */
// `||`, not `??`: NEXT_PUBLIC_POSTHOG_HOST is inlined at build time, and an
// unset GitHub Actions repo variable is inlined as an empty string, not
// undefined — `?? default` never catches that, silently pointing the CLI at
// api_host: "" instead of the real ingestion host.
const key =
  process.env.POSTHOG_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY || "";
const host =
  process.env.POSTHOG_HOST ||
  process.env.NEXT_PUBLIC_POSTHOG_HOST ||
  "https://us.i.posthog.com";

let client: PostHog | null = null;
function getClient(): PostHog | null {
  if (!key) return null;
  if (!client) {
    client = new PostHog(key, { host, flushAt: 1, flushInterval: 0 });
  }
  return client;
}

/**
 * Capture a server-side exception to PostHog. Fire-and-forget and never throws —
 * error reporting must not itself crash a handler.
 */
export async function captureServerException(
  error: unknown,
  context?: Record<string, string | number | boolean>,
): Promise<void> {
  const ph = getClient();
  if (!ph) return;
  try {
    ph.captureException(error, "server", context);
    await ph.flush();
  } catch (err) {
    logger.warn("[posthog] failed to capture server exception", { err });
  }
}

/**
 * Capture a server-side metric/event to PostHog (e.g. slow_query, R-8.3.2).
 * Same fixed `"server"` distinctId and never-throw contract as
 * captureServerException — this is telemetry, it must never affect the
 * caller's control flow or latency budget.
 */
export async function captureServerEvent(
  event: string,
  properties?: Record<string, string | number | boolean>,
): Promise<void> {
  const ph = getClient();
  if (!ph) return;
  try {
    ph.capture({ distinctId: "server", event, properties });
    await ph.flush();
  } catch (err) {
    logger.warn("[posthog] failed to capture server event", { err, event });
  }
}
