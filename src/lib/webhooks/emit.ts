import { prisma } from "../prisma";
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
    const subscriptions = await prisma.webhook.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, events: true },
    });

    const matching = subscriptions.filter((w) => parseEvents(w.events).includes(event));
    if (matching.length === 0) return { enqueued: 0 };

    // The payload stored here is NOT the final body — the envelope needs the delivery
    // id, which only exists once the row does. `deliverPendingWebhooks` builds the
    // envelope from this `data` plus the row's id and createdAt.
    await prisma.webhookDelivery.createMany({
      data: matching.map((w) => ({
        organizationId,
        webhookId: w.id,
        event,
        payload: JSON.stringify(data),
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
