# 68 — Mira (in-app assistant)

> _Owner: Jayden Nawotka · Last reviewed: 2026-08-02 (review quarterly — POLICY.md R-5.5)_

## What this is

Mira is RVLT Flow's in-app assistant. `MiraContextProvider`
(`src/components/providers/mira-context-provider.tsx`) holds just the assistant's
open/closed state and an arbitrary `pageContext` object — deliberately trivial so it
never delays paint, with the actual assistant UI deferred to its own mount point.

Mira answers a question with a real LLM tool-calling loop (OpenRouter) over the **same
agent-accessible API/MCP surface** an external agent would use (FEATUREDOCS/56) — not a
separate code path. Every Mira call is a real `dispatch()` call, gated by the same RBAC,
scopes, and lifecycle locks as anything else, and shows up in the asking user's per-key
request log (Settings → API keys → request log) like any other API traffic.

Each org brings its **own** OpenRouter API key and picks its **own** model
(`/settings/mira`) — the platform never sees or pays for a shared LLM credential.

## Architecture

```
MiraContextProvider (open, pageContext)
        │
        ▼
MiraLauncher (trigger button, next/dynamic-loads the panel)
        │
        ▼
MiraPanel ("use client" — persisted multi-turn thread, markdown rendering)
        │  sendMiraMessage(question, pageContext)   [server action]
        ▼
src/server/mira.ts
        │  1. getMiraLlmConfig(org)        → org's OpenRouter key + model, or bail
        │  2. getOrProvisionMiraToken(org, user, writeAccessEnabled)
        │  3. buildMiraTools({ includeWrites, grantedScopes })   [tool-defs.ts]
        │  4. runMiraAgentLoop({ apiKey, model, messages, tools, executeTool })
        │        │                                                [agent-loop.ts]
        │        ▼  each tool call
        │     dispatch(operation, { args, idempotencyKey }, `Bearer <token>`, requestId)
        │  5. persist every turn to miraConversations/miraMessages
        ▼
src/lib/api/dispatcher.ts  (THE SAME dispatcher REST/MCP use)
```

`executeTool` (in `src/server/mira.ts`) is the one place a tool call actually reaches
Convex: it looks up the tool's underlying operation, mints an idempotency key for a
write, and calls `dispatch()` directly — NOT through the MCP protocol server's
`routeToolCall`/`handleCuratedTool` (`src/lib/api/mcp/build-server.ts`). Same endpoint,
same envelope shape, just without the MCP protocol wrapper Mira doesn't need.

## Mira's own API key — one per (org, user), preset chosen by the org

Mira acts **as the asking user**, not as a privileged service account — the same design
principle the whole agent-token architecture rests on (FEATUREDOCS/56 §3: "an agent
behaves as a user everywhere"). A member should never get more access through Mira than
their own role already grants, and an admin should never get less.

This forces a per-user key: an agent token's `sub` (acting user) is baked into the
signed JWT from `apiKeys.actingUserId` at mint time, and `assertAgentTokenPayload`
(`src/lib/api/agent-token.ts`) refuses to mint one where `sub` doesn't match the key's
own `actingUserId` — **there is no "impersonate a different user" parameter anywhere in
that module, by design.** So Mira provisions its own `apiKeys` row per
(organizationId, userId), lazily, on first use that actually needs one
(`getOrProvisionMiraToken`, `src/server/mira.ts`).

**The one-time-reveal problem, and why `miraKeys` exists.** A human-managed key's raw
secret is shown exactly once and only its hash is ever stored (`src/server/api-keys.ts`)
— correct for a key a person copies into a client, wrong for a key the SERVER itself
must reuse on every question. `miraKeys` (`convex/schema.ts`/`convex/miraKeys.ts`) is a
small SERVICE-only table storing that one secret **encrypted at rest** with the same
vault already trusted for round-tripping third-party secrets
(`src/lib/crypto/secret-vault.ts` — the same mechanism protecting Xero OAuth tokens and,
now, each org's OpenRouter API key), decrypted only by `src/server/mira.ts`, never sent
to the browser.

**Provisioning bypasses `createApiKey`'s own permission gate on purpose.** The general
`createApiKey` server action requires `orgSettings:update` (an admin deliberately
managing keys). Mira's provisioning path calls the underlying Convex mutations directly
instead, so any org member can get their own Mira key without admin involvement. This is
safe because the key always acts as the caller — the intersection with that caller's
live RBAC (FEATUREDOCS/56) means Mira can never grant anyone capability their own role
doesn't already have — regardless of which preset it provisions. For the same reason
this path does **not** fire the `api_key.created` webhook (see FEATUREDOCS/58) — that
event is for keys an operator deliberately created, not Mira's silent internal plumbing.

**Which preset it provisions is an admin-controlled org setting, not a fixed choice.**
`miraOrgSettings.writeAccessEnabled` (default `false`, `/settings/mira`) picks between:

- `false` → `read_only_agent` — every `:read` scope, no writes of any kind (the original
  Phase 8 posture).
- `true` → `full_agent` — every `:read` scope plus ~40 non-destructive write scopes
  (create/update, never delete, never `warehouse:check_out`/`check_in`, never
  `orgSettings:update` — see `src/lib/api-key-presets.ts`'s own doc comment for the full
  exclusion list).

This is a deliberate, admin-gated escalation, not a silent upgrade the next time someone
asks Mira a question: self-provisioning without an admin gate was only ever safe
*because* the preset was fixed and read-only. Once writes are possible, the org's admin
has to opt in explicitly (same `orgSettings:update` gate as every other integration
setting) before ANY member's Mira key can write anything. Toggling the setting in either
direction revokes and deletes every already-provisioned `miraKeys`/`apiKeys` row for the
org (`convex/miraOrgSettings.ts` `patch`) — the next question re-provisions with the
correct preset, so the change takes effect immediately, not just for new members.

Even with write access enabled org-wide, `buildMiraTools` (`src/lib/mira/tool-defs.ts`)
only *offers* the model a write tool whose required scope is actually covered by the
provisioned preset — `dispatch_gear`/`receive_gear`/`reserve_items` need
`warehouse:check_out`/`check_in`, which `full_agent` deliberately excludes, so those
tools are never advertised even when writes are on. Convex's own RBAC is still the real
enforcement; this is "don't advertise a button that's always going to fail."

## The tool-call loop — a real LLM, not a keyword router

`src/lib/mira/tool-defs.ts` derives Mira's tool surface from the SAME curated MCP tool
catalog (`src/lib/api/mcp/curated-tool-defs.ts`, ~20 tools) an external MCP client sees
— never the raw `call_operation` escape hatch or the full ~500-operation registry, so
the model reasons over a small, well-described job list. `idempotencyKey` is stripped
from what the model sees (the agent loop mints one itself per write) and **`confirm` is
never offered to the model at all** — only a human clicking "Confirm" in the chat UI can
set it (`confirmMiraPendingAction`), never the LLM retrying its own tool call. This is a
stronger safety property than the raw MCP surface: even a successfully prompt-injected
model has no parameter to self-approve a high-danger action with.

`src/lib/mira/agent-loop.ts`'s `runMiraAgentLoop` calls the model, executes whatever
tool calls it returns via the injected `executeTool`, feeds results back, and repeats —
bounded by both an iteration count and a wall-clock timeout (`docs/budgets.md` T-P10) so
a confused model can't run away on the org's own OpenRouter spend. When a tool call hits
the dispatcher's `CONFIRMATION_REQUIRED` gate (a `danger:"high"` op — delete/archive,
financial issue/void, bulk-destructive, warehouse dispatch/receive), the loop stops
calling more tools, gives the model exactly one more turn (tools disabled) to explain
what it's waiting on in plain text, and returns a `pendingConfirmation` the chat UI
renders as a Confirm/Dismiss card. Confirming replays the **exact** stored
operation/args/idempotencyKey with `confirm: true` — deterministic server-side code, not
the model retrying — see `confirmMiraPendingAction` in `src/server/mira.ts`.

Deliberately **non-streaming**: one request/response per model turn, not token-by-token
SSE. This keeps Mira on the same "server action" convention as the rest of the app
(CLAUDE.md's Server Actions rules) instead of introducing this codebase's first
hand-built streaming API route — a real cost (the chat panel shows a "thinking…"
spinner rather than live tokens), accepted to keep the surface area small; revisit if
answer latency becomes a real complaint.

## Conversation persistence

`miraConversations` / `miraMessages` (`convex/schema.ts`) hold one ongoing thread per
(org, user) — "Clear conversation" archives it (`archivedAt`) rather than deleting, so
history is never silently destroyed; the next message starts a fresh thread. A message
row is shaped to round-trip losslessly through an OpenAI-style chat-completions message
(`role`/`content`/`toolCalls`/`toolCallId`) so rebuilding the model's context is a
straight map, not a lossy re-derivation. History fed back to the model is capped to the
last 12 user-initiated turns (`capHistory` in `src/server/mira.ts`), grouped so an
assistant/tool exchange is never split across the cap boundary (a `tool` message with no
matching preceding `tool_calls` is an invalid message sequence for the chat-completions
API).

## Page context

`src/hooks/use-mira-page-context.ts`'s `useMiraPageContext(context)` publishes "what the
user is currently looking at" into the provider on mount and clears it on unmount — a
one-line call from any page. The project detail page
(`src/app/(app)/projects/[id]/page.tsx`) is the first caller:
`useMiraPageContext({ entityType: "project", entityId: id })`. It flows into the
system prompt (`src/lib/mira/system-prompt.ts`) as "the user is currently looking at
X" context, not into a hand-written routing table — extend it to other detail pages the
same way; there's no separate router file to update anymore.

## Settings — `/settings/mira`

Org-admin-only (`orgSettings:update`, same gate as WooCommerce's integration settings).
`src/server/mira-settings.ts` stores the OpenRouter key **encrypted at rest**
(`src/lib/crypto/secret-vault.ts`) and never round-trips it back to the browser — the
settings page only ever learns `hasApiKey: boolean`, never the key itself. Saving a new
key, changing the model, or flipping write access all call `logActivity()` for the audit
trail, same as every other settings save (CLAUDE.md's Server Actions rules).

## Related

- FEATUREDOCS/56 (Agent-Accessible API + MCP) — the surface Mira calls into; the agent
  auth kind, scope model, and safety rails all apply unchanged.
- FEATUREDOCS/58 (Webhooks) — why Mira's own key provisioning doesn't fire
  `api_key.created`.
- `docs/designs/api-mcp-reimplementation.md` §12 — the curated MCP tool set
  `buildMiraTools` draws from.
- `docs/budgets.md` T-P10 — the agent-loop iteration/timeout bound.
