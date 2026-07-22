/**
 * Analytics event vocabulary + a thin, PII-safe capture wrapper around PostHog.
 *
 * Single source of truth for event names (R-3.1) so dashboards/insights and the
 * emit sites can't drift. The actual PostHog client is initialised in
 * `posthog-provider.tsx` (browser only) — this module just resolves it lazily so
 * importing it from a server module is inert (returns null, never throws).
 *
 * PII policy (R-8.12.4): event *properties* must never carry names, emails,
 * addresses, or free-text notes. Use opaque cuids for entity references. The
 * provider additionally disables autocapture + input capture, so the only data
 * PostHog sees is what we explicitly send through here.
 */

/** Canonical event names. Add here, reference by constant — never inline a string. */
export const AnalyticsEvent = {
  // Performance / latency budget instrumentation (README.md budget registry).
  // WebVital -> T-7 (Core Web Vitals). SlowQuery -> T-9 (interactive query
  // latency, R-8.3.2/#643), emitted by src/lib/prisma-query-timing.ts.
  // ConvexOpLatency -> T-P6 (per-endpoint SLOs, R-8.9.6/#651): emitted
  // server-side by src/lib/convex-op-timing.ts for every Convex query/
  // mutation the app server makes (the backend leg of most interactive
  // server actions). QueueLag -> T-P7 (webhook queue lag, R-9.10/#623),
  // emitted by src/lib/queue-lag-timing.ts.
  WebVital: "web_vital",
  SlowQuery: "slow_query",
  ConvexOpLatency: "convex_op_latency",
  QueueLag: "queue_lag",
  // Product usage (extend as needed — keep PII out of properties).
  PageView: "$pageview",
} as const;

export type AnalyticsEventName =
  (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent];

type Props = Record<string, string | number | boolean | null | undefined>;

declare global {
  interface Window {
    /** Set by posthog-provider.tsx after init; undefined until then / when unconfigured. */
    posthog?: { capture: (event: string, properties?: Props) => void };
  }
}

/**
 * Fire-and-forget capture. No-ops on the server and whenever PostHog isn't
 * initialised (key unset, or before the provider mounts), so call sites never
 * need to guard.
 */
export function capture(event: AnalyticsEventName, properties?: Props): void {
  if (typeof window === "undefined") return;
  const ph = window.posthog;
  if (!ph || typeof ph.capture !== "function") return;
  ph.capture(event, properties);
}
