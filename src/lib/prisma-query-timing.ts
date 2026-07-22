import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";
import { captureServerEvent } from "@/lib/posthog-server";

/**
 * T-9 interactive-path latency budget (README.md R-0.4): p95 < 100ms is the
 * "slow" line, > 1s is an incident. Analytics/batch/report paths register
 * their own budgets per R-0.4 — this extension has no way to distinguish an
 * interactive request from a batch job, so it flags every query against the
 * interactive default; a batch path that's expectedly > 100ms will show up
 * here and should be read with that context, not treated as a regression.
 */
export const SLOW_QUERY_MS = 100;
export const INCIDENT_QUERY_MS = 1000;

/**
 * Report a completed query's duration if it crosses the slow-query line —
 * structured log line (always) + a best-effort `slow_query` PostHog event
 * (for the p95 alert). Pulled out of the Prisma extension below so the
 * threshold/reporting logic is unit-testable without a real Prisma client.
 * Never throws — latency instrumentation must never become a new source of
 * request failures.
 */
export function reportIfSlow(model: string, operation: string, durationMs: number): void {
  if (durationMs <= SLOW_QUERY_MS) return;
  const incident = durationMs > INCIDENT_QUERY_MS;
  logger[incident ? "error" : "warn"](
    `[db] slow query: ${model}.${operation} took ${durationMs}ms`,
    { model, operation, durationMs, incident },
  );
  void captureServerEvent("slow_query", { model, operation, duration_ms: durationMs, incident });
}

/**
 * Prisma Client Extension (R-8.3.2): times every query and hands the result
 * to `reportIfSlow`, without altering the query's result or throwing on its
 * own account.
 */
export function withQueryTiming(client: PrismaClient): PrismaClient {
  return client.$extends({
    name: "query-timing",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: {
          model?: string;
          operation: string;
          args: unknown;
          query: (args: unknown) => Promise<unknown>;
        }) {
          const start = performance.now();
          try {
            return await query(args);
          } finally {
            reportIfSlow(model ?? "raw", operation, Math.round(performance.now() - start));
          }
        },
      },
    },
  }) as unknown as PrismaClient;
}
