/**
 * In-mutation webhook ENQUEUE for the browser-direct `warehouse.checked_out` event.
 *
 * The server path was `emitWebhookEvent` (src/lib/webhooks/emit.ts) =
 * `webhooks.activeSubscriptions` (query) + `webhooks.enqueueDeliveries` (mutation),
 * then a fire-and-forget kick of the Node delivery worker. Moving checkout
 * browser-direct means the ENQUEUE runs INSIDE the mutation (same transaction as the
 * write), replicating both reads/inserts here.
 *
 * DELIVERY is deliberately NOT run here: the sender (`src/lib/webhooks/deliver.ts` +
 * `sign.ts`) is Node crypto + fetch, an action/cron concern, and there is no Convex
 * delivery ACTION to schedule — so we can't `ctx.scheduler.runAfter` it. Enqueued rows
 * are `PENDING` with `nextAttemptAt = now` (immediately due) and get picked up by the
 * existing cron worker (`/api/cron/webhooks` → `deliverPendingWebhooks`). The only cost
 * vs. the server path is losing the best-effort "kick now" optimisation — up to one
 * cron interval of delivery latency, which is acceptable (the worker retries anything
 * PENDING anyway). See docs/designs/webhooks.md.
 *
 * Best-effort by design (mirrors emit): a webhook read/insert failure must NEVER roll
 * back the gear movement, so callers wrap this in try/catch and swallow.
 */
import { createId } from "@paralleldrive/cuid2";
import type { MutationCtx } from "../_generated/server";

/** Parse the stored `events` JSON column — never throws; non-array → []. Mirrors
 *  `parseEvents` in src/lib/webhooks/events.ts (minus the isWebhookEvent narrowing,
 *  which only matters for the shared TS type, not the string-equality match here). */
function parseEvents(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Enqueue one `webhookDeliveries` row per ACTIVE endpoint subscribed to `event`.
 * Replicates `webhooks.activeSubscriptions` (isActive endpoints whose events include
 * `event`) + `webhooks.enqueueDeliveries` (PENDING rows, nextAttemptAt=now). The
 * delivery id is minted here (stable across retries) exactly like emit().
 * Returns the number of deliveries enqueued.
 */
export async function enqueueWebhookEvent(
  ctx: MutationCtx,
  organizationId: string,
  event: string,
  data: Record<string, unknown>,
  now: number,
): Promise<number> {
  const endpoints = await ctx.db
    .query("webhooks")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)) // r9.8-ok: small org-configured table (webhook endpoints), not growable with usage
    .collect();
  const matching = endpoints.filter(
    (w) => w.isActive === true && parseEvents(w.events ?? "[]").includes(event),
  );
  if (matching.length === 0) return 0;

  const payload = JSON.stringify(data);
  for (const w of matching) {
    await ctx.db.insert("webhookDeliveries", {
      id: createId(),
      organizationId,
      webhookId: w.id,
      event,
      payload,
      status: "PENDING",
      attempts: 0,
      createdAt: now,
      nextAttemptAt: now,
    });
  }
  return matching.length;
}
