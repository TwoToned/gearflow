# Convex Hybrid Migration — Session Hand-off Brief

**Branch:** `feat/convex-migration` (pushed to origin, 19 commits, **not merged**)
**PR:** https://github.com/TwoToned/gearflow/pull/new/feat/convex-migration
**Plan:** [`convex-hybrid-migration.md`](./convex-hybrid-migration.md) · **Live status:** [`FEATUREDOCS/54`](../../FEATUREDOCS/54-convex-data-layer.md)

---

## Where things stand

Phases **0–2 complete**; the **Clients domain is fully migrated end-to-end**
(Phase 3 hard cutover + Phase 4 reactive reads) as the reference implementation.
Every step verified: `tsc` clean · 2185 tests · lint 0 errors · `pnpm build` green.

| Phase | State |
|---|---|
| 0 Infra · 1 Schema (95 tables, 476 indexes) · 2 CRUD (81 modules, 405 fns) | ✅ generated + deployed |
| 3 Server actions | 🔄 **Clients done** (hard cutover, ~20 sites); 85 domains to go |
| 4 Frontend reactive reads | 🔄 **Clients done**; rest follow per domain |
| 5 Auth bridge · 6 Decommission | not started |

---

## First thing in the new session

1. Read [`convex-hybrid-migration.md`](./convex-hybrid-migration.md) and
   [`FEATUREDOCS/54`](../../FEATUREDOCS/54-convex-data-layer.md) (the live status doc).
2. Bring the stack up:
   ```bash
   docker compose -f docker-compose.convex.yml up -d   # project "gearflow-convex"; backend :3210, dashboard :6791
   ```
3. Worktree bootstrap if fresh:
   ```bash
   cp <main>/.env .env
   cp <main>/pnpm-workspace.yaml .   # else `pnpm add` won't update the worktree lockfile
   pnpm install
   pnpm exec prisma generate
   ```
   `.env.local` holds the Convex URL + admin key.

---

## The reference pattern (repeat per domain)

1. **Backfill** Prisma→Convex — copy `scripts/convex-backfill-clients.ts`; idempotent,
   maps Date→ms, Decimal→number, null→absent.
2. **Completeness-grep every reader** before cutting over:
   `prisma.<model>.`, `<rel>: true`, `<rel>: { select`. (The first Clients audit
   missed 6 `client: true` join sites — the grep caught them. Do not skip this.)
3. **Rewire writes + reads** in the server actions: keep permissions/validation/
   `logActivity`; call Convex via `getConvexClient()` (`src/lib/convex-client.ts`);
   generate cuids with `createId()`. Compose cross-domain joins in JS via a
   `src/lib/<x>-read.ts` helper (model on `clients-read.ts`:
   `getById`/`getByOrg`/`getMap`/`attach`). Sort-by-joined-field done in JS.
4. **Reactive UI**: add `src/hooks/use-<x>.ts` wrapping `useQuery(api.<x>.*)` —
   keep it in `src/hooks`, **not** `convex/` (the Convex bundler chokes on React).
   Convert simple read UIs; leave cross-domain-composing pages (detail views) on
   server actions.
5. Run `tsc` + tests + `pnpm build` at each step. Commit atomically.

---

## Key decisions already baked in

- FKs stored as **`v.string()` cuids** (not `v.id()`). Prisma `@id` preserved as a
  stored `id` field + `by_cuid` index. Convex `_id` stays internal/unused.
- Convex functions are **unauthed**; the calling server action owns trust.
  **Writes stay in server actions** until Phase 5 (auth bridge) enables direct
  browser→Convex mutations.
- 14 tables (Better Auth core + `activityLog`) **excluded** — stay in Prisma.
- Regenerate after any `prisma/schema.prisma` change:
  `pnpm convex:schema` → `pnpm convex:crud` → `npx convex dev --once`.

---

## Suggested next target

**Suppliers** or **Locations** — moderately coupled, good second domain to prove
the pattern generalizes. Alternatively, finish **Clients Phase 4 polish** (make the
detail page reactive once a strategy for cross-domain reactive composition is chosen).

---

## Watch-outs

- **Don't merge to `main` without explicit go-ahead** — deploy auto-triggers on
  push to `main`.
- Report-builder sorting by a `client.*` column is a documented **no-op** (values
  correct from Convex, ordering skipped — a Prisma relation sort would hit the
  stale `client` table).
- `pnpm-workspace.yaml` is gitignored and lives only in the main repo; a fresh
  worktree must copy it or `pnpm add` silently fails to update the tracked lockfile.
- Convex stack persists across sessions as docker project `gearflow-convex`
  (containers `gearflow-convex-backend-1` / `-dashboard-1`).
