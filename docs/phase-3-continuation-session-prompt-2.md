# Phase 3 continuation prompt #2 (browser-direct native — WS2, the deletion grind)

> Paste this whole file as the opening message of a fresh session. It is self-contained.
> It continues `docs/phase-3-continuation-session-prompt.md` after a 13-PR session (#489–#501)
> that closed the audit's open items, finished the clients-reads domain, and completed the
> count-map read sweep. The **read-rehoming tail** and the **write-domain deletions** remain.

## Your mission

**Continue finishing Phase 3** of the Convex-native migration — "browser-direct native" (WS2).
Work autonomously, one clean domain at a time, **shipping small PRs to `main`, with a codex
review on every PR and an independent adversarial re-audit after each domain cluster.** Prod is
**dark/pre-launch** (1 org `jlrtkbf64z7ogmyzi30uonoe`, 3 users), so blast radius is low — but the
Convex query/mutation is now the security boundary, so **per-row org re-checks on every
global-index fetch are non-negotiable** (audits have found real cross-tenant holes).

**Reality check:** this is the plan's own "XL — the largest sustained effort." It is a
**multi-session grind (~4–6 more sessions)**, not one. Do NOT try to rush the whole DoD in one
sitting — ship correct, reviewed, tested slices and keep the memory current so the next session
resumes cleanly.

**First, read these** (in order): `MEMORY.md` → the memory files `convex-native-phase-progress`
(THE cross-session source of truth — read it fully; the last entries cover this session),
`convex-native-migration-plan`, `prod-box-access`, `prod-deploy-box`, `convex-local-validation`,
`rvlt-registry`, plus the Convex gotcha memories. Then `docs/convex-native-migration-plan.md`
(§1 end-state, §WS2, §4 hard gates, Appendix A bulk, Appendix B efficiency),
`docs/phase3-data-layer-deletion-map.md` (the authoritative per-file worklist), and the two prior
continuation prompts (`docs/phase-3-session-prompt.md`, `docs/phase-3-continuation-session-prompt.md`).
Then `CLAUDE.md`. (`convex/_generated/ai/guidelines.md` referenced by CLAUDE.md does NOT exist —
rely on CLAUDE.md + the gotcha memories.)

## Where things stand (verified 2026-07-14 — spot-check before trusting)

**DONE + on `main` + prod-307 (do not redo):**
- Security baseline (resolveActor, strict `v.*` + `returns` on the 26 browser-direct `*Writes`,
  sanitizeClientSet, rate limiter + kill-switch, per-row org re-check), sharded counters, the bulk
  single-call invariant, optimistic-by-consequence — all shipped + audited clean in prior sessions.
- **Server files fully DELETED:** `roi`, `dashboard`, `project-costs`, `search`, `tags`,
  `scan-lookup` (earlier). Reads trimmed: `activity-log`, `saved-views`.
- **This session (#489–#501, all merged + CI-green + prod-307):**
  - Audit-open items: `dashboardStats` date-metric range-scan (#489), notifications DB-backed
    "Dismiss All" (#490), asset bulk-tag (#491), client bulk-archive (#492), plan-doc corrections
    (#493), re-audit MED cross-org dedup fix (#495).
  - **clients-reads domain COMPLETE:** `getClientProjectCounts` → `clients.projectCounts` (#494);
    `getClient` detail page → reactive `clients.detail` composite (#496). `getClients` is agent-only
    (deferred to the api-mcp pass).
  - **count-map read sweep COMPLETE** (all `getXCounts` with a browser consumer): suppliers (#497),
    categories (#498), locations (#499), models (#500, +primary-photo composite), kits (#501,
    +primary-photo composite). Each → `<domain>.counts` Convex query + one-shot hook; server action
    deleted. **Independently re-audited CLEAN** (parity/cross-tenant/Appendix-B/consumer).
  - `getCheckItemCounts` is agent-only (no browser consumer) → deferred.

**★ LOCKED USER DECISIONS (apply throughout):**
1. **ACCEPT dropping agent/MCP WRITE capability.** Write server actions CAN be deleted — drop their
   agent write ops and **repoint the ~10 `src/lib/api/{mcp,openapi,dispatch}.test.ts` fixtures**
   (they use `clients.createClient`/`updateClient` as canonical write examples). No CONVEX_WRITES bridge.
2. **For READS**, prefer preserving CURATED agent tools (list_projects, global_search, scan_lookup,
   create_client, …) via the `CONVEX_READS` bridge (relax the query guard + add an entry under the
   SAME op name/scope). Let long-tail non-curated read ops drop on deletion.

## The remaining worklist (priority order)

1. **`availability.ts`** — 4 composite booking queries (getModelBookings/getAssetBookings/
   getKitBookings/getCalendarData). A REAL pipeline refactor: the builders consume MAPPED docs behind
   `getConvexClient`, so FIRST extract the pure builders/mapping into a plain `src/lib/*.ts`
   (no getConvexClient import), THEN author the Convex queries that reuse them. Semi-consequential
   (availability display) — verify parity carefully.
2. **Remaining domain LIST reads** (each: author or reuse a browser-callable Convex query, rewire the
   `useServerQuery` consumers, preserve curated agent tools via CONVEX_READS, delete/trim the server
   read): `models`/`kits`/`assets`/`crew` list composites, `maintenance`, `test-tag-*` (needs a Convex
   user/member-name mirror for `testedBy`), `supplier-orders`, `notification-preferences` (user-scoped),
   `custom-fields` (mostly native already), `check-items`.
3. **Write-domain deletions** (the big block; unblocked by decision 1): per domain, author
   `convex/*Writes.ts` (4 guards + per-row org re-check + `sanitizeClientSet` on patches + atomic
   audit + `returns`; the client hook runs the domain's zod schema — see `use-native-client-writes.ts`),
   move residual server-side orchestration INTO the mutation (Zod, `reserve*Tags`/counters, T&T
   auto-register, `recalculateProjectTotals`, cascades, dup-guards), rewire forms browser-direct, delete
   the server writes + repoint the API fixtures, drop the agent write ops. Order: kit → crew → project →
   **line-item (keystone — availability/pricing must move in; heaviest)** → asset → warehouse
   (scan-brain + inventory) → maintenance → project-services/sub-hires (money; native
   `recalculateProjectTotals` FIRST — already in `convex/lib/recalc.ts` behind `NATIVE_RECALC`) →
   models → categories/locations/suppliers → saved-views/notification-preferences/custom-fields/
   brand-templates.
4. **KEEP-SERVER-ONLY (never delete):** auth/admin/`settings`/`site-admin`, `sso`, `api-keys`,
   `org-members`, `user-profile`, `invitations`, `public-org`, `changelog`, `notification-email-sender`,
   `woocommerce`+`webhooks`, `test-tag-auditor/reminders/reports`, `org-calendar`/`crew-calendar`/
   `warehouse-display`, `document-templates`, `csv`, `crew-communication` — and ALL `src/lib/*-read.ts`.
5. **Also DoD:** CSV import bulk + benchmark (50/200/500/1000 × 1/4/8 vs the 16k-write/1s-CPU budget);
   `internal*` reduction is architecturally INAPPLICABLE for HTTP-client-called fns (documented).

## Proven patterns (reuse these — established this session)

- **Count-map re-homing** (`getXCounts` → table count columns): `convex/X.ts counts` query
  (`requireOrgRead` + scan `by_organizationId` + tally; `returns: v.record(...)` for simple maps,
  omit it for nested-media maps) → `use-X-counts.ts` ONE-SHOT `useConvex().query` gated on
  `useConvexAuth().isAuthenticated`, cancellation-safe, resets on org change (NOT a reactive
  `useQuery` — counts have no liveness need, Appendix B) → rewire consumers (`map?.[id]?.x ?? 0`) →
  delete server action → regen registry → convex test (parity + org-isolation + non-member RBAC).
- **Detail composite** (`getX` detail page → reactive bundle): author ONE reactive Convex query
  returning `{...doc, <relations>}` **bounded to the entity** (client-scoped, not org-wide) — org-recheck
  EVERY `by_cuid`/`by_<fk>` fetch (incl. line-item counts), reproduce the exact consumer shape
  (`MediaItem` etc.) → page uses `useAuthedQuery(api.X.detail, orgId ? {...} : "skip")` and DROPS manual
  `refetch` (reactive auto-updates on writes). See `convex/clients.ts detail` + `clients/[id]/page.tsx`.
- **Pure logic trapped behind `getConvexClient`:** extract the pure builders/mappers to a plain
  `src/lib/*.ts` so a Convex query AND client hooks can share them.
- **Reads re-home safely:** `requireOrgRead`/`requireOrgReadDoc`/`requireOrgPermission` all
  short-circuit-allow for a service token, so relaxing a query's `requireService`→`requireOrgRead`
  keeps PDF/CSV service callers working AND enables the browser. **Every row fetched by a GLOBAL index
  (`by_cuid`/`by_modelId`/`by_projectId`) must be re-checked `doc.organizationId === orgId`.**
- **Write template:** `convex/clientWrites.ts` + `use-native-client-writes.ts`.

## Per-deletion / per-re-home checklist (each bit at least once)

1. `git fetch origin main --force` → branch off `origin/main`. **VERIFY the last PR's changes are
   actually present** (`grep` for its new symbol) — a plain `git fetch` right after a merge can return a
   STALE ref (GitHub propagation lag); if stale, `git reset --hard origin/main` after a forced fetch.
   Confirm `git merge-base --is-ancestor origin/main HEAD`. SERIALIZE deletions (every one regenerates
   `operations.ts`).
2. Author query/hook (or reuse) → rewire consumers → `git rm` / trim the server file → remove any
   now-dead imports (run `npx eslint <files>`; leave PRE-EXISTING unrelated warnings alone).
3. `pnpm exec convex dev --once` (⚠️ DEPLOYS to PROD, additive/inert) — MUST run BEFORE tsc for a new
   Convex fn (updates `_generated/api.d.ts`).
4. `pnpm exec tsx scripts/generate-api-registry.ts` → confirm ONLY the intended op dropped and no
   stray comment got picked up as the next export's `summary` (a free-floating `//` before an export
   becomes its summary — delete such comments).
5. Remove any curated `mcp-tools.ts`/`tool-aliases.ts`/`public/llms.txt` entry for a dropped op, OR add
   a `convex-reads.ts` bridge entry to preserve a curated tool. Repoint/delete broken int-tests + API
   fixtures.
6. `npx tsc --noEmit` → `npx vitest run src/lib/api/` (114 tests guard the registry) + the domain test.
7. **codex review** (`codex exec --skip-git-repo-check "<focused correctness/security prompt>"`) → fix.
8. commit (end `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`) → push → `gh pr create` →
   `gh pr merge <n> --merge` (no branch protection; auto-merge is intermittently rejected — use plain
   `--merge`) → **watch the PR's CI `Tests` job go green** → `build-image.yml` deploys async via Coolify →
   verify `curl -s https://flow.rvlt.app -o /dev/null -w "%{http_code}"` = 307.

## Shipping workflow + environment

- Work in `/home/jayden/code/gearflow-perf-io` (wired to **PROD** Postgres `100.64.240.72` + **PROD**
  Convex Cloud `useful-cuttlefish-334`, deploy key in `.env.local`). **pnpm only** (`npm install` fails).
  A launched-in worktree without node_modules/.env is NOT the place to build.
- `main` is checked out by the PRIMARY worktree (`/home/jayden/code/gearflow`) → `git checkout main`
  FAILS in perf-io; a chained `&& git pull` silently skips. Always branch off `origin/main` directly.
- Never let a background agent `git checkout` in the SHARED worktree — spawn re-audit agents with
  `isolation: worktree`. (Note: an isolated worktree cut right after a merge can also miss it — same lag.)
- Convex rules: `throw new ConvexError(...)` never plain `Error`; `createIfMissing` never `create` for
  mirror first-writes; NEVER regenerate `convex/schema.ts` over itself (hand-add indexes); by_cuid/
  by_modelId global → per-row org re-check. UI: RVLT registry; overlays Radix (`asChild`), Sidebar/
  Breadcrumb Base UI (`render`); Tooltip needs its own provider; never nest a Base UI popup in a Radix
  modal; cover new overlay UI with a jsdom smoke test that RENDERS it.

## Review & audit discipline (non-negotiable — it has caught real bugs)

- **Every PR gets a codex pass** focused on correctness + the security baseline (per-row org re-check on
  by_cuid/by_projectId fetches; actor spoofing; validation parity when logic moves client-side).
- **After each domain cluster, run an INDEPENDENT adversarial re-audit** (fresh general-purpose agent,
  `isolation: worktree`, trust nothing, verify against code + plan + the retained pure helpers):
  cross-tenant, bulk single-call, optimistic-by-consequence, read-set breadth (no org-wide reactive
  `.collect()`), parity with the deleted behavior. Self-verify its confirmed findings before fixing.
- Keep `docs/phase3-data-layer-deletion-map.md` + the `convex-native-phase-progress` memory current as
  each domain lands (the memory is the cross-session source of truth).

## Definition of done (Phase 3)

Every domain browser-direct for reads AND writes; server-action data layer deleted except
`src/lib/*-read.ts` + the KEEP-SERVER-ONLY set; API fixtures repointed; curated agent read-tools
preserved via bridge; no org-wide reactive `.collect()` on subscribed paths; every global-index fetch
org-checked; CSV bulk + benchmark done; full suite green; codex + an independent full re-audit clean;
prod healthy (307) with a fresh container. **Then Phase 4** (strip Prisma domain models +
`DROP TABLE CASCADE`) is the only thing left — hand off (or do it) with a fresh backup immediately
before the irreversible migration (the drilled restore in `docs/convex-backup-restore-runbook.md` is
the standing authorization; prod is dark).

Start by reading the memory + plan + deletion map, spot-checking "where things stand", then take
`availability.ts` (extract pure builders first), then the remaining domain reads, then the write-domain
deletions kit → crew → project → line-item → … Ship small, review hard, re-audit between clusters.
