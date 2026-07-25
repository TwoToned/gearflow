# Efficiency / Convex billing-reduction — session kickoff prompt

> Paste this whole file as the opening message of a fresh session. The user will ALSO
> paste this month's **Convex usage stats** (bandwidth / function-calls / action-compute /
> storage / file-bandwidth breakdown). Use those numbers to PRIORITIZE — measure first,
> don't guess.

## Your mission

Reduce the app's **Convex Cloud billing** by making the data layer more efficient — **without changing any behaviour or results.** The Prisma→Convex migration is COMPLETE (all domain data is Convex, browser-direct; Postgres holds only Better Auth). So this is pure post-migration performance/cost optimization: every change must be **behaviour-preserving and parity-verified** (same query results, same UI), just cheaper.

Work autonomously in small PRs, **codex review on every PR**, and an **independent adversarial re-audit after each cluster** confirming (a) the fix is behaviour-preserving and (b) it actually reduces reads/calls. Ship measurement-backed, not vibes.

**First, read:** `MEMORY.md` → the memories `convex-native-phase-progress` (migration is done; workflow + gotchas), `perf-round-trip-bundles` (prior wins: getProject 4→1.5s, checkAvailability 6→0.5s; **addLineItem waterfall + per-row getLock/getReviewMarker still open**), `bulk-op-batching`, the Convex gotcha memories, and `rvlt-registry`. Then `docs/designs/perf-convex-efficiency-2026-06.md` (the **efficiency standard + DB I/O audit** — the old plan's "Appendix B", now the canonical reference), `docs/convex-search-decision.md` (the global-search SCAN_CAP note + BM25 trigger), `FEATUREDOCS/54-convex-data-layer.md`, and `CLAUDE.md` (Convex rules).

## How Convex bills (so you optimize the right thing)

Convex charges on **database bandwidth (bytes read + written)**, **function calls**, **action compute (GB-s)**, **document storage**, and **file storage/bandwidth**. For this app the dominant cost is almost always **bandwidth from over-reading + reactive re-execution** — NOT raw call count. A reactive `useQuery` **re-runs (and re-bills its full read) every time any document in its read-set changes**, so a broad subscription on a busy table is the classic bill multiplier. Optimize bytes-read and re-execution frequency first.

## Prioritize with the usage stats + the dashboard — don't guess

1. Start from the **usage stats the user pasted** + the **Convex dashboard** (`dashboard.convex.dev/t/two-toned/gearflow-prod/useful-cuttlefish-334` → Functions / Health): rank functions by **call count** and **bandwidth**, and note **cache hit rate** + **OCC retries**. The top 3–5 functions by bandwidth are your target list — fix those first, ignore the long tail.
2. For each target: **measure** its current reads (log doc counts / use the dashboard), form a hypothesis, apply the **behaviour-preserving** fix, then **prove** (a) identical results (parity/shadow-compare) and (b) fewer reads/lower bandwidth. Only then ship.

## The efficiency levers (bandwidth-first — apply where the stats point)

1. **Reactive read-set breadth (the #1 recurring cost).** Scope hot subscriptions tightly (by `projectId` / current view). Split org-wide, high-churn slices (availability, presence, counters) into their OWN narrow queries so an unrelated write doesn't recompute a whole page. *(Sharded counters already did the dashboard counter row — pattern to replicate.)*
2. **Global search scan.** `convex/globalSearch.ts` range-scans 15 entities × up to `SCAN_CAP=5000` per search. Add/verify **client debounce** (~300ms) + keep the ≥2-char floor; migrate the hottest entities to Convex **`searchIndex` (BM25)** (reads a handful of docs, not whole tables) per the documented trigger. Likely the biggest single lever at any real traffic.
3. **`.collect()` on growing tables → indexed `.take(n)` / pagination.** Reactive pagination also only re-runs the affected page. Audit `activity_log`, `check_records`, `asset_scan_logs`, `project_line_items` and any `*-read.ts` bundle that collects a whole org table.
4. **Reference-only reads.** Bundle helpers should read by id-set, not "load all org X then filter in JS." Finish the pattern the perf PRs started (`swapLineItemAsset`/`availabilityCheck`/`dashboardLists` were done).
5. **N+1 / per-row `useQuery`.** Collapse remaining composites into single backend-local bundle queries — the **`addLineItem` waterfall** + **per-row `getLock`/`getReviewMarker`** in list rows are the known-open ones.
6. **Notifications poller → subscription** (a poll = constant billed calls even when idle).
7. **Indexes everywhere — zero `.filter()` full-table scans.** Every query `withIndex`; a `.filter()` without an index scans (and bills) the whole table.
8. **No redundant writes.** Skip a patch when nothing changed (e.g. recalc writing unchanged totals). Each write bills bandwidth.
9. **Retention / archival.** `activity_log`, `webhook_deliveries`, `asset_scan_logs`, `notification_email_log` grow unbounded → storage + scan cost. Add a Convex cron that archives/deletes rows older than N months (confirm nothing reads them first).
10. **File/media bandwidth.** Serve **client-generated thumbnails** for list views (don't serve full-res where a thumbnail suffices) + long cache headers on the authed file proxy (`src/app/api/files/[...path]`).
11. **Consolidate duplicate subscriptions per page** (Convex dedupes identical ones, but distinct near-identical queries each bill).

## Method (non-negotiable — this is optimization, not a rewrite)

- **Behaviour-preserving ALWAYS.** These changes must not alter query results, ordering, permissions, or UI. For any read change, **shadow-compare** old vs new output on real prod data (via the in-container validation technique) before shipping. If you can't prove identical results, don't ship it.
- **Measure before + after.** State the read/bandwidth delta in the PR. No "should be faster" — show it.
- **Benchmark where sizing matters** (bulk/pagination page sizes) against Convex's 16k-write / 1s-CPU limits.
- **Codex review every PR** (focus: did behaviour change? did reads actually drop?). **Independent re-audit per cluster.**

## Shipping workflow (established — see `convex-native-phase-progress` memory)

- Worktree `/home/jayden/code/gearflow-perf-io` is wired to **PROD** Postgres + **PROD** Convex (`useful-cuttlefish-334`, deploy key in `.env.local`). Per change: `git fetch origin main` → branch off `origin/main` → edit → `pnpm exec convex codegen` for local types (⚠️ `pnpm exec convex dev --once` DEPLOYS to PROD — use codegen for typecheck, let CI deploy on merge) → `pnpm exec tsc --noEmit` → **codex review** → commit (`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`) → push → PR → `gh pr merge <n> --merge` (**auto-merge is NOT enabled** — plain `--merge`; then watch the post-merge CI **Tests** job go green) → CI deploys (async Coolify) → verify `curl -s https://flow.rvlt.app -o /dev/null -w "%{http_code}"` = 307.
- **pnpm only** (`npm install` hits an arborist bug; pnpm-lock.yaml only). Use `pnpm add`.
- **★ In-container live validation** (worktree service token isn't trusted by prod Convex): `CID=$(ssh root@100.72.165.61 'docker ps --filter ancestor=ghcr.io/twotoned/gearflow:latest --format "{{.ID}}"|head -1')` (filter by IMAGE — container name is a hash), `docker cp <script.ts> + convex/_generated/api.js` into `$CID:/app/...`, `docker exec $CID sh -lc 'cd /app && pnpm exec tsx scripts/X.ts'`. Use this to shadow-compare old vs new query output on real data + to measure doc counts. For fns not yet in the image, call via `makeFunctionReference("module:fn")`.
- **★ Worktree hygiene:** keep the tree clean between PRs; if a stash conflicts, back up intended files → `git reset --hard origin/main` + `git clean -fdx --exclude=node_modules --exclude=.env*` + `git stash clear` → restore → `pnpm exec prisma generate`.
- **Convex rules:** `ConvexError` not `Error`; NEVER regenerate `convex/schema.ts` over itself (hand-merge indexes — adding a `searchIndex`/composite index is a hand-edit); **expand-contract any signature change to a live-called mutation/query** (the deployed app calls prod Convex directly, so a breaking change breaks prod until redeploy); `by_cuid`/`by_modelId` are global → per-row org re-check.
- Adding an index (very common here) is a `convex/schema.ts` hand-edit + deploy; Convex backfills the index automatically. Prefer adding an index over a `.filter()` scan.

## Definition of done

- The **top billing drivers from the usage stats** are addressed, each with a **measured** before/after read/bandwidth reduction in its PR.
- No `.filter()` full-table scan and no `.collect()` on a growing table remains in a **hot** path (dashboard, project/asset/kit detail, search, warehouse, lists).
- Hot reactive subscriptions have **minimal, scoped read-sets**; the known N+1s (addLineItem waterfall, per-row getLock/getReviewMarker) are collapsed.
- **Retention** crons exist for the unbounded log tables.
- Every change is **behaviour-preserving** (parity-verified on real data), tsc clean, full test suite green, codex + independent re-audit clean, prod healthy.
- A short **`docs/`** write-up of what moved the needle (which functions, the measured deltas) so the next billing cycle can be compared.

Start by reading the memory + `docs/designs/perf-convex-efficiency-2026-06.md`, then turn the pasted usage stats + the Convex dashboard into a ranked target list, and fix top-down — measured, parity-verified, one PR per lever.
