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
  // Phase 8 (#1004) — API-lifecycle events. An operator running an MCP/API
  // consumer needs to know about the KEY, not just the data it moves: a new
  // key minted, a key revoked out from under a running client, a client
  // getting throttled, or the org kill switch flipping. Added because an
  // agent polling `list_projects` on a timer literally asked for webhooks in
  // the first place (see the module doc above).
  "api_key.created",
  "api_key.revoked",
  "api.rate_limited",
  "api.kill_switch_toggled",
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
  "api_key.created": "A new agent-accessible API key was minted for this org.",
  "api_key.revoked": "An API key was revoked (or superseded by a rotation) and can no longer authenticate.",
  "api.rate_limited": "An API/MCP call was rejected for exceeding its per-key rate limit.",
  "api.kill_switch_toggled": "The org-wide API kill switch was flipped on or off.",
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
