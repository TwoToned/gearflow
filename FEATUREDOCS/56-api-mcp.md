# 56 — Agent-Accessible API + MCP

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-29 (review quarterly — POLICY.md R-5.5)_

> **STATUS 2026-07-29 — reinstatement complete. Phases 0-8 have landed (#996,
> #997, #998, #999, #1000, #1001, #1002, #1003, #1004): there is now a real,
> curl-verifiable HTTP API — `POST /api/v1/ops/{operation}` (the universal
> dispatcher), `GET /api/v1/operations{,/[operation]}`, `GET
> /api/v1/whoami`, `GET /api/v1/openapi.json`, `GET /llms.txt`, a handful
> of curated REST aliases (`/api/v1/{projects,assets,clients}[/{id}]`,
> `POST /api/v1/projects/{id}/line-items`) — **and a streamable HTTP MCP
> server at `/api/v1/mcp`**, over the same bearer keys and the same
> dispatcher: 21 curated tools + `list_operations`/`describe_operation`/
> `call_operation` discovery + `llms.txt`/OpenAPI resources + 3 prompt
> templates, plus a local stdio↔HTTP proxy for clients that don't speak
> remote MCP yet. The Phase-0 throwaway prover (`POST
> /api/v1/probe/line-items`) is gone — Phase 2 replaced it wholesale.
> **Phase 4 (#1000) added the safety rails that gate writes going wide:**
> every agent-reachable mutation now carries a `danger: "low"|"medium"|"high"`
> classification (a colocated `agentOps` export per module), `danger:"high"`
> requires `confirm: true` at the dispatcher, the §6 privileged-argument table
> is now enforced end to end (`project:unlock_session` denied by default,
> `emitSideEffects` re-asserted in Convex), the `noFinancials` key flag
> extends to models/crew-assignment cost fields (on top of Phase 6's
> `projectCosts.operationalCosts` groundwork), the activity log has an
> agent-authored badge/filter, and `revertAgentWindow` gives an operator a
> real (scoped) tool to reverse a bad agent warehouse run.
> **Phase 5 (#1001) closed almost all of the remaining read-guard gap** —
> agent-reachable operations went from 331 to 549 (284 queries + 265
> mutations), and the resource-less `requireOrgRead`/`requireOrgReadDoc`
> guard now has exactly ONE remaining call site in the whole app
> (`globalSearch.search`, deliberately denied — see below). Phase 5 also
> landed the `agentOps` annotation FORMAT (`convex/lib/agentOps.ts`) that
> Phase 4's `danger` classification populates.
> **Phase 6 (#1002) has also landed** — `/settings/api-keys` (key
> management, scope presets, rotation, the org kill switch, the per-key
> request log, and a "Connect an AI Agent" one-screen MCP flow), landed
> ahead of Phase 4 in numeric order at the tracking issue's request.
> **Phase 7 (#1003) has landed** — MCP OAuth 2.1: authorization-server +
> protected-resource metadata (`/.well-known/oauth-*`), RFC 7591 dynamic
> client registration (`POST /api/v1/oauth/register`), a session-gated
> consent screen (`/oauth/authorize`) that narrows requested scopes to the
> consenting user's LIVE RBAC, a token endpoint (`POST /api/v1/oauth/token`)
> for the `authorization_code`+PKCE and `refresh_token` grants, and RFC 7009
> revocation (`POST /api/v1/oauth/revoke`). An OAuth grant is a plain
> `apiKeys` row (`origin: "oauth"`) — a pure auth adapter in front of the
> Phase 3 dispatcher exactly as designed, so every gate (RBAC, scopes,
> lifecycle locks, kill switch, `no_financials`, the request log,
> `revertAgentWindow`) applies unchanged. This is the phase that unlocks
> claude.ai + desktop connectors for non-technical staff — no admin
> involvement, no pasted bearer header.
> **Phase 8 (#1004) has also landed** — polish + external readiness, not new
> architecture: (1) four `api.*` webhook lifecycle events —
> `api_key.created`, `api_key.revoked`, `api.rate_limited`,
> `api.kill_switch_toggled` (`src/lib/webhooks/events.ts`, wired from
> `src/server/api-keys.ts` + `src/lib/api/dispatcher.ts`); (2) stability
> tiers HARDENED, not just declared — every `RegistryOperation` now carries
> `stability: "stable" | "tracks-app"` (`scripts/generate-api-registry.mts`,
> derived from the SAME curated-tool-defs table the MCP manifest already
> used), surfaced in the OpenAPI description, and a new CI gate
> (`checkStableContractRegression`, backed by the committed, ratcheting
> `src/lib/api/stable-contract.generated.ts`) fails the build if a stable
> operation loses a field, disappears, or gets silently demoted — proved by
> a deliberate-violation test the same way every other registry gate is
> (`src/lib/api/registry.test.ts` gate 6); every success envelope also now
> carries an in-band `warnings: string[]` (empty today — the channel exists
> before anything needs it); (3) an interim API docs page at `/docs/api`
> (public, `#959`'s Docusaurus site doesn't exist yet — move this content
> there wholesale once it does) with SDK snippets (curl/TypeScript/Python)
> DERIVED from the registry at render time (`src/lib/api/sdk-snippets.ts`),
> never hand-written; (4) **Mira wired as the first first-party MCP
> consumer** — see [FEATUREDOCS/68](./68-mira-assistant.md) for the full
> design (per-user key provisioning, the deterministic question router, page
> context). Third-party developer access (OAuth apps for other orgs, a
> marketplace) remains explicitly out of scope (decision 5) until its own
> program.**
> **Agent document access added 2026-07-30** — `GET
> /api/v1/documents/{projectId}` + a 21st curated MCP tool,
> `get_project_document`: an agent can now fetch any of the 5 project PDFs
> (delivery docket, pick slip, return sheet, quote, invoice) it could already
> see the DATA for. See "Agent document access" below and
> [13-pdfs.md](./13-pdfs.md).

> **⚠️ Removed 2026-07-14 (the state phases 0-1 are building out of).** The entire agent-API
> request surface was deleted during the Convex-native migration:
> `src/lib/api/*` (operations registry, dispatch, MCP, OpenAPI, tool aliases,
> the Convex-reads bridge, reserve-items), the `/api/v1/*` routes,
> `public/llms.txt`, the `scripts/generate-api-registry.ts` generator, and the
> `/settings/api-keys` UI. The generated registry dynamically imported and
> invoked every `src/server/*.ts` action, which coupled the API contract to
> the server-action data layer and blocked the Convex-native server-action
> deletions. **The `ApiKey` backend is kept dormant** (Prisma model + Convex
> table both exist — see FEATUREDOCS/03) so reinstating is cheap.

## Reinstatement blueprint

**Plan of record (2026-07-28):**
[`docs/designs/api-mcp-reimplementation.md`](../docs/designs/api-mcp-reimplementation.md).
Read that first — it supersedes the archived design's *architecture* while keeping its
safety findings.

The headline change: rebuild over the **native Convex surface** (the 223 `*Native`
mutations + the org-guarded queries), driven by a short-lived **AGENT token** —
`sub = actingUserId`, `orgId`, a new `akid` claim, no `svc` — rather than the SERVICE
token. Because the Convex-native migration moved every gate *inside* the mutation
(`requireOrgPermission`, `resolveActor`, `assertWritesEnabled`,
`enforceBrowserWriteLimit`, `assertLifecycleGuard`, the in-mutation availability check,
`assertNoBlockingCommentsInMutation`, `fieldGuards`/`moneyGuards`, in-transaction
`writeActivityLog`), an agent token inherits all of them with zero per-operation
security code — and `requireService()`-gated generated CRUD becomes **unreachable by
construction** (597 of 1,109 public functions), which is the invariant the old design
could only ask developers to remember.

The archived design remains the reference for the hard-won review findings — org-scoping
holes in bridged reads, no-privilege-escalation-through-minting, MCP tool-list staleness,
preview→confirm token binding:
[`docs/designs/archive/api-mcp-agent-access.md`](../docs/designs/archive/api-mcp-agent-access.md).
Don't rediscover those the hard way twice.

## What exists today (phases 0-2, landed 2026-07-28)

Everything below is built, tested and CI-gated.

### The agent identity (`convex/lib/auth.ts`)

`getAuthContext` resolves a third kind, `agent`, from an `akid` claim naming an
`apiKeys` row. It behaves as `user` everywhere — same member-row RBAC, same
`resolveActor` subject pinning, same kill switch — and additionally:

- **fails `requireService`**, which is what makes the 602 service-gated functions
  (raw generated CRUD, mirrors, backfills, org-export internals) structurally
  unaddressable. `convex/agentServiceUnreachable.test.ts` invokes **all 602** with
  an owner-backed wildcard key and asserts every one rejects;
- passes through **`requireAgentScope`**, which re-reads the key document inside
  the transaction — so revoke, expiry, deactivation and re-pointing land on the
  next call regardless of the token's 60s TTL;
- gets its **own rate-limit buckets** (`agentRead`/`agentWrite`) keyed on
  `apiKeyId`, not the token subject, so a looping agent cannot starve the human it
  acts as out of their own UI;
- gets a **bulk cap of 50** against the human 500;
- has `apiKeyId` + `actorType` stamped into every audit row it causes, from the
  verified token, inside `writeActivityLog` — so all ~272 write paths gained it at
  once and a bad agent run is filterable and bulk-revertible.

A token bearing `svc` alongside `akid` is rejected outright, not downgraded.

### Scopes (`convex/lib/scopes.ts`)

`resource:action` over the existing RBAC vocabulary — no parallel vocabulary —
plus `self:read`/`self:write` for the personal-scope surfaces (saved views,
notification preferences, dismissals). The grant algebra is isomorphic and shared
with `src/lib/api-key.ts`: the Convex copy is the load-bearing one, because it
runs in-transaction and cannot be dodged by calling Convex directly.

**Reads fail closed.** `requireOrgRead`/`requireOrgReadDoc` carry no resource, so
they reject agents outright rather than admit them unscoped (decision 2). Phase 2
(#998) migrated a ~45-query **read bootstrap** to `requireOrgReadFor`/
`requireOrgReadDocFor` — assets, models, categories, projects, line items,
groups, availability, overbookings, clients, crew + assignments, warehouse
status, maintenance, kits, bulk assets — chosen to fully back the curated MCP
tool set Phase 3 built. **Phase 5 (#1001) finished the migration**: all ~170
remaining bare call sites across 56 modules moved to `requireOrgReadFor`/
`requireOrgReadDocFor`, one domain at a time (assets/kits, models,
projects+collaboration+dashboards, clients+crew,
warehouse+maintenance+test&tag, suppliers+sub-hires+finance,
settings+cross-cutting). Exactly one bare call site remains
(`globalSearch.search`), and it's a recorded decision, not an oversight — see
the triage section below.

### Contract registry (`scripts/generate-api-registry.mts`)

Imports every `convex/*.ts` module in-process and reads `exportArgs()` /
`exportReturns()`, so it needs **no deployment and no deploy key** and the gates
run on every PR. Guard classification is a static read, so agent-reachability and
the `(resource, action)` pair are *derived* from the guard the function calls —
the flag cannot drift, because changing it requires changing the guard.

Live numbers are in [`docs/api-coverage.md`](../docs/api-coverage.md), regenerated
on every PR. At the time of writing: 1,119 public operations, 549 agent-reachable
(284 queries + 265 mutations) — up from 331 pre-#1001 (67 queries + 264
mutations), the +218 (almost all queries) being Phase 5's coverage sweep. This
comfortably clears the original removed build's "537 operations" parity bar
(design §4) — the number the tracking issue (#995) was watching for.

Also new in Phase 5: the `agentOps` colocated annotation format
(`convex/lib/agentOps.ts`) — `{ summary, danger, mcpTier, agentAccess,
reason }` per exported function, read by the generator and merged into
`RegistryOperation`. `agentAccess: "denied"` records a DELIBERATE decision to
keep an otherwise-classifiable operation closed (the guard itself still
enforces the denial — this is metadata about WHY, not a second gate); the
generator fails the build on a denied entry with no reason, or one that
contradicts an agent-admitting guard. `docs/api-coverage.md` prints every
denied operation with its reason in a dedicated table.

Four CI gates, each proved to fail on a deliberately-introduced violation in
`src/lib/api/registry.test.ts`:

| # | Gate | Fails when |
|---|---|---|
| 1 | Privileged-arg policy | a new arg matching `/^(allow\|force\|skip\|override\|ignore\|bypass)/` or named `justification` appears with no row in `src/lib/api/privileged-args.ts` |
| 2 | Staleness | the committed registry or coverage table is out of date |
| 3 | Reachability floor | the agent-reachable count drops below the committed floor |
| 4 | Runtime probe | the statically-extracted scope isn't the one the guard enforces |

### Idempotency + errors

`apiIdempotency` (claim → run → complete, with `release` for calls that failed
before producing an effect) dedupes replays, but the real double-write defence is
**deterministic id derivation** from `(idempotencyKey, operation)` — proved by a
test that kills the ledger mid-flight and shows the retry still writes exactly one
row. The error envelope maps the `ConvexError` codes the guards already throw;
`MISSING_SCOPE` stays distinct from `FORBIDDEN`, because they lead to different
recoveries and only one of them is the operator's to fix.

## What Phase 2 built (#998)

**The universal dispatcher** (`src/lib/api/dispatcher.ts`, `POST
/api/v1/ops/{operation}`) — one route, closed by default: an operation absent
from the registry OR not `agentReachable` is a 404, never a 403 (a SERVICE-only
op does not "exist" for a key). Per call: bearer key → agent token
(agent-auth.ts, unchanged since Phase 0) → registry lookup → rate limit (a read
spends one `agentRead` token via a service-authenticated mutation, since a
Convex query can't self-limit; a write's `agentWrite` token is spent inside the
transaction, unchanged) → business-field validation → arg normalization →
idempotency claim/run/complete around a write → the Convex call, under the
freshly-minted agent token → error mapping + the per-key request log, always.
Authorization is deliberately not a step here — every gate lives inside the
Convex transaction; the dispatcher cannot grant what Convex would refuse.

**The arg normalizer** (`src/lib/api/arg-normalizer.ts`) — the 7-rule table
from the design doc, plus the one thing it left implicit: `auditId` is always
server-minted, but a bare `id` is only minted on a CREATE-shaped mutation
(`create*`/`add*`) — everywhere else it names an EXISTING row the caller is
pointing at, so overwriting it would silently target (or fail to find) the
wrong row.

**Validation parity** (`src/lib/validations/registry.ts`) — the Zod↔Convex
pairing table promoted out of `convex/validationDrift.test.ts`
(R-3.1), plus a best-effort `OPERATION_VALIDATION_PAIR` map from `<module>.<fn>`
to a pair, so the dispatcher can run the SAME schema the UI hooks run before
the Convex call. Not exhaustive — an operation absent from the map falls back
to the in-Convex `fieldGuards`/`moneyGuards` backstop, same enforcement, a
less specific message.

**The per-key request log** (`convex/apiRequestLog.ts`, `apiRequestLog`
table) — every dispatcher call, success or error, PII-redacted
(`src/lib/api/request-log-redact.ts`, R-8.12.4) before it's stored. 30-day
retention (T-P2), aged out by the daily `api-request-log-retention` cron.

**OpenAPI 3.1 + llms.txt** (`scripts/generate-api-docs.mts`) — generated from
the SAME registry the operation dispatcher reads, so they can't drift from
what `/ops/{operation}` actually does. `GET /api/v1/openapi.json` is the one
deliberately UNAUTHENTICATED `/api/v1` route (it's a schema, not org data);
`GET /llms.txt` is a static `public/llms.txt` file, not a route. Both
staleness-gated in CI (`pnpm run api:docs:check`), right after the registry
gate.

**Curated REST aliases** (`src/lib/api/alias.ts`) — `GET
/api/v1/{projects,assets,clients}`, `GET .../{id}`, `POST
/api/v1/projects/{id}/line-items`. Each is a few lines that name an operation
and merge the path param into `args`, then call the SAME `dispatch()` the
generic route uses — REST and the dispatcher cannot drift because one calls
the other. Not a generator: an alias is a hand-picked ergonomic shortcut,
`/ops/{operation}` already covers every agent-reachable operation.

**`GET /api/v1/whoami`** — org, acting user, LIVE effective permissions
(re-read from the `members` mirror every call, never the token's cached role
claim — a demotion lands on the next request), scopes, and rate/bulk limits.

## What Phase 0 proved (#996)

`convex/agentVertical.test.ts` — all eight assertions green, each paired with the
browser doing the same thing and *not* being blocked, so no assertion can pass
because the operation is broken for everyone:

1. concurrent adds for the last free unit — exactly one succeeds
2. `allowOverbook: true` needs `project:allow_overbook` on top of the RBAC
3. a money-field write on a `CONFIRMED` project fails `FINANCIALS_LOCKED`
4. a structural write on `ON_SITE` fails `JUSTIFICATION_REQUIRED`
5. the in-mutation audit row carries `apiKeyId` + `actorType`
6. **`projectLineItems.create` is rejected** — the load-bearing one
7. cross-org `organizationId` *and* cross-org `projectId` both rejected
8. the live key row is re-checked in-transaction (revoked/expired/re-pointed)

## What Phase 3 built (#999)

**`/api/v1/mcp`** (`src/app/api/v1/mcp/route.ts`) — streamable HTTP MCP, `runtime =
"nodejs"`, bearer-gated exactly like every other `/api/v1` route. Stateless by
design: a fresh MCP `Server` + `WebStandardStreamableHTTPServerTransport` is
built per HTTP request (`sessionIdGenerator: undefined`, `enableJsonResponse:
true`) rather than held across a session — there's no per-connection state to
lose, because `dispatch()` already re-authenticates the bearer token on every
call. Bearer auth is resolved once up front to reject an unauthenticated
connection before the MCP transport is touched at all, and to answer `whoami`
without a redundant `dispatch()` round-trip; every other tool call still
re-validates the token itself inside `dispatch()` — nothing here is trusted to
have checked a gate, same posture as the REST dispatcher.

**Three tiers**, matching design §12:

1. **21 curated tools** (`rvlt_flow.v1.*` namespace) — 19 named `verb_object`
   tools that each 1:1 wrap one registry operation (`search_assets`,
   `get_asset`, `check_availability`, `list_projects`, `get_project`,
   `create_project`, `add_line_items`, `reserve_items`, `release_items`,
   `swap_asset`, `stage_pick_list`, `dispatch_gear`, `receive_gear`,
   `list_crew`, `assign_crew`, `get_warehouse_status`, `create_maintenance`,
   `list_overbookings`, `get_project_financials`), plus two with no
   underlying registry operation, handled specially in `build-server.ts`'s
   `SPECIAL_TOOL_HANDLERS`: `whoami` (answered directly from the
   pre-resolved agent context, `src/lib/api/whoami.ts`, shared with `GET
   /api/v1/whoami`) and `get_project_document` (added 2026-07-30 — fetches
   one of a project's 5 PDFs; can't be a registry operation because PDF
   rendering needs Node+Prisma, which the Convex-only dispatcher can never
   reach, `src/lib/api/documents.ts`, shared with `GET
   /api/v1/documents/{projectId}`). Its result is JSON like every other
   tool — a short-lived download URL + metadata (`resolveProjectDocumentUrl`),
   not the PDF bytes inline. A same-day version that embedded the PDF as a
   base64 MCP `resource` content block broke in real client use (some layer
   in the actual relay path stripped fields it didn't recognise, failing
   client-side schema validation) and was replaced with the URL-returning
   approach before this doc's review date. See
   [13-pdfs.md](./13-pdfs.md)'s "Agent-facing document access" section for
   the doc-type/permission table and the incident detail.
2. **Discovery + generic dispatch** — `list_operations`/`describe_operation`
   (shared with the REST `/api/v1/operations{,/[operation]}` routes via
   `src/lib/api/operations-listing.ts`) and `call_operation` (a thin pass-through
   to `dispatch()`), covering the full ~330-operation agent-reachable surface
   without a tool-list explosion.
3. **Resources + prompts** — `llms.txt` and the OpenAPI document as MCP
   resources (`src/lib/api/mcp/resources.ts`, same generated constants the REST
   routes serve), and 3 hand-authored prompt templates
   (`src/lib/api/mcp/prompts.ts`): `weekly_availability_sweep`,
   `prep_sheet_review`, `overbooking_triage`.

**The tool manifest is generated, never hand-maintained**
(`scripts/generate-mcp-manifest.mts` → `src/lib/api/mcp-manifest.generated.ts`,
`pnpm run api:mcp` / `api:mcp:check`, CI-gated in `ci.yml` right after the
OpenAPI staleness gate). It combines the already-generated `API_REGISTRY` with
one hand-authored table, `src/lib/api/mcp/curated-tool-defs.ts` — the ONLY
editorial layer, analogous to `alias.ts`'s curated REST aliases: it names
which operation each curated tool wraps and supplies the human-facing
prose (summary/prerequisites/transition). Everything else — the JSON Schema
`inputSchema` (`src/lib/api/json-schema.ts`, shared with the OpenAPI
generator so REST and MCP schemas can't drift from each other), the required
scope, the idempotency requirement, the error-code pointer — is derived. A
curated tool whose target operation disappears or loses agent-reachability
fails generation loudly rather than silently publishing a broken tool. This is
the explicit fix for the previous build's "MCP tool-list staleness" finding.

Design §7 describes a future `agentOps` annotation colocated in each
`convex/*.ts` module (`summary`/`danger`/`mcpTier`) as the eventual home for
curated-tool metadata. **Phase 5 (#1001) landed the format**
(`convex/lib/agentOps.ts`) and populated it across every migrated/widened
operation, but `curated-tool-defs.ts`'s `summary`/`prerequisites`/`transition`
have NOT yet been migrated to read from it (R-3.1 — this is a known,
still-open duplication, not an oversight). Phase 4's `danger` classification
now HAS a real consumer (the dispatcher's confirmation gate), which makes the
duplication more worth closing, not less — do it in a follow-up rather than
letting both linger indefinitely.

**Versioning** (`src/lib/api/version.ts`) — `rvlt_flow.v1.*` MCP tool
namespace, an `X-RVLT-Flow-API-Version` response header (now applied to every
`/api/v1` REST response too, not just MCP, since design §13 calls it a "day
one" mechanic and Phase 2 had not yet added it), and the `warnings[]` in-band
channel is documented but currently empty — no operation is deprecated yet, so
there's nothing for it to carry. Compatibility tiers: the 21 curated tools +
discovery are `stability: "stable"` (additive-only within `/v1`);
`call_operation` is `stability: "tracks-app"` (follows the app's internals
directly, per decision 12).

**Local stdio proxy** (decision 4, `scripts/mcp-stdio-proxy.mts`, `pnpm run
mcp:stdio-proxy`) — relays raw JSON-RPC messages between a local stdio MCP
client and `/api/v1/mcp` by wiring the SDK's `StdioServerTransport` directly to
`StreamableHTTPClientTransport` (no re-implementation, no re-validation — a
pipe, not a second server). Runs today via `pnpm exec tsx
scripts/mcp-stdio-proxy.mts --url <url> --key <key>` for anyone with the repo
checked out; publishing it as a standalone package for zero-install use (never
`npm`/`npx` — see the pnpm-only note above) is Phase 8 (#1004). Until then, a
maintained third-party stdio↔HTTP MCP proxy (`pnpm dlx mcp-remote <url>
--header "Authorization:Bearer <key>"`) is the zero-install equivalent for
anyone without this repo checked out.

**Write posture unchanged from REST.** Phase 3 added no new write capability —
every curated write tool (`create_project`, `add_line_items`, `dispatch_gear`,
…) is the identical `dispatch()` call the REST alias/`ops` routes already
made, gated by the same scopes. "Agent write scopes stay off in every preset"
(the issue's write-posture note) is a Phase 6 (key-management UX / presets)
concern — no presets exist yet, so a key's effective write access today is
exactly whatever scopes it was hand-minted with, same as before this phase.

**Rate limits kept at the Phase 1 proposal** (`agentRead` 600/min burst 200,
`agentWrite` 60/min burst 20, `convex/lib/rateLimits.ts`) — unchanged by this
phase. A real MCP session's call volume (a "curated tool per turn" pattern
rather than REST's "however many calls a script makes") reads comfortably
under both buckets in manual testing; recalibrating from *measured* production
volume instead of a session-count estimate is left to whichever phase first
has real usage data to point at, per design §16.

## What Phase 4 built (#1000)

**Danger classification, generated and CI-gated** (`convex/lib/agentOps.ts` +
`scripts/generate-api-registry.mts` gate 5) — every agent-reachable mutation
carries a `low`/`medium`/`high` `danger` in a colocated `agentOps` export next
to the mutation itself (e.g. `convex/lineItemWrites.ts`'s `export const
agentOps: AgentOpsAnnotations = { removeNative: { danger: "high" }, … }`), the
same "colocated, generated, build fails if missing" posture as the
privileged-arg policy table. All 264 agent-reachable mutations across 51
modules are classified: 86 `high`, 141 `medium`, 37 `low` (`docs/api-coverage.md`).
`RegistryOperation.danger` is published in the registry so the dispatcher, the
OpenAPI/MCP-manifest generators, and any future consumer read the SAME
classification.

**The confirmation gate** (`src/lib/api/dispatcher.ts`) — a mutation whose
EFFECTIVE danger is `"high"` — its own classification, OR escalated because it
supplies a privileged arg whose own policy `danger` is `"high"` (e.g. a
non-empty `justification`, per `src/lib/api/privileged-args.ts`) — must carry
`confirm: true` in the same call or it fails `CONFIRMATION_REQUIRED` with a
rendered summary of the operation, resource/action, and which privileged args
triggered it, before Convex is ever touched. `idempotencyKey` is already
mandatory for every mutation (Phase 2), which is the other half of "confirm +
idempotency" the design asks for. No preview→commit token (decision 11) — the
identical call, re-sent with `confirm: true`, is the only recovery path.

**Privileged-argument enforcement completed** (`convex/lib/agentArgs.ts`):
- `emitSideEffects` — the dispatcher already forced this `true`; Convex now
  ALSO asserts it for an agent token calling Convex directly
  (`assertEmitSideEffectsAgentTrue`), the same "force in Node AND assert in
  Convex" redundancy `allowOverbook` already had.
- `projectUnlockSessionsWrites.openNative` — the one true HARD_LOCKED /
  FINANCE_LOCKED escape hatch is now `agentAccess:"denied"` by default: an
  agent needs the explicit `project:unlock_session` scope (granted in no
  preset), checked unconditionally regardless of which scope (`FINANCIAL`/
  `FULL`) it's opening.
- `allowOverbook`, `justification`, `overrideReason`, `forceSeparate`,
  `allowOrgCreation` were already enforced correctly by Phases 0-1; unchanged.

**`no_financials` key flag extended** (`convex/schema.ts` `apiKeys.noFinancials`,
`convex/lib/auth.ts` `isAgentNoFinancials` — Phase 6 groundwork, wired into
`projectCosts.operationalCosts` there) — this phase extends the SAME flag to
two more independent reads, verifying the redaction field-by-field rather than
on one query alone: `models.{list,getById,detail}` strip
`replacementCost`/`defaultPurchasePrice` while leaving the model's own sell
rates (`dailyRate`/`weeklyRate`/`defaultRentalPrice`) visible — an agent still
needs those to quote/book; `crewAssignments.{list,getById,listByProject,
projectCrew}` strip `estimatedCost`/`rateOverride` plus the nested
`crewMember`/`crewRole` rate fields. Extending it across every remaining
financial field family (quotes, invoices) is left to a future slice.

**Agent-justified activity-log badge/filter** — `convex/activityLog.ts` gained
an `agentAuthored` filter arg (and the exported `isAgentAuthored` helper) over
the `metadata.actorType === "apiKey"` stamp Phase 3 already wrote on every
agent-caused row. The `/activity` page (`src/app/(app)/activity/page.tsx`)
gained an "Actor" column — an `Agent`/`Human` badge plus an enum filter — and
the CSV export carries the same filter, so agent-authored writes (especially
agent-supplied justifications) are reviewable as a set instead of buried in
per-row metadata.

**`revertAgentWindow`** (`convex/agentRevert.ts`) — enumerates one API key's
agent-authored activity-log rows in a `[fromMs, toMs]` window and reverses the
ones with a known inverse, via the SAME reverse-mutation core helpers a human
uses from the Warehouse tab: a deploy (`CHECK_OUT`) reverses through
`undeployItemsCore`/`undeployKitFull`, a return (`CHECK_IN`) through
`unreturnItemsCore`/`unreturnKitFull`. Denied by default for agents (a new
`warehouse:revert_agent_window` scope, granted in no preset — the same "no
legitimate agent use case" posture as `project:unlock_session`); an operator
needs ordinary `warehouse:check_in` RBAC plus that scope. **Scope stated
honestly**: only the physical-movement actions above have a mechanical
inverse — creates/updates/deletes/archives/force-returns in the window are
reported in `skipped` with a reason, not silently ignored, because there is no
generic "undo any write" primitive in this codebase to call. An operator still
gets the full agent-authored slice of the activity log (the badge/filter
above) to review and hand-fix anything `skipped` lists.

## What Phase 5 built (#1001)

**The coverage sweep** — one PR-worth of commits per domain (assets/kits,
models, projects-core, projects+collaboration+dashboards, clients+crew,
warehouse+maintenance+test&tag, suppliers+sub-hires+finance,
settings+cross-cutting), each doing the same four things per the tracking
issue's checklist: migrate the domain's remaining `requireOrgRead(Doc)` call
sites, triage its SERVICE-only queries into widen/sibling/deny, extend
`agentOps` annotations, and extend cross-tenant test coverage.

**Triage buckets applied, per design §4:**
- **Widen** — the majority: swap `requireService` for `requireOrgPermission`/
  `requireOrgReadFor` on a plain org-scoped read with no special sensitivity.
- **Deny** — recorded in `agentOps` with a reason. Two real classes emerged
  beyond the design doc's original list: (1) a query with **no `orgId`
  argument at all**, fetched by a global foreign-key index with no way to
  verify the caller's org against it without a parent-lookup redesign
  (`crewShifts`, `categorySlots`, several `*Media.listByParent`s — flagged
  for a future slice, not silently dropped); (2) a query whose raw row
  carries a live secret (`warehouseDashboardTokens`, `testTagAuditorTokens`'
  plaintext bearer tokens; `orgSettings.getByOrg`'s `icalToken`;
  `wooCommerceIntegrations`' `webhookSecret`) or PII beyond what redaction
  covers (`wooCommerceOrderLogs`' raw customer payload). The expected
  site-admin/platform-surface denials from the tracking issue (`orgExport`,
  `siteSettings`, `pendingSSOApprovals`, `projectNumberSequences`, `parity`,
  `apiKeys`) were applied as directed.
- **Sibling** — not needed this pass; every case that needed redaction
  already had a precedent to follow (`crewRoles.list` vs `listForSettings`)
  rather than a new sibling to write.

**Real pre-existing bugs found and fixed along the way** (not hypothetical —
each was live before this PR):
1. `projects.getByOrgAndNumber` had **no auth guard at all** — any
   authenticated identity could look up any org's project by number. Fixed
   with `requireOrgReadFor`.
2. `checkRecords.getById` and `serviceTemplates.getById` were on bare
   `requireService` with **no doc-level org check** even for the trusted
   path being widened — fixed by routing through `requireOrgReadDocFor`.
3. `crew.ts` (`myCrewMemberId`, the roster `isOwnProfile` flag),
   `dashboardLists.ts` (`home`, `blocking`), and `projectTasks.ts`
   (`myOpenTasks`) all gated a self-scoped read on `auth.kind !== "user"` /
   `=== "user"` — which silently excludes agent tokens even though an agent
   carries a real `userId` (the acting user). Per this repo's own convention
   (CLAUDE.md: "`auth.kind !== "user"` is now a bug in most places... use
   `isMemberAuth(auth)`"), these now use `isMemberAuth` so an agent gets the
   same answer a user would, not a wrong rejection or a silent `null`.

**Cross-tenant hardening** (R-8.4.3) — `convex/xtenantHardening.test.ts`
gained targeted regression coverage for the three bug fixes above (each
proven exploitable before the fix, via an inserted foreign-org row) plus the
`isMemberAuth` fix, following the file's existing "org A can't read org B's
row through a global index" pattern.

**What Phase 5 deliberately left alone:** mutations. The triage scope (per
the tracking issue) is SERVICE-only *queries*; no write's guard was widened,
so the reachable-mutations count barely moved (264 → 265 — one mutation,
`dashboardCounters.reconcileIfStale`, was on the resource-less
`requireOrgRead` rather than `requireService` and got the same one-argument
fix as the reads). The Zod validation registry (`src/lib/validations/registry.ts`)
therefore needed no new entries this phase — extending it is Phase 4/6
territory, once writes actually go wide.

## What Phase 7 built (#1003)

**Discovery metadata** — `GET /.well-known/oauth-authorization-server`
(`src/app/.well-known/oauth-authorization-server/route.ts`, RFC 8414) and
`GET /.well-known/oauth-protected-resource`
(`src/app/.well-known/oauth-protected-resource/route.ts`, RFC 9728, per the
MCP authorization spec) — both built from one shared source
(`src/lib/api/oauth/metadata.ts`) so the issuer/scope vocabulary can't
disagree between the two documents. Both are deliberately unauthenticated
(same posture as `GET /api/v1/openapi.json`) and public per
`src/middleware.ts`'s exemption list. `/api/v1/mcp`'s existing 401 response
now also carries a `WWW-Authenticate: Bearer resource_metadata="..."` header
(RFC 9728 §5.1) so an MCP OAuth client can discover the authorization server
without hardcoding anything — bearer-key clients (Phase 3) simply ignore it.

**Dynamic client registration** (RFC 7591) — `POST /api/v1/oauth/register`
(`src/lib/api/oauth/client-registration.ts`). No admin step: a client posts
its `redirect_uris` (must be `https://`, or a loopback URI for native/CLI
clients — `isAllowedRedirectUri`) and gets back a `client_id` (public clients)
or a `client_id`+`client_secret` (confidential clients requesting
`client_secret_basic`). Storage is a new Convex table, `oauthClients`
(`convex/oauthClients.ts`) — `requireService`-gated, `agentAccess: "denied"`
same posture as `apiKeys.list`.

**Consent screen** — `GET /oauth/authorize`
(`src/app/oauth/authorize/page.tsx` + `src/server/oauth-authorize.ts`). A
plain Next.js page route, deliberately outside the `/api/v1/*`/`.well-known`
bearer-exempt list, so `src/middleware.ts`'s existing session-cookie check
gates it for free — "gated on an existing Better Auth session" needed no new
auth logic. Requested scopes (the `scope` query param) are narrowed to the
consenting user's LIVE role via `narrowScopesToRole`
(`src/lib/api/oauth/rbac-scopes.ts`), which reads `permissionsCore`'s
`RESOURCES`/`rolePermissions` directly — the same table `hasPermission`
reads, so there is no parallel "what can a role grant" vocabulary to drift.
`describeScope` renders each narrowed scope in plain language
("View assets", "Manage line items on projects"). Approve/Deny are native
Next.js Server Actions bound to a plain `<form>` (`approveOauthAuthorization`/
`denyOauthAuthorization`) — NOT `useServerMutation`, because completing the
flow means a real top-level browser navigation back to the client's
(possibly cross-origin) `redirect_uri`, not a fetch. PKCE (S256) is required
on every request; `redirect_uri` is checked for an EXACT match against the
client's registered list before anything is trusted, including before
rendering an error (an unverified `redirect_uri` is never followed).

**CORS (fixed 2026-07-29)** — Phase 7 shipped OAuth discovery/registration/token
endpoints and `/api/v1/mcp` with no `Access-Control-*` headers anywhere in the
stack (`next.config.ts`'s global `headers()` doesn't set any either). Bearer-only
auth meant this was believed CSRF-safe by construction (no cookie path,
R-8.11.1), but it also meant a browser-based MCP client — including claude.ai's
own connector flow, the client `oauth-errors.ts` names as a target — could
complete the OAuth consent screen (a top-level navigation, unaffected by CORS)
and then have its `fetch()` calls to `/api/v1/mcp` and the OAuth endpoints
silently blocked by the browser's CORS preflight, surfacing as a generic
"couldn't connect to the server" with no server-side error to debug from. Fixed
by `src/lib/api/cors.ts` (`withCors`/`corsPreflight`, `Access-Control-Allow-Origin:
"*"`, no `Allow-Credentials`) wired into `/api/v1/mcp`, both `.well-known/oauth-*`
routes, and `/api/v1/oauth/{register,token,revoke}` — a wildcard origin doesn't
reintroduce the CSRF risk the bearer-only design avoided, since a foreign page
still can't read another origin's `Authorization` header, only present one it
already holds.

**Token endpoint** — `POST /api/v1/oauth/token`
(`src/app/api/v1/oauth/token/route.ts`), standard
`application/x-www-form-urlencoded` body (RFC 6749 §4.1.3) — the documented
`withValidatedBody` exception, since that helper is JSON-only. Two grant
types, no implicit flow ever:
- `authorization_code` — redeems the one-time code
  (`convex/oauthAuthorizationCodes.ts`'s `redeem`, single-use inside one
  Convex transaction — a concurrent replay loses the race), then checks
  `client_id`/`redirect_uri`/PKCE (`verifyPkce`, `src/lib/api/oauth/pkce.ts`)
  AFTER redemption so a mismatched replay can't probe validity repeatedly,
  then mints a grant.
- `refresh_token` — rotates both tokens via `apiKeys.rotateOAuthTokens`, a
  close cousin of the manual-key `rotate` mutation except single-use with NO
  grace window (a replayed refresh token must fail immediately, per OAuth
  2.1's rotation guidance) — proved under a genuine concurrent race in
  `convex/apiKeysOAuth.test.ts`.

**An OAuth grant IS an `apiKeys` row** (`origin: "oauth"`, `oauthClientId` set;
new `refreshTokenHash`/`refreshTokenExpiresAt` fields, OAuth-origin only) —
minted by `src/lib/api/oauth/grant.ts`'s `mintOAuthGrant` using the exact same
raw-secret/SHA-256-hash shape `generateApiKey()` already used. The resulting
bearer string flows through `getApiKeyActorContext` → `mintAgentToken`
completely unchanged, which is what makes "OAuth is a pure auth adapter"
literally true: RBAC, scopes, lifecycle locks, the org kill switch,
`no_financials`, the per-key request log, and `revertAgentWindow` all apply
to an OAuth grant with zero new code, because Convex cannot tell the two
origins apart. Access tokens are short-lived (1 hour); refresh tokens last 30
days and rotate on every use.

**Revocation** (RFC 7009) — `POST /api/v1/oauth/revoke`
(`src/app/api/v1/oauth/revoke/route.ts`). Per §2.2 of that RFC, an
unknown/foreign-client/already-revoked token is not an error — the endpoint
always returns 200, so it can never be used to probe whether a token string
is valid. Reuses the existing `apiKeys.revoke` mutation once the presented
token is hashed and matched to its owning client.

**Grant management** — `/settings/api-keys` lists OAuth grants alongside
manually-minted keys (same table, same list/revoke/kill-switch code path),
with an "OAuth" badge and a "Connected app: `<client name>`" line
(`src/server/api-keys.ts`'s `listApiKeys` resolves `oauthClientId` → a
display name via `oauthClients.listByIds`). Rotate is hidden for OAuth-origin
rows — rotation happens automatically via the client's own `refresh_token`
flow, and a manual rotation there would mint an access token the client never
asked for.

**A real pre-existing bug found and fixed along the way** — `callbackUrl`
was being SET by `src/middleware.ts` on every unauthenticated redirect to
`/login` (and referenced by the invite-flow page) but never actually READ by
the login page; every affected deep link silently landed on `/dashboard`
after signing in. It just never mattered enough to notice before an OAuth
authorization request — which carries `client_id`/`code_challenge`/`state`
in its query string — needed to survive a login round trip intact. Fixed at
the root: middleware now preserves the FULL path+query (not just the
pathname) in `callbackUrl`, and the login page reads + honors it for both
the password and SSO sign-in paths, guarded against open redirects (only a
same-origin relative path is ever followed).

**Org export coverage** (`scripts/org-export-tables.ts`) — the two new
tables are classified: `oauthClients` is `EXCLUDED/platform` (a global DCR
registry, no `organizationId` column, same posture as Better Auth's own
tables); `oauthAuthorizationCodes` is `EXCLUDED/ephemeral` (a ~120s one-shot
credential, same "restoring a dead short-lived row has no value" rationale
as `apiIdempotency`).

## What shipped before removal (for scale/scope reference)

Coverage was complete: 537 operations (every server action the UI called,
plus 29 Convex-only reads), REST (`/api/v1/*`) + MCP (27 tools, 2-tier:
curated + generic `call_operation`), OpenAPI 3.1, and ~106 unit tests.
Verified end-to-end against the shared dev DB + dev Convex on 2026-07-09,
five days before removal — it worked; it was removed for architectural
sequencing (Convex-native migration), not because it was broken.
