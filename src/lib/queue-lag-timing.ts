import "server-only";
import { logger } from "@/lib/logger";
import { captureServerEvent } from "@/lib/posthog-server";
import { AnalyticsEvent } from "@/lib/analytics";

/**
 * T-P7 queue-lag/age alert (README.md R-0.4, R-9.10): the webhook delivery
 * queue is expected to drain within 5 minutes of a delivery being enqueued.
 * `deliverPendingWebhooks` (src/lib/webhooks/deliver.ts) calls
 * `reportIfQueueLagged` once per cron tick with the oldest age observed in
 * that tick's due batch — a cheap, no-new-query signal (reuses the batch
 * `dueDeliveries` already fetches) rather than a separate unbounded scan.
 */
export const QUEUE_LAG_MS = 5 * 60 * 1000;

/**
 * Report queue lag if the oldest due delivery in this batch has been waiting
 * longer than the T-P7 threshold. Structured log line (always past the
 * threshold) + a best-effort `queue_lag` PostHog event. Never throws — queue
 * monitoring must never become a new source of delivery failures.
 */
export function reportIfQueueLagged(oldestAgeMs: number, pendingCount: number): void {
  if (oldestAgeMs <= QUEUE_LAG_MS) return;
  logger.error(
    `[webhooks] queue lag: oldest pending delivery is ${Math.round(oldestAgeMs / 1000)}s old`,
    { oldestAgeMs, pendingCount },
  );
  void captureServerEvent(AnalyticsEvent.QueueLag, {
    oldest_age_ms: oldestAgeMs,
    pending_count: pendingCount,
  });
}
