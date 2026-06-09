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

## Migration phases (roadmap)

| Phase | Scope | Verification |
|------|-------|--------------|
| **0 Infra** ✅ | Docker stack, empty schema, provider, env | dashboard up, `convex dev` connects |
| 1 Schema | 95 models + 65 enums → `defineTable()` | `convex deploy` succeeds, schema in dashboard |
| 2 Thin CRUD | ~80 query/mutation stubs | callable from dashboard |
| 3 Server actions | 86 `"use server"` files call Convex | data appears in Convex on action |
| 4 Frontend | 177 React Query sites → Convex `useQuery` | components auto-update on mutation |
| 5 Auth bridge | Better Auth → Convex JWT (admin key meanwhile) | mutations rejected without auth |
| 6 Decommission | Remove React Query + SSE event bus | [FEATUREDOCS/53](./53-realtime-sync.md) marked superseded |

## Conventions

See [`convex/README.md`](../convex/README.md) for the authoritative coding
conventions (domain file layout, the standard 5 functions per entity, orgId
scoping, mandatory indexes, and the Prisma→Convex type mapping table).
