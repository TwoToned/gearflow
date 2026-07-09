/**
 * The webhook event contract.
 *
 * This is the part consumers build against, so it is the expensive thing to change.
 * Naming is `<noun>.<past_tense_verb>`, and the noun matches the API's read
 * vocabulary (`project`, `line_item`, …) so a consumer can correlate an event with a
 * `get_project` call. Additive payload fields are not breaking; anything else ships
 * as a new version alongside the old.
 *
 * See docs/designs/webhooks.md.
 */

export const WEBHOOK_EVENTS = [
  "project.status_changed",
  "line_item.added",
  "warehouse.checked_out",
  "maintenance.created",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Per-event payload version. Bumped only on a breaking change to that event's `data`. */
export const WEBHOOK_EVENT_VERSION = "v1" as const;

/** Human descriptions, surfaced by the API so an agent can pick without reading docs. */
export const WEBHOOK_EVENT_DESCRIPTIONS: Record<WebhookEvent, string> = {
  "project.status_changed": "A project moved to a new status.",
  "line_item.added": "Gear was added to a project.",
  "warehouse.checked_out": "Gear physically left the warehouse.",
  "maintenance.created": "A maintenance record was opened.",
};

export function isWebhookEvent(value: unknown): value is WebhookEvent {
  return typeof value === "string" && (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

/** The exact body we POST. `id` is the delivery id — stable across retries; dedupe on it. */
export interface WebhookEnvelope {
  id: string;
  event: WebhookEvent;
  version: typeof WEBHOOK_EVENT_VERSION;
  createdAt: string;
  organizationId: string;
  data: Record<string, unknown>;
}

export function buildEnvelope(args: {
  deliveryId: string;
  event: WebhookEvent;
  organizationId: string;
  data: Record<string, unknown>;
  createdAt: Date;
}): WebhookEnvelope {
  return {
    id: args.deliveryId,
    event: args.event,
    version: WEBHOOK_EVENT_VERSION,
    createdAt: args.createdAt.toISOString(),
    organizationId: args.organizationId,
    data: args.data,
  };
}

/** Parse the stored `events` JSON column. Never throws; unknown names are dropped. */
export function parseEvents(json: string): WebhookEvent[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter(isWebhookEvent) : [];
  } catch {
    return [];
  }
}
