# Phase 3 continuation prompt #3 (browser-direct native — WS2, post agent-API removal)

> Paste this whole file as the opening message of a fresh session. It is self-contained.
> Continues `docs/phase-3-continuation-session-prompt-2.md` after an 8-PR session (#503–#510)
> whose headline was **removing the entire agent/MCP API** — which turned every remaining
> server-action deletion into trivial mechanical work.

## Your mission

**Continue finishing Phase 3** of the Convex-native migration — "browser-direct native"
(WS2): every domain browser-direct for reads AND writes, and the `src/server/*` data layer
**deleted** except `src/lib/*-read.ts` + the KEEP-SERVER-ONLY set. Work autonomously, one
clean domain per PR, **shipping small PRs to `main` with a codex review on every PR** and an
independent adversarial re-audit after each write-domain cluster. Prod is **dark/pre-launch**
(1 org `jlrtkbf64z7ogmyzi30uonoe`, 3 users) so blast radius is low — but the Convex
query/mutation is now the security boundary, so **per-row org re-checks on every global-index
fetch (`by_cuid`/`by_modelId`/`by_kitId`/`by_projectId`/…) are non-negotiable** (audits have
found real cross-tenant holes). This is a **multi-session grind** — ship correct, reviewed,
tested slices and keep the memory current; do NOT try to finish the whole DoD in one sitting.

**First, read these** (in order): `MEMORY.md` → the memory file `convex-native-phase-progress`
(THE cross-session source of truth — read it FULLY; the newest entries are Session 5),
`prod-box-access`, `prod-deploy-box`, `convex-local-validation`, `rvlt-registry`, plus the
Convex gotcha memories. Then `docs/convex-native-migration-plan.md` (§1 end-state, §WS2, §4
gates, Appendix A bulk, Appendix B efficiency), **`docs/phase3-data-layer-deletion-map.md`**
(the authoritative per-file worklist — read its ★ banner about the agent-API removal), and
`CLAUDE.md` (Convex + composition rules). `convex/_generated/ai/guidelines.md` referenced by
CLAUDE.md does NOT exist — rely on CLAUDE.md + the gotcha memories.

## ★★★ THE GAME-CHANGER (Session 5): the agent/MCP API is GONE (#506)

The generated operations registry used to dynamically import + invoke every `src/server/*.ts`
action to expose it as an agent op, coupling the API contract (+114 guard tests) to the data
layer being deleted. **PR #506 deleted the whole request surface:** `src/lib/api/*`,
`/api/v1/*` routes, `public/llms.txt`, `scripts/generate-api-registry.ts` + the `api:registry`
npm script, the `/settings/api-keys` UI + settings nav, middleware `/api/v1`+`/llms.txt` hooks.
**KEPT DORMANT** (do NOT delete): the ApiKey backend — `src/server/api-keys.ts`,
`src/lib/api-key.ts`, the `apiKey` table. `FEATUREDOCS/56` + `docs/designs/api-mcp-agent-access.md`
are the reinstate blueprint (reinstate LATER over native Convex fns, not server actions).

**CONSEQUENCE — the per-deletion checklist SHRANK.** Deleting a server action no longer
touches ANY agent-API contract. **Ignore every older instruction about regenerating the
registry, editing `mcp-tools`/`tool-aliases`/`llms.txt`, the `CONVEX_READS` bridge, or
repointing `src/lib/api/*` fixtures — those files no longer exist.** Decisions 1 & 2 from the
prior prompts (drop agent writes / preserve curated reads via bridge) are BOTH MOOT.

## Where things stand (verified 2026-07-14 — spot-check before trusting)

**DONE + on `main` + prod-307 (Session 5, #503–#510):**
- **Read re-homings:** #503 `availability.ts` (4 booking queries → `convex/availability.ts`,
  pure builders ported to `convex/lib/availabilityBookings.ts`), #504 `canDeleteKit` →
  `api.kits.deletability`, #505 `getSupplierById` → `api.suppliers.detail` composite.
- **#506 agent-API removal** (above) + **#507** deletion-map doc banner.
- **Trivial post-removal dead-file deletions:** #508 `clients.ts` (writes already
  browser-direct via `convex/clientWrites.ts`; `getClients` was agent-only → 0 importers →
  whole file gone), #509 `brand-templates.ts` (all exports dead; PDF path uses the
  `-read.ts` helper), #510 `bulk-checkin.ts` + its int test (superseded by native
  `warehouseOps.checkinItems`; the unused native `warehouseOps.checkInBulkTotals` left inert).

**Free deletions are EXHAUSTED.** The remaining zero-importer server files are deliberate
KEEPs: `api-keys` (dormant), `webhooks` (delivery cron `@/lib/webhooks/deliver` + crypto/SSRF),
`split-sibling-collapse` (migration script). Everything else needs authored work.

## The remaining worklist (priority order — all now free of agent-API friction)

1. **Read re-homings** — each `src/server/*.ts` READ with a browser consumer: author (or reuse)
   a browser-callable Convex query, rewire the `useServerQuery` consumers, delete/trim the
   server read. Targets: `notification-preferences` (USER-scoped — needs a `mine`/`upsertMine`
   query keyed on the VERIFIED `getUserIdentity().subject`, a distinct auth pattern from the
   org-scoped ones), `custom-fields` (mostly native already), `project-tasks`, `activity-log`
   remainder, the `*-media` reads, `notifications` (Prisma invitation/user seam), paginated
   `getSupplierAssets`/`getSupplierSubhires`, `crew`/`models`/`kits`/`assets` LIST composites,
   `maintenance`, `test-tag-*` (needs a Convex user/member name mirror for `testedBy`).
2. **Write-domain deletions** — per domain: author `convex/*Writes.ts` (4 guards
   `assertWritesEnabled` + `enforceBrowserWriteLimit` + `requireOrgPermission` + `resolveActor`,
   per-row org re-check, `sanitizeClientSet` on patches, atomic `activityLogWrites.record`
   audit, `returns` validator; the client hook runs the domain's zod schema — see
   `use-native-client-writes.ts` / `convex/clientWrites.ts` as the template), move residual
   server orchestration INTO the mutation (Zod, `reserve*Tags`/counters, T&T auto-register,
   `recalculateProjectTotals`, cascades, dup-guards), rewire the forms browser-direct, **delete
   the server writes** (no fixtures to repoint now). Order: **kit → crew → project →
   line-item (keystone — availability/pricing must move in; heaviest) → asset → warehouse
   (scan-brain + inventory) → maintenance → project-services/sub-hires (money; native
   `recalculateProjectTotals` FIRST — already in `convex/lib/recalc.ts` behind `NATIVE_RECALC`)
   → models → categories/locations/suppliers → saved-views/notification-preferences/custom-fields**.
   (Many domains already have native `*Writes` mutations built + flag-gated — check first.)
3. **KEEP-SERVER-ONLY (never delete):** `api-keys` (dormant), `webhooks`, `site-admin`,
   `settings`, `sso`, `org-members`, `user-profile`, `invitations`, `public-org`, `changelog`,
   `notification-email-sender`, `woocommerce`, `test-tag-auditor/reminders/reports`,
   `org-calendar`/`crew-calendar`/`warehouse-display`, `document-templates`, `csv`,
   `crew-communication`, `split-sibling-collapse` — and ALL `src/lib/*-read.ts`.
4. **Also DoD:** CSV import bulk + benchmark (50/200/500/1000 × 1/4/8 vs the 16k-write/1s-CPU
   budget). `internal*` reduction is architecturally INAPPLICABLE for HTTP-client-called fns.

## Proven patterns (reuse these)

- **Dead-file check:** for a server file, grep each exported fn for non-test refs across `src`;
  if ALL are 0 → `git rm` the file (+ any int test that imported it) → tsc → ship. Scan:
  `for f in src/server/*.ts; do case $f in *.test.ts) continue;; esac; b=$(basename $f .ts); n=$(grep -rln "@/server/$b\"" src --include=*.ts --include=*.tsx | grep -v "\.test\.ts$" | grep -v "^$f$" | wc -l); echo "$n $b"; done | sort -n`.
- **Read re-home (composite):** author ONE Convex query returning the exact consumer shape,
  **bounded/index-scoped** (not org-wide reactive `.collect()` — Appendix B), org-re-check EVERY
  global-index fetch. Non-reactive datum (preview/count/report/popover) → keep `useServerQuery`
  but swap its `queryFn` to `convex.query(api.X.y, {...})`, gated `enabled: !!orgId && isAuthenticated`
  (one-shot). Live datum → reactive `useAuthedQuery(api.X.y, orgId ? {...} : "skip")`, drop `refetch`.
- **Pure logic trapped behind `getConvexClient`:** Convex CANNOT import `@/lib/*` (path alias
  unresolved in the Convex bundler). Port the pure builder into `convex/lib/*.ts` (byte-for-byte,
  `convex/lib/recalc.ts` + `convex/lib/availabilityBookings.ts` precedent) + a convex test; OR
  run the builder client-side in the hook (ROI pattern).
- **Relocate types out of `"use server"`:** never re-export a type from a `"use server"` file;
  move public shapes to a plain `src/lib/*-types.ts` (e.g. `availability-types.ts`).
- **Write template:** `convex/clientWrites.ts` + `use-native-client-writes.ts`.

## Per-PR checklist (streamlined — the agent-API steps are GONE)

1. `git fetch origin main --force` → branch off `origin/main`. **VERIFY the last PR's changes
   are actually present** (`grep`/`git show origin/main:<file>` for a new symbol) — a plain fetch
   right after a merge can return a STALE ref; if stale, `git reset --hard origin/main` after a
   forced fetch. `git merge-base --is-ancestor origin/main HEAD`.
2. Author query/hook (or reuse) → rewire consumers → `git rm`/trim the server file → remove
   now-dead imports (`npx eslint <files>`; leave PRE-EXISTING unrelated warnings alone).
3. For a NEW Convex fn: `pnpm exec convex dev --once` (⚠️ DEPLOYS to PROD, additive/inert) —
   MUST run BEFORE tsc (updates `_generated/api.d.ts`).
4. `npx tsc --noEmit` → `npx vitest run <domain test> convex/<domain>.test.ts` (+ a convex test
   for any new query/mutation: parity + cross-tenant + RBAC).
5. **codex review** (`codex exec --skip-git-repo-check "<focused correctness/security prompt>"`) → fix.
6. commit (end `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`) → push → `gh pr create`
   → `gh pr merge <n> --merge` (no branch protection; auto-merge intermittently rejected — use
   plain `--merge`) → **watch the PR's CI `Tests` job go green** (`gh pr checks <n>`; ~4–5 min) →
   `build-image.yml` deploys async via Coolify → verify
   `curl -s https://flow.rvlt.app -o /dev/null -w "%{http_code}"` = 307 (poll; the OLD container
   serves during the async swap — for a route/structural change, poll a removed path until fresh).

## Shipping workflow + environment

- Work in `/home/jayden/code/gearflow-perf-io` (wired to **PROD** Postgres `100.64.240.72` +
  **PROD** Convex Cloud `useful-cuttlefish-334`, deploy key in `.env.local`). **pnpm only**
  (`npm install` fails — arborist bug; pnpm-lock.yaml only). A launched-in worktree without
  node_modules/.env is NOT the place to build.
- `main` is checked out by the PRIMARY worktree → `git checkout main` FAILS in perf-io; always
  branch off `origin/main` directly. After each merge: `git fetch origin main --force && git
  checkout -b <branch> origin/main`; if a branch got cut from a stale ref, `git reset --hard origin/main`.
- Convex rules (CLAUDE.md): `throw new ConvexError(...)` never plain `Error`; `createIfMissing`
  never `create` for mirror first-writes; NEVER regenerate `convex/schema.ts` over itself
  (hand-add indexes); by_cuid/by_modelId are GLOBAL → per-row org re-check. `new Date(ms)` is
  allowed in Convex (deterministic); argless `new Date()`/`Date.now()` are not.
- UI (RVLT): install from the registry; overlays are Radix (`asChild`), Sidebar/Breadcrumb Base
  UI (`render`); Tooltip needs its own `TooltipProvider`; NEVER nest a Base UI popup in a Radix
  modal Dialog; cover new overlay UI with a jsdom smoke test that RENDERS it.
- Convex-test seeding: schema `defineTable` REQUIRED fields bite (e.g. `kits.assetTag`,
  `supplierOrders.type`) — check the schema stanza when a seed insert throws a validator error.

## Review & audit discipline (non-negotiable)

- **Every PR gets a codex pass** focused on correctness + the security baseline (per-row org
  re-check on global-index fetches; actor spoofing; validation parity when logic moves client-side).
- **After each WRITE-domain cluster, run an INDEPENDENT adversarial re-audit** (fresh
  general-purpose agent, `isolation: worktree`, trust nothing, verify against code + plan + the
  retained pure helpers): cross-tenant, bulk single-call, optimistic-by-consequence (no fake
  success on gear/quote/pricing/scheduling), read-set breadth. Self-verify its confirmed findings
  before fixing. (Read-only re-homing PRs: codex suffices; run a full re-audit periodically.)
- Keep `docs/phase3-data-layer-deletion-map.md` + the `convex-native-phase-progress` memory
  current as each domain lands (the memory is the cross-session source of truth).

## Definition of done (Phase 3)

Every domain browser-direct for reads AND writes; server-action data layer deleted except
`src/lib/*-read.ts` + the KEEP-SERVER-ONLY set; no org-wide reactive `.collect()` on subscribed
paths; every global-index fetch org-checked; CSV bulk + benchmark done; full suite green; codex +
an independent full re-audit clean; prod healthy (307) with a fresh container. **Then Phase 4**
(strip Prisma domain models + `DROP TABLE CASCADE`) is the only thing left — hand off (or do it)
with a fresh backup immediately before the irreversible migration (the drilled restore in
`docs/convex-backup-restore-runbook.md` is the standing authorization; prod is dark).

Start by reading the memory + plan + deletion map, spot-checking "where things stand", then pick
the next slice: knock out the remaining read re-homings, then run the write-domain sweep kit →
crew → project → line-item → … . Ship small, review hard, re-audit between write clusters.
