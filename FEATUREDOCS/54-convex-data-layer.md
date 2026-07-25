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
- **The service token itself** (`src/lib/convex-auth.ts`'s `getConvexServiceToken`) is
  minted by `src/lib/convex-service-signer.ts` — a SEPARATE, minimal Better Auth
  instance carrying only the `jwt` plugin, not the full `auth` instance
  (`src/lib/auth.ts`). It signs against the same shared Postgres `jwks` table and the
  same `BETTER_AUTH_SECRET`, so Convex's customJwt provider validates tokens from
  either instance interchangeably; it is never mounted as an HTTP route. This split
  exists because `auth.ts`'s hooks mirror data into Convex (which needs the service
  token, which would need `auth.ts`) — importing the full instance from the signer
  would be circular (POLICY.md R-3.5).
- **Cross-domain joins that need two `*-read.ts` modules both ways** (e.g. a model
  needs its category, AND a category's counts need the org's models) live in a
  dedicated `*-join.ts` module (`model-category-join.ts`), not in either domain's
  own read file — putting the join in either one creates a circular import between
  the two domain modules (POLICY.md R-3.5).
- **Unbounded-read ratchet (R-9.8, `scripts/collect-ratchet.mjs`)**: prefer an
  indexed/status-narrowed read or `.paginate()`/`.take()` over `ctx.db.query(...).collect()`
  on a table that grows with usage. The CI-blocking ratchet recursively scans every
  non-test `convex/**/*.ts` file (including `convex/lib/`, not just the top-level
  directory) and tracks three numbers: the full non-test `.collect()` count
  (`.collect-ratchet-full-baseline`); within that, org-wide-index-only or no-index
  unjustified collects (`.collect-ratchet-baseline`, target 0); and, independent of
  hazard shape, `r9.8-ok` markers that aren't backed by a real `docs/exceptions.md`
  row (`.collect-ratchet-unregistered-baseline`, target 0 — #901). A `.collect()`
  that genuinely needs the whole set (an aggregation, a reconciliation job, or a
  small platform/roster-scale table) is marked `// r9.8-ok: <reason>` on the query
  line — but per R-15.1 a bare comment alone is not a valid exception once it's
  load-bearing; register it in `docs/exceptions.md` too and have the comment point
  there (see the `R-8.3.3` rows for the pattern). A marker only counts as
  "registered" for metric 3 if the comment names `docs/exceptions.md` **and** that
  file actually mentions the source filename — round-4 audit (#901) found 211 of 225
  markers were bare inline reasons with no exceptions.md row at all, which the old
  hazard-shape-only "0 unjustified" metric couldn't see. Raising
  `.collect-ratchet-full-baseline` via `--write` now requires `--reason "..."` and is
  logged to `docs/collect-ratchet-log.md` — a baseline bump with no recorded reason
  was round 4's own finding (665→671 framed as remediation).

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
- **Kit-by-cuid goes through `getKitByCuid` (`convex/lib/kits.ts`), never an inlined
  `ctx.db.query("kits").withIndex("by_cuid", ...)`.** One accessor for a global index
  means one place to get the org re-check right, instead of ~30 independent chances
  to forget it (R-8.3.4). Callers still MUST check the returned doc's
  `organizationId` — the helper doesn't scope by org.
- **Client-supplied FKs are org-validated** via `convex/lib/orgRef.ts`
  (`assertRefInOrg` / `assertMemberInOrg`). Because the service-token server reads
  bypass read-side org scoping, **write-side FK validation is the only reliable
  cross-tenant guard** — never skip it for a client-provided id.
- **Money is recomputed in-mutation from server truth** (`lineTotal`, `discount`,
  totals) via `convex/lib/moneyGuards.ts`. Never trust monetary values sent by the
  client.
- **Business constraints (string length caps, numeric min/max, array length caps)
  are mirrored server-side**, not just checked by the client Zod schema
  (POLICY.md R-8.6.1/R-8.6.2 — a caller with a valid session can call a public
  mutation directly and skip the browser's `.parse()` entirely). Each
  `convex/*Writes.ts` file exposing constrained fields to the browser declares a
  local `assert<Entity>Fields(...)` mirroring the paired `src/lib/validations/*.ts`
  schema's bounds, built from the shared primitives in `convex/lib/fieldGuards.ts`
  (`assertStrLen`/`assertNumRange`/`assertArrayMax` — generalises the
  `moneyGuards.ts` pattern above to non-money fields). Called at the top of every
  create/update/createMany/bulk handler that writes those fields, before the DB
  write. `convex/validationDrift.test.ts` separately guards that the Zod schema and
  the Convex arg validator's *field set* stay in sync — the `assert*Fields` guards
  are the matching *value*-level guarantee.

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
- Postgres (Better Auth + activity log, above) has its own separate backup/restore
  runbook — [`docs/postgres-backup-restore-runbook.md`](../docs/postgres-backup-restore-runbook.md).
  The Convex runbook explicitly marks Postgres out of scope; don't assume Convex's
  backup posture covers it.

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
- **Derive `Mapped*`/Prisma-row-shaped types from `Doc<"table">`, never hand-duplicate
  them field-by-field** (POLICY.md R-8.2.4): `Omit<Doc<"table">, "_id" | "_creationTime"
  | "<transformed fields>"> & { "<transformed fields with their coerced/converted
  types>" }`. A hand-copied interface silently drifts the moment the Convex schema
  gains/renames a field — the compiler has no way to catch it. See
  `src/lib/categories-read.ts` (`MappedCategory`), `src/lib/crew-scheduling-read.ts`,
  `src/lib/locations-read.ts`, `src/lib/project-line-item-read.ts`,
  `src/lib/suppliers-read.ts`, `src/lib/assets-read.ts`, and
  `src/lib/custom-fields-read.ts` for the pattern.
