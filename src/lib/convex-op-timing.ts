import "server-only";
import { getFunctionName } from "convex/server";
import type { ConvexHttpClient } from "convex/browser";
import { logger } from "@/lib/logger";
import { captureServerEvent } from "@/lib/posthog-server";
import { AnalyticsEvent } from "@/lib/analytics";

/**
 * T-P6 per-endpoint p95 SLO (README.md R-0.4, R-9.11/R-8.9.6): 300ms is the
 * "API" target, so a Convex round-trip (the backend leg of most interactive
 * server actions/API routes) is flagged past that line; > 1s escalates to an
 * incident, mirroring the two-tier severity used for T-9 query timing
 * (src/lib/prisma-query-timing.ts). This measures the Convex leg only, not
 * the whole request — an action doing several sequential Convex calls plus
 * Prisma work can still exceed budget with every individual call under 300ms.
 */
export const SLOW_OP_MS = 300;
export const INCIDENT_OP_MS = 1000;

type ConvexOpKind = "query" | "mutation" | "action";

/**
 * Report a completed Convex op's duration if it crosses the slow line —
 * structured log line (always) + a best-effort `convex_op_latency` PostHog
 * event (for the p95 alert). Never throws — latency instrumentation must
 * never become a new source of request failures.
 */
export function reportIfSlowConvexOp(
  name: string,
  kind: ConvexOpKind,
  durationMs: number,
): void {
  if (durationMs <= SLOW_OP_MS) return;
  const incident = durationMs > INCIDENT_OP_MS;
  logger[incident ? "error" : "warn"](
    `[convex] slow ${kind}: ${name} took ${durationMs}ms`,
    { name, kind, durationMs, incident },
  );
  void captureServerEvent(AnalyticsEvent.ConvexOpLatency, {
    name,
    kind,
    duration_ms: durationMs,
    incident,
  });
}

/**
 * Wrap a ConvexHttpClient's `query`/`mutation` methods with timing. Mutates
 * and returns the same instance (the client is a lazily-created process
 * singleton in src/lib/convex-client.ts, so this only runs once per process).
 * `action` is intentionally left unwrapped — it's not used from src/server today.
 */
export function withConvexOpTiming(client: ConvexHttpClient): ConvexHttpClient {
  type QueryMethod = ConvexHttpClient["query"];
  type MutationMethod = ConvexHttpClient["mutation"];

  const rawQuery: QueryMethod = client.query.bind(client);
  const rawMutation: MutationMethod = client.mutation.bind(client);

  client.query = (async (query, ...args) => {
    const start = performance.now();
    try {
      return await rawQuery(query, ...args);
    } finally {
      reportIfSlowConvexOp(getFunctionName(query), "query", Math.round(performance.now() - start));
    }
  }) as QueryMethod;

  client.mutation = (async (mutation, ...args) => {
    const start = performance.now();
    try {
      return await rawMutation(mutation, ...args);
    } finally {
      reportIfSlowConvexOp(getFunctionName(mutation), "mutation", Math.round(performance.now() - start));
    }
  }) as MutationMethod;

  return client;
}
