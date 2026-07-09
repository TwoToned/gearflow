# 56 — Agent-Accessible API + MCP

Lets AI agents (Claude, OpenClaw, scripts) and power users read and write GearFlow
through a stable, org-scoped API exposed **MCP-first** with a REST facade. v1 ships a
"safe rental-ops layer": broad reads + curated preview→commit capability verbs, bound
by the SAME overbooking / RBAC / audit protections the web UI enforces.

Design of record: [`docs/designs/api-mcp-agent-access.md`](../docs/designs/api-mcp-agent-access.md)
(approved via `/autoplan` — CEO + Eng + DX, dual-model review).

## Auth model

- **`ApiKey`** (`prisma/schema.prisma`, migration `20260707160000_add_api_key`): org-scoped,
  **hash-only** (`tokenHash`, SHA-256) + display `prefix`, JSON `scopes`, an **acting
  user** whose live RBAC bounds the key, plus `expiresAt`/`lastUsedAt`/`lastRotatedAt`/
  `revokedAt`. `Organization.apiKillSwitchAt` is an org-wide kill switch.
- **`ActorContext`** (`src/lib/actor-context.ts`): the one identity shape both a Better
  Auth session and an API key resolve to. `requirePermission(resource, action, actor?)`
  funnels through the pure `resolvePermissionForActor` (`src/lib/org-context.ts`), so an
  API key drives the existing `src/server/*.ts` guards **without spoofing a session**.
- **`getApiKeyActorContext`** (`src/lib/api-key.ts`): `Bearer` token → hash lookup →
  active/expiry/revoke/kill-switch validation → `ActorContext`. `requireApiScope` enforces
  the key-scope half; `authorizeApiOperation` (`src/lib/api/authorize.ts`) is the
  **scope ∩ RBAC** gate every verb passes through (a key can't exceed its user's role;
  a user can't act through a narrower key).

## Capability verb: `reserve_items`

`src/lib/api/reserve-items.ts` (protocol-agnostic) → `src/lib/api/reserve-port.ts` (write).
- **Preview** (`confirm:false`, default): `checkAvailability` per model — returns per-item
  availability + conflicts, writes nothing.
- **Commit** (`confirm:true`): requires an `idempotencyKey`; reuses the guarded
  `addLineItem` (threaded with the ActorContext) per item; availability failures map to a
  structured `INVENTORY_CONFLICT`.
- **Idempotency**: `ApiIdempotency` ledger (unique `apiKeyId`+`key`, migration
  `20260707170000`) — a retried commit replays the stored result instead of double-booking.
- Org is taken from the **authorized actor**, never from caller input.

## Surfaces

- **REST** (`src/app/api/v1/`): `GET /whoami` (test connection — identity + scopes),
  `POST /reserve-items`. `Authorization: Bearer <key>`. Errors use one agent-native
  envelope (`src/lib/api/http.ts` `toErrorEnvelope`): stable `code`, `retryable`,
  `requiredScope`, typed `details`; unknown errors become an opaque 500. `/v1` +
  `X-GearFlow-API-Version` header.
- **MCP** (`POST /api/v1/mcp`, `src/lib/api/mcp.ts`): JSON-RPC 2.0 Streamable HTTP —
  `initialize`, `tools/list`, `tools/call` for `whoami` + `reserve_items`. Tool
  descriptions are prompt-shaped (prerequisites, effect, preview behaviour, required
  scope, idempotency). Tool failures return a structured `isError` result the agent can
  recover from.

## Agent documentation

`public/llms.txt` (served at `https://flow.rvlt.app/llms.txt`) is the complete,
self-contained guide an AI agent reads to use the API/MCP: auth, MCP + REST setup,
every tool/endpoint with schemas, the preview→commit flow, idempotency, the full
error-code table with recovery actions, versioning, and worked examples. Discovery is
wired INTO the API so an agent finds it without being told: `GET /api/v1` (unauthenticated
index) returns the docs URL + endpoints; every error envelope carries `documentation_url`;
`whoami` returns it too. The settings page links to it for operators.

## Key management

`src/server/api-keys.ts`: `createApiKey` (returns the raw secret ONCE; acting user must be
a member), `revokeApiKey`, `setOrgApiKillSwitch`, `listApiKeys` — org-settings-guarded + audited.

## Testing

56 unit tests across `src/lib/api/*`, `src/lib/actor-context.test.ts`, `src/lib/api-key.test.ts`,
`src/server/api-keys.test.ts`. Full test plan (incl. the concurrency + cross-org isolation
integration tests): the gstack test-plan artifact referenced in the design doc.

## Known limitations / remaining work

- **Availability TOCTOU**: the availability check and the write are not one atomic
  transaction (the overbooking math lives in `src/lib/overbooking-core.ts` and can't yet run
  inside a Convex mutation) — the same window the UI has today. The hardening is the
  availability-atomic Convex reserve mutation (relocate the core into `convex/lib` with a
  parity test first).
- **Reservation state**: lands as a normal (QUOTED) line; a first-class `DRAFT`/hold status
  + `reservationExpiresAt` TTL + `createdByApiKeyId` provenance are the next schema step.
- **Not yet built**: asset-specific holds, a key-management settings UI + "Connect an AI
  Agent" onboarding, webhooks, read-scope-by-sensitivity tiers.
- **Verification**: unit-tested locally; end-to-end runs via the PR preview deploy (the
  worktree has no Convex deploy key / DB).
