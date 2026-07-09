# Webhooks — outbound events for agents

**Created:** 2026-07-09
**Driver:** An agent using the API asked for events so it could react instead of polling.
**Related:** [`api-mcp-agent-access.md`](./api-mcp-agent-access.md), [FEATUREDOCS/56](../../FEATUREDOCS/56-api-mcp.md)

## Intent

Let an agent (or any integration) subscribe to a small set of high-signal GearFlow
events and receive a signed HTTP POST when they happen, rather than polling
`list_projects` on a timer.

The event contract is the part that is **expensive to change later** — consumers build
against it. So v1 ships four events, versioned, with room to add more without breaking
anyone.

## The events (v1)

| Event | Fires when | `data` |
|-------|-----------|--------|
| `project.status_changed` | A project moves to a new status | `{ projectId, projectNumber, name, from, to }` |
| `line_item.added` | Gear is added to a project | `{ projectId, lineItemId, modelId, quantity, type }` |
| `warehouse.checked_out` | Gear physically leaves the warehouse | `{ projectId, lineItemIds, assetIds, count }` |
| `maintenance.created` | A maintenance record is opened | `{ maintenanceId, assetId, issue, status }` |

Naming rule: `<noun>.<past_tense_verb>`. The noun matches the API's read vocabulary
(`project`, `line_item`, `warehouse`, `maintenance`) so a consumer can correlate an
event with a `get_project` / `get_asset` call.

## Envelope

```json
{
  "id": "whd_...",
  "event": "project.status_changed",
  "version": "v1",
  "createdAt": "2026-07-09T11:00:00.000Z",
  "organizationId": "org_...",
  "data": { }
}
```

- `id` is the **delivery** id. It is stable across retries — consumers use it to
  deduplicate. Also sent as the `X-GearFlow-Delivery-Id` header.
- `version` is per-event. A breaking change to a payload ships as `v2` alongside `v1`,
  and subscriptions name the version they want. Additive fields are not breaking.

## Signing

Stripe-style, because it is the convention consumers already know and it defeats replay:

```
X-GearFlow-Signature: t=1783600000,v1=<hex hmac-sha256>
```

The signed message is `${timestamp}.${rawBody}`, keyed by the endpoint's secret
(`whsec_...`, shown once at creation). Consumers must:

1. Reject if `|now - t|` exceeds a tolerance (we document 5 minutes).
2. Recompute the HMAC over `${t}.${rawBody}` and compare in **constant time**.

Signing the timestamp — not just the body — is what makes a captured payload
unreplayable. We ship `verifyWebhookSignature` so consumers don't hand-roll it.

## Delivery

Two-phase, because a webhook must **never** be able to break a business write:

1. **Emit** (`emitWebhookEvent`) runs after the write succeeds and only *enqueues*: it
   inserts one `WebhookDelivery` row per matching active subscription. It is
   best-effort and swallows its own errors — an unreachable webhook table must not
   roll back a warehouse check-out.
2. **Deliver** (`deliverPendingWebhooks`) POSTs each pending row, with a timeout. The
   cron route `POST /api/cron/webhooks` drives it; emit also kicks a fire-and-forget
   attempt so the happy path is fast.

**Retries.** Exponential backoff on `attempts`: 1m, 2m, 4m, 8m, 16m, 32m, then give up
(6 attempts). Any 2xx is success. `410 Gone` is treated as "unsubscribe me" and
disables the endpoint immediately — that is the standard way for a consumer to say stop.

**Auto-disable.** After 20 consecutive failures the endpoint is disabled and
`disabledAt` is stamped, so a dead endpoint stops generating load forever. The operator
re-enables it explicitly.

**Delivery log.** Every attempt updates the row: `attempts`, `lastError`,
`responseStatus`, `deliveredAt`. This is the self-serve debugging surface — an operator
can see exactly what we sent and what came back.

## What we deliberately do *not* do in v1

- **No ordering guarantee.** Deliveries are independent. A consumer that needs order
  must read state back (`get_project`), which is the honest thing to tell them.
- **No exactly-once.** At-least-once with a stable delivery id. Dedupe on `id`.
- **No event replay endpoint.** The delivery log records what happened; re-sending is
  an operator action, not an API.
- **No fan-out queue.** Postgres rows + a cron worker. This is a rental app, not a bus.
  If volume demands it, the `WebhookDelivery` table is already the queue.

## Security

- The endpoint URL must be `https://` (except `http://localhost` in development), so a
  signed payload never crosses the wire in the clear.
- Secrets are stored so we can sign with them. They are shown once on creation and
  rotatable. Rotation keeps the old secret valid for a grace window so a consumer can
  roll without dropping deliveries.
- Webhook management is an `orgSettings:update` write and is marked `dangerous`, so an
  API key needs an explicit scope AND `confirm` + `idempotencyKey` to create or delete
  an endpoint. An agent should not be able to quietly point your events at its own URL.
- SSRF: we refuse private/loopback hosts in production. An org admin could otherwise
  aim a webhook at internal infrastructure and use us as a probe.
