import { getConvexClient } from "../convex-client";
import { api } from "../../../convex/_generated/api";
import { buildEnvelope, type WebhookEvent } from "./events";
import { signWebhookPayload } from "./sign";
import { hostResolvesToPrivate } from "./resolve-guard";

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
/**
 * How long a claimed delivery is invisible to other workers. Comfortably longer than
 * the request timeout, so a crashed worker's row becomes retryable rather than stuck.
 */
const LEASE_MS = 60_000;

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
    createdAt: number; // epoch ms (Convex)
    webhook: {
      id: string;
      url: string;
      secret: string;
      previousSecret: string | null;
      previousSecretExpiresAt: number | null; // epoch ms (Convex)
    };
  },
  doFetch: FetchLike,
  now: Date,
): Promise<DeliveryOutcome> {
  const convex = await getConvexClient();
  const envelope = buildEnvelope({
    deliveryId: delivery.id,
    event: delivery.event as WebhookEvent,
    organizationId: delivery.organizationId,
    data: JSON.parse(delivery.payload) as Record<string, unknown>,
    createdAt: new Date(delivery.createdAt),
  });

  // Sign exactly the bytes we send. Re-serializing on the consumer's side would
  // change key order and break the HMAC, so the body is built once, here.
  const rawBody = JSON.stringify(envelope);
  const timestamp = Math.floor(now.getTime() / 1000);

  // During a rotation grace window, sign with BOTH secrets (two `v1=` values) so a
  // consumer that hasn't swapped yet still verifies. Signing only with the new secret
  // would break every consumer the moment the operator rotated.
  const secrets = [delivery.webhook.secret];
  const previousStillValid =
    delivery.webhook.previousSecret &&
    delivery.webhook.previousSecretExpiresAt &&
    delivery.webhook.previousSecretExpiresAt > now.getTime();
  if (previousStillValid) secrets.push(delivery.webhook.previousSecret!);

  const signature = signWebhookPayload(rawBody, secrets, timestamp);
  // `attempts` was already incremented atomically when this row was claimed.
  const attempts = delivery.attempts;

  let responseStatus: number | undefined;
  let error: string | undefined;

  // Resolve-time SSRF guard: a plain hostname that resolves to an internal address
  // (metadata.google.internal, or an attacker A-record -> 169.254.169.254) passed the
  // creation-time URL check, which only sees the string. Refuse to POST to it.
  if (await hostResolvesToPrivate(delivery.webhook.url)) {
    error = "Endpoint resolves to a private or loopback address.";
  }

  try {
    if (error) throw new Error(error);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await doFetch(delivery.webhook.url, {
        method: "POST",
        // Do NOT follow redirects. A validated endpoint could otherwise 302 us onto
        // an internal address (169.254.169.254, 10.x, …), defeating the SSRF guard in
        // url.ts entirely. A 3xx is simply a failed delivery.
        redirect: "manual",
        headers: {
          "content-type": "application/json",
          "user-agent": "RVLT-Flow-Webhooks/v1",
          // Rebrand transition (expand-contract): emit the new X-RVLT-Flow-*
          // headers AND the legacy X-GearFlow-* headers with identical values so
          // existing consumers keep verifying signatures while they migrate. Drop
          // the legacy set in a later release once consumers have moved. See
          // docs/designs/rvlt-flow-rebrand-migration.md.
          "X-RVLT-Flow-Signature": signature,
          "X-RVLT-Flow-Event": delivery.event,
          "X-RVLT-Flow-Delivery-Id": delivery.id,
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
    await convex.mutation(api.webhooks.markSucceeded, {
      deliveryId: delivery.id,
      webhookId: delivery.webhook.id,
      responseStatus: responseStatus!,
      deliveredAt: now.getTime(),
      expectedAttempts: attempts,
    });
    return { deliveryId: delivery.id, status: "SUCCEEDED", responseStatus };
  }

  const exhausted = attempts >= MAX_ATTEMPTS || gone;
  const failureMessage = error ?? `HTTP ${responseStatus}`;

  // One atomic mutation: record the delivery outcome + backoff, bump the endpoint's
  // consecutiveFailures, and auto-disable on 410 or once it crosses the threshold.
  await convex.mutation(api.webhooks.markFailed, {
    deliveryId: delivery.id,
    webhookId: delivery.webhook.id,
    deliveryStatus: exhausted ? "FAILED" : "PENDING",
    ...(responseStatus !== undefined ? { responseStatus } : {}),
    lastError: failureMessage,
    // Overwrites the claim lease with the real backoff.
    nextAttemptAt: exhausted ? now.getTime() : now.getTime() + backoffMs(attempts),
    now: now.getTime(),
    gone,
    autoDisableAfter: AUTO_DISABLE_AFTER,
    expectedAttempts: attempts,
  });

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
  // Batch time bounds the due-query (a single consistent snapshot of "what's due").
  // Per-delivery work uses a FRESH timestamp (unless a time is injected for tests), so
  // a later delivery in a slow sequential batch gets current signatures + backoff, not
  // the stale batch-start time.
  const batchNow = opts.now ?? new Date();
  const doFetch = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const convex = await getConvexClient();

  const due = await convex.query(api.webhooks.dueDeliveries, {
    now: batchNow.getTime(),
    limit: opts.limit ?? 50,
  });

  const outcomes: DeliveryOutcome[] = [];
  for (const delivery of due) {
    const now = opts.now ?? new Date();

    // Orphan: the endpoint was deleted after this row was enqueued. Fail it out of the
    // queue so it can't sit forever "due" and starve the batch. Fenced by attempts.
    if (!delivery.webhook) {
      await convex.mutation(api.webhooks.markEndpointDisabled, {
        deliveryId: delivery.id,
        lastError: "Endpoint no longer exists.",
        expectedAttempts: delivery.attempts,
      });
      outcomes.push({ deliveryId: delivery.id, status: "FAILED", error: "endpoint deleted" });
      continue;
    }

    // The endpoint was disabled after this row was enqueued. Don't deliver it.
    if (!delivery.webhook.isActive) {
      await convex.mutation(api.webhooks.markEndpointDisabled, {
        deliveryId: delivery.id,
        lastError: "Endpoint disabled before delivery.",
        expectedAttempts: delivery.attempts,
      });
      outcomes.push({ deliveryId: delivery.id, status: "FAILED", error: "endpoint disabled" });
      continue;
    }

    // CLAIM the row before sending — an atomic, transactional Convex mutation (replaces
    // the Postgres updateMany optimistic lock). The cron worker and every emit
    // fire-and-forget kick select the same PENDING rows; the claim bumps attempts and
    // pushes nextAttemptAt out by the lease, so a concurrent worker's due-filter misses
    // it. claim.claimed=false → someone else owns this attempt.
    const claim = await convex.mutation(api.webhooks.claimDelivery, {
      id: delivery.id,
      now: now.getTime(),
      leaseMs: LEASE_MS,
    });
    if (!claim.claimed) continue;

    outcomes.push(await attemptOne({ ...delivery, attempts: claim.attempts }, doFetch, now));
  }

  return {
    processed: outcomes.length,
    succeeded: outcomes.filter((o) => o.status === "SUCCEEDED").length,
    failed: outcomes.filter((o) => o.status === "FAILED").length,
    outcomes,
  };
}
