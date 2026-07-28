<!-- STATUS: DRAFT 2026-07-28 — plan of record for reinstating the agent API + MCP surface. -->
<!-- Supersedes docs/designs/archive/api-mcp-agent-access.md (the 2026-07-07 design, built -->
<!-- then removed 2026-07-14). That doc's SAFETY findings are retained; its ARCHITECTURE is -->
<!-- obsolete because the data layer it sat on (src/server/*.ts server actions) is gone. -->
# RVLT Flow — API + MCP Re-implementation

**Branch:** `claude/api-mcp-reimplementation-l8hsjl`
**Created:** 2026-07-28
**Source:** "fully re-implement the API and MCP server — API first for full customisation,
then MCP on the API infrastructure for AI collaboration. Both must touch all aspects of
the app, read and write, so the MCP is useful for real requests. Gates and checks must
still be followed — the API or an AI shouldn't be able to bypass project locks etc."
**Supersedes:** [`archive/api-mcp-agent-access.md`](./archive/api-mcp-agent-access.md)
**Related:** [FEATUREDOCS/56](../../FEATUREDOCS/56-api-mcp.md),
[54 (Convex data layer)](../../FEATUREDOCS/54-convex-data-layer.md),
[62 (project lifecycle locks)](../../FEATUREDOCS/62-project-lifecycle-locks.md),
[58 (webhooks)](../../FEATUREDOCS/58-webhooks.md),
[04 (auth/permissions)](../../FEATUREDOCS/04-auth-permissions.md)

---

## 1. Intent

Give power users a **fully customisable HTTP API** over every read and write in RVLT Flow,
then hang an **MCP server** off that same infrastructure so an AI agent can answer real
questions ("what's free next Tuesday, and what's the margin on project 1042?") and *act*
("add the kit, reserve it, dispatch it") — bound by **exactly** the gates a human operator
faces in the UI: RBAC, org isolation, overbooking, project lifecycle locks, blocking
comments, money bounds, kill switches, audit.

The safety requirement is not "add checks to the API." It is: **make it structurally
impossible for the API path to reach a write that skips a gate.** Section 3 is how.

## 2. What changed since the last attempt (why the old design is obsolete)

The 2026-07-07 build shipped 537 operations and worked. It was deleted on 2026-07-14
because its registry dynamically imported and invoked every `src/server/*.ts` server
action — coupling the API contract to a data layer that the Convex-native migration was
in the middle of deleting.

That migration has since finished, and it moved the ground under the old design in the
best possible way:

| Then (2026-07-07) | Now (2026-07-28) |
|---|---|
| Business logic in ~508 `src/server/*.ts` server actions | 34 server-action files left (email, SSO, CSV, cron, Xero OAuth); logic lives in **223 `*Native` Convex mutations** across 46 files |
| Authorization in Node (`requirePermission`) *before* calling Convex; Convex trusted the caller via the SERVICE token | Authorization **inside Convex** — `requireOrgPermission` + `resolveActor` + `assertWritesEnabled` + `enforceBrowserWriteLimit`, because the browser now calls mutations directly |
| Overbooking was check-then-write across two calls — a real TOCTOU (design risk #2) | Availability/double-booking enforcement is **in the mutation** (`lineItemWrites.ts` `addNative`/`createNative`/kit paths). Risk #2 is already fixed |
| Project locks were UI-side | `assertLifecycleGuard` is a single shared in-mutation guard called from every gate site (#957) |
| Audit was best-effort `logActivity()` after the write | `writeActivityLog` runs **in the same mutation** as the effect |

Every one of those changes moves a gate from "the caller is trusted to have checked" to
"the transaction checks it." That is the whole reason this re-implementation can be
smaller, safer, and more complete than the original.

## 3. The architectural inversion: an AGENT token, not the SERVICE token

**The single most important decision in this design.**

The old API path attached the `SERVICE` token (`src/lib/convex-auth.ts`) — the
all-powerful trusted-backend identity that short-circuits `requireService`,
`requireOrgRead`, and `requireOrgPermission` to *allow*. Every gate then had to be
re-implemented in Node, correctly, on every path, forever. That is the #1 risk the old
design named, and it is a discipline problem, not a structural one.

Instead: **the API mints a short-lived, per-request AGENT token** — an ES256 JWT signed by
the same JWKS (`convexServiceSigner.api.signJWT`, already in-repo and payload-arbitrary),
shaped like a USER token:

```
sub  = apiKey.actingUserId      (the human the key acts as)
orgId= apiKey.organizationId
akid = apiKey.id                 ← NEW claim
svc  = ABSENT                    (never — that claim is reserved for SERVICE)
exp  = now + 60s
```

`convex/lib/auth.ts`'s `getAuthContext` gains a third kind:

```ts
export type ConvexAuthContext =
  | { kind: "service" }
  | { kind: "user";  userId: string; orgId: string | null; role: string | null }
  | { kind: "agent"; userId: string; orgId: string | null; role: string | null;
      apiKeyId: string };
```

`kind: "agent"` behaves **exactly like `kind: "user"` everywhere** — the same member-row
RBAC lookup, the same `resolveActor` subject pinning, the same kill switch — plus a scope
check (§5) and its own rate-limit bucket (§12).

### What this buys, for free, with zero per-operation security code

```
   ┌──────────┐  ┌──────────┐   ┌─────────────┐
   │ Web UI   │  │ REST /v1 │   │ MCP /v1/mcp │
   └────┬─────┘  └────┬─────┘   └──────┬──────┘
        │ USER token  └────────┬───────┘
        │                      │ one dispatcher → AGENT token (sub=actingUser, akid=key)
        ▼                      ▼
   ┌───────────────────────────────────────────────────────────────┐
   │  convex/*.ts  PUBLIC (*Native) mutations & org-guarded queries │
   │   assertWritesEnabled  → systemFlags kill switch               │
   │   enforceBrowserWriteLimit → per-actor rate budget             │
   │   requireOrgPermission → member-row RBAC ∩ key scopes  (§5)    │
   │   resolveActor        → attribution pinned to token subject    │
   │   assertLifecycleGuard→ FINANCE_LOCKED / JUSTIFY / HARD_LOCKED │
   │   loadModelAvailabilityBundle → overbooking, in-transaction    │
   │   assertNoBlockingCommentsInMutation → send-out gate           │
   │   fieldGuards / moneyGuards → bounds, NaN/Infinity             │
   │   assertBulkSizeOk    → array amplification cap                │
   │   writeActivityLog    → audit, same transaction                │
   └───────────────────────────────────────────────────────────────┘
   ┌───────────────────────────────────────────────────────────────┐
   │  Generated CRUD + mirrors + backfills:  requireService()       │
   │  ⛔ UNREACHABLE by an agent token — throws, by construction     │
   └───────────────────────────────────────────────────────────────┘
```

The old design's invariant *"the API path never calls generated Convex CRUD directly"* was
a rule a developer had to remember. Here it is **enforced by the auth layer**: an agent
token fails `requireService()`. 445 service-only mutations and 152 service-only queries —
raw table CRUD, mirror writes, backfills, org-export internals — are simply not addressable.

**Answering the brief directly:** an AI cannot bypass a project lock because the lock is
`assertLifecycleGuard` executing inside the same Convex transaction as the write, keyed off
the project row's own `status`, with no caller-supplied bypass. There is no code path from
the API to a project mutation that doesn't go through it.

### Cost / risk of the inversion

- **Impersonation capability.** Minting a `sub = arbitrary user` token is powerful. It MUST
  be reachable only from `resolveAgentToken(apiKey)`, never from request input; the minting
  module takes an already-validated `ApiKey` document as its only argument, and a unit test
  asserts it refuses any `sub` not equal to `apiKey.actingUserId`.
- **60-second TTL** so a leaked token is near-worthless, and the key document is re-read on
  every call (§5) so revoke / expiry / kill-switch are instant regardless of TTL.
- `enforceBrowserWriteLimit`'s current bucket keys on the token subject, which would make an
  agent eat the human's budget. Fix in Phase 1: key on `akid` when present, separate bucket.

## 4. Coverage: what "all aspects of the app" actually means

Measured on the current tree (`convex/*.ts`, excluding tests/generated):

| | Total public | Agent-reachable (org-guarded) | SERVICE-only (unreachable) |
|---|---|---|---|
| Queries | 392 | **240** | 152 |
| Mutations | 717 | **272** (223 of them `*Native`) | 445 |
| **Total** | 1,109 | **≈512** | 597 |

≈512 agent-reachable operations vs the 537 the removed build shipped — parity, reached by
*exposing an existing guarded surface* rather than by generating wrappers around 508 server
actions.

**The reachability gap is the real Phase-3 work.** 152 SERVICE-only queries include things
an agent genuinely needs and that no org-guarded equivalent covers:

`availabilityCheck` (1), `assetScanLogs` (6), `orgExport` (6), `projectLineItemUnits` (5),
`categorySlots` (4), `kitSerializedItems` (4), `maintenanceRecordAssets` (4),
`crewShifts` (3), `checkRecords` (3), `clientContacts` (3), `serviceTemplates` (2),
`members` (2), `orgSettings` (2), `revenueAllocation` (1), the `*Media` families (~18)…

Each needs a decision, recorded per-query in the registry:
1. **Widen** — swap `requireService` for `requireOrgPermission(ctx, orgId, <resource>, "read")`.
   Correct for the majority (they are org-scoped reads whose only reason for being
   service-only is that an RSC page called them). Widening also unlocks them for the browser.
2. **Add a sibling** — where the service query intentionally returns unredacted rows, add a
   `listForAgent` beside it and `redactFields` (the `crewRoles.listForSettings` vs `list`
   precedent, Integration Checklist "Role-gated fields").
3. **Leave closed** — `orgExport`, `siteSettings`, `pendingSSOApprovals`,
   `projectNumberSequences`, `parity`. Recorded as `agentAccess: "denied"` with a reason.

A CI classifier (Phase 1) prints this table on every PR so the number can only go down
deliberately, and a new SERVICE-only query has to declare which bucket it's in.

## 5. Scope model: `resource:action`, intersected **inside Convex**

Effective permission = **live member-row RBAC ∩ key scopes ∩ operation policy**,
re-evaluated on every call. A demoted, deactivated or SSO-deprovisioned user loses access
through their keys immediately, without touching the key.

Scopes reuse the existing RBAC vocabulary verbatim (`convex/lib/permissionsCore.ts`
`RESOURCES` × actions) — `asset:read`, `project:manage_line_items`, `invoice:xero_push`,
`warehouse:check_out`, with `resource:*` and `*` wildcards. No parallel vocabulary (R-3.1).

**The scope check runs in Convex, at the same call site as RBAC:**

```ts
// convex/lib/auth.ts
async function requireAgentScope(ctx, auth, resource, action) {
  if (auth.kind !== "agent") return;
  const key = await ctx.db.query("apiKeys")
    .withIndex("by_cuid", q => q.eq("id", auth.apiKeyId)).first();
  if (!key || key.isActive === false || key.revokedAt) throw ConvexError({code:"KEY_INACTIVE",…});
  if (key.organizationId !== auth.orgId)               throw ConvexError({code:"FORBIDDEN",…});
  if (key.expiresAt != null && key.expiresAt <= Date.now()) throw ConvexError({code:"KEY_EXPIRED",…});
  if (!hasScope(parseScopes(key.scopes), resource, action))
    throw ConvexError({ code:"MISSING_SCOPE", requiredScope:`${resource}:${action}` });
}
```

called from `requireOrgPermission`, and from the read guards once they carry a resource.

Why in Convex and not in the dispatcher:
- **No mapping table.** The mutation already declares its `(resource, action)`; the scope
  check consumes that. A hand-maintained operation→scope map would be a second copy of a
  business rule — a defect even in sync (R-3.1, and precisely the class of bug the PDF
  consumer-audit note in CLAUDE.md warns about).
- **Impossible to forget.** A new `*Native` mutation is scope-gated the day it's written.
- **Instant revocation** — the key doc is in the transaction's read set, so a revoke lands
  on the next call, not after the token TTL.
- **Defence in depth.** A leaked agent token is a valid Convex JWT. A dispatcher-side check
  would be bypassed by calling Convex directly; this one isn't.

Cost: one extra indexed point-read per request. Acceptable (`by_cuid` on a small table).

### The read guards need a resource (the one real refactor)

`requireOrgRead` / `requireOrgReadDoc` enforce org-scoping only — there's no resource to
check a scope against. 277 + 74 call sites. Plan:

- Add `requireOrgReadFor(ctx, orgId, resource)` and `requireOrgReadDocFor(ctx, doc, resource)`,
  which org-check **and** scope-check.
- **`requireOrgRead` fails closed for `kind: "agent"`** from day one. So an unmigrated query
  is invisible to the API rather than unscoped — the safe default, and it makes the
  migration incrementally shippable instead of one 350-site commit.
- Migrate per domain in Phase 3, ordered by agent value (assets → projects → availability →
  crew → warehouse → finance). The change is one argument per call site; a codemod plus the
  Phase-1 classifier tracks the remainder.

### Personal-scope operations

`savedTableViews*`, `userNotificationPreferences`, `notificationDismissals` guard on
"verified user's own row," not resource RBAC. They get a dedicated `self:read` / `self:write`
scope and route through a `requireSelfScope` helper — not folded into a resource scope.

## 6. Privileged arguments: the bypass levers that must be scope-gated separately

Grepping every override-shaped mutation arg gives a **bounded, auditable list of 7**. These
are the only ways a *legitimately permitted* caller can soften a gate, so each needs its own
scope and its own registry policy — a key with `project:update` must NOT thereby be able to
overbook or justify past a lock:

| Arg | Sites | Gate it softens | Agent policy |
|---|---|---|---|
| `allowOverbook` | 6 | in-mutation availability check | **Forced `false`** by the dispatcher **and** rejected in Convex unless the key holds `project:allow_overbook`. (The archived design said "do not expose"; forcing plus a server-side assert is strictly stronger than stripping it in Node.) |
| `justification` | 50 | `assertLifecycleGuard` JUSTIFY tier | Allowed — it is the human-equivalent act — but the op is `danger:"high"`, requires `confirm:true`, and the audit row already carries `justification` + `apiKeyId` via `lifecycleAuditMetadata`, so every agent-justified edit is reviewable. |
| `projectUnlockSessionsWrites.openNative` | — | HARD_LOCKED / FINANCE_LOCKED escape | **`agentAccess:"denied"` by default.** Opening an unlock session is the one true lock override; it also needs `isHardLockOverrideAllowed` (admin/owner/assigned PM). Enabling it for a key requires the explicit `project:unlock_session` scope, off in every preset. |
| `overrideReason` | 6 | line-item override trail | Allowed; `danger:"medium"`, string-bounded. |
| `forceSeparate` | 2 | merge-dedup | Allowed; cosmetic. |
| `emitSideEffects` | 12 | webhook/side-effect fold | Dispatcher-injected `true` — never agent-controlled. |
| `allowOrgCreation` | 5 | `siteSettings` | Site-admin surface; `agentAccess:"denied"`. |

This table is generated by the registry build and a CI test fails if a **new** arg matching
`/^(allow|force|skip|override|ignore|bypass)/` or named `justification` appears without a
policy row. That is the mechanism that stops gate #8 from being silently exposed in six
months' time.

## 7. The contract registry — generated, never hand-maintained

One generator, `scripts/generate-api-registry.ts`, run in CI and committed (R-3.1):

**Inputs (all existing sources of truth):**
1. **Convex arg/return validators** — import each `convex/*.ts` module in-process and read
   `fn.exportArgs()` / `fn.exportReturns()` (Convex attaches these to every registered
   function; verified in `node_modules/convex/dist/…/registration_impl.js`). This works
   **offline — no deployment needed**, so CI doesn't need `CONVEX_DEPLOY_KEY`.
   Cross-checked against `pnpm exec convex function-spec` in the deploy workflow, where a
   deployment does exist, as a drift assertion.
2. **Guard classification** — static read of each function body for
   `requireService` / `requireOrgPermission(ctx, org, "<resource>", "<action>")` /
   `requireOrgRead*`. Yields agent-reachability **and** the `(resource, action)` pair for
   docs, with a runtime probe test asserting the statically-extracted pair matches what the
   function actually enforces.
3. **Zod business schemas** — `src/lib/validations/*`, bound per operation (§8).
4. **Per-operation policy annotations** — colocated in the Convex module as
   `export const agentOps = { addNative: { op: "line_item.add", danger: "high",
   summary: "…", mcpTier: "curated" } } as const;`. Deliberately minimal: **no**
   resource/action/scope here (extracted from the guard), so there is nothing to drift.

**Outputs:** `src/lib/api/registry.generated.ts` (the allowlist — an operation absent from it
is a 404, so the API surface is closed by default), `openapi.generated.json` (3.1), the MCP
tool manifest, and `public/llms.txt`.

**Staleness is a CI gate**, not a hope: regenerate, `git diff --exit-code`. This is the fix
for the "MCP tool-list staleness" finding from the previous build.

## 8. Argument ergonomics and validation parity

The `*Native` mutations are UI-shaped. `assetWrites.createNative` wants a caller-minted
`id`, an `auditId`, `now`, an `actor` object, and `set`/`clear` arrays; the *business*
validation (`assetSchema.parse`, custom-field resolution) lives in the client hook
(`src/hooks/use-asset-writes.ts`). An agent must not have to know any of that, and the API
must not skip the Zod half.

**Arg normalization — one rule table keyed on arg name, ~7 entries, not a per-op mapping:**

| Arg | Dispatcher behaviour |
|---|---|
| `actor` | Injected from the resolved key context (Convex re-pins it via `resolveActor` regardless) |
| `id`, `auditId` | Minted server-side, **derived deterministically from the idempotency key** (§9) |
| `now` | Server clock |
| `emitSideEffects` | Forced `true` |
| `allowOverbook` | Forced `false` unless the `project:allow_overbook` scope is held |
| `set` / `clear` | Agent sends one flat patch object; the normalizer splits `null`/`""` into `clear` |
| `orgId` / `organizationId` | Injected from the key's org — **never** read from the request body |

Injected args are stripped from the generated OpenAPI/MCP schemas, so the published contract
is the agent-facing shape.

**Validation parity.** `convex/validationDrift.test.ts` already pairs 18 Zod schemas with
their Convex arg field-sets. Promote that test-local table to
`src/lib/validations/registry.ts`, imported by **both** the drift test and the API
dispatcher. The dispatcher runs the same `.parse()` the hook runs, so the API inherits every
business bound instead of relying on `fieldGuards`/`moneyGuards` alone (which remain the
in-Convex backstop — belt and braces, R-9.3). Extending that registry from 18 to full
coverage is tracked per-domain in Phase 3.

## 9. Idempotency and confirmation rails

**Idempotency** — every write takes `idempotencyKey`. New Convex table:

```ts
apiIdempotency: defineTable({
  organizationId: v.string(), apiKeyId: v.string(), key: v.string(),
  operation: v.string(), argsHash: v.string(),
  status: v.union(v.literal("PENDING"), v.literal("DONE")),
  result: v.optional(v.any()), createdAt: v.number(), completedAt: v.optional(v.number()),
}).index("by_org_key", ["organizationId", "key"])
  .index("by_apiKeyId", ["apiKeyId"]),
```

Three-step: `claim` (insert PENDING, or return the stored result with `replayed:true`, or
`IDEMPOTENT_IN_PROGRESS` if still PENDING) → run → `complete`. A mismatched `argsHash` on the
same key is `IDEMPOTENCY_KEY_REUSED`, never a silent divergent write.

**This is deliberately not atomic with the effect**, and that's safe because of the real
defence: **entity `id` and `auditId` are derived deterministically from
`(idempotencyKey, operation)`**. A crash between "run" and "complete" leaves PENDING; the
retry re-derives the same `id`, and the mutation's own duplicate guard (`createIfMissing` /
the `by_cuid` collision check) rejects the second insert. So a replay cannot double-write
even if the ledger is stale. Making it atomic would mean threading an idempotency arg through
223 mutations — a large, invasive change for a guarantee determinism already provides. Recorded
as a conscious trade, not an oversight.

**Confirmation.** Operations classified `danger:"high"` (stock-affecting, irreversible,
lock-softening, financial issue/void, bulk destructive) require `confirm: true`. For
availability-affecting writes, a **preview → commit** pair: preview returns a
`confirmationToken` bound to `{org, key, actor, argsHash, availability snapshot}`,
single-use and expiring; commit consumes it and returns `STALE_PREVIEW` (retryable) if the
world moved. One tool per verb with a `confirm` flag — fewer tools for a model to reason
over than `preview_*`/`commit_*` pairs.

**Audit is already fail-closed** and in-transaction (`writeActivityLog`). The only addition:
stamp `apiKeyId` + `actorType: "apiKey"` into the existing `metadata` field, so every agent
write is filterable in the activity log and a bad agent run is bulk-revertible. No schema
change.

## 10. Error envelope (identical for REST and MCP)

```json
{ "error": { "code": "FINANCIALS_LOCKED", "category": "gate", "retryable": false,
  "message": "This project's financials are locked…",
  "recovery": { "action": "open_unlock_session",
                "hint": "A manager must open an unlock session on the Financials tab." },
  "requiredScope": null, "requestId": "req_…", "details": { "projectId": "…", "tier": "JUSTIFY" } } }
```

The Convex guards already throw `ConvexError` with stable codes — `PROJECT_LOCKED`,
`FINANCIALS_LOCKED`, `JUSTIFICATION_REQUIRED`, `FORBIDDEN_HARD_LOCK_OVERRIDE`,
`BULK_TOO_LARGE`, `INVALID_NUMBER`, `NOT_FOUND`, `RateLimited` — so the envelope is a
**mapping, not a re-invention**. Two rules carried forward from the previous build:

- `MISSING_SCOPE` (key too narrow — the operator can fix it) is distinct from `FORBIDDEN`
  (the acting user's role forbids it). Conflating them sends agents down the wrong recovery.
- An overbooking rejection returns `conflicts[]` **and** `suggestions[]` (substitutes), not
  just "no" — the availability bundle already computes what's needed.

## 11. REST surface (`/api/v1`) — phase one, the customisable half

- `POST /api/v1/ops/{operation}` — the universal dispatcher. Full coverage, one route.
- `GET  /api/v1/operations` — paginated registry (R-9.8), filterable by resource/kind/danger.
- `GET  /api/v1/operations/{operation}` — schema, scope, danger, gates, error codes.
- `GET  /api/v1/whoami` — org, acting user, live effective permissions, scopes, limits.
- **Generated typed aliases** for the curated set: `GET /api/v1/projects`,
  `GET /api/v1/projects/{id}`, `POST /api/v1/projects/{id}/line-items`, … emitted from the
  registry so REST and the dispatcher can't drift.
- `GET /api/v1/openapi.json`, `GET /llms.txt`.

Cross-cutting: `runtime = "nodejs"` (AsyncLocalStorage + node:crypto), bearer-only auth so
CSRF is structurally N/A (no cookie path — R-8.11.1), deny-by-default CORS with no
credentials, `x-request-id` propagated from the existing middleware, per-key request log.
Webhooks already exist (FEATUREDOCS/58) and need only the `api.*` event additions.

## 12. MCP surface (`/api/v1/mcp`) — phase two, thin by design

Streamable HTTP MCP over the **same dispatcher**. 512 operations cannot be 512 tools — no
model reasons well over that list. Three tiers:

1. **~25 curated tools** for the jobs agents actually do: `search_assets`, `get_asset`,
   `check_availability`, `list_projects`, `get_project`, `create_project`,
   `add_line_items`, `reserve_items`, `release_items`, `swap_asset`, `stage_pick_list`,
   `dispatch_gear`, `receive_gear`, `list_crew`, `assign_crew`, `get_warehouse_status`,
   `create_maintenance`, `list_overbookings`, `get_project_financials`, `whoami`.
   Naming is `verb_object`, objects matching the read vocabulary exactly so an agent can
   correlate a write result with a later `get_*`.
2. **Discovery + generic dispatch** — `list_operations(filter, cursor)`,
   `describe_operation(name)`, `call_operation(name, args, confirm?, idempotencyKey?)`.
   This is how the *full* surface stays reachable without tool-list explosion.
3. **MCP resources + prompts** — `llms.txt` and the OpenAPI spec as resources; prompt
   templates for the recurring workflows (weekly availability sweep, prep-sheet review,
   overbooking triage).

Every tool description states: prerequisites, the FROM→TO transition, whether it's
preview-first, the exact scope string, idempotency behaviour, and its error codes — the
descriptions *are* the docs, and they're generated from the registry.

## 13. Observability, limits, budgets

- **Rate limits** — a new `agentRead` / `agentWrite` token bucket in
  `convex/lib/rateLimiter.ts`, keyed on `apiKeyId`, separate from `browserWrite` so an agent
  can't starve the human it acts as. Per-key overrides for trusted internal keys.
- **Kill switches, three levels** — `systemFlags.writesDisabled` / `disabledDomains`
  (existing, now covering agents), the per-org `apiKillSwitchAt` (existing), per-key revoke.
- **Per-key request log** — last ~200 calls (ts, operation, status, error code, missing
  scope, latency, requestId, redacted args) for self-serve debugging. PII-scrubbed per
  R-8.12.4 / `docs/pii-inventory.md`; args are redacted, not stored raw.
- **PostHog** — `api_request` / `mcp_tool_call` events with cuid-only props; p95 latency SLO
  per R-9.11 registered in the README budget table; alert at 80% (R-9.2).
- **Versioning from day one** — `/v1`, `rvlt_flow.v1.*` MCP namespace, versioned webhook
  events, in-band `warnings[]` plus a version header (the only channel an autonomous agent
  reliably consumes).

## 14. Build plan

**Phase 0 — pattern-prover (gates everything else).** One vertical: API key → agent token →
`api.lineItemWrites.addNative` on a `CONFIRMED` project. Must demonstrate, with tests:
overbooking rejected under concurrency; `allowOverbook: true` rejected without the scope;
`FINANCIALS_LOCKED` on a money field; `JUSTIFICATION_REQUIRED` at ON_SITE; audit row carries
`apiKeyId`; `requireService`-gated `api.projectLineItems.create` **rejected** for the agent
token; cross-org args rejected. If this holds, every other operation is a template.

**Phase 1 — foundations.** `kind: "agent"` in `getAuthContext`; agent-token minter (+ the
"sub must equal actingUserId" test); `requireAgentScope`; agent rate-limit buckets;
`apiIdempotency` table; error envelope; the guard/reachability classifier + privileged-arg
CI gate; the registry generator and its staleness gate.

**Phase 2 — API core.** `/api/v1/ops/{operation}`, `/operations`, `/whoami`; the arg
normalizer; the Zod validation registry; per-key request log; OpenAPI + `llms.txt`.
*Ships useful on its own — this is the "full customisation" milestone.*

**Phase 3 — coverage sweep (the long pole).** Per domain, in agent-value order: migrate
`requireOrgRead` → `requireOrgReadFor`, triage the SERVICE-only queries (widen / sibling /
deny), extend the Zod registry, write the `agentOps` annotations. Each domain is an
independently shippable PR, and the classifier prints remaining coverage on every one.

**Phase 4 — safety rails.** Preview→commit tokens for availability-affecting writes;
`danger` classification pass across all 272 writes; confirmation enforcement; bulk-revert
tooling ("undo everything key X did between T1 and T2").

**Phase 5 — key management UX.** Rebuild `/settings/api-keys`: scope presets
(`read_only_agent`, `warehouse_operator`, `finance_reader`, `full_agent`), one-click
"Connect an AI Agent" producing a copy-paste MCP config, a "Test connection" button echoing
the org name, the per-key request log, rotation with a grace window, kill switch. Target
time-to-hello-world < 5 minutes.

**Phase 6 — MCP.** `/api/v1/mcp` over the same dispatcher; the 25 curated tools; discovery +
`call_operation`; resources + prompts; the tool-manifest staleness gate.

**Phase 7 — polish.** Webhook `api.*` events; SDK snippets; docs site page; a Mira wiring
spike (`MiraContextProvider` already exists — the in-app assistant becomes the first
first-party MCP consumer).

## 15. Testing (highest value first)

The previous build's 106 tests were removed with it. The critical set, re-derived:

1. **Cross-tenant isolation under the agent token** — for every reachable operation, args
   naming another org's row must fail. Extend `convex/xtenantHardening.test.ts` (already
   the harness for this) with an agent-identity variant. This is the R-8.4.3 Critical class.
2. **`requireService` unreachability** — a parameterised test asserting **every**
   service-only function rejects an agent token. This is the invariant the whole design
   rests on; it must be machine-checked, not argued.
3. **Gate parity matrix** — for each gate (lifecycle tiers × financial/structural, blocking
   comments, overbooking, bulk cap, money bounds, kill switch, rate limit): the same
   scenario via UI-equivalent user token and via agent token produce the *same* rejection.
   Any divergence is a bypass.
4. **Scope ∩ RBAC** — reuse `permissionsCore` as the parity oracle: a `read`-only key on an
   `owner` acting user is still read-only; a `*` key on a `crew` user is still crew-limited.
5. **Privileged-arg enforcement** — one test per row in the §6 table.
6. **Idempotency** — replay returns `replayed:true`; concurrent same-key returns
   `IDEMPOTENT_IN_PROGRESS`; deterministic-id replay of a create writes exactly one row.
7. **No privilege escalation through minting** — `assertScopesWithinActor` (already written
   and tested) holds on the new path.
8. **Registry/manifest staleness** — regenerate and diff, in CI.
9. **Integration** — Convex's JWKS test-trust caveat means the shared dev deployment won't
   trust locally-minted test keys; stub at `getAuthContext` for unit-level RBAC and use a
   real preview deployment for the concurrency and end-to-end tests (same approach the
   previous build used).

## 16. Open questions

1. **`requireOrgRead` migration size.** ~350 call sites gain one argument. Codemod-able, but
   it touches nearly every read module. Alternative considered and rejected: derive the
   resource from the module filename (hidden coupling, and unenforceable). Confirm the
   incremental fail-closed rollout is acceptable — it means the API's read coverage grows
   over Phase 3 rather than landing complete on day one.
2. **Field-level read sensitivity.** Scopes are `resource:action`; cost/margin visibility is
   gated by `isCallerManagerPlus` against the *acting user*, which is correct but coarse — a
   `read_only_agent` acting as an owner sees margins. Do we want a `no_financials` key flag
   that forces `redactFields` regardless of the acting user's role? (Recommended, cheap,
   Phase 4.)
3. **`justification` from an AI.** An agent can satisfy the JUSTIFY gate by writing prose.
   Attributable and reviewable, but is "agent-authored justification" acceptable at all, or
   should JUSTIFY-tier structural edits be `agentAccess:"denied"` by default like unlock
   sessions? This is a product call, not a technical one.
4. **Idempotency atomicity.** Accept the deterministic-id trade (§9), or invest in threading
   an idempotency arg through the write mutations later?
5. **Trust ramp.** Internal agents + same-org power users only, as before. A public
   third-party developer platform (OAuth apps, quotas, marketplace) stays out of scope.

## 17. Not in scope

Public third-party developer platform (OAuth apps, marketplace, quotas); raw table CRUD
(structurally excluded, §3); billing/packaging of API access; exposing `allowOverbook` by
default; USER-token minting for browser use; replacing the surviving server-action carve-outs
(email, SSO, CSV, cron, Xero OAuth) — those get thin `ops/*` wrappers if an agent needs them,
not a rewrite.
