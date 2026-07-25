/**
 * Report one billable unit of metered vendor usage from a Convex action
 * (POLICY.md R-9.12, T-P4). Convex actions run in Convex Cloud's own
 * deployment — a separate runtime from the Next.js app (`src/`), so this
 * can't import `src/lib/vendor-cost-tracking.ts` (which pulls in
 * `posthog-server.ts`, a Next-only `posthog-node` singleton). Mirrors
 * `errorReporting.ts`: a raw `fetch` POST to PostHog's `/capture/` HTTP API,
 * same `vendor_usage` event name as `AnalyticsEvent.VendorUsage`
 * (`src/lib/analytics.ts`) so both send paths land in the same PostHog
 * insight.
 *
 * Requires `POSTHOG_KEY` set on the CONVEX deployment (same key
 * `errorReporting.ts` uses) — **inert (no-op) if unset**.
 *
 * Never throws and is fire-and-forget: cost telemetry must never affect the
 * caller's control flow (mirrors `src/lib/vendor-cost-tracking.ts`).
 */
export async function reportConvexVendorUsage(
  vendor: "resend" | "maps",
  operation: string,
  units = 1,
): Promise<void> {
  const key = process.env.POSTHOG_KEY;
  if (!key) return;

  const host = (process.env.POSTHOG_HOST || "https://us.i.posthog.com").replace(/\/+$/, "");

  // R-9.6: explicit timeout on every outbound call — no library-default
  // infinities.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    await fetch(`${host}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        event: "vendor_usage",
        // No end-user identity here — this is vendor spend telemetry, not a
        // request; "server" mirrors errorReporting.ts's fixed distinctId.
        distinct_id: "server",
        properties: { vendor, operation, units },
      }),
      signal: controller.signal,
    });
  } catch {
    // Best-effort — must never mask the send outcome it's reporting on.
  } finally {
    clearTimeout(timer);
  }
}
