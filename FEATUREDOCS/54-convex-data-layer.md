# Convex Data Layer

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

The living reference for the Convex data layer. Read this (plus CLAUDE.md's Convex
rules) before touching anything under `convex/` or the read/write plumbing in `src/`.

## Overview

All domain/business data lives in **Convex** (Convex Cloud, deployment
`useful-cuttlefish-334`). Convex is the sole copy of that data and of the uploaded
file bytes — there is no Prisma domain mirror behind it.

Postgres (via Prisma) holds **only**:

- **Better Auth**: `user`, `session`, `account`, `verification`, `organization`,
  `member`, `invitation`, `twoFactor`, `backupCode`, `passkey`, `jwks`,
  `ssoProvider`, `pendingSSOApproval`.
- The **dormant custom-API pair**: `apiKey`, `apiIdempotency` (agent/MCP API, not yet
  live).
- A **frozen** `activity_log` (audit history; no longer written by the domain layer).

The Prisma domain tables were dropped at cutover (the decommission). Adding a new
domain entity means adding a Convex table + `*Writes.ts` mutations, not a Prisma model.

## Reads

- **Browser components** subscribe to native reactive queries: `useQuery(api.*)` /
  the `useAuthedQuery` wrapper (`src/hooks/use-authed-query.ts`), authenticated with
  the end-user's Better Auth token and scoped to the caller's org. Reads are
  live-updating — no manual invalidation, no SSE, no React Query for domain data.
- **Non-browser server contexts** (PDF generation, public API routes, email senders)
  can't hold a user session, so they read Convex through the `src/lib/*-read.ts`
  service helpers using a **service token** (e.g. `project-line-item-read.ts`,
  `test-tag-read.ts`, `warehouse-display-token-read.ts`,
  `maintenance-record-asset-read.ts`). These bypass read-side org scoping by design
  (see the write-side FK note below).

## Writes

Every domain write is **browser-direct**: forms call
`useMutation(api.<domain>Writes.<fn>)` with the end-user token. There is **no
server-action hop** for domain writes. The `convex/*Writes.ts` mutations are the
security boundary — treat them as untrusted-input handlers.

### The write security bar

Every public browser-direct mutation MUST enforce, in order:

1. **`assertWritesEnabled`** — global kill-switch.
2. **`enforceBrowserWriteLimit`** — per-caller rate limit.
3. **`requireOrgPermission(orgId, resource, action)`** — RBAC, enforced inside Convex.
4. **`resolveActor`** — pins the audit actor to the verified token subject, so the
   acting user is **unspoofable** (the client can't claim to be someone else).

Plus, on every mutation:

- **Per-row org re-check on GLOBAL-index fetches.** `by_cuid`, `by_modelId`, and
  friends are *global* indexes; a fetched doc's `organizationId` must be re-checked
  against the caller's org or you have a cross-tenant read/write.
- **Client-supplied FKs are org-validated** via `convex/lib/orgRef.ts`
  (`assertRefInOrg` / `assertMemberInOrg`). Because the service-token server reads
  bypass read-side org scoping, **write-side FK validation is the only reliable
  cross-tenant guard** — never skip it for a client-provided id.
- **Money is recomputed in-mutation from server truth** (`lineTotal`, `discount`,
  totals) via `convex/lib/moneyGuards.ts`. Never trust monetary values sent by the
  client.

## What stays a server action (permanent)

A set of surfaces is server-only **by nature** — they need secrets, crypto, Node
APIs, or external I/O the browser must never touch. These are NOT migration
leftovers; they will not become browser-direct:

- **Better-Auth / crypto:** `sso`, `org-members`, `site-admin`, `settings`,
  `user-profile`, `invitations`, `api-keys`.
- **HMAC / crypto tokens / external API:** `webhooks`, `woocommerce`,
  `test-tag-auditor`, `warehouse-display`.
- **Email / iCal:** `notification-email-sender`, `crew-calendar`, `org-calendar`,
  `crew-communication`.
- **CSV / Node:** `csv`, `crew-time`, `test-tag-reports`.
- **Two carve-outs** inside otherwise browser-direct files: `sub-hires` (ref-counted
  media/file delete via `media-write.ts`) and `project-services` (crew-message +
  CSV export).

## Operational

- **Prod is Convex Cloud** (`useful-cuttlefish-334`), deployed via
  `pnpm exec convex deploy` in the CI pipeline (see CLAUDE.md → Deploy pipeline).
- Convex is the **sole copy** of domain data + file bytes, so the operational
  runbooks are load-bearing:
  - [`docs/convex-backup-restore-runbook.md`](../docs/convex-backup-restore-runbook.md)
    — scheduled backups + rehearsed restore.
  - [`docs/convex-observability-runbook.md`](../docs/convex-observability-runbook.md)
    — monitoring + the write kill-switch.

## Gotchas

These are covered in full in CLAUDE.md's "Convex" rules — cross-referenced here, not
duplicated:

- **Throw `ConvexError`, never plain `Error`** in `convex/*.ts` (plain errors get
  masked to `InternalServerError` in prod, breaking the mirror tolerance pattern).
- **Use `createIfMissing`, never `create`** for first-writes that mirror a row into
  Convex (avoids duplicate-id crashes on the non-unique `by_cuid` index).
- **Never regenerate `convex/schema.ts` over itself** — the generator is scaffolding
  and drops hand-added search/composite indexes and Convex-only tables.
- **Expand-contract any change to a live-called mutation** — the deployed app calls
  prod Convex directly, so a breaking signature change breaks prod until redeploy.
- `by_cuid` / `by_modelId` are **global** indexes; `requireOrgPermission` authorises
  the *caller's* org, not the *row's* — re-check `organizationId` on every such fetch.
