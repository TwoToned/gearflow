# Convex — GearFlow data layer

Self-hosted Convex is GearFlow's reactive data layer. This directory holds the
Convex schema, queries, and mutations. **Business logic stays in Next.js server
actions** (`src/server/`) — Convex functions are thin CRUD stubs.

> Full plan: `docs/designs/convex-hybrid-migration.md`. Read it before working here.

## The split

| Concern | Lives in |
|---|---|
| Permissions (`requirePermission`), validation (Zod), activity log, PDF, email, Discord | Next.js server actions (`src/server/`) |
| Database reads/writes + real-time propagation | Convex (this directory) |

Server actions call Convex over HTTP via the shared `ConvexHttpClient`
(`src/lib/convex-client.ts`), authenticated with a **service token** (Phase 5).
The browser subscribes to reads via `useQuery` from `convex/react` with a **user
token** (Better Auth), scoped to its org. Mutations are **not** callable from the
browser — they require the service token.

## Conventions

- **One file per domain**: `projects.ts`, `assets.ts`, `kits.ts`, `line-items.ts`,
  `warehouse.ts`, … Mirrors the Prisma model domains.
- **Each entity exposes**: `list`, `getById`, `create`, `update`, `remove`
  (5–10 lines each). Complex entities may add `search`, `count`, `listByStatus`.
- **Functions are authenticated (Phase 5, `convex/lib/auth.ts`).** Mutations call
  `requireService` (only the trusted backend writes — RBAC stays in the server
  action, which still owns permissions/validation/audit). Org-scoped `list`/
  `getById` call `requireOrgRead`/`requireOrgReadDoc` (service OR a user token
  scoped to the same org). Do **not** put fine-grained permission checks here —
  Convex is never the authZ source of truth. The CRUD generator injects these
  guards; hand-written functions call the same helpers. See
  `docs/designs/convex-phase5-auth-bridge.md`.
- **Every list query takes `orgId` as its first arg** and scopes by it via an
  index. Multi-tenant isolation is enforced by always filtering on `orgId`.
- **Index everything you filter on**: every foreign key + every common filter
  field gets a `.index(...)`. Foreign keys are stored as `v.id("otherTable")`.
- **Don't fight the document model.** Aggregations/rollups/reports stay as server
  actions that call multiple Convex queries and post-process in Node.

## Prisma → Convex mapping (Phase 1)

| Prisma | Convex |
|---|---|
| `String @id @default(cuid())` | implicit `_id: v.id("table")` (Convex generates IDs) |
| `String @unique` | field + unique index |
| `DateTime` | `v.number()` (Unix ms) |
| `Decimal` | `v.number()` |
| `Json` | `v.any()` |
| `Boolean @default(false)` | `v.optional(v.boolean())` |
| `enum X { ... }` | `v.union(v.literal("A"), v.literal("B"), …)` |
| FK relation | store `v.id("other")`, query via index + `collect()` |
| `@@unique([a, b])` | compound index `.index("by_a_b", ["a", "b"])` |
| partial index | not supported — filter in the handler |

`createdAt`/`updatedAt`: Convex provides `_creationTime` automatically; add an
explicit `updatedAt: v.number()` field only where the app needs it. (Note kit
join tables use `addedAt`, not `createdAt`.)

## Running locally

The backend + dashboard run via Docker. From the repo root:

```bash
docker compose -f docker-compose.convex.yml up -d           # start
docker compose -f docker-compose.convex.yml exec backend ./generate_admin_key.sh
npx convex dev                                              # push schema/functions + codegen
docker compose -f docker-compose.convex.yml logs -f backend # tail logs
docker compose -f docker-compose.convex.yml down            # stop
```

Required env (in `.env.local`, gitignored):

```
CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
CONVEX_SELF_HOSTED_ADMIN_KEY=<from generate_admin_key.sh>
NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210
```

Backend infra config (instance secret, Postgres URL, ports) lives in
`.env.convex.local` — see `.env.convex.example`.

## Generated code

`convex/_generated/` is produced by the Convex CLI (`npx convex dev`/`codegen`).
It is committed so the Next.js build and CI typecheck without a running backend.
Don't edit it by hand; re-run codegen after changing the schema or functions.
