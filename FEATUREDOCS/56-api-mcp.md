# 56 — Agent-Accessible API + MCP

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-28 (review quarterly — POLICY.md R-5.5)_

> **STATUS 2026-07-28 — reinstatement underway. Phases 0 + 1 have landed
> (#996, #997): the agent identity, the scope intersection, the limits, the
> idempotency ledger, the error envelope and the contract registry all exist and
> are gated in CI. There is still no general request surface — that is Phase 2
> (#998). The only route today is the deliberately throwaway Phase-0 prover,
> `POST /api/v1/probe/line-items`.**

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

## What exists today (phases 0 + 1, landed 2026-07-28)

Everything below is built, tested and CI-gated. Nothing here is a request
surface — an operator cannot yet make a general API call.

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
they reject agents outright rather than admit them unscoped (decision 2). 216
queries are invisible to the API until Phase 5 migrates them to
`requireOrgReadFor`. That is deliberate: an unmigrated read is invisible, not
unscoped, and the migration is one argument per call site.

### Contract registry (`scripts/generate-api-registry.mts`)

Imports every `convex/*.ts` module in-process and reads `exportArgs()` /
`exportReturns()`, so it needs **no deployment and no deploy key** and the gates
run on every PR. Guard classification is a static read, so agent-reachability and
the `(resource, action)` pair are *derived* from the guard the function calls —
the flag cannot drift, because changing it requires changing the guard.

Live numbers are in [`docs/api-coverage.md`](../docs/api-coverage.md), regenerated
on every PR. At the time of writing: 1,113 public operations, 287 agent-reachable,
602 SERVICE-only, 216 fail-closed org-reads, 8 unclassified.

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
