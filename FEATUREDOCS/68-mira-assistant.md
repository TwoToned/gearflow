# 68 — Mira (in-app assistant)

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-29 (review quarterly — POLICY.md R-5.5)_

## What this is

Mira is RVLT Flow's in-app assistant. `MiraContextProvider`
(`src/components/providers/mira-context-provider.tsx`) has existed since before this
phase, holding just the assistant's open/closed state and an arbitrary `pageContext`
object — deliberately trivial so it never delays paint, with the actual assistant UI
deferred to its own mount point.

**Phase 8 (#1004)** wired the first real consumer on top of that provider: Mira answers
a question by calling the **same agent-accessible API/MCP surface** an external agent
would (FEATUREDOCS/56), not a separate code path. This is "dogfooding the API by
shipping product" — every Mira call is a real dispatcher call, gated by the same RBAC,
scopes, and lifecycle locks as anything else, and shows up in the asking user's
per-key request log (Settings → API keys → request log) like any other API traffic.

## Architecture

```
MiraContextProvider (open, pageContext)
        │
        ▼
MiraLauncher (trigger button, next/dynamic-loads the panel)
        │
        ▼
MiraPanel ("use client" — question box + transcript)
        │  askMira(question, pageContext)   [server action]
        ▼
src/server/mira.ts
        │  1. getOrProvisionMiraToken(org, user)
        │  2. routeMiraQuestion(question, pageContext)  → { operation, args } | null
        │  3. dispatch(operation, { args }, `Bearer <token>`, requestId)
        │  4. formatMiraAnswer(operation, data)
        ▼
src/lib/api/dispatcher.ts  (THE SAME dispatcher REST/MCP use)
```

## Mira's own API key — one per (org, user), never a fixed "system" identity

Mira acts **as the asking user**, not as a privileged service account. That is the
same design principle the whole agent-token architecture rests on (FEATUREDOCS/56 §3:
"an agent behaves as a user everywhere") — a member should never get more access
through Mira than their own role already grants, and an admin should never get less.

This forces a per-user key: an agent token's `sub` (acting user) is baked into the
signed JWT from `apiKeys.actingUserId` at mint time, and `assertAgentTokenPayload`
(`src/lib/api/agent-token.ts`) refuses to mint one where `sub` doesn't match the key's
own `actingUserId` — **there is no "impersonate a different user" parameter anywhere
in that module, by design.** So Mira cannot share one org-wide key across users; it
provisions its own `apiKeys` row per (organizationId, userId), lazily, on first use
that actually needs one (`getOrProvisionMiraToken`, `src/server/mira.ts`).

**The one-time-reveal problem, and why `miraKeys` exists.** A human-managed key's raw
secret is shown exactly once and only its hash is ever stored (`src/server/api-keys.ts`)
— correct for a key a person copies into a client, wrong for a key the SERVER itself
must reuse on every question. `miraKeys` (`convex/schema.ts`/`convex/miraKeys.ts`) is a
small SERVICE-only table storing that one secret **encrypted at rest** with the same
vault already trusted for round-tripping third-party secrets
(`src/lib/crypto/secret-vault.ts` — the same mechanism protecting Xero OAuth tokens),
decrypted only by `src/server/mira.ts`, never sent to the browser.

**Provisioning bypasses `createApiKey`'s own permission gate on purpose.** The general
`createApiKey` server action requires `orgSettings:update` (an admin deliberately
managing keys). Mira's provisioning path calls the underlying Convex mutations
directly instead, so any org member can get their own Mira key without admin
involvement. This is safe specifically because the preset is fixed
(`read_only_agent` — the same preset "Connect an AI Agent" on `/settings/api-keys`
uses; `noFinancials: true`) and the key always acts as the caller — the intersection
with that caller's live RBAC (FEATUREDOCS/56) means Mira can never grant anyone
capability their own role doesn't already have. For the same reason this path does
**not** fire the `api_key.created` webhook (see FEATUREDOCS/58) — that event is for
keys an operator deliberately created, not Mira's silent internal plumbing.

## The question router — deterministic today, not an LLM

`src/lib/mira/intent-router.ts`'s `routeMiraQuestion(question, pageContext)` maps a
question to **one** curated MCP operation call (`{ operation, args }`) using simple
keyword matching plus page context, e.g.: on a project page, a non-asset-shaped
question routes to `projectDetail.bundle` for THAT project; an asset-shaped question
(`/asset|assets|equipment|gear|inventory/i`) routes to `assets.list`; anything else
gets a fixed "here's what I can help with" answer and — deliberately — never
provisions a key or calls `dispatch()` at all (no wasted key-mint, no log-noise for a
question Mira can't answer).

This is intentionally the smallest thing that makes the acceptance criterion true
("Mira answers a page-contextual question through the MCP surface, with page context
flowing into the agent's tool calls automatically") without taking on a whole separate
feature: adding a real LLM tool-use loop behind `askMira` is future work, and nothing
downstream of `routeMiraQuestion` needs to change to add it — swap the router,
`dispatch()` stays the same. `src/lib/mira/format-answer.ts` is the equally small
mirror on the way out: one case per operation the router can return, turning the raw
result into a sentence.

## Page context

`src/hooks/use-mira-page-context.ts`'s `useMiraPageContext(context)` publishes "what
the user is currently looking at" into the provider on mount and clears it on unmount
— a one-line call from any page. The project detail page
(`src/app/(app)/projects/[id]/page.tsx`) is the first caller:
`useMiraPageContext({ entityType: "project", entityId: id })`. Extend this to other
detail pages (assets, clients, …) the same way as their own Mira routes are added to
`intent-router.ts`.

## Related

- FEATUREDOCS/56 (Agent-Accessible API + MCP) — the surface Mira calls into; the agent
  auth kind, scope model, and safety rails all apply unchanged.
- FEATUREDOCS/58 (Webhooks) — why Mira's own key provisioning doesn't fire
  `api_key.created`.
- `docs/designs/api-mcp-reimplementation.md` §12 — the curated MCP tool set
  `routeMiraQuestion` dispatches into.
