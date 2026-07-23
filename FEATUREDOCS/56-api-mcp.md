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

Rebuild the surface over native Convex queries/mutations (a
`CONVEX_READS`/`CONVEX_WRITES` bridge), not over `src/server/*.ts` — that
coupling is exactly what got this removed. The full original design —
ambient-actor auth, the generated operations registry, scope ∩ RBAC
enforcement, confirmation/idempotency rails, the two-tier MCP tool surface,
`llms.txt`, OpenAPI generation, and every hard-won review finding (org-scoping
holes in bridged reads, idempotency-before-effect ordering, no-privilege-
escalation-through-minting, MCP tool-list staleness) — is preserved in full
detail in the design of record:
[`docs/designs/archive/api-mcp-agent-access.md`](../docs/designs/archive/api-mcp-agent-access.md).
Read that before rebuilding; don't rediscover those findings the hard way twice.

## What shipped before removal (for scale/scope reference)

Coverage was complete: 537 operations (every server action the UI called,
plus 29 Convex-only reads), REST (`/api/v1/*`) + MCP (27 tools, 2-tier:
curated + generic `call_operation`), OpenAPI 3.1, and ~106 unit tests.
Verified end-to-end against the shared dev DB + dev Convex on 2026-07-09,
five days before removal — it worked; it was removed for architectural
sequencing (Convex-native migration), not because it was broken.
