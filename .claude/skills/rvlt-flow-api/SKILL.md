---
name: rvlt-flow-api
description: >-
  Use when an agent or script needs to connect to RVLT Flow (flow.rvlt.app) over
  its MCP server or REST API to pull data or perform operations — authenticating
  with an API key or OAuth, calling rvlt_flow_v1_* tools, hitting
  /api/v1/ops/{operation}, handling CONFIRMATION_REQUIRED, MISSING_SCOPE,
  INVENTORY_CONFLICT or RateLimited, finding an operation no curated tool covers,
  or fetching a project PDF. Also use when setting up the connection in Claude,
  Cursor, or any MCP client. Not for running the hire business itself (that's
  the rvlt-flow skill) or for changing gearflow code (CLAUDE.md).
---

# RVLT Flow — API & MCP integration

RVLT Flow is the ops platform for an AV / live-event hire business: jobs
(`projects`), quotes, invoices, gear (`assets`), warehouse dispatch, crew and
sub-hires. This skill is how an **agent** talks to it. One dispatcher sits behind
every entry point (MCP tools, REST, curated aliases), so the rules here apply
regardless of transport.

**REQUIRED BACKGROUND for business questions:** the `rvlt-flow` skill holds the
domain rules (status machine, availability math, money). This skill is the
wire contract. Read both before a write.

## Connect

| You are | Do this |
|---|---|
| Claude.ai / Claude Desktop / any MCP client that speaks OAuth | Add a remote MCP server at `https://flow.rvlt.app/api/v1/mcp`. Discovery is automatic (`/.well-known/oauth-authorization-server`, dynamic client registration). The consent screen narrows scopes to the signed-in user's live role. Tokens expire in 1 hour; the refresh token (30 days) rotates on every use. |
| MCP client with a bearer header | `{"mcpServers":{"rvlt-flow":{"url":"https://flow.rvlt.app/api/v1/mcp","headers":{"Authorization":"Bearer <key>"}}}}` — the exact config Settings → API keys → "Connect an AI Agent" hands you. |
| stdio-only MCP client | `pnpm dlx mcp-remote https://flow.rvlt.app/api/v1/mcp --header "Authorization:Bearer <key>"` |
| Script / curl / SDK | REST, base `https://flow.rvlt.app/api/v1`, header `Authorization: Bearer <key>`. Bearer only — there is no cookie path. |

Keys are minted at `https://flow.rvlt.app/settings/api-keys` by an org admin.
The MCP server is stateless (fresh server per HTTP request), so reconnects
cost nothing and there is no session to lose.

**First call on any new connection: `whoami`.** It returns `organizationId`,
`actingUser`, `role`, live `permissions`, the key's `scopes`, and `limits`
(`agentRead`, `agentWrite`, `maxBulkItems`). Plan against what it says —
knowing you lack `warehouse:check_out` before you propose a dispatch saves a
round trip.

## Identity model — you act AS a person, within a key

Every call is authorised twice, inside the database transaction:

1. **RBAC of the acting user** — the human the key was minted for. Owner,
   admin, manager, member, warehouse, viewer. Re-read live on every call; a
   demotion lands on the next request.
2. **Scopes of the key** — `resource:action` strings (`asset:read`,
   `project:manage_line_items`, `warehouse:check_out`, `invoice:issue`, …)
   plus `self:read`/`self:write` for personal surfaces. Wildcards `*` and
   `resource:*` exist but presets never use them.

You can do only what BOTH allow. Presets an admin picks from:

| Preset | Grants | Sees margins? |
|---|---|---|
| `read_only_agent` | every `:read` + `reports:view` + `self:read` | no (`noFinancials` on) |
| `warehouse_operator` | reads + `warehouse:scan` | no |
| `finance_reader` | reads incl. quotes/invoices | **yes** |
| `full_agent` | reads + all non-destructive writes | yes |

**No preset grants** `*:delete`, `invoice:void`, `invoice:record_payment`,
`invoice:void_payment`, `invoice:xero_manage`, `warehouse:check_out`,
`warehouse:check_in`, `project:allow_overbook`, `project:unlock_session`,
`warehouse:revert_agent_window`, org settings or member management. Each is a
deliberate per-key grant. If you need one, say so plainly and name the scope.
`full_agent` DOES carry `invoice:create/update/publish/issue/xero_push`, so
sending a quote or issuing an invoice is in reach (still `high` danger, still
confirm-gated). `warehouse_operator`'s extra `warehouse:scan` covers only
ad-hoc check records; staging, reserving and dispatching all need
`warehouse:check_out`, which no preset has — a key on that preset cannot move
gear. Confirm with `whoami.scopes`, not the preset name.

A key flagged `noFinancials` has cost/margin fields redacted on every read
(model purchase/replacement cost, crew rates, `get_project_financials`
returns all zeros). Sell rates stay visible — you need them to quote.

Org is never an argument. `orgId`/`organizationId` are overwritten from the
key on every call; `NOT_FOUND` for a valid-looking id means it belongs to
another org.

## The request envelope

Every operation, on every transport, takes the same shape:

```json
{ "args": { ... }, "idempotencyKey": "<8-200 chars>", "confirm": true }
```

- **`args`** — the operation's business arguments. Never send `actor`,
  `auditId`, `now`, `orgId`, `organizationId`, or `id` on a create — the
  server injects them (`describe_operation` lists them as `injectedArgs`).
- **`idempotencyKey`** — REQUIRED on every mutation. Same key + same args =
  the first result replayed (`replayed: true`, HTTP 200 instead of 201).
  Same key + different args = `IDEMPOTENCY_KEY_REUSED`. The new row's id is
  derived from the key, so a retry cannot double-write even if the ledger
  is stale. Mint one per logical action, keep it, reuse it on retry.
- **`confirm`** — top-level, sibling of `args`, only meaningful on
  `danger: high` writes. See the gate below.

REST: `POST /api/v1/ops/{module.fn}` with that body. MCP curated tools take
the operation's args flat, with `idempotencyKey` and `confirm` alongside
them; `call_operation` takes `{ operation, args, idempotencyKey, confirm }`.

Success: `{ "data": …, "requestId", "warnings": [], "replayed"? }`.
`warnings[]` is the deprecation channel — surface anything in it.
Error: `{ "error": { "code", "category", "retryable", "message", "recovery": { "action", "hint" }, "requiredScope", "requestId", "details" } }`.
Act on `recovery.action`; quote `requestId` when reporting an `internal` error.

Dates and times are **epoch milliseconds** everywhere (`rentalStartDate`,
`startMs`, `rangeStart`, `paidAt`, …) — never ISO strings. For a date-only
field send 00:00:00 UTC of that calendar day (`Date.parse("2026-10-14")` =
`1791936000000`), which is what the app's own forms send; quote and invoice
dates are then normalised server-side to the org's calendar day. For a range
query send the real instants you mean. Money is a plain number in the org's
currency. Ids are 24-char cuids.

## Three gates you WILL hit

### 1. Confirmation (`CONFIRMATION_REQUIRED`, HTTP 409)

Every mutation carries `danger: low | medium | high`. High = stock-affecting,
irreversible, lock-softening, delete/archive, financial issue/void, warehouse
movement, bulk-destructive. A high call without `confirm: true` fails with a
human-readable `details.summary` of exactly what it would do.

The flow is not optional:

1. Send the call **without** `confirm`.
2. Show the returned summary to the human.
3. On their explicit yes, re-send the **identical** call (same args, same
   `idempotencyKey`) with `confirm: true`.

Do not pre-set `confirm: true` because you feel sure. The gate exists so a
human sees the consequence before gear or money moves, and that human is not
you. A medium/low op escalates to high for one call when it supplies an
active privileged arg (e.g. `allowOverbook: true`).

### 2. Scope vs permission — two different conversations

| Code | Who can fix it | What to say |
|---|---|---|
| `MISSING_SCOPE` (`requiredScope` set) | An org admin, by adding that scope to the key | "The key needs `warehouse:check_out`." |
| `FORBIDDEN` | Nobody via the key — the acting user's role lacks it | "Your role doesn't include this; someone whose role has `<resource:action>` needs to do it." (`whoami.permissions` shows what the acting user's role holds.) |

Never report `FORBIDDEN` as "I need more access". Widening the key changes
nothing.

### 3. Inventory (`INVENTORY_CONFLICT`, HTTP 409)

`add_line_items` runs the availability check in the same transaction. On a
clash you get `details.conflicts[]` and `details.suggestions[]` — substitutes
that are actually free. Offer those. `allowOverbook: true` is forced false
unless the key holds `project:allow_overbook` (no preset has it).

## Error codes

`retryable` is the server's flag and means "not permanently dead", never
"re-send blindly": do `recovery.action` first (confirm, unlock, split, wait),
then re-send. A `no` means the identical call will never succeed.

| Category | Code | Retryable | Do |
|---|---|---|---|
| auth | `MISSING_CREDENTIALS`, `INVALID_KEY` | no | Fix the header / key |
| auth | `KEY_INACTIVE`, `KEY_EXPIRED` | no | Admin issues a new key (or OAuth refresh) |
| auth | `ORG_KILL_SWITCH`, `ORG_ARCHIVED` | no | API is off for the org — stop, tell the human |
| scope | `MISSING_SCOPE` | no | Admin adds `requiredScope` |
| permission | `FORBIDDEN`, `FORBIDDEN_UNLOCK_PRICING` | no | Escalate to a person whose role has it |
| permission | `AGENT_READ_NOT_MIGRATED` | no | This read isn't open to keys; pick an equivalent from `list_operations` |
| gate | `CONFIRMATION_REQUIRED` | yes | Confirm flow above |
| gate | `PRICING_LOCKED` | yes | Pricing is frozen (quote sent). An admin/manager/PM clears it via `projectPricingLockWrites.unlockPricingNative` (high, confirm) — propose, don't bypass |
| gate | `BLOCKING_COMMENTS` | no | Unresolved blocking comments on the job; a human resolves them in the app |
| gate | `ASSET_IN_KIT` | no | Add the kit, not the member |
| gate | `WRITES_DISABLED` | yes | Writes paused for that domain — retry later |
| validation | `VALIDATION_FAILED` | no | `details.issues` names fields |
| validation | `INVALID_NUMBER` | no | NaN / infinite / out of range |
| validation | `BULK_TOO_LARGE` | yes | Split to ≤ 50 items |
| conflict | `INVENTORY_CONFLICT` | no | Use `details.suggestions` |
| conflict | `IDEMPOTENT_IN_PROGRESS` | yes | Retry shortly with the SAME key |
| conflict | `IDEMPOTENCY_KEY_REUSED` | no | New key for a different call |
| conflict | `DOCUMENT_NOT_READY` | yes | PDF still rendering — retry |
| conflict | `ALREADY_EXISTS` | no | Fetch the existing row |
| not_found | `NOT_FOUND`, `UNKNOWN_OPERATION` | no | Check id / `list_operations` |
| rate_limit | `RateLimited` | yes | Wait `details.retryAfter` ms |
| internal | anything else | no | Quote `requestId` |

## Limits

- Reads: 600/min, burst 200. Writes: 60/min, burst 20. Per key — you cannot
  starve the human's own UI, and they cannot starve you.
- Bulk arrays: **50 items per call** (humans get 500). Split larger batches.
- Agent token TTL is 60 s but you never see it; the bearer key is what you send.

## Curated MCP tools (stable, additive-only)

Namespace `rvlt_flow.v1.*`; most clients show them as `rvlt_flow_v1_<name>`.
Nineteen wrap one registry operation each; `whoami` and `get_project_document`
have no registry operation (so `describe_operation` cannot describe them —
their args are below). These 21 are the only part of the surface with a
compatibility promise. Prefer them.

| Tool | Operation | Danger | Scope | Key args |
|---|---|---|---|---|
| `whoami` | — | read | — | none |
| `search_assets` | `assets.list` | read | `asset:read` | none — returns ALL assets; filter client-side (or use `assets.listPage` via `call_operation` for `search`/`statusIn`/`page`) |
| `get_asset` | `assets.getById` | read | `asset:read` | `id` |
| `check_availability` | `availability.calendarData` | read | `project:read` | `startMs`, `endMs` |
| `list_projects` | `projects.listPage` | read | `project:read` | `search?` (name, job number, location), `statusIn?[]`, `typeIn?[]`, `page?` (1-based), `pageSize?` (default 25), `sortBy?`, `sortOrder?` → `{ items, total, page, pageSize, totalPages }` |
| `get_project` | `projectDetail.bundle` | read | `project:read` | `projectId` — the workhorse: dates, client, status, line items |
| `create_project` | `projectWrites.createNative` | medium | `project:create` | `name` (only required), `clientId?`, `type?`, `status?`, `rentalStartDate?`/`rentalEndDate?` (chargeable), `projectStartDate?`/`projectEndDate?` (gear-committed), `locationId?`, `projectManagerId?` |
| `add_line_items` | `lineItemWrites.addNative` | medium | `project:manage_line_items`, `asset:update` | `projectId`, `fields{ quantity, modelId? \| assetId? \| bulkAssetId?, type?, unitPrice?, pricingType?, discount?, isOptional?, notes?, categoryId?, groupId? }`, `includeAccessories` (bool), `allowOverbook` (send `false`) |
| `reserve_items` | `warehouseWrites.reassignLineItemUnit` | medium | `warehouse:check_out` | `projectId`, `targetLineItemId`, `unitId` |
| `release_items` | `warehouseWrites.undeprepLine` | **high** | `warehouse:check_out` | `projectId`, `lineItemId` |
| `swap_asset` | `projectLineItems.swapLineItemAsset` | medium | `project:manage_line_items` | `lineItemId`, `newAssetId` — find candidates with `reservationConflicts.swapCandidates` first |
| `stage_pick_list` | `warehouseWrites.syncContainersBatch` | medium | `warehouse:check_out` | `projectId`, `containerNames[]` |
| `dispatch_gear` | `warehouseWrites.checkOutItems` | **high** | `warehouse:check_out` | `projectId`, `items[{ lineItemId, assetId?, quantity?, notes?, includeAccessoryIds?[] }]`, `includeAccessories`, `auditIds[]` (send `[]`) |
| `receive_gear` | `warehouseWrites.checkInItems` | **high** | `warehouse:check_in` | `projectId`, `items[{ lineItemId, assetId?, quantity?, returnCondition: GOOD\|DAMAGED\|MISSING }]`, `auditIds[]` |
| `list_crew` | `crewMembers.list` | read | `crew:read` | none |
| `assign_crew` | `crewAssignmentsWrites.createNative` | medium | `crew:create` | `projectId`, `crewMemberId`, `startDate?`, `endDate?`, `crewRoleId?`, `phase?`, `status?`, `rateOverride?` |
| `get_warehouse_status` | `warehouseList.bundle` | read | `warehouse:read` | none — out, due back, overdue |
| `create_maintenance` | `maintenanceWrites.createNative` | medium | `maintenance:create` | `recordId` (you mint it, e.g. `MAINT-2026-0142`), `title`, `type` (REPAIR\|PREVENTATIVE\|TEST_AND_TAG\|INSPECTION\|CLEANING\|FIRMWARE_UPDATE), `assetLinks[]` |
| `list_overbookings` | `overbookingBoard.bundle` | read | `project:read` | `rangeStart`, `rangeEnd` |
| `get_project_financials` | `projectCosts.operationalCosts` | read | `project:read` | `projectId` — all zeros under `noFinancials` |
| `get_project_document` | — | read | `project:read` / `invoice:read` | `projectId`, `docType` |

Plus three discovery tools: `list_operations` (`resource?`, `kind?`, `cursor?`,
`limit?`), `describe_operation` (`operation`), `call_operation`.

**Documents.** `docType` is one of `packing-list` (warehouse pick slip, kits
exploded), `return-sheet`, `delivery-docket`, `manifest` (client-facing:
everything on site, container by container, then loose) — each rendered fresh
from today's state, need `project:read` — or `quote` / `invoice` — the
**frozen** sent/issued PDF, never re-rendered, need `invoice:read`. An unsent
quote returns a watermarked draft preview; an un-issued invoice is `NOT_FOUND`.
The MCP tool returns `{ url, fileName, contentType, docType, status }` with
`status` one of `live | draft-preview | sent | issued`; fetch `url` (short-lived
storage link, no auth) promptly for the bytes, or hand it to the user if your
client cannot fetch. REST: `GET /api/v1/documents/{projectId}?type=<docType>`
streams `application/pdf` directly (`X-Document-Status` header carries the
status). Never tell anyone a quote or invoice can be "regenerated".

## Everything else: discover, describe, call

Roughly 615 operations are agent-reachable (about 312 reads, 303 writes).
Anything not curated is `stability: tracks-app` — it follows the app's
internals and may change shape between releases.

```
list_operations { resource?: "invoice", kind?: "mutation", cursor?: 0, limit?: 50 }
    → { data: [{ operation, kind, resource, action, scopePairs, args, injectedArgs, requiresIdempotencyKey }], total, cursor, nextCursor }
      (cursor is a numeric offset; limit max 200; page until nextCursor is null)
describe_operation { operation: "invoicesWrites.issueNative" }
    → the same fields plus possibleErrorCodes
call_operation { operation, args, idempotencyKey (required for mutations), confirm? }
```

Always `describe_operation` before a non-curated call; never guess an arg
shape from memory. `references/operations.md` in this skill maps the common
jobs (quotes, invoices, payments, clients, line-item edits, status changes,
sub-hires, tasks) to their operation names and args.

If an operation is not in `list_operations`, it does not exist for you. There
is no other route: the ~630 service-only functions (raw CRUD, mirrors,
backfills, API-key management) are unreachable by construction, and
`/api/v1/ops/<anything-else>` is a 404, not a 403.

**REST shortcuts** (same dispatcher, same envelope): `GET /api/v1/projects`,
`GET /api/v1/projects/{id}`, `GET /api/v1/assets`, `GET /api/v1/clients`,
`POST /api/v1/projects/{id}/line-items` (body `{ args: { fields, includeAccessories, allowOverbook }, idempotencyKey }` — `projectId` comes from the path and overrides any sent in `args`). The three `GET` list aliases take no query params and return everything; use `*.listPage` via `/ops` for paging and search.
Also `GET /api/v1/whoami`, `GET /api/v1/operations[/{operation}]`,
`GET /api/v1/openapi.json` (unauthenticated), `GET /llms.txt`, and the
public reference page `https://flow.rvlt.app/docs/api`. Every `/api/v1`
response carries `X-RVLT-Flow-API-Version: v1`. Inside MCP the same docs are
resources `rvlt-flow://llms.txt` and `rvlt-flow://openapi.json`, and three
prompts exist: `weekly_availability_sweep`, `prep_sheet_review`,
`overbooking_triage`.

## Domain facts that break integrations

- **Two date windows.** `rentalStartDate`→`rentalEndDate` is what the client
  pays for. `projectStartDate`→`projectEndDate` is when gear is out of the
  building (defaults to the rental window). Availability reads the gear
  window; pricing reads the rental window. Line items inherit the project's
  dates — there are no per-line dates on `add_line_items`.
- **Status moves itself.** Quote sent (`quotesWrites.sendNative`) → `QUOTED`;
  client accepts (`quotesWrites.markAcceptedNative`) or an invoice is issued →
  `AWAITING_PAYMENT`; paid in full (`paymentsWrites.recordNative`, or Xero
  sync) → `CONFIRMED`; first pack → `PREPPING`; last item out → `CHECKED_OUT`;
  last item back → `RETURNED`. So "the client said yes" is
  `markAcceptedNative`, not a status edit. `projectWrites.updateStatusNative`
  is `high` danger; record the missing event instead of forcing a status.
  Never move a job to `COMPLETED` or `INVOICED` by automation.
- **Statuses:** `ENQUIRY, QUOTING, QUOTED, AWAITING_PAYMENT, CONFIRMED,
  PREPPING, CHECKED_OUT, ON_SITE, RETURNED, COMPLETED, INVOICED, CANCELLED`.
  `AWAITING_PAYMENT` and later hard-hold stock. Say "deployed" for
  `CHECKED_OUT` when talking to humans.
- **Quote status is derived.** Use the `effectiveStatus` field the quote
  queries return (`EXPIRED` is computed, never stored).
- **Money is server-computed.** Totals, tax, margin come from line items. Do
  not send `subtotal`/`total`/`taxAmount` on `create_project` even though the
  schema lists them — they are stripped or recomputed. `$0` is a real price,
  not "unpriced"; `discount` is a flat amount, `discountMode` only records
  how it was typed.
- **Sending a quote does not email anyone.** `quotesWrites.sendNative` records
  the send, freezes pricing and renders the PDF for a human to attach. Flow
  does not take payments; Xero does.
- **Everything is audited.** Each write is stamped with your key id and shows
  in the activity log with an "Agent" badge. An operator can bulk-revert your
  warehouse movements. Work as though the log will be read.

## One complete example (REST)

```bash
K="Authorization: Bearer $RVLT_FLOW_API_KEY"; B=https://flow.rvlt.app/api/v1

# 1. identity
curl -s $B/whoami -H "$K"

# 2. find the job
curl -s $B/ops/projects.listPage -H "$K" -H 'Content-Type: application/json' \
  -d '{"args":{"search":"Hilton","statusIn":["CONFIRMED","PREPPING"]}}'

# 3. add gear — medium danger, idempotency key required, no confirm needed
curl -s $B/ops/lineItemWrites.addNative -H "$K" -H 'Content-Type: application/json' \
  -d '{"args":{"projectId":"<id>","fields":{"modelId":"<modelId>","quantity":4},"includeAccessories":true,"allowOverbook":false},
       "idempotencyKey":"hilton-add-led-2026-10-14-a"}'
#    → 201 {data:{id,...}}   or 409 INVENTORY_CONFLICT with details.suggestions

# 4. dispatch — high danger: first call returns CONFIRMATION_REQUIRED + summary
curl -s $B/ops/warehouseWrites.checkOutItems -H "$K" -H 'Content-Type: application/json' \
  -d '{"args":{"projectId":"<id>","items":[{"lineItemId":"<li>"}],"includeAccessories":true,"auditIds":[]},
       "idempotencyKey":"hilton-dispatch-2026-10-14-a"}'
#    show details.summary to the human; on "yes" re-send IDENTICAL body + "confirm":true
```

The MCP equivalent is `rvlt_flow_v1_whoami` → `rvlt_flow_v1_list_projects` →
`rvlt_flow_v1_add_line_items` → `rvlt_flow_v1_dispatch_gear` with the same
args flattened and `idempotencyKey`/`confirm` alongside.

## Red flags — stop

- About to send `confirm: true` on the first attempt.
- About to retry a timed-out write with a **new** idempotency key.
- Telling a user "I need more access" on a `FORBIDDEN`.
- Calling `updateStatusNative` to make a board look right.
- Passing a date as an ISO string, or `orgId` in `args`.
- Inventing an operation name instead of calling `list_operations`.
- Describing a quote/invoice PDF as regenerable, or a `$0` line as unpriced.
- Reporting a number you did not fetch on this turn.
