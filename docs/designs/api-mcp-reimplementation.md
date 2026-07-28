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
**Decisions:** the 12 forks in §0 were settled with the owner on 2026-07-28 and are
recorded there as the authoritative answers; the rest of this document follows from them.
**Tracking:** [#995](https://github.com/TwoToned/gearflow/issues/995) — phases 0–8 are
[#996](https://github.com/TwoToned/gearflow/issues/996) (pattern-prover),
[#997](https://github.com/TwoToned/gearflow/issues/997) (foundations),
[#998](https://github.com/TwoToned/gearflow/issues/998) (API core + read bootstrap),
[#999](https://github.com/TwoToned/gearflow/issues/999) (MCP, bearer),
[#1000](https://github.com/TwoToned/gearflow/issues/1000) (safety rails),
[#1001](https://github.com/TwoToned/gearflow/issues/1001) (coverage sweep),
[#1002](https://github.com/TwoToned/gearflow/issues/1002) (key UX),
[#1003](https://github.com/TwoToned/gearflow/issues/1003) (MCP OAuth),
[#1004](https://github.com/TwoToned/gearflow/issues/1004) (polish).
**Related:** [FEATUREDOCS/56](../../FEATUREDOCS/56-api-mcp.md),
[54 (Convex data layer)](../../FEATUREDOCS/54-convex-data-layer.md),
[62 (project lifecycle locks)](../../FEATUREDOCS/62-project-lifecycle-locks.md),
[58 (webhooks)](../../FEATUREDOCS/58-webhooks.md),
[04 (auth/permissions)](../../FEATUREDOCS/04-auth-permissions.md)

---

## 0. Settled decisions (2026-07-28)

| # | Fork | Decision |
|---|------|----------|
| 1 | Agent writes on JUSTIFY-tier projects (ON_SITE/RETURNED) | **Allowed**, but `danger:"high"` → `confirm:true` required, and agent-authored justifications are badged/filterable in the activity log for review |
| 2 | `requireOrgRead` → resource migration (~350 sites) | **Incremental, fail-closed.** Unmigrated reads are invisible to agents; migrate per domain, each an independently shippable PR |
| 3 | First end-to-end target | **You + Claude Code over MCP.** MCP moves ahead of the key-management UI (see §14 and the read-bootstrap consequence) |
| 4 | MCP clients | Claude Code/dev tools, claude.ai + desktop connectors, a local stdio proxy, **and eventually third-party agents** |
| 5 | Public developer platform | **Design for it now, ship it later.** No third-party code in v1, but every v1 decision is made as if it were public |
| 6 | Cost/margin exposure | **`no_financials` per-key flag** forcing `redactFields` regardless of the acting user's role |
| 7 | Destructive writes (delete/archive/bulk) | **Allowed** with `confirm:true` + `idempotencyKey` + per-resource scope; agent bulk cap **50** (vs the human 500); bulk-revert tooling by `apiKeyId` + time window |
| 8 | Idempotency atomicity | **Accept the deterministic-id trade** — no mutation signatures change |
| 9 | MCP OAuth 2.1 | **Bearer first (Phase 3), OAuth right after (Phase 7)** — same dispatcher, so OAuth is a pure auth adapter |
| 10 | Warehouse check-out / check-in (physical-world writes) | **Allowed** with an explicit `warehouse:check_out` / `check_in` scope + `confirm:true` + idempotency. Not in any default preset |
| 11 | Preview→commit tokens | **Dropped.** The overbooking check now runs *inside* the mutation, so the TOCTOU those tokens existed to close no longer exists. Keep the enriched `conflicts[]` + `suggestions[]` rejection |
| 12 | Compatibility guarantee | **Additive-only within `/v1`.** Curated ops + error codes are stable contract; the generic `call_operation` surface is explicitly "tracks the app, may change" |

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

### Phase 0 findings (2026-07-28) — what the pattern-prover actually showed

Required by #996's definition of done. All eight assertions are green
(`convex/agentVertical.test.ts`), so the architectural premise holds and Phase 1
was unblocked. Four things behaved differently than predicted, all recorded here
rather than quietly absorbed.

**1. Assertion 6 is stronger than the design claimed, and it was cheap to prove
exhaustively.** The plan was one representative rejection. Because Convex attaches
`exportArgs()` to every registered function, arguments can be synthesised from a
function's own validator — so `convex/agentServiceUnreachable.test.ts` *invokes
all 602* service-gated functions with an owner-backed wildcard key and asserts
each rejects. 602/602 reached the handler and threw the service guard. The
invariant the whole design rests on is now machine-checked across the tree, not
argued from a sample.

**2. The static guard classifier was wrong, and only the runtime probe found it.**
Extracting `(resource, action)` by reading the `requireOrgPermission` call is
sound, but the first implementation took the FIRST match per handler.
`collaboration.createThread` gates conditionally — `project:manage_line_items` for
a blocking comment, `project:read` otherwise — so the registry advertised a scope
that a non-blocking call does not need. Nothing else would have caught it: the
generator was self-consistent, the staleness gate compared it against itself, and
the operation worked. The fix is `scopePairs` (every pair a handler can enforce,
with the singular fields nulled when there is more than one) plus the probe that
withholds exactly the declared scope. **Generalisable lesson for §7: a
statically-extracted contract needs a runtime probe, or it is only a hypothesis.**

**3. Reads fail closed harder than §14's read-bootstrap estimate implies.** The
design predicted ~21 queries carrying a resource; measured, it is 20 queries and
258 mutations reachable, with **216 reads** still on the resource-less guard. The
"can write, can barely read" shape §14 warns about is real and is now visible on
every PR (`docs/api-coverage.md`). No change to the plan — the read bootstrap
stays Phase 2 — but the number to migrate is the one to plan against.

**4. `assertBulkSizeOk` had to become async and ctx-taking.** §9 describes it
taking "the cap from the auth kind", which reads as a parameter change; the cap
must actually come from the *verified identity*, since a caller-supplied hint
would defeat the point. Three call sites, no behaviour change for humans.

Two things behaved exactly as designed and are worth recording as confirmed: the
in-mutation availability check makes a divergent commit unrepresentable (decision
11's premise — preview→commit tokens really are unnecessary), and stamping the
agent attribution inside `writeActivityLog` rather than at each call site gave all
~272 write paths the audit trail at once with no schema change.

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
- A ~40-query **read bootstrap** lands in Phase 2 (see §14); the rest migrate per domain in
  Phase 5, ordered by agent value (assets → projects → availability →
  crew → warehouse → finance). The change is one argument per call site; a codemod plus the
  Phase-1 classifier tracks the remainder.

### The `no_financials` key flag (decision 6)

Scopes are `resource:action`; cost/margin visibility is a *field*-level concern gated by
`isCallerManagerPlus` against the **acting user**. So a read-only key acting as an owner
still sees full margins — correct by the "key acts as a human" model, wrong if the
transcript leaves the building.

Fix: a boolean `noFinancials` on the `apiKeys` document. When set, the read guards force
`redactFields` over the cost/margin field families **regardless** of the acting user's role,
reusing the existing redaction path (`convex/lib/auth.ts` `redactFields`, the
`crewRoles.listForSettings` vs `list` precedent). Chosen over a separate `finance:*` scope
family because it needs no new vocabulary and can't be partially granted by mistake.
Enforcement lands in Phase 4; the settings toggle in Phase 6.

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
| `justification` | 50 | `assertLifecycleGuard` JUSTIFY tier | **Allowed** (decision 1) — it is the human-equivalent act. `danger:"high"` → `confirm:true`; the audit row already carries `justification` + `apiKeyId` via `lifecycleAuditMetadata`, and the activity log gains an **agent-justified filter/badge** so these edits are reviewable as a set rather than buried. |
| `projectUnlockSessionsWrites.openNative` | — | HARD_LOCKED / FINANCE_LOCKED escape | **`agentAccess:"denied"` by default.** Opening an unlock session is the one true lock override; it also needs `isHardLockOverrideAllowed` (admin/owner/assigned PM). Enabling it for a key requires the explicit `project:unlock_session` scope, off in every preset. |
| `overrideReason` | 6 | line-item override trail | Allowed; `danger:"medium"`, string-bounded. |
| `forceSeparate` | 2 | merge-dedup | Allowed; cosmetic. |
| `emitSideEffects` | 12 | webhook/side-effect fold | Dispatcher-injected `true` — never agent-controlled. |
| `allowOrgCreation` | 5 | `siteSettings` | Site-admin surface; `agentAccess:"denied"`. |

Two further scope-gated capabilities that aren't args but belong to the same family
(decision 10): `warehouse:check_out` and `warehouse:check_in` are **physical-world**
transitions — gear leaves the building. They are agent-callable, but require their own
explicit scope, `confirm:true` and an idempotency key, and appear in **no default preset**;
granting one is a deliberate operator act.

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
coverage is tracked per-domain in Phase 5.

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

**Confirmation.** Operations classified `danger:"high"` — stock-affecting, irreversible,
lock-softening, delete/archive, financial issue/void, warehouse movement, bulk destructive —
require `confirm: true` **and** an `idempotencyKey`. A missing `confirm` returns
`CONFIRMATION_REQUIRED` with a rendered summary of what the call would do, so an agent's
natural next step is to show a human and re-call.

**No preview→commit tokens** (decision 11). The archived design specified a content-bound
`confirmationToken` carrying an inventory snapshot, with `STALE_PREVIEW` on divergence. That
existed to close the old check-then-write TOCTOU — and that race is gone: the availability
check now runs *inside* the same mutation as the insert, so a divergent commit is not
representable. A stale attempt simply fails the write with `INVENTORY_CONFLICT` +
`conflicts[]` + `suggestions[]`. Dropping the token subsystem removes a whole moving part
for a guarantee the data layer already provides.

**Destructive writes** (decision 7) are allowed, with three limits:
- a per-resource scope (`asset:delete`, `project:delete`, …), granted in no read-only preset;
- `confirm:true` + `idempotencyKey`;
- **agent bulk arrays capped at 50**, against the human `MAX_BULK_ITEMS` of 500
  (`convex/lib/rateLimiter.ts`). `assertBulkSizeOk` takes the cap from the auth kind, so one
  confused agent call has a small blast radius. Over-cap returns `BULK_TOO_LARGE` telling the
  agent to split.

**Bulk revert.** Because every agent write's audit row carries `apiKeyId`, a
`revertAgentWindow(apiKeyId, from, to)` operator tool can enumerate and reverse a bad run
using the existing reverse-mutations (`undeployItems` / `unreturnItems` / `undeprepLine`,
archive restores). This is the real safety net behind "let the agent write" — Phase 4.

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
whether it needs `confirm:true`, the exact scope string, idempotency behaviour, and its
error codes — the
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
### Compatibility policy (decisions 5 + 12)

Third-party consumers don't ship in v1, but every v1 decision is made **as if they had**, so
nothing needs re-litigating when they do. Concretely, two stability tiers, declared per
operation in the registry and stated in the OpenAPI description:

- **`stability: "stable"`** — the ~25 curated operations, the error `code` vocabulary, the
  scope vocabulary, the envelope shape, and webhook event schemas. **Additive-only within
  `/v1`**: fields and operations may be added, never removed or narrowed. A breaking change
  means `/v2`.
- **`stability: "tracks-app"`** — the generic `call_operation` surface and everything reached
  through it. Explicitly documented as following the app's internals, so ordinary Convex
  refactors are not breaking API changes. This is the release valve that keeps additive-only
  honest instead of freezing the codebase.

Mechanics from day one: `/v1` path prefix, `rvlt_flow.v1.*` MCP namespace, versioned webhook
events (`project.status_changed.v1`), an `X-RVLT-Flow-API-Version` response header, and
in-band `warnings[]` — the only deprecation channel an autonomous agent reliably consumes.
A CI test fails if a `stable` operation's generated schema loses a field or an op disappears.

## 14. Build plan

Ordered for decision 3 — **you, in Claude Code, over MCP** is the first thing that works.
That pulls MCP ahead of the key-management UI and forces one refinement, below.

> ### ⚠ The read-bootstrap consequence (found while re-sequencing)
> Decision 2 makes `requireOrgRead`/`requireOrgReadDoc` fail closed for agents until each
> call site is migrated. Only **~21 queries** use `requireOrgPermission` (which carries a
> resource) today; the other 215 org-guarded reads don't. Writes, by contrast, almost all use
> `requireOrgPermission` and are reachable immediately.
>
> So a naive ordering yields an MCP server that can **write** to 272 operations but can barely
> **read** anything — the worst possible first impression, and genuinely dangerous (an agent
> acting with no ability to check its work).
>
> **Fix:** a *read bootstrap* is pulled into Phase 2 — migrate ~40 hand-picked queries
> covering assets, models, projects, availability, clients, crew and warehouse status, chosen
> so the curated MCP tool set is fully backed. Writes stay gated behind Phase 4's `danger`
> pass. **Reads land before writes**, which is the right order for trust anyway.

**Phase 0 — pattern-prover (gates everything else).** One vertical: API key → agent token →
`api.lineItemWrites.addNative` on a `CONFIRMED` project. Must demonstrate, with tests:
overbooking rejected under concurrency; `allowOverbook: true` rejected without the scope;
`FINANCIALS_LOCKED` on a money field; `JUSTIFICATION_REQUIRED` at ON_SITE; audit row carries
`apiKeyId`; `requireService`-gated `api.projectLineItems.create` **rejected** for the agent
token; cross-org args rejected. If this holds, every other operation is a template.

**Phase 1 — foundations.** `kind: "agent"` in `getAuthContext`; agent-token minter (+ the
"sub must equal actingUserId" test); `requireAgentScope`; agent rate-limit buckets +
kind-aware bulk cap; `apiIdempotency` table; error envelope; the guard/reachability
classifier + privileged-arg CI gate; the registry generator and its staleness gate.

**Phase 2 — API core + read bootstrap.** `/api/v1/ops/{operation}`, `/operations`,
`/whoami`; the arg normalizer; the Zod validation registry; per-key request log; OpenAPI +
`llms.txt`; the ~40-query read bootstrap above. *Ships useful on its own — this is the "full
customisation" milestone, verifiable with curl.*

**Phase 3 — MCP over bearer keys (first AI milestone).** `/api/v1/mcp` streamable HTTP on
the same dispatcher; the ~25 curated tools; `list_operations` / `describe_operation` /
`call_operation`; resources + prompts; the tool-manifest staleness gate; the local stdio
proxy (decision 4). Key minted by hand from the existing `createApiKey` server action — no
UI needed yet. **This is the "wire it into Claude Code and ask it real things" milestone.**

### Phase 3 findings (2026-07-28) — what building the MCP layer actually showed

Required by #999's acceptance criteria. Recorded here rather than quietly absorbed,
same convention as §3's Phase 0 findings.

**1. §12's ~25 curated tools landed at 20 (19 named + `whoami`).** All 19 names from
the issue/design list are present; the count reads lower only because "~25" was always
an estimate and 19 covers every named job without inventing a 20th.

**2. Two of the 19 — `reserve_items`/`release_items` — don't have a 1:1 "reserve"
primitive in the registry, because the app doesn't model a reservation as a distinct
entity.** Booking gear (line-item add) already reserves it — the in-mutation
availability check runs on every add — so a naive mapping would have made
`add_line_items` and `reserve_items` two names for the same call. Resolved by mapping
`reserve_items` → `warehouseWrites.reassignLineItemUnit` (committing a specific
serialized unit to a line item — a real, distinct staging action) and `release_items` →
`warehouseWrites.undeprepLine` (its inverse). Both are genuinely different operations
from `add_line_items`/`lineItemWrites.removeNative`, not renames.

**3. `search_assets` has no server-side search.** `assets.list` — the only reachable
assets read — takes just `orgId`; there's no query/filter param in the Convex validator
to widen into. Rather than invent search capability (out of Phase 3's "protocol adapter,
no business logic" charter, and squarely Phase 5 territory if it needs a new
`requireOrgReadFor` migration or a new query), `search_assets` returns the full list and
the tool description says so plainly — filtering is left to the calling agent, which is
a normal and correct pattern for an LLM client.

**4. `agentOps` (§7's planned per-operation annotation) doesn't exist yet — it's Phase 5
scope, and Phase 3 didn't need to pull it forward.** Curated-tool prose
(summary/prerequisites/transition) lives in a Phase-3-scoped hand-authored table,
`src/lib/api/mcp/curated-tool-defs.ts`, combined with registry-derived facts (scope,
idempotency, schema, error codes) by the manifest generator. Migrate this table into
`agentOps` when Phase 5 builds it, rather than keeping both as parallel sources.

**5. The `X-RVLT-Flow-API-Version` header and `warnings[]` channel (§13) hadn't actually
been wired up despite being described as "mechanics from day one."** Phase 2 shipped
without them. Since Phase 3 is where the gap was noticed and MCP needed *a* versioning
story anyway, the header was added to every `/api/v1` REST response too (not just MCP)
in the same PR — cheap, additive, and it closes the gap instead of only half-fixing it
for the new surface. `warnings[]` stays documented-but-empty: no operation is deprecated
yet, so there's nothing for it to carry, and adding a permanent empty array to the
existing (already-tested) REST envelope shape felt like a change looking for a reason
rather than a real need.

**6. Rate limits were left at the Phase 1 proposal, not recalibrated.** #999's
acceptance criteria ask for calibration "from a real session." A curated-tool MCP
session (one tool call per agent turn) generates meaningfully less traffic than the
REST dispatcher's original design point (an arbitrary script hitting `/ops/*` in a
loop), and manual testing stayed comfortably under both `agentRead` (600/min) and
`agentWrite` (60/min). Recorded as "not recalibrated, evidence points the current
numbers are conservative rather than tight" — genuine production volume, once it
exists, is a better input than a manually-driven session count.

**Phase 4 — safety rails (gates writes going wide).** `danger` classification pass across
all 272 writes; `confirm` + idempotency enforcement; the agent bulk cap; `no_financials`
enforcement; the agent-justified activity-log badge/filter; bulk-revert tooling
(`revertAgentWindow`). Until this lands, agent write scopes stay off in every preset.

**Phase 5 — coverage sweep (the long pole).** Per domain, in agent-value order: migrate the
remaining `requireOrgRead` → `requireOrgReadFor`, triage the 152 SERVICE-only queries
(widen / sibling / deny), extend the Zod registry, write the `agentOps` annotations. Each
domain is an independently shippable PR; the classifier prints remaining coverage on every one.

**Phase 6 — key management UX.** Rebuild `/settings/api-keys`: scope presets
(`read_only_agent`, `warehouse_operator`, `finance_reader`, `full_agent` — none granting
delete, warehouse movement, unlock sessions or `allow_overbook`), one-click "Connect an AI
Agent" producing a copy-paste MCP config, "Test connection" echoing the org name, the
per-key request log, rotation with a grace window, kill switch, the `no_financials` toggle.
Target time-to-hello-world < 5 min.

**Phase 7 — MCP OAuth 2.1 (decision 9).** Authorization-server metadata, dynamic client
registration, consent screen, token exchange → an agent token. Purely an auth adapter in
front of the Phase 3 dispatcher, so no rework. Unlocks claude.ai + desktop connectors for
non-technical staff.

**Phase 8 — polish + external readiness.** Webhook `api.*` events; SDK snippets; docs-site
page; Mira wired as a first-party consumer (`MiraContextProvider` already exists); the
`stability` tier annotations and the additive-only CI check hardened ahead of any
third-party program.

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

## 16. Remaining open questions

The twelve design forks are settled (§0). What's left is calibration, answerable during the
build rather than before it:

1. **Rate-limit numbers.** Starting proposal: `agentRead` 600/min (burst 200), `agentWrite`
   60/min (burst 20) per key — deliberately far below the human `browserWrite` 300/min so a
   looping agent is throttled long before it's noticed by a human. Needs one real MCP session
   to calibrate.
2. **Request-log retention.** R-8.12.2 requires a registered retention period (T-P2) for the
   per-key request log, since redacted args can still carry business context. Proposal: 30
   days, aged out by a Convex cron. Needs registering in `docs/exceptions.md` / the README
   budget table.
3. **Preset composition.** Which exact scope sets ship as `read_only_agent`,
   `warehouse_operator`, `finance_reader`, `full_agent` — a Phase 6 detail, but worth your eye
   since presets are what most keys will actually use.
4. **`allow_overbook` for agents at all.** Currently a grantable scope. It may be better as a
   permanent deny — a human deliberately overbooking is a judgement call; an agent doing it is
   almost always a mistake. Cheap to decide later; the scope exists either way.

## 17. Not in scope for v1

Third-party consumers (**designed for**, per decision 5, but no OAuth apps, client
registration, quotas, marketplace or public docs ship in v1 — Phase 7 delivers OAuth for
same-org staff only); raw table CRUD (structurally excluded, §3); billing/packaging of API
access; USER-token minting for browser use; replacing the surviving server-action carve-outs
(email, SSO, CSV, cron, Xero OAuth) — those get thin `ops/*` wrappers if an agent needs them,
not a rewrite.
