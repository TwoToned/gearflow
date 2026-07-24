/**
 * Forward a Convex job/cron failure to PostHog Error Tracking (POLICY.md R-8.9.1
 * — "Convex jobs/cron have no error-capture pipeline").
 *
 * Deliberately a raw `fetch` to PostHog's HTTP capture API, not the `posthog-node`
 * SDK: Convex actions run in Convex Cloud's own deployment, a separate runtime
 * from the Next.js app (`src/`), so this file can't import `src/lib/posthog-server.ts`
 * — and a POST to `/capture/` needs no SDK dependency at all.
 *
 * Requires `POSTHOG_KEY` set on the CONVEX deployment (`pnpm exec convex env set
 * POSTHOG_KEY <phc_...>` — separate from the Next.js `.env`; reuse the same
 * public write-only ingestion key `NEXT_PUBLIC_POSTHOG_KEY` already uses).
 * **Inert (no-op) if unset**, matching `posthog-server.ts`'s "no key -> nothing
 * sent" convention — so an unconfigured deployment doesn't fail cron runs, it
 * just doesn't get error visibility until the key is set.
 *
 * Never throws: error reporting must never mask or replace the original
 * failure. Callers still throw/propagate the real error themselves (Convex's
 * own dashboard cron-run log is the durable record; this is the forwarding leg
 * that was missing).
 *
 * Carries an explicit 10s `AbortController` timeout (POLICY.md R-9.6) — this
 * was previously the one outbound call in the cron-failure path without one.
 */
export async function reportConvexJobError(
  source: string,
  error: unknown,
  context?: Record<string, string | number | boolean>,
): Promise<void> {
  const key = process.env.POSTHOG_KEY;
  if (!key) return;

  const host = (process.env.POSTHOG_HOST || "https://us.i.posthog.com").replace(/\/+$/, "");
  const message = error instanceof Error ? error.message : String(error);
  const type = error instanceof Error ? error.name || "Error" : "Error";
  const stack = error instanceof Error ? error.stack : undefined;

  // R-9.6: explicit timeout on every outbound call — no library-default
  // infinities. 10s matches the T-22 default / convex/scheduledJobs.ts's
  // invokeCronRoute (duplicated, not imported — convex/ is a separate
  // deployment bundle from src/).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    await fetch(`${host}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        event: "$exception",
        // No end-user identity here — this is a job/cron failure, not a
        // request; "server" mirrors the fixed distinctId posthog-server.ts
        // uses for Next.js server exceptions.
        distinct_id: "server",
        properties: {
          // Minimal $exception_list — type/value only (no frame-level
          // stacktrace parsing), enough for PostHog Error Tracking to group
          // and alert on. The raw stack still goes out as $exception_stack
          // for the properties panel.
          $exception_list: [
            { type, value: message, mechanism: { handled: false, synthetic: false } },
          ],
          $exception_source: "convex",
          source,
          ...(stack ? { $exception_stack: stack } : {}),
          ...context,
        },
      }),
      signal: controller.signal,
    });
  } catch {
    // Best-effort — must never mask the original job failure.
  } finally {
    clearTimeout(timer);
  }
}
