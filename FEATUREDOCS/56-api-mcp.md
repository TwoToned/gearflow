# 56 — Agent-Accessible API + MCP

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

> **⚠️ REMOVED 2026-07-14 (dormant — to be reinstated).** The entire agent-API
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

## What shipped before removal (for scale/scope reference)

Coverage was complete: 537 operations (every server action the UI called,
plus 29 Convex-only reads), REST (`/api/v1/*`) + MCP (27 tools, 2-tier:
curated + generic `call_operation`), OpenAPI 3.1, and ~106 unit tests.
Verified end-to-end against the shared dev DB + dev Convex on 2026-07-09,
five days before removal — it worked; it was removed for architectural
sequencing (Convex-native migration), not because it was broken.
