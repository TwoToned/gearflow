# 56 — Agent-Accessible API + MCP

Lets AI agents (Claude, OpenClaw, scripts) and power users read and write GearFlow
through a stable, org-scoped API exposed **MCP-first** with a REST facade.

**Coverage: everything a user can do.** All 537 operations — every read and every write
the web UI performs — are reachable. They are not a reimplementation: each operation
invokes the *same guarded server action* the UI invokes, so RBAC, validation,
overbooking prevention and the audit log apply unchanged. There is no weaker API path.

Design of record: [`docs/designs/api-mcp-agent-access.md`](../docs/designs/api-mcp-agent-access.md)
(approved via `/autoplan` — CEO + Eng + DX, dual-model review). The v1 design shipped a
curated verb set; full coverage was added afterwards on the same foundations.

## How full coverage works

Three pieces:

1. **Ambient actor** (`src/lib/request-actor.ts`). `getOrgContext()` is the single
   function every server action funnels through for org scoping — reads call it
   directly, writes reach it via `requirePermission()`. It now consults an
   `AsyncLocalStorage<ActorContext>` before falling back to the Better Auth session.
   The dispatcher wraps each call in `runWithActor(actor, …)`, so all ~508 server
   actions run for an API key **unmodified**, with no cookie and no session spoofing.
   Nothing set → the web UI path is byte-for-byte unchanged.

2. **Generated registry** (`scripts/generate-api-registry.ts` →
   `src/lib/api/generated/operations.ts`). Parses `src/server/*.ts` with the TypeScript
   compiler API and records, per exported action, its parameters and the
   `requirePermission("resource", "action")` literal that guards it. The guard *is* the
   scope, so the registry cannot drift from the code. A module with no guard anywhere
   must be declared explicitly or generation **fails** — an unguarded module can never
   silently inherit an over-broad scope. Regenerate with `npm run api:registry`.

3. **Convex read bridge** (`src/lib/api/convex-reads.ts`). The app's index pages and
   real-time surfaces read Convex directly (`useAuthedQuery(api.kits.list, {orgId})`),
   so 29 reads have no server action behind them — the collaboration surface, the kits
   list, dashboard/warehouse bundles, per-entity typeahead search. These are declared
   and dispatched as first-class operations.

### Scope enforcement rides the real code path

`requirePermission` enforces the key's scopes (not just the acting user's RBAC) whenever
`actorType === "apiKey"`. So an action guarding itself with
`requirePermission("project", "delete")` demands `project:delete` **even if the registry
described it wrongly**. Registry metadata drives discovery and docs; it is not the
security boundary.

### Confirmation rails

`isGuardedWrite` (`src/lib/api/dispatch.ts`) refuses to run without `confirm: true` **and**
an `idempotencyKey` for:
- **dangerous** operations — `delete*`/`remove*`/`archive*`/`revoke*`/… plus the
  `api-keys`, `custom-roles`, `org-members`, `sso`, `settings` modules (97 total), and
- **availability-affecting** writes — line-item adds, warehouse check-out/check-in.

Everything else commits directly. `CONFIRMATION_REQUIRED` (428) points stock-affecting
callers at `reserve_items`, which offers a true preview.

### Generated parameter schemas (the discoverability fix)

`scripts/generate-api-registry.ts` resolves each named parameter type back to the Zod
schema that declares it (`export type ClientFormValues = z.input<typeof clientSchema>` in
`src/lib/validations/*.ts`), then converts it with Zod 4's native `z.toJSONSchema` into
JSON Schema draft 2020-12. Prisma enums fall back to `{ type: "string", enum: [...] }`.

Result: **52 of 57 named types resolved**; the 5 misses are plain TS interfaces with no
Zod behind them (`ActivityLogFilters`, `ReportFilters`, `WooOrder`, …) and the generator
prints them rather than hiding them. Emitted as `PARAM_SCHEMAS`, keyed by type text.

Three consumers, one source, so they cannot drift:
- `describe_operation` returns `schema` per parameter.
- Curated MCP tools splice the real schema into their `inputSchema`
  (`enrichWithGeneratedSchemas`), replacing hand-written prose placeholders.
- `GET /api/v1/openapi.json` builds every `requestBody` from it.

Why it mattered: 93 of 508 operations took a parameter typed as a bare name like
`ClientFormValues`. An agent saw a type name and nothing else, so it could not construct
the object — it could only guess. Reads were discoverable; **writes mostly were not**.

### Project dates

`src/lib/project-dates.ts` resolves the six nullable date fields into one
`primaryDateRange = { start, end, source }`, attached to `getProjects` and `getProject`.
Precedence is by start date: `event` → `rental` → `load`, with the end taken from the
**same** pair so a range never straddles two meanings. `source: "none"` for undated
projects; single-day jobs report `end === start`.

This is the human answer. Availability and overbooking still run on
`rentalStartDate`/`rentalEndDate` (`overbooking-core.ts:104`) — documented loudly in
`llms.txt`, because conflating the two would silently corrupt inventory reasoning.

### Idempotency semantics

The `ApiIdempotency` ledger is keyed `(apiKeyId, key)`. Three properties, each learned
from a review finding:

- **Reserved before the effect.** A row is inserted with a `PENDING` sentinel *before*
  the handler runs. Recording only afterwards meant a crash (or an unserializable
  result) in between left no row, so the retry re-applied a stock-moving write.
- **The verb is checked.** A key reused for a different operation is a
  `VALIDATION_ERROR`. Before this, it returned the first operation's stored result and
  the second operation silently never ran.
- **Failures replay as failures.** A handler that throws does not free the key — a
  guarded write can mutate before it throws (`addLineItem` writes, then reads back), so
  "it threw" never proves nothing applied. The error is recorded and replayed; a genuine
  retry needs a fresh key. An interrupted call yields `IDEMPOTENCY_IN_PROGRESS`, which is
  deliberately terminal for that key rather than risk a double-apply.

### The SERVICE-token boundary

`getConvexClient()` attaches a process-global SERVICE token, and Convex's `requireOrgRead`
short-circuits to *allow* for service callers (`convex/lib/auth.ts:103`). Bridged Convex reads
therefore carry no authorization of their own. Two rules make that safe, both enforced in
`runConvexRead`: `orgId` is injected from the authenticated actor, and a **caller-supplied
`orgId` is a hard `VALIDATION_ERROR`**. RBAC runs in Node (`authorizeApiOperation`) before
Convex is touched.

**Injecting `orgId` is necessary but not sufficient.** `requireOrgRead(ctx, orgId)` proves the
*caller* belongs to `orgId`; it says nothing about whether a caller-supplied `projectId` does.
Three Convex queries took a bare `projectId` and returned rows with no org filter, so a foreign
id leaked another org's data: `projectLineItems.listByProject`, `projectGroups.listByProject`,
and `equipmentTab.bundle`'s four `by_projectId` reads. All three now filter rows by
`organizationId`. That closed the hole on the UI's user-token path too — the ownership of the
*id* was never checked on either path.

**Rule for any new bridged read:** if it accepts an id the caller supplies, the Convex handler
must either scope its index by `orgId` or filter returned rows by `organizationId`. The sibling
bundles (`projectDetail`, `warehouseDetail`, `kitDetail`, `assetDetail`) load the parent doc and
return `null` on mismatch — copy that.

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

Every call — REST and MCP alike — funnels through `invokeOperation`
(`src/lib/api/dispatch.ts`). Neither adapter imports `src/server` directly, so there is
one authorization site, one arg-mapping site, one idempotency site.

- **REST** (`src/app/api/v1/`): `GET /whoami`, `GET /operations` (discovery, filtered to
  the key's scopes), `GET /operations/{name}` (call signature), `POST /ops/{name}`
  (invoke anything), `POST /reserve-items`, `GET /` (unauth index).
  `Authorization: Bearer <key>`. Errors use one agent-native envelope
  (`src/lib/api/http.ts` `toErrorEnvelope`): stable `code`, `retryable`, `requiredScope`,
  typed `details`; unknown errors become an opaque 500. All v1 routes pin
  `runtime = "nodejs"` (AsyncLocalStorage).
- **MCP** (`POST /api/v1/mcp`, `src/lib/api/mcp.ts`): JSON-RPC 2.0 Streamable HTTP —
  `initialize`, `tools/list`, `tools/call`. **27 tools**, deliberately two-tier:
  - ~22 **curated named tools** (`src/lib/api/mcp-tools.ts`) for the common flows —
    `list_projects`, `get_project`, `search_assets`, `check_availability`,
    `global_search`, … Each is a thin alias over a registry operation, with `argMap`
    renaming agent-friendly argument names onto the action's real parameters. An
    import-time assertion fails the build if a curated tool targets an operation or
    parameter that doesn't exist.
  - `list_operations` / `describe_operation` / `call_operation` reach the remaining
    ~510. Publishing all 537 as tools would swamp an agent's context and wreck tool
    selection; a test bounds the list at 40.

  Tool descriptions are prompt-shaped (prerequisites, effect, preview behaviour,
  required scope, idempotency). Failures return a structured `isError` result.

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

## OpenAPI

`GET /api/v1/openapi.json` (unauthenticated) serves an OpenAPI **3.1** document built from
`ALL_OPERATIONS`, cached per process. 3.1 specifically, because its schema objects are
JSON Schema 2020-12 — the same dialect `PARAM_SCHEMAS` and MCP `inputSchema` already speak,
so one generator feeds all three. Under 3.0 you would be converting between near-miss
dialects forever.

Carries `x-required-scope`, `x-kind` and `x-dangerous` per operation, and marks
`confirm` + `idempotencyKey` as required on guarded writes. Shared responses are `$ref`-ed
into `components/responses` — inlining them across 540 paths made the document 1.5 MB;
it is now ~740 KB, and a test enforces the ceiling.

**Not the agent path.** It describes every operation and is large. Agents use
`GET /api/v1/operations` (scope-filtered, paginated) + `describe_operation`. OpenAPI exists
for humans, SDK generation, and request-validation tooling. Swagger UI is deliberately not
served — the primary consumer is an agent, and agents read `llms.txt` and tool schemas.

## MCP staleness

`initialize` advertises `capabilities.tools.listChanged: true`. MCP clients fetch
`tools/list` once and cache it, and this transport is request/response, so the server
cannot push an update — a client that connected before a deploy keeps serving the old list
until it reconnects. That is exactly how a real agent ended up seeing only the two tools
that predated the coverage work. The capability makes the staleness detectable; reconnecting
is the fix, and `llms.txt` says so.

## Excluded from the API

Not reachable by any key, by design:

- `site-admin` — cross-org platform admin, guarded by `admin-auth`, not org RBAC.
- `invitations`, `user-profile` — read the Better Auth session directly; cannot run headless.
- `public-org` — deliberately unauthenticated.
- `notification-email-sender`, `csv`, `split-sibling-collapse` — internal helpers.
- `dashboardLists.home` / `.blocking` — require a user token; the service token is rejected.

API-key management (`api-keys.*`) **is** exposed but every operation is `dangerous`, so it
needs `orgSettings:update` scope plus `confirm` + `idempotencyKey`. Do not put that scope on
an agent's key unless you intend it to mint credentials.

**No privilege escalation through minting.** `assertScopesWithinActor` (`src/lib/api-key.ts`)
rejects any `createApiKey` whose requested scopes exceed the *creating key's own* scopes —
so a key holding only `orgSettings:update` cannot mint itself a `*` key and escape the limits
its operator set. `*` is grantable only by a `*` holder; `asset:*` only by `*` or `asset:*`.
Human sessions are exempt: the acting user's role is already the intended authority.

## Testing

~106 unit tests across `src/lib/api/*` and `src/lib/request-actor.test.ts`, covering the
ambient actor (propagation, concurrent isolation, session fallback), scope ∩ RBAC,
arg mapping, confirmation + idempotency rails, the Convex bridge's org-injection rule, and
MCP protocol/dispatch.

Verified end-to-end (2026-07-09) against the shared dev DB + dev Convex: MCP `list_projects`
returns real projects; a `clients.createClient` write commits and its retry replays
(`replayed: true`); a narrow key gets `MISSING_SCOPE` on `client:create` while still reading
projects; `projects.deleteProject` returns `CONFIRMATION_REQUIRED` then
`IDEMPOTENCY_KEY_REQUIRED`; a caller-supplied `orgId` is rejected; an argument typo is
rejected rather than dropped.

## Known limitations / remaining work

- **Availability TOCTOU**: the availability check and the write are not one atomic
  transaction (the overbooking math lives in `src/lib/overbooking-core.ts` and can't yet run
  inside a Convex mutation) — the same window the UI has today. The hardening is the
  availability-atomic Convex reserve mutation (relocate the core into `convex/lib` with a
  parity test first).
- **Reservation state**: lands as a normal (QUOTED) line; a first-class `DRAFT`/hold status
  + `reservationExpiresAt` TTL + `createdByApiKeyId` provenance are the next schema step.
- **Registry drift is not CI-enforced**: `npm run api:registry` is manual. Adding a server
  action does not expose it until someone regenerates. A CI check that regenerates and
  fails on a diff would close this.
- **Result size is unbounded**: a broad read (e.g. `projects.getProjects` with no filter)
  returns the full payload; there is no API-level truncation for agent context limits.
- **Not yet built**: asset-specific holds, "Connect an AI Agent" onboarding, webhooks,
  per-key rate limits, read-scope-by-sensitivity tiers.
