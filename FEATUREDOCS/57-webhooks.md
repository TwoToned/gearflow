# 57 — Webhooks

Outbound, signed HTTP events so an agent or integration can **react** instead of polling.

Design of record: [`docs/designs/webhooks.md`](../docs/designs/webhooks.md).
Driver: an agent using the API asked for events after polling `list_projects` on a timer.

## Events (v1)

| Event | Fires when | `data` |
|-------|-----------|--------|
| `project.status_changed` | A project moves to a new status | `projectId, projectNumber, name, from, to` |
| `line_item.added` | Gear is added to a project | `projectId, lineItemId, modelId, quantity, type, description` |
| `warehouse.checked_out` | Gear physically leaves the warehouse | `projectId, lineItemIds, assetIds, count` |
| `maintenance.created` | A maintenance record is opened | `maintenanceId, title, assetIds, status, type` |

Names are `<noun>.<past_tense_verb>`, and the noun matches the API's read vocabulary so a
consumer can correlate an event with a `get_project` / `get_asset` call. The catalogue is
declared once in `src/lib/webhooks/events.ts` and served by `webhooks.getWebhookEvents`.

## Envelope and signing

```json
{ "id": "whd_…", "event": "project.status_changed", "version": "v1",
  "createdAt": "…", "organizationId": "org_…", "data": { } }
```

`id` is the **delivery** id, stable across retries and echoed in `X-GearFlow-Delivery-Id`.
Delivery is at-least-once; consumers dedupe on it.

```
X-GearFlow-Signature: t=<unix>,v1=<hex hmac-sha256 of `${t}.${rawBody}`>
```

Signing the **timestamp** as well as the body is what defeats replay: an attacker cannot
move an old, validly-signed body forward in time without invalidating the HMAC
(`sign.test.ts` proves both halves). Comparison is constant-time — a naive `===` on the
hex digest leaks how much of a forgery was correct. `verifyWebhookSignature` is exported
so consumers don't hand-roll it, and it accepts several secrets so a rotation grace
window works.

## Delivery (`src/lib/webhooks/`)

Two phases, because **a webhook must never break a business write**:

1. `emitWebhookEvent` runs after the write commits and only *enqueues* one
   `WebhookDelivery` row per subscribed endpoint. It swallows its own errors and never
   throws — an unreachable webhook table must not roll back a warehouse check-out. The
   cost is that a lost enqueue is a lost event, which is the right trade against losing
   the gear movement. It then kicks delivery fire-and-forget.
2. `deliverPendingWebhooks` POSTs each due row with a 10s timeout. `POST /api/cron/webhooks`
   (guarded by `CRON_SECRET`) drives the retries.

- **Backoff:** 1m, 2m, 4m, 8m, 16m, 32m, then `FAILED` (6 attempts).
- **`410 Gone`** is honoured as "unsubscribe me": fail immediately and disable.
- **Auto-disable** after 20 consecutive failures, so a dead endpoint stops generating load
  forever. Re-enabling via `updateWebhook({ isActive: true })` clears the streak.
- **Delivery log:** every attempt records `attempts`, `responseStatus`, `lastError`,
  `deliveredAt`. `webhooks.getWebhookDeliveries` is the self-serve debugging surface.

## Management

`src/server/webhooks.ts`: `getWebhookEvents`, `getWebhooks`, `getWebhookDeliveries`,
`createWebhook`, `updateWebhook`, `rotateWebhookSecret`, `deleteWebhook`.

All are reachable through the API/MCP like any operation. The module is marked
**dangerous**, so an API key needs `orgSettings:update` **and** `confirm` +
`idempotencyKey` to create, rotate or delete an endpoint — an agent must not be able to
quietly point your events at its own URL. Reads (`getWebhooks`, deliveries) are not
dangerous; nothing there is irreversible.

> Note: `dangerous` now applies only to **writes** in the generated registry. A read is
> never irreversible, so flagging one confused the meaning of the flag.

## Security

- The URL must be `https://` (only `http://localhost` in development), so a signed
  payload never crosses the wire in the clear.
- **SSRF guard** (`url.ts`): private, loopback, CGNAT and link-local hosts are refused —
  including `169.254.169.254`, the cloud metadata endpoint. Otherwise an org admin could
  aim a webhook at internal infrastructure and read results back through the delivery
  log's `responseStatus`.
- The signing secret is stored readable because we must sign with it. It is shown once at
  creation and rotatable; rotation keeps the old secret valid for a grace window.

## Known limitations

- **No ordering guarantee.** Deliveries are independent. A consumer needing order must
  read state back (`get_project`).
- **At-least-once, never exactly-once.** Dedupe on the envelope `id`.
- **DNS rebinding is not closed.** `url.ts` validates the hostname at creation; a name
  that resolves to a private address *at delivery time* still gets through. Closing it
  needs resolution-time address pinning.
- **No replay endpoint.** The delivery log records what happened; re-sending is an
  operator action.
- Delivery is a Postgres table plus a cron worker, not a queue. If volume demands it,
  `WebhookDelivery` is already shaped like the queue it would become.
