# Phase 3 continuation prompt (browser-direct native — WS2, the deletion grind)

> Paste this whole file as the opening message of a fresh session. It is self-contained.
> It continues `docs/phase-3-session-prompt.md` after ~16 shipped PRs + a full independent audit.

## Your mission

**Finish Phase 3** of the Convex-native migration — "browser-direct native" (WS2). The
security baseline, sharded counters, bulk single-call invariant, optimistic-by-consequence,
and the first wave of the server-action **data-layer deletion** are DONE and audited. What
remains is the **large mechanical tail**: re-home the ~87 components still on `useServerQuery`
to native Convex reads, make the remaining domain writes browser-direct, and **delete the
server-action data layer** (except the exemptions below). Work autonomously, phase-item by
phase-item, **shipping small PRs against `main`, with a codex review on every PR and an
independent adversarial re-audit after each domain cluster.** Prod is **dark/pre-launch**
(1 org, 3 users) so blast radius is low — but the mutation/query is now the security boundary,
so per-row org re-checks are non-negotiable (the last audit found 3 real cross-tenant holes).

**First, read these** (in order): `MEMORY.md` → the memory files `convex-native-phase-progress`
(THE cross-session source of truth — read it fully), `convex-native-migration-plan`,
`prod-box-access`, `prod-deploy-box`, `convex-local-validation`, `rvlt-registry`, plus the
Convex gotcha memories. Then `docs/convex-native-migration-plan.md` (§1 end-state, **§WS2 in
full**, §4 hard gates, **Appendix A — bulk inventory**, **Appendix B — efficiency standard**).
Then **`docs/phase3-data-layer-deletion-map.md`** (the authoritative per-file deletion worklist)
and `docs/phase-3-session-prompt.md` (the original DoD). Then `CLAUDE.md` (Convex + Server-Action
+ composition rules). `convex/_generated/ai/guidelines.md` is referenced by CLAUDE.md but does
NOT exist — rely on CLAUDE.md + the gotcha memories.

## Where things stand (verified 2026-07-14 — do NOT re-derive, but DO spot-check before trusting)

**DONE + on `main` + prod-307 (do not redo):**
- **Security baseline:** `resolveActor` (unspoofable), strict `v.*` + `returns` validators on the
  26 browser-direct `*Writes` mutations, `sanitizeClientSet` (no org/id anchor smuggling), rate
  limiter + `assertWritesEnabled` kill-switch, per-row org re-check on writes. **Sharded counters**
  (gate #3) built + backfilled. All audited CLEAN.
- **Bulk single-call invariant:** ZERO gate violations across every shipped multi-select surface
  (audited). Remaining bulk gaps are cold server-only paths (CSV) or plan-known-open (media link-step).
- **Optimistic-by-consequence:** 4 live optimistic hooks (asset/kit/project notes, line-item edit),
  all notes/edit-only; no consequential op fakes success. Audited CLEAN.
- **Deletion cluster (WS2) — 6 server files DELETED, browser-direct + agent-op-preserved-via-bridge:**
  `roi.ts`, `dashboard.ts`, `project-costs.ts`, `search.ts`, `tags.ts`, `scan-lookup.ts`. `activity-log.ts`
  reads re-homed (trimmed to CSV export). `saved-views` list re-homed (derives from the reactive hook).
  **client WRITES** browser-direct (`convex/clientWrites.ts` + `use-native-client-writes.ts`; the server
  writes are KEPT as the agent path per the decision below). All parity-audited MATCH.
- **Full independent audit (5 adversarial agents) done 2026-07-14; the 3 real cross-tenant holes it
  found are FIXED (#486) + the 1 efficiency regression FIXED (#487).** See "Audit state" below.

**★ TWO LOCKED USER DECISIONS (apply throughout):**
1. **ACCEPT dropping agent/MCP WRITE capability.** Write server actions CAN now be deleted — drop
   their agent write ops and **repoint the ~10 `src/lib/api/{mcp,openapi,dispatch}.test.ts` fixtures**
   (they use `clients.createClient`/`updateClient` as the canonical write examples). No CONVEX_WRITES
   bridge needed.
2. **For READS**, prefer preserving CURATED agent tools (list_projects, global_search, scan_lookup,
   create_client, etc.) via the `CONVEX_READS` bridge (relax the query guard + add an entry under the
   SAME op name/scope). Let long-tail non-curated read ops drop on deletion.

## Audit state (2026-07-14) — close these first

- **FIXED #486** — 3 cross-tenant holes on the line-item surface (listByIds/listByProjectIds missing
  per-row org filter; add* create paths missing project-org check → new `assertProjectInOrg`).
  `convex/lineItemOrgIsolation.test.ts` guards it.
- **FIXED #487** — ROI hooks reactive→one-shot (Appendix B).
- **OPEN — close early in the new session:**
  1. **`dashboardStats.bundle`** still does 2 org-wide reactive `.collect()` (projects + maintenanceRecords)
     for the date-derived metrics (`maintenanceDue`, `overdueReturns`). Fix per Appendix B: range-scan
     `projects` by `rentalEndDate`; add a maintenance composite index. (Counters already sharded/O(1).)
  2. **3 plan-Appendix "DONE 12 Jul" claims are FALSE on main** — `assets.bulkAddTags`+bulkTagAssets,
     `clients.bulkArchive`+row-selection, notifications "Dismiss All" server-side
     (`notificationDismissals.createManyIfMissing`; it's still localStorage-only). Either BUILD them
     (small) or correct `docs/convex-native-migration-plan.md`'s Appendix to stop claiming DONE.

## The remaining worklist (the XL tail) — suggested order

**Scope reality:** ~87 components still import `useServerQuery`; ~45 `src/server/*.ts` data-layer files
remain (of ~78; the ~6 Wave-1 pure-read files are deleted). Most reads are COMPOSITE (project-count/
media/availability joins) needing an authored Convex query + a pure-logic extraction. This is a
multi-PR grind — ship one clean domain at a time.

1. **Close the audit's OPEN items** (dashboardStats index + the 3 plan-accuracy corrections). Quick wins.
2. **Read re-homing, domain by domain** (per the deletion map's wave order). For each: author the
   browser-callable Convex query (or reuse an existing `requireOrgRead` one), rewire the browser
   consumers to `useAuthedQuery`/`useConvex().query`, preserve curated agent tools via `CONVEX_READS`,
   delete/trim the server read. Next targets: `clients` reads (getClients/getClient composites),
   `availability.ts` (4 booking queries — a real pipeline refactor: its builders consume mapped docs
   behind `getConvexClient`, so extract the pure builders/mapping to a Convex-importable module first),
   `categories`/`locations`/`suppliers` (counts + detail composites), `models`/`kits`/`assets`/`crew`
   reads, `maintenance`, `test-tag-*` reads (need a Convex user/member name mirror for `testedBy`),
   `supplier-orders`, `notification-preferences` (user-scoped), `custom-fields` (mostly already native).
3. **Write-domain deletions** (now unblocked by decision 1): per domain, author `convex/*Writes.ts`
   (4 guards + per-row org re-check + `sanitizeClientSet` on patches + atomic audit + `returns` validator;
   the client hook runs the domain's zod schema for validation/defaults — see `use-native-client-writes.ts`),
   rewire the forms to browser-direct, **delete the server writes + repoint the API test fixtures**, drop
   the agent write ops. Domains: kit, crew, project, line-item (keystone — availability/pricing must move
   in; heaviest), asset, warehouse (scan-brain + inventory — most careful), maintenance (asset state
   machine), project-services/sub-hires (money; need native `recalculateProjectTotals` first — already
   duplicated in `convex/lib/recalc.ts` behind `NATIVE_RECALC`), models, categories/locations/suppliers,
   saved-views/notification-preferences/custom-fields/brand-templates.
4. **KEEP-SERVER-ONLY (never delete):** auth/admin/settings, sso, api-keys, org-members, user-profile,
   invitations, public-org, changelog (`execSync`), notification-email-sender (Resend cron), woocommerce
   + webhooks (crypto), test-tag-auditor/reminders/reports (crypto/email/CSV), org-calendar/crew-calendar/
   warehouse-display (crypto tokens), document-templates (pdfme), csv (RBAC + org.metadata counter),
   crew-communication (email). And **all `src/lib/*-read.ts`** service-read helpers (PDF/CSV Node paths).
5. **Also required by DoD:** CSV import bulk + benchmark (50/200/500/1000 × 1/4/8 vs 16k-write/1s-CPU);
   `internal*` reduction is architecturally INAPPLICABLE for HTTP-client-called fns (documented — the
   `requireService` guard IS the access control).

## The proven re-homing patterns (reuse these)

- **Reads re-home safely** because `requireOrgRead`/`requireOrgReadDoc`/`requireOrgPermission` ALL
  short-circuit-allow for a service token — so relaxing a query's `requireService`→`requireOrgRead(ctx,orgId)`
  keeps PDF/CSV service callers working AND enables the browser. **Every row fetched by a GLOBAL index
  (`by_cuid`/`by_modelId`/`by_projectId`) must be re-checked `doc.organizationId === orgId`** — the last
  audit found 3 holes from missing this. Sweep every new/existing public read for it.
- **Pure logic trapped behind `getConvexClient`:** extract the pure builders/mappers into a plain
  `src/lib/*.ts` (no getConvexClient import) so client hooks + Convex queries can share them (did this for
  `saved-views-filter.ts`, `client-fields.ts`, `activity-log-filters.ts`, `search-types.ts`).
- **Composite read → author a browser-callable Convex query** (project-scoped by index where possible,
  not org-wide reactive `.collect()` — Appendix B). Reports/autocomplete with no liveness need → one-shot
  `useConvex().query`, NOT a reactive subscription (roi/tags pattern).
- **Agent-only reads** (no browser consumer): just bridge + delete (dashboard/scan-lookup).
- **Write template:** `convex/clientWrites.ts` + `use-native-client-writes.ts`.

## Per-deletion checklist (mechanics — each bit me at least once)

1. `git fetch origin main` → branch off `origin/main` (SERIALIZE deletions — every one regenerates
   `operations.ts`, so parallel branches conflict there; resolve by regenerating).
2. Author query/hook (or reuse) → rewire consumers → `git rm` / trim the server file.
3. `pnpm exec tsx scripts/generate-api-registry.ts` to regen the API registry.
4. Remove any curated `mcp-tools.ts` / `tool-aliases.ts` / `public/llms.txt` entry for a dropped op;
   OR add a `convex-reads.ts` bridge entry to preserve a curated tool.
5. Repoint/delete broken int-tests + API fixtures (they reference deleted server fns).
6. `pnpm exec convex dev --once` (⚠️ DEPLOYS to PROD, additive/inert) — MUST run BEFORE tsc for a new
   Convex fn (updates `_generated/api.d.ts`; tsc-first fails "Property X does not exist on api").
7. `npx tsc --noEmit` → `npx vitest run src/lib/api/` (114 tests guard the registry) + the domain test.
8. **codex review** (`codex exec --skip-git-repo-check "<focused correctness/security prompt>"`) → fix.
9. commit (end message `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`) → push → `gh pr create`
   → `gh pr merge <n> --merge` (no branch protection; auto-merge is intermittently rejected — fall back to
   plain `--merge`) → **watch the PR's CI `Tests` job go green** (a merge ≠ CI passed) → `build-image.yml`
   deploys async via Coolify → **verify `curl -s https://flow.rvlt.app -o /dev/null -w "%{http_code}"` = 307**.

## Shipping workflow + environment

- Worktree `/home/jayden/code/gearflow-perf-io` is wired to **PROD** Postgres (`100.64.240.72`) + **PROD**
  Convex Cloud (`useful-cuttlefish-334`, deploy key in `.env.local`). **pnpm only** (`npm install` fails —
  arborist bug; pnpm-lock.yaml only). Prod DARK (1 org `jlrtkbf64z7ogmyzi30uonoe`).
- **Live-validation** (worktree service token is NOT trusted by prod Convex): run backfills/validation
  INSIDE the prod app container — `CID=$(ssh root@100.72.165.61 'docker ps --filter ancestor=ghcr.io/twotoned/gearflow:latest --format "{{.ID}}"|head -1')` (filter by IMAGE, name is a hash), `docker cp` + `docker exec $CID sh -lc 'cd /app && npx tsx scripts/X.ts'`. `/browse` (gstack) can smoke-test prod (creds in the memory) — build it once via `.claude/skills/gstack/setup`.
- **Worktree hygiene:** keep the tree clean between PRs; never let a background agent `git checkout` in the
  SHARED worktree (use `isolation: worktree` for agents); don't leave detached-HEAD commits (branch first).
- **Convex rules (CLAUDE.md):** `throw new ConvexError(...)` never plain `Error`; `createIfMissing` never
  `create` for mirror first-writes; NEVER regenerate `convex/schema.ts` over itself; `by_cuid`/`by_modelId`
  global → per-row org re-check.
- **UI (RVLT):** install from the registry; overlays are Radix (`asChild`), Sidebar/Breadcrumb Base UI
  (`render`); Tooltip needs its own `TooltipProvider`; never nest a Base UI popup in a Radix modal Dialog;
  cover new overlay UI with a jsdom smoke test that RENDERS it.

## Review & audit discipline (non-negotiable — this caught real bugs)

- **Every PR gets a codex pass** focused on correctness + the security baseline (per-row org re-check on
  by_cuid/by_projectId fetches; actor spoofing; validation parity when logic moves client-side).
- **After each domain cluster, run an INDEPENDENT adversarial re-audit** (spawn a fresh general-purpose
  agent with `isolation: worktree`, tell it to trust nothing and verify against the code + plan):
  cross-tenant holes (every global-index fetch org-checked), single-array-mutation bulk, optimistic-by-
  consequence (no fake success on gear/quote/pricing), read-set breadth minimal (no org-wide reactive
  `.collect()`), parity with the deleted server behavior. **Self-verify its confirmed findings yourself
  before fixing**, then fix, then re-audit. (The 2026-07-14 audit ran 5 agents by dimension — repeat that
  shape for a full pass; a per-cluster agent for incremental work.)
- **Update `docs/phase3-data-layer-deletion-map.md` + the `convex-native-phase-progress` memory** as each
  domain lands (the memory is the cross-session source of truth).

## Definition of done (Phase 3)

- Every domain browser-direct for reads AND writes; server-action **data layer deleted** except
  `src/lib/*-read.ts` + the KEEP-SERVER-ONLY set; API fixtures repointed; agent read-tools preserved via
  bridge where curated.
- No org-wide reactive `.collect()` on subscribed paths (Appendix B); every global-index fetch org-checked.
- CSV bulk + benchmark done; the audit's open items closed.
- Full suite green; codex + an independent full re-audit clean; prod healthy (307) with a fresh container.
- Then **Phase 4 (strip Prisma domain models + `DROP TABLE CASCADE`)** is the only thing left — hand off
  (or do it) with a fresh backup immediately before the irreversible migration (the drilled restore in
  `docs/convex-backup-restore-runbook.md` is the standing authorization; prod is dark).

Start by reading the plan + memory + deletion map, spot-checking the "where things stand" claims, then
close the audit's open items and grind the read re-homing + write deletions domain by domain. Ship small,
review hard, re-audit between clusters.
