# 56 — Agent-Accessible API + MCP

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-28 (review quarterly — POLICY.md R-5.5)_

> **STATUS 2026-07-28 — reinstatement underway. Phases 0, 1 + 2 have landed
> (#996, #997, #998): there is now a real, curl-verifiable HTTP API —
> `POST /api/v1/ops/{operation}` (the universal dispatcher), `GET
> /api/v1/operations{,/[operation]}`, `GET /api/v1/whoami`, `GET
> /api/v1/openapi.json`, `GET /llms.txt`, and a handful of curated REST
> aliases (`/api/v1/{projects,assets,clients}[/{id}]`,
> `POST /api/v1/projects/{id}/line-items`). The Phase-0 throwaway prover
> (`POST /api/v1/probe/line-items`) is gone — Phase 2 replaced it wholesale.
> Next up: Phase 3 (#999), MCP over bearer keys.**

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
tool set Phase 3 will build. The remaining unmigrated reads stay invisible
(not unscoped) until Phase 5's coverage sweep; migrating one is a one-argument
change at the call site (`requireOrgRead(ctx, orgId)` →
`requireOrgReadFor(ctx, orgId, "<resource>")`).

### Contract registry (`scripts/generate-api-registry.mts`)

Imports every `convex/*.ts` module in-process and reads `exportArgs()` /
`exportReturns()`, so it needs **no deployment and no deploy key** and the gates
run on every PR. Guard classification is a static read, so agent-reachability and
the `(resource, action)` pair are *derived* from the guard the function calls —
the flag cannot drift, because changing it requires changing the guard.

Live numbers are in [`docs/api-coverage.md`](../docs/api-coverage.md), regenerated
on every PR. At the time of writing: 1,127 public operations, 336 agent-reachable
(67 queries + 269 mutations) — up from 291 pre-#998, the +45 being the read
bootstrap.

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

## What shipped before removal (for scale/scope reference)

Coverage was complete: 537 operations (every server action the UI called,
plus 29 Convex-only reads), REST (`/api/v1/*`) + MCP (27 tools, 2-tier:
curated + generic `call_operation`), OpenAPI 3.1, and ~106 unit tests.
Verified end-to-end against the shared dev DB + dev Convex on 2026-07-09,
five days before removal — it worked; it was removed for architectural
sequencing (Convex-native migration), not because it was broken.
