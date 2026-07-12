import { createId } from "@paralleldrive/cuid2";
import { getConvexClient } from "../convex-client";
import { api } from "../../../convex/_generated/api";
import { parseEvents, type WebhookEvent } from "./events";

/**
 * Enqueue an event for every active endpoint subscribed to it.
 *
 * This runs AFTER the business write has committed, and it is **best-effort by
 * design**: it swallows its own errors and never throws. A webhook table that is
 * unreachable, or an endpoint that is misconfigured, must never roll back a warehouse
 * check-out. The cost of that choice is that a lost enqueue is a lost event — which is
 * the right trade, because the alternative is losing the gear movement.
 *
 * Delivery itself is a separate phase (`deliverPendingWebhooks`), driven by the cron
 * worker, with a fire-and-forget kick from here so the happy path is fast.
 *
 * See docs/designs/webhooks.md.
 */
export async function emitWebhookEvent(
  organizationId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<{ enqueued: number }> {
  try {
    const convex = await getConvexClient();
    const subscriptions = await convex.query(api.webhooks.activeSubscriptions, { orgId: organizationId });

    const matching = subscriptions.filter((w) => parseEvents(w.events).includes(event));
    if (matching.length === 0) return { enqueued: 0 };

    // The payload stored here is NOT the final body — the envelope needs the delivery
    // id, which we mint here (createId) so it's stable. `deliverPendingWebhooks` builds
    // the envelope from this `data` plus the row's id and createdAt. nextAttemptAt=now
    // so the row is immediately due.
    const now = Date.now();
    const payload = JSON.stringify(data);
    await convex.mutation(api.webhooks.enqueueDeliveries, {
      deliveries: matching.map((w) => ({
        id: createId(),
        organizationId,
        webhookId: w.id,
        event,
        payload,
        createdAt: now,
        nextAttemptAt: now,
      })),
    });

    // Kick delivery now so the happy path doesn't wait for the next cron tick.
    // Deliberately not awaited, and its failure is swallowed: this is an
    // optimisation over the cron worker, which will retry anything left PENDING.
    // Imported lazily so `emit` stays cheap for the (common) no-subscriber case.
    void import("./deliver")
      .then((m) => m.deliverPendingWebhooks({ limit: matching.length }))
      .catch(() => {});

    return { enqueued: matching.length };
  } catch {
    // Never let an event break the write that produced it.
    return { enqueued: 0 };
  }
}
