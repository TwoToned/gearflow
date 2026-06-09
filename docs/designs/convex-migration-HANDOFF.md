# Convex Hybrid Migration — Session Hand-off Brief

**Branch:** `feat/convex-migration` (pushed to origin, **not merged**)
**PR:** https://github.com/TwoToned/gearflow/pull/new/feat/convex-migration
**Plan:** [`convex-hybrid-migration.md`](./convex-hybrid-migration.md) · **Live status:** [`FEATUREDOCS/54`](../../FEATUREDOCS/54-convex-data-layer.md)

---

## Where things stand

Phases **0–2 complete**. **Two domains fully migrated end-to-end** (Phase 3 + 4),
one per cutover strategy:
- **Clients** — *hard cutover* (Convex is sole source of truth). Reference for
  tables with **no inbound required FKs**.
- **Suppliers** — *dual-write* (Prisma row = durable FK anchor, Convex = reactive
  read source). Reference for tables that **other Prisma tables hard-FK**
  (Suppliers had 6 inbound FKs, two **required + Cascade** from `supplier_order` /
  `supplier_model_rate`, which a Convex-only cutover would orphan).

Every step verified: `tsc` clean · 2185 tests · 0 *new* lint errors · `pnpm build`
green. ⚠️ `pnpm lint` exits 1 on **8 pre-existing** `no-require-imports` errors
(`convex/_generated/*`, `convex/auth.config.ts`, `convex/siteSettings.ts`,
`scripts/*.cjs`) — NOT from domain work; flag for a separate cleanup commit.

| Phase | State |
|---|---|
| 0 Infra · 1 Schema (95 tables, 476 indexes) · 2 CRUD (81 modules, 405 fns) | ✅ generated + deployed |
| 3 Server actions | 🔄 **Clients (hard) + Suppliers (dual-write) done**; ~84 domains to go |
| 4 Frontend reactive reads | 🔄 **Clients + Suppliers done**; rest follow per domain |
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

0. **Pick the cutover strategy FIRST** — grep inbound FKs before touching code:
   ```bash
   psql "${DATABASE_URL%%\?*}" -tAc "SELECT conrelid::regclass AS child, conname FROM pg_constraint WHERE contype='f' AND confrelid::regclass::text='<table>';"
   ```
   - **No inbound FKs (or all nullable + you'll rewire every writer)** → *hard
     cutover* (Clients model): Convex sole source of truth, rewire **every** reader,
     zero `prisma.<model>` in app code.
   - **Inbound required/Cascade FKs from Prisma-resident tables** → *dual-write*
     (Suppliers model): a Convex-only write would orphan those FKs the moment a
     child row is created. Write **Prisma first** (FK anchor) **then Convex**
     (reactive read), deriving the Convex payload from the written row via
     `toConvexDoc` so the two can't drift. Reads that need reactivity go to Convex;
     cross-domain joins may stay on the **dual-write-fresh** Prisma mirror (they're
     never stale) and migrate at decommission — don't rewire the PDF pipeline for a
     `name` field just for purity.
1. **Backfill** Prisma→Convex — copy `scripts/convex-backfill-suppliers.ts`
   (or `-clients`); idempotent, maps Date→ms/Decimal→number/null→absent. Also the
   dual-write **heal path** if a Convex write fails after its Prisma write.
2. **Completeness-grep every reader** before cutting over:
   `prisma.<model>.`, `<rel>: true`, `<rel>: { select`, `include: { <rel>`.
   (The first Clients audit missed 6 `client: true` join sites — the grep caught
   them. Do not skip this. Watch for the relation living on **multiple** parent
   models — Supplier sits on asset / bulk_asset / line_item / sub_hire / orders.)
3. **Rewire writes (+ reads)** in the server actions: keep permissions/validation/
   `logActivity`; call Convex via `getConvexClient()` (`src/lib/convex-client.ts`);
   generate cuids with `createId()`. Compose cross-domain joins in JS via a
   `src/lib/<x>-read.ts` helper (model on `clients-read.ts` / `suppliers-read.ts`:
   `getById`/`getByOrg`/`getMap`/`attach`). Sort-by-joined-field done in JS.
4. **Reactive UI**: add `src/hooks/use-<x>.ts` wrapping `useQuery(api.<x>.*)` —
   keep it in `src/hooks`, **not** `convex/` (the Convex bundler chokes on React).
   Convert simple read UIs (lists + dropdowns + edit forms); leave cross-domain-
   composing pages (detail views) on server actions. **Dropdowns that filtered
   `isActive` server-side must re-apply that filter client-side** — the Convex
   `list` returns all rows. Cross-domain counts (e.g. asset/order counts) come from
   a separate non-reactive `get<X>Counts()` server query, merged into the list.
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

**Locations** — the natural third domain, but it brings **two new wrinkles** worth
planning for: (a) a **self-referential parent/child hierarchy** (`LocationHierarchy`)
— the backfill must handle the self-FK and the tree composition is new; (b) wide
fan-out (referenced by asset / bulk_asset / kit / project / location_media /
warehouse_dashboard_token / stocktake). Run the step-0 FK grep — Location has
several inbound FKs, so expect **dual-write** like Suppliers. Lighter alternatives
if you want another flat dual-write rep first: **Model** or **Tag**.

Deferred polish (either domain): migrate the cross-domain `supplier.name` /
`client.*` joins (warehouse / category-slots / PDF pipeline) off the Prisma mirror
to Convex attach — but this is genuinely decommission-phase work; the mirrors are
fresh so there's no correctness gap today.

---

## Watch-outs

- **Don't merge to `main` without explicit go-ahead** — deploy auto-triggers on
  push to `main`.
- **`pnpm lint` exits 1** on 8 **pre-existing** `no-require-imports` errors in the
  convex infra/generated files + `scripts/*.cjs` — unrelated to domain work, but
  CI lint will be red until someone fixes them (eslint-disable the `.cjs`/generated
  paths). Verify your own diff adds **0 new** errors (`git stash` + lint compare).
- **Dual-write failure modes** (Suppliers): Prisma is written first, so a Convex
  outage leaves a supplier that works for FKs but is invisible in the reactive UI
  until `pnpm convex:backfill:suppliers` heals it. The two stores are otherwise
  kept identical via `toConvexDoc(writtenPrismaRow)`.
- Report-builder sorting by a `client.*` column is a documented **no-op** (values
  correct from Convex, ordering skipped — a Prisma relation sort would hit the
  stale `client` table).
- `pnpm-workspace.yaml` is gitignored and lives only in the main repo; a fresh
  worktree must copy it (and `.env` + `.env.local` + `.env.convex.local`) or
  `pnpm add` silently fails to update the tracked lockfile.
- Convex stack persists across sessions as docker project `gearflow-convex`
  (containers `gearflow-convex-backend-1` / `-dashboard-1`).
- **Worktree note:** `feat/convex-migration` can only be checked out in one
  worktree at a time. If it's locked elsewhere, release that worktree (it goes to
  detached HEAD) before `git checkout feat/convex-migration` here.
