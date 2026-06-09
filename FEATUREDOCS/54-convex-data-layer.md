# Convex Data Layer (Hybrid Migration)

> **Status: Phase 0 complete (infrastructure).** This is a long-running, multi-phase
> migration. Full plan: [`docs/designs/convex-hybrid-migration.md`](../docs/designs/convex-hybrid-migration.md).

## Overview

Self-hosted [Convex](https://www.convex.dev) is being introduced as GearFlow's
reactive data layer, replacing the current stack incrementally:

- **Database**: Prisma + PostgreSQL → Convex (over the same Postgres instance)
- **Real-time**: SSE + in-memory EventEmitter + React Query invalidation
  ([FEATUREDOCS/53](./53-realtime-sync.md)) → Convex's reactive engine (WebSocket
  query subscriptions)
- **Client data fetching**: React Query (`@tanstack/react-query`) → `useQuery`
  from `convex/react`

**Business logic stays in Next.js server actions** — permissions
(`requirePermission`), Zod validation, activity logging, PDF generation, email,
and the Discord bot are unchanged. Convex holds thin CRUD functions (5–10 lines);
server actions call them via `fetchMutation`/`fetchQuery` from `convex/nextjs`
using the admin key.

## Architecture

```
Server Action (auth + validation + logActivity)
  └─ fetchMutation("domain:op", args, { adminToken })  ──┐
                                                         ▼
Browser  ──useQuery(api.domain.op)──►  Self-hosted Convex backend (Docker)
   ▲                                         │  reactive engine, WebSocket diffs
   └─────────── live diffs over WS ──────────┘  └─ PostgreSQL (gearflow_convex DB)
```

Trust model: the browser only **reads** from Convex. All **writes** go through
server actions that already authenticated the user. Convex functions are
themselves unauthed and trust their caller — so the Convex URL + admin key must
never reach the browser. (The Better Auth → Convex JWT bridge for direct
browser writes is Phase 5.)

## Phase 0 — Infrastructure (done)

| File | Purpose |
|------|---------|
| `docker-compose.convex.yml` | Backend + dashboard containers, pinned to release `precompiled-2026-06-03-7eff2e7`. Project name `gearflow-convex` (one stack per machine). |
| `.env.convex.example` | Template for backend infra config (instance secret, Postgres URL, ports, optional S3). Real values live in gitignored `.env.convex.local`. |
| `.env.example` | App env template, incl. Convex client/server vars. |
| `convex/schema.ts` | Convex schema — **empty** in Phase 0; populated domain-by-domain in Phase 1. |
| `convex/auth.config.ts` | Auth providers — empty until Phase 5. |
| `convex/README.md` | Conventions: one file per domain, `list`/`getById`/`create`/`update`/`remove`, orgId scoping, indexing, Prisma→Convex mapping. |
| `convex/_generated/` | Convex CLI output (committed so CI builds without a running backend). |
| `src/components/providers/convex-provider.tsx` | `ConvexClientProvider` — wraps the app in root layout, inside `GlobalErrorBoundary`. Inert if `NEXT_PUBLIC_CONVEX_URL` is unset. |
| `src/env.ts` | Adds (optional) `CONVEX_SELF_HOSTED_URL`, `CONVEX_SELF_HOSTED_ADMIN_KEY`, `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`. |

### Infrastructure details

- **Images** pinned to the release SHA tag `7eff2e7c87f3f9dd9e513c253ae8987e7f90345e`
  on both `convex-backend` and `convex-dashboard`. `:latest` drifts ahead of
  tagged releases — bump the pin deliberately.
- **Postgres**: `POSTGRES_URL` is the connection string **without** db name or
  query params. Convex uses a database named after `INSTANCE_NAME` (`-`→`_`), so
  `INSTANCE_NAME=gearflow-convex` → database **`gearflow_convex`** (created
  manually, separate from Prisma's `gearflow`). `DO_NOT_REQUIRE_SSL=1` for local.
- **Linux**: backend reaches host Postgres/MinIO via `host.docker.internal`,
  mapped with `extra_hosts: ["host.docker.internal:host-gateway"]`.
- **Ports**: 3210 backend/client API, 3211 HTTP actions, 6791 dashboard.
- **File storage**: Phase 0 uses the local Docker volume (`convex_data`). The
  S3/MinIO block in `.env.convex.example` is documented but commented out;
  enable it (5 buckets) when moving storage off-volume.

### Running

```bash
docker compose -f docker-compose.convex.yml up -d            # start backend + dashboard
docker compose -f docker-compose.convex.yml exec backend ./generate_admin_key.sh
npx convex dev                                               # push schema/functions + codegen
docker compose -f docker-compose.convex.yml logs -f backend  # logs
docker compose -f docker-compose.convex.yml down             # stop
```

Dashboard: http://localhost:6791 · Backend: http://127.0.0.1:3210

## Phase 1 — Schema (done)

All **95 Prisma models → `defineTable()`** in `convex/schema.ts` (1206 fields, 380
indexes) and all **65 enums → `v.union(v.literal(...))`** in `convex/lib/validators.ts`.
Generated deterministically from `prisma/schema.prisma` by
[`scripts/generate-convex-schema.cjs`](../scripts/generate-convex-schema.cjs)
(`pnpm convex:schema`), then reviewed. Deployed clean to the backend
(`convex dev --once`), typechecks, full suite green.

**Decisions baked into the schema:**
- **Foreign keys are `v.string()`, not `v.id()`.** During the hybrid migration,
  Convex docs must interoperate with the existing Prisma **cuid** id space, and
  auth-owned entities (user/organization/member/…) stay in Better Auth/Prisma.
  Storing FKs as the source cuid string matches the design doc's own Phase 2
  example (`orgId: v.string()`). FK fields drive **indexes** only. Converting
  hot-path FKs to native `v.id()` is a post-data-migration optimization.
- **Table names**: camelCase **plural** of the Prisma model (`ProjectLineItem` →
  `projectLineItems`). Generated from one map so FK/index references stay consistent.
- **Primary cuid `@id` → Convex `_id`** (not stored explicitly).
- **Type map**: `DateTime`/`Decimal`/`Int`/`Float` → `v.number()`; `Json` →
  `v.any()`; `String[]` → `v.array(v.string())`; enum → `enums.<Name>`.
- **Optional** iff the Prisma field is nullable, has a default, is a list, or is
  `@updatedAt` — so inserts and migration backfill aren't forced to set them.
  `createdAt`/`updatedAt` kept (optional) to preserve migrated timestamps
  (Convex also exposes `_creationTime`).
- **Indexes**: one per FK, per `@unique` field, and per `@@unique`/`@@index`/`@@id`
  compound (named `by_<f1>_<f2>`). `@unique` is **not** enforced by Convex — the
  owning mutation enforces uniqueness; the index is for lookup.

> Regenerate after any `prisma/schema.prisma` change: `pnpm convex:schema`, then
> `npx convex dev --once` to redeploy + codegen, and review the diff.

## Phase 2 — Thin CRUD (done)

**81 generated per-entity modules** (`convex/<tableKey>.ts`), **405 functions** —
each table gets `list` / `getById` / `create` / `update` / `remove`. Generated by
[`scripts/generate-convex-crud.cjs`](../scripts/generate-convex-crud.cjs)
(`pnpm convex:crud`), which shares the Prisma parser
([`scripts/lib/prisma-to-convex.cjs`](../scripts/lib/prisma-to-convex.cjs)) with
the schema gen so the two can't drift. Deployed clean, typechecks, full suite
green, and a live create→list→getById→update→remove round-trip verified.

**Conventions:**
- **Unauthed.** The calling server action owns auth, permissions, validation, and
  the activity log — never add checks here, never expose the URL/admin key to the
  browser.
- **Lookups key off the cuid** (`id`) via `by_cuid` (`getById`/`update`/`remove`).
  `update` returns the Convex `_id`; `id` arg validator follows the table's real
  id type (`discordOutboxes` uses `v.number()` — its `@id` is an autoincrement Int).
- **`list`** takes `orgId` and uses `by_organizationId` for org-scoped tables;
  otherwise lists by the first foreign key, or collects all (singletons).
- **`create`** takes the full table shape (incl. the caller-supplied cuid) and
  inserts it. **`update`** takes `{ id, patch }` (all fields optional).

**14 tables are excluded** (own no Convex CRUD — they stay in Better Auth/Prisma):
`users, sessions, accounts, verifications, organizations, members, invitations,
customRoles, ssoProviders, pendingSSOApprovals, twoFactors, backupCodes,
passkeys` (auth + org membership + permissions) and `activityLogs` (audit trail,
stays in Prisma per Phase 6).

> Bulk ops, search, aggregations/rollups, and `listBy*` variants are **not**
> generated — they're added by hand per domain as Phases 3–4 cut each domain over
> (report-style queries stay as server actions that call these + post-process).

## Phase 3 — Server-action integration (in progress: Clients pilot)

Pilot domain: **Clients** (chosen as the simplest), strategy: **one-time backfill,
Convex source-of-truth**. Groundwork landed:
- [`src/lib/convex-client.ts`](../src/lib/convex-client.ts) — server-side
  `ConvexHttpClient` for actions/scripts to call the public Convex functions
  (no token; they're unauthed) + `toConvexDoc` mapping (Date→ms, Decimal→number,
  null→absent).
- [`scripts/convex-backfill-clients.ts`](../scripts/convex-backfill-clients.ts)
  (`pnpm convex:backfill:clients`) — idempotent Prisma→Convex copy. Ran clean,
  6/6 clients mirrored.

### Clients cutover — DONE (hard cutover, Convex is source of truth)

The "simplest" domain turned out to be relationally coupled: `prisma.client` was
read/written in **~20 sites**. All were rewired — there is now **zero**
`prisma.client` access in app code (only the backfill reads Prisma, to copy out).
Convex (`convex/clients.ts`) is the single source of truth; cross-domain joins
are composed in JS via [`src/lib/clients-read.ts`](../src/lib/clients-read.ts)
(`getClientById` / `getClientsByOrg` / `getClientMap` / `attachClient`).

Sites rewired:
- **Writes**: `server/clients.ts` (create/update/notes/archive — generate cuid +
  `fetchMutation`, keep permission/validation/`logActivity`), `server/woocommerce.ts`
  (find/create + in-memory fuzzy match), `lib/org-import.ts`.
- **Direct reads**: `server/clients.ts` (`getClients` filters/sorts/paginates in
  JS + project counts from Prisma; `getClient` attaches projects+media),
  `server/tags.ts`, `server/reports.ts`, `server/client-media.ts`, `lib/org-export.ts`.
- **Relational joins** (`include: { client }` → attach from Convex):
  `server/projects.ts` (×3, incl. sort-by-client done in JS), `server/dashboard.ts`
  (×2), `server/availability.ts` (×4), `server/warehouse.ts` (×2), `server/documents.ts`,
  `server/locations.ts`, `app/api/calendar/.../route.ts`, `lib/report-engine.ts`,
  `lib/pdfme/build-document-data.ts`.

**Pattern**: fetch the Prisma rows without the client join, then attach the
Convex client(s) by `clientId` (one `getClientMap` round-trip for lists,
`getClientById` for singletons). Sorting projects/lists by client name is done in
JS (DB can't sort across the dropped join).

**Known limitation**: in the generic **report builder**, sorting a report by a
`client.*` column is a no-op (client values still display correctly from Convex,
but ordering by them is skipped — a Prisma relation sort would order by the stale
`client` table). Acceptable for the pilot; revisit if needed.

Verified: `tsc` clean, 2185 tests pass, lint 0 errors, backfill 6/6, Convex CRUD
round-trip. **Still TODO for the Clients domain**: Phase 4 (convert the client
React Query `useQuery` sites to Convex `useQuery` for real-time) — the data is
already in Convex, this is the reactive-reads upgrade.

## Migration phases (roadmap)

| Phase | Scope | Verification |
|------|-------|--------------|
| **0 Infra** ✅ | Docker stack, empty schema, provider, env | dashboard up, `convex dev` connects |
| **1 Schema** ✅ | 95 models + 65 enums → `defineTable()` | deployed clean, typechecks, tests green |
| **2 Thin CRUD** ✅ | 81 tables × 5 = 405 functions | deployed, typechecks, CRUD round-trip verified |
| **3 Server actions** 🔄 | 86 `"use server"` files call Convex (Clients pilot) | infra + backfill done; cutover strategy pending (see finding above) |
| 4 Frontend | 177 React Query sites → Convex `useQuery` | components auto-update on mutation |
| 5 Auth bridge | Better Auth → Convex JWT (admin key meanwhile) | mutations rejected without auth |
| 6 Decommission | Remove React Query + SSE event bus | [FEATUREDOCS/53](./53-realtime-sync.md) marked superseded |

## Conventions

See [`convex/README.md`](../convex/README.md) for the authoritative coding
conventions (domain file layout, the standard 5 functions per entity, orgId
scoping, mandatory indexes, and the Prisma→Convex type mapping table).
