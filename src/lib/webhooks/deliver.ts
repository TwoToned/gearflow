import { prisma } from "../prisma";
import { buildEnvelope, type WebhookEvent } from "./events";
import { signWebhookPayload } from "./sign";

/**
 * The delivery worker. Claims pending deliveries whose backoff has elapsed, POSTs
 * them signed, and records the outcome.
 *
 * Driven by `POST /api/cron/webhooks`; `emitWebhookEvent` also kicks it
 * fire-and-forget so the happy path doesn't wait for the next cron tick.
 *
 * At-least-once, never exactly-once. The envelope's `id` is the delivery row id and
 * is stable across retries, so consumers dedupe on it. See docs/designs/webhooks.md.
 */

/** 1m, 2m, 4m, 8m, 16m, 32m — then give up. */
export const MAX_ATTEMPTS = 6;
/** Consecutive failures before an endpoint is disabled and stops generating load. */
export const AUTO_DISABLE_AFTER = 20;
const REQUEST_TIMEOUT_MS = 10_000;

function backoffMs(attempts: number): number {
  return 2 ** (attempts - 1) * 60_000;
}

export interface DeliveryOutcome {
  deliveryId: string;
  status: "SUCCEEDED" | "FAILED" | "PENDING";
  responseStatus?: number;
  error?: string;
}

/** Injected so tests don't hit the network. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

async function attemptOne(
  delivery: {
    id: string;
    organizationId: string;
    event: string;
    payload: string;
    attempts: number;
    createdAt: Date;
    webhook: { id: string; url: string; secret: string };
  },
  doFetch: FetchLike,
  now: Date,
): Promise<DeliveryOutcome> {
  const envelope = buildEnvelope({
    deliveryId: delivery.id,
    event: delivery.event as WebhookEvent,
    organizationId: delivery.organizationId,
    data: JSON.parse(delivery.payload) as Record<string, unknown>,
    createdAt: delivery.createdAt,
  });

  // Sign exactly the bytes we send. Re-serializing on the consumer's side would
  // change key order and break the HMAC, so the body is built once, here.
  const rawBody = JSON.stringify(envelope);
  const timestamp = Math.floor(now.getTime() / 1000);
  const signature = signWebhookPayload(rawBody, delivery.webhook.secret, timestamp);
  const attempts = delivery.attempts + 1;

  let responseStatus: number | undefined;
  let error: string | undefined;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await doFetch(delivery.webhook.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "GearFlow-Webhooks/v1",
          "X-GearFlow-Signature": signature,
          "X-GearFlow-Event": delivery.event,
          "X-GearFlow-Delivery-Id": delivery.id,
        },
        body: rawBody,
        signal: controller.signal,
      });
      responseStatus = res.status;
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 500) : "request failed";
  }

  const ok = responseStatus !== undefined && responseStatus >= 200 && responseStatus < 300;
  // 410 Gone is the conventional "stop sending me these". Honour it immediately.
  const gone = responseStatus === 410;

  if (ok) {
    await prisma.$transaction([
      prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: "SUCCEEDED", attempts, responseStatus, deliveredAt: now, lastError: null },
      }),
      prisma.webhook.update({
        where: { id: delivery.webhook.id },
        data: { consecutiveFailures: 0, lastDeliveryAt: now },
      }),
    ]);
    return { deliveryId: delivery.id, status: "SUCCEEDED", responseStatus };
  }

  const exhausted = attempts >= MAX_ATTEMPTS || gone;
  const failureMessage = error ?? `HTTP ${responseStatus}`;

  const webhook = await prisma.webhook.update({
    where: { id: delivery.webhook.id },
    data: { consecutiveFailures: { increment: 1 }, lastDeliveryAt: now },
    select: { consecutiveFailures: true },
  });

  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      status: exhausted ? "FAILED" : "PENDING",
      attempts,
      responseStatus,
      lastError: failureMessage,
      nextAttemptAt: exhausted ? now : new Date(now.getTime() + backoffMs(attempts)),
    },
  });

  // A dead endpoint must stop generating load forever. The operator re-enables it.
  if (gone || webhook.consecutiveFailures >= AUTO_DISABLE_AFTER) {
    await prisma.webhook.update({
      where: { id: delivery.webhook.id },
      data: { isActive: false, disabledAt: now },
    });
  }

  return {
    deliveryId: delivery.id,
    status: exhausted ? "FAILED" : "PENDING",
    responseStatus,
    error: failureMessage,
  };
}

/**
 * Deliver up to `limit` due deliveries. Safe to run concurrently with itself: a
 * duplicate delivery is at-least-once behaviour the envelope's stable `id` already
 * covers, and never a double-apply on our side.
 */
export async function deliverPendingWebhooks(opts: {
  limit?: number;
  fetchImpl?: FetchLike;
  now?: Date;
} = {}): Promise<{ processed: number; succeeded: number; failed: number; outcomes: DeliveryOutcome[] }> {
  const now = opts.now ?? new Date();
  const doFetch = opts.fetchImpl ?? ((url, init) => fetch(url, init));

  const due = await prisma.webhookDelivery.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: "asc" },
    take: opts.limit ?? 50,
    include: { webhook: { select: { id: true, url: true, secret: true, isActive: true } } },
  });

  const outcomes: DeliveryOutcome[] = [];
  for (const delivery of due) {
    // The endpoint was disabled after this row was enqueued. Don't deliver it.
    if (!delivery.webhook.isActive) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: "FAILED", lastError: "Endpoint disabled before delivery." },
      });
      outcomes.push({ deliveryId: delivery.id, status: "FAILED", error: "endpoint disabled" });
      continue;
    }
    outcomes.push(await attemptOne(delivery, doFetch, now));
  }

  return {
    processed: outcomes.length,
    succeeded: outcomes.filter((o) => o.status === "SUCCEEDED").length,
    failed: outcomes.filter((o) => o.status === "FAILED").length,
    outcomes,
  };
}
