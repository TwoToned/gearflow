<!-- STATUS: APPROVED 2026-07-07 (via /autoplan — CEO + Eng + DX, dual-model review) -->
<!-- IMPLEMENTATION 2026-07-07 (PR #378): backend vertical BUILT + unit-tested (56 tests). See FEATUREDOCS/55. -->
<!-- Built: ActorContext seam, ApiKey model+auth, scope∩RBAC gate, reserve_items service, reserve write via -->
<!-- guarded addLineItem, Prisma idempotency, REST (/api/v1/whoami, /api/v1/reserve-items), MCP (/api/v1/mcp), -->
<!-- key-management server actions. Remaining: availability-atomic Convex mutation (TOCTOU hardening), -->
<!-- reservation DRAFT/TTL/provenance schema, asset-specific holds, key-management settings UI + onboarding, -->
<!-- webhooks. Integration verified via PR preview deploy (no local Convex/DB in the worktree). -->
<!-- SHIPPED to prod 2026-07-07 (PR #378 + #379 middleware hotfix); agent docs PR #380. -->
<!-- 2026-07-09: FULL COVERAGE. Ambient ActorContext (AsyncLocalStorage) lets an API key drive -->
<!-- all ~508 server actions unmodified; AST-generated operation registry; +29 bridged Convex-only -->
<!-- reads = 537 operations. REST /operations + /ops/{name}; MCP 27 tools (curated + dynamic -->
<!-- dispatch). confirm+idempotency rails on dangerous/stock-affecting writes. See FEATUREDOCS/56. -->

<!-- Full review artifact + decision audit trail: ~/.gstack/projects/TwoToned-gearflow/jayden-worktree-bridge-cse_01F1scZAF9AgfUgiUhzWSRTi-design-20260707-153700.md -->
# GearFlow — Agent-Accessible API + MCP

**Branch:** `worktree-bridge-cse_01F1scZAF9AgfUgiUhzWSRTi`
**Created:** 2026-07-07
**Source:** /autoplan request — "I want to add an API/MCP to the app, so users can use the API and connect AI agents to the app to read/write etc."
**Related designs:** [`convex-phase5-auth-bridge.md`](./convex-phase5-auth-bridge.md), [`convex-native-read-layer.md`](./convex-native-read-layer.md), [`line-item-fulfillment-model.md`](./line-item-fulfillment-model.md)

---

## Intent

Let AI agents (Claude, OpenClaw, scripts) and power users read GearFlow broadly and write to it safely,
through a stable API exposed **MCP-first** with a REST + webhook surface over the same contract. An agent should
be able to answer "what gear is free next week?" and *act* — "draft a booking and reserve the kit" — while being
bound by exactly the overbooking / RBAC / audit protections a human operator has in the UI.

Primary consumer (v1): **internal agents + power users** (same-org, scoped keys). Not a public third-party
developer platform yet — that is a deliberate later step on a trust ramp (internal → per-org power users → public).

> **SUPERSEDED IN PART (2026-07-09).** The section below argued for a curated verb set over
> full coverage. That shipped, and then an agent asked to "view projects" and found no tool
> for it — the curated set was too thin to be useful. Coverage is now **complete** (537
> operations, every app read and write), which turned out to be *compatible* with the safety
> argument rather than opposed to it. The reason: the objection was to exposing **raw
> table-level CRUD**, which bypasses workflow invariants. What is exposed instead is the
> **server-action layer** — the same guarded functions the UI calls — so every business rule,
> RBAC check and audit write applies unchanged. Raw Convex/Prisma CRUD is still never called
> directly (invariant 2 below holds).
>
> The safety machinery this document specifies is retained and generalised: preview→commit
> survives as `reserve_items`; irreversible and stock-affecting writes now require
> `confirm: true` + `idempotencyKey`. See FEATUREDOCS/56.

## The core decision: capability actions, not raw CRUD

v1 is **not** table-level CRUD across the 87 models. Raw CRUD exposes database shape, not rental intent — an agent
can create perfectly valid rows that violate workflow expectations the overbooking check never sees, and RBAC
answers "may this user," not "is this a sane irreversible act from an LLM." Audit makes writes reversible, not
prevented, and "reversible" is a fiction once gear is physically pulled and a van is dispatched.

Instead, v1 exposes **broad reads + a curated set of capability verbs**, where high-impact (availability-affecting)
writes are **preview → confirm** and land as **reversible drafts**:

| Verb | Kind | Effect / transition | Preview→confirm |
|------|------|---------------------|-----------------|
| `search_assets`, `get_asset`, `list_projects`, `get_project`, `check_availability` | read | none | n/a |
| `create_draft_project` | write | new project in a draft state | no (cheap) |
| `reserve_items` | write | holds specific assets/qty on a project (DRAFT→RESERVED) | **yes** |
| `release_items` | write | inverse of reserve | yes |
| `swap_asset` | write | substitute one asset on a reservation | **yes** |
| `stage_pick_list` | write | build the pick list | no |
| `dispatch_gear` | write | RESERVED→CHECKED_OUT | **yes** |
| `receive_gear` | write | CHECKED_OUT→RETURNED | yes |

Naming rule: `verb_object`, objects match the READ vocabulary exactly (an agent must correlate a create result
with a later `get_project`). Every write verb's description states: prerequisite entities, the FROM→TO transition,
whether it is preview-first, the exact scope string, idempotency behaviour, and its error codes.

## Architecture

```
   ┌─────────────┐   ┌─────────────┐   ┌──────────────┐        Adapters (thin, generated from contract)
   │ Web UI      │   │ MCP server  │   │ REST + webhook│
   │(server act) │   │ (tools)     │   │  facade      │
   └──────┬──────┘   └──────┬──────┘   └──────┬───────┘
          │ session-Actor    │ apiKey-Actor    │ apiKey-Actor
          ▼                  ▼                 ▼
   ┌───────────────────────────────────────────────────┐
   │  ActorContext {orgId, actorUserId, actorType,      │  ◄── NEW seam
   │                apiKeyId?, scopes}                  │
   └───────────────────────────┬───────────────────────┘
                               ▼
   ┌───────────────────────────────────────────────────┐
   │  DOMAIN SERVICES (plain TS, protocol-agnostic)     │
   │  • resolvePermission(actor,resource,action)  ──────┼─ reuses decideOrgPermission
   │  • previewReservation(actor,input)  (dry-run)      │  (parity: UI ≡ Convex)
   │  • capability verbs                                │
   └───────────────────────────┬───────────────────────┘
                               ▼  SERVICE token (authZ ALREADY done above)
   ┌───────────────────────────────────────────────────┐
   │  Convex mutation (atomic): availability recheck +  │  ◄── check moves INSIDE the mutation
   │  reserve + in-mutation audit + idempotency record  │      + assert arg.orgId === actor.orgId
   │  Postgres: Better Auth, customRole, activityLog    │
   └───────────────────────────────────────────────────┘
```

Invariants: (1) the domain core has **zero** protocol/MCP types in its signatures; (2) the API path **never**
calls generated Convex CRUD directly; (3) availability check + reservation + audit + idempotency are **atomic in
one mutation**; (4) actor-org is asserted server-side, never trusted from the argument.

`src/server/*.ts` server actions become thin adapters over the domain services. `revalidatePath`/cache
invalidation stays in the server-action adapter only; services return data.

## The three critical risks (design against these)

1. **SERVICE-token bypass (the #1 risk).** `getConvexClient()` (`src/lib/convex-client.ts:36`) always attaches the
   all-powerful SERVICE token; Convex `requireService`/`requireOrgPermission` short-circuit to allow for service
   callers (`convex/lib/auth.ts`). Generated CRUD like `api.projectLineItems.create` is `requireService()`-only,
   no RBAC (`convex/projectLineItems.ts:154`). And `organizationId` is an untrusted mutation argument the service
   identity blesses. **Fix:** API writes MUST enter domain services that call `requirePermission(actor,…)`; map
   key scopes → the existing RBAC resource/action vocab (reuse `decideOrgPermission` — no parallel authZ);
   assert `arg.organizationId === actor.organizationId` **inside** every write mutation.

2. **Overbooking TOCTOU.** `addLineItem` computes availability in Node from Convex reads
   (`src/server/line-items.ts:105,178,216`) then writes separately; `addNative` inserts without rechecking
   (`convex/lineItemWrites.ts:277`). Two concurrent callers both see `available=1`, both write. **Fix:** move the
   availability check + reservation insert into **one** Convex mutation (serialisable/OCC), or an explicit
   reservation/hold table with idempotency + conflict-protected allocation. `reserve_items` must not use the
   current check-then-write path. Do **not** expose the `allowOverbook` flag to the API.

3. **ActorContext seam (tractable).** `getOrgContext()`→`requireOrganization()`→`requireSession()` reads
   `next/headers` (`src/lib/auth-server.ts:5`) — the only request-scope coupling. But `requirePermission()`
   (`src/lib/org-context.ts:88`) is already pure given `{organizationId,userId}`. **Fix:** extract
   `ActorContext`; add `getSessionActorContext()` + `getApiKeyActorContext()`; change signature to
   `requirePermission(resource, action, actor = await getSessionActorContext())` — zero UI behaviour change.
   **Do not spoof Better Auth sessions.**

## Auth & keys

Better Auth's `apiKey` plugin is **not** installed, so the key model is greenfield. Model a new `ApiKey` on the
existing `TestTagAuditorToken` (`prisma/schema.prisma:2707`): org-scoped, hash-only `tokenHash @unique` + `prefix`
+ `scopes` (JSON) + `isActive` + `expiresAt` + `lastRotatedAt` + `revokedAt` + `lastUsedAt`; org-level
`apiKillSwitchAt` for an instant org-wide kill switch. Secret shown once; rotation with a grace window.

An API key references an **acting user**. Effective permission = **intersection(live user RBAC, key scopes,
operation policy)**, re-checked **every request** — so a deactivated / demoted / SSO-deprovisioned user
immediately loses access through their keys.

## Safety layer for autonomous writes

- **Preview→confirm** with a **content-bound, single-use, expiring `confirmation_token`** bound to
  {org, key, actor, params hash, inventory snapshot}. Commit consumes it; if the world changed → `STALE_PREVIEW`
  (retryable), never a silent divergent commit. One tool per verb with a `confirm:false|true` flag (fewer tools
  for the LLM to reason over than separate preview_/confirm_ pairs).
- **Idempotency:** every write takes an `idempotency_key`; an `apiIdempotency` record (unique by
  `(orgId, apiKeyId, key)`) is written in the same mutation; replay returns the original result with
  `replayed:true` (a success, not an error).
- **Fail-closed audit:** a `recordApiMutationAudit()` that **throws** on failure, written **in the same Convex
  mutation** as the effect (pattern already exists — `writeActivityLog` awaited before return,
  `convex/lineItemWrites.ts:302`). The UI `logActivity` path stays best-effort/unchanged. Audit payload carries
  `apiKeyId` + `actorType` (existing `metadata` field; no schema change).
- **Reversible drafts:** add an explicit `DRAFT`/`PROPOSED` state (precedent: `SubHireStatus`/`SupplierOrderStatus`
  already have `DRAFT`) with a **reservation TTL / soft-hold** so abandoned drafts don't silently consume stock,
  plus provenance (`createdByApiKeyId`/`source`) to bulk-revert agent mistakes. Reverse-mutations already exist
  (`undeployItems`/`unreturnItems`/`undeprepLine`).
- **Rate limits** per key; org-wide kill switch.

## DX (primary consumer is an agent)

- **"Connect an AI Agent" one-screen flow** — one click mints a `read_only_agent`-preset key → renders a
  copy-paste MCP config (URL + `Authorization: Bearer gf_live_…` header + key interpolated) → a `whoami`/`ping`
  tool + "Test connection" button echoing the org name → link to the per-key request log. Target TTHW < 5 min.
- **Agent-native structured error envelope** (identical for MCP and REST): stable `code`, `category`, `retryable`,
  `retry_after_ms`, `required_scope`/`missing_scope`, `request_id`, `recovery.action` + human message, typed
  `details`. Overbooking returns **substitutes** (`INVENTORY_CONFLICT` with `conflicts[]` + `suggestions[]`), not
  just "no". Distinguish `MISSING_SCOPE` (key too narrow — human fixable) from `FORBIDDEN` (role forbids).
- **MCP tool descriptions are the docs/prompt** — generate MCP tool schemas **from the OpenAPI spec** (single
  source; REST + MCP never drift).
- **Per-key request log** (last ~100 calls: ts, tool/endpoint, status, error code, missing scope, latency,
  request_id, redacted params) for self-serve debugging.
- **Boring versioning from day one** — `/v1`, `gearflow.v1.*` MCP namespace, versioned webhook events
  (`booking.created.v1`), in-band `warnings[]` + version header (the only channel an autonomous agent consumes).

## Build plan

**Phase 0 — pattern-prover (first, gates everything).** Drive `reserve_items` end-to-end: API key →
`ActorContext` → domain service → a **single Convex mutation** that (a) re-checks availability atomically,
(b) asserts `arg.orgId === actor.orgId`, (c) writes the reservation + in-mutation audit + idempotency record.
If this holds with overbooking enforced under concurrency and audit written, every other verb is a template.

**Phase 1 — foundations.** `ApiKey` model + hashing + scopes + kill switch; `ActorContext` extraction +
`requirePermission` signature change (UI path unchanged); structured error envelope; idempotency table.

**Phase 2 — read surface.** MCP server + `search_assets`/`get_asset`/`list_projects`/`get_project`/
`check_availability` over the native Convex read layer; `whoami`; "Connect an AI Agent" onboarding + per-key log.

**Phase 3 — write verbs.** `create_draft_project`, `reserve_items`/`release_items`, `swap_asset`,
`stage_pick_list`, `dispatch_gear`/`receive_gear` — each preview→confirm where availability-affecting; DRAFT state
+ TTL + provenance.

**Phase 4 — REST + webhooks** generated from the same contract; OpenAPI spec; webhook signing + delivery log.

## Testing (highest-value first)

Full plan: `~/.gstack/projects/TwoToned-gearflow/jayden-worktree-bridge-cse_01F1scZAF9AgfUgiUhzWSRTi-test-plan-20260707-153700.md`.
CRITICAL: cross-org isolation under the SERVICE token; RBAC ∩ key-scope (reuse `permissionsCore` parity oracle);
overbooking under concurrency (N concurrent `reserve_items` for the last unit → exactly one succeeds — this test
FAILS against the current check-then-write, which is the point); idempotency replay; audit fail-closed. Note the
Convex JWKS test-trust caveat (`gearflow_test` keys aren't trusted by shared dev) — stub at `getAuthContext` for
unit-level RBAC, use a real deployment for the concurrency test.

## Not in scope (v1)

Public third-party developer platform (OAuth apps, marketplace, quotas); raw CRUD across all models; billing /
packaging; read-scopes-by-sensitivity tiers (recommended soon after); `allowOverbook` exposure; USER-token minting
for writes (writes are service-only + mirror-freshness-dependent).
