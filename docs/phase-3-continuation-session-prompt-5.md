# Phase-3 continuation — session prompt #5 (CLOSE-OUT: projects Slice B + re-audit + cleanup)

> Paste this whole file as the opening message of a fresh session. It is self-contained.
> Continues `docs/phase-3-continuation-session-prompt-4.md` after a large session that
> (a) executed the whole Postgres DECOMMISSION and (b) pushed the browser-direct WRITE
> sweep to 3.5/4 domains. This prompt is the **final close-out** of Phase 3.

## Your mission

**Close out Phase 3** of the Convex-native migration. The heavy lifting is done — Postgres
is decommissioned (77 domain/config tables dropped, prod at 17 tables) and almost every
write domain is browser-direct. What remains is: **(1) projects Slice B** (the last
convertible write domain, delicate), **(2) an independent security re-audit** of the new
browser-direct write surface, and **(3) a hygiene sweep** (dead Convex fns, Stage-5
decommission infra, vestigial config). Work autonomously, one clean slice per PR, shipping
small PRs to `main` with a **codex review on every PR** and **live prod validation** of any
money/data path. Prod is **dark/pre-launch** (1 org `jlrtkbf64z7ogmyzi30uonoe`, 3 users) so
blast radius is low — but the Convex mutation is the security boundary, so **per-row org
re-checks on every global-index fetch (`by_cuid`/`by_modelId`/…) are non-negotiable**, and
`resolveActor` must pin the audit actor to the verified token on every user-token write.

**First, read these** (in order): `MEMORY.md` → the memory file `convex-native-phase-progress`
(THE cross-session source of truth — read it FULLY; the newest entries at the bottom cover
this whole session's 7 PRs #581–#586, the decommission, the flag removal, and the
browser-direct write sweep incl. the exact Slice-B scope), `convex-prod-push-expand-contract`,
`prod-box-access`, `prod-deploy-box`. Then `docs/designs/convex-decommission-RUNBOOK.md`
(Phase C marked DONE), `docs/phase3-data-layer-deletion-map.md`, and `CLAUDE.md` (Convex +
composition rules). `convex/_generated/ai/guidelines.md` referenced by CLAUDE.md does NOT
exist — rely on CLAUDE.md + the gotcha memories.

## Where things stand (verified 2026-07-17 — spot-check before trusting)

**DONE this session, all merged + deployed + prod-307:**
- **#581/#582 DECOMMISSION:** dropped 76 Convex-native Postgres tables + the implicit
  `_CrewMemberToCrewSkill` join (65 core domain + 11 config/gap/webhook). **Prod is now 17
  tables = Better Auth (user/session/account/verification/organization/member/invitation/
  twoFactor/backupCode/passkey/jwks/ssoProvider/pendingSSOApproval) + dormant custom-API
  (apiKey/apiIdempotency) + frozen activity_log.** Safety: pg_dump + Convex export + scratch-DB
  rehearsal + parity re-verify (all in the memory). schema.prisma matches migration history
  (no drift). ★ The prior "Phase 4 (DROP TABLE)" is therefore ALREADY DONE.
- **#583 removed the always-on `NATIVE_*` flags** (server writes + read + optimistic flags,
  hardcoded native, dead legacy branches deleted, Dockerfile/build-image build-args stripped).
- **#584/#585 line-items browser-direct** (singular + bulk): forms call `useLineItemWrites()`
  (user token → hardened native mutations); `line-items.ts` is now READS +
  `recalculateProjectTotals` (woo) only. #585 authored `removeManyNative`/`patchManyNative`
  + `convex/lib/lineTotal.ts` (money recomputed in-mutation from the doc, never client).
- **sub-hires + project-services were ALREADY browser-direct** (earlier #563–565 wave) —
  server files are reads + genuine carve-outs (sub-hire media ref-count delete; project-service
  crew-message/CSV). No work needed.
- **#586 projects Slice A:** status/notes/archive/deleteTemplate browser-direct; un-gated the
  dormant `NEXT_PUBLIC_NATIVE_PROJECT_STATUS_BROWSER` flag; deleted those 4 server actions.
  Live-validated (status change → confirmed → reverted, no errors).

## The remaining worklist (priority order)

### 1. ★ PROJECTS SLICE B — the last write domain (delicate; do FIRST, its own PR)
Convert `createProject` / `updateProject` / `duplicateProject` / `saveAsTemplate` /
`deleteProject` in `src/server/projects.ts` to browser-direct, then delete them so
`projects.ts` is READS ONLY. **The native mutations ALL exist + are hardened + prod-proven**
(the server actions call them today via service token): `projectWrites.createNative` /
`updateNative` / `duplicateNative` / `saveAsTemplateNative` / `deleteNative`. This is WIRING
+ client-side data resolution, not new mutation logic. Build a `useProjectWrites()` hook (or
extend `src/hooks/use-native-project-writes.ts`, which already has status+notes+archive+
deleteTemplate) with `create/update/duplicate/saveAsTemplate/remove` methods, `enabled`-guard
(throw "Not ready" if `!orgId||!session`), and `resolveActor`-pinned actor.

**The nuances (read the current server actions in `src/server/projects.ts` to replicate arg-building):**
- **createNative** AUTO-numbers in-mutation via an `autoNumber` config. The server derives it
  as `readProjectNumberConfig(org.metadata)` (Better-Auth org metadata) with
  `useAutoNumber = !isTemplate && !parsed.projectNumber && !!autoConfig`. The browser hook
  must resolve `autoConfig` **client-side** — read the active org's `metadata` (from
  `useActiveOrganization`, or a read) and call the pure `readProjectNumberConfig` (relocate it
  to a shared `src/lib/*` module if it isn't already client-importable). Pass `autoNumber`
  config (or `projectNumber` for the manual/template path). `createNative` returns
  `{created:false}` on a number-clash → retry with the next number (mirror the server's loop).
- **duplicateNative / saveAsTemplateNative** take a CLIENT `newProjectNumber`/`templateNumber`
  + an in-mutation clash-guard (throws `DUPLICATE_PROJECT_CODE`). The client peeks via the KEPT
  read `peekNextProjectNumber()` then passes it; retry on clash. They also need `orgDefaultTaxRate`
  (resolve client-side from org settings, or pass null — the mutation resolves it; check).
- **deleteNative** needs `defaultLocationId` (the org's default location — server uses
  `getDefaultLocation(orgId)`; resolve client-side via a read/hook) and runs the FULL 8-step
  cascade (frees CHECKED_OUT assets/kits, orphans lines/groups/PMs/crew — the #567
  prod-orphan-bug fix). Returns `{freedAssets, freedKits}`.

**Callers to rewire:** `project-wizard.tsx` (create + update), `duplicate-project-dialog.tsx`
(duplicate + saveAsTemplate), `projects/[id]/page.tsx` (deleteProject). **KEEP** the reads:
`getProjects/getProject/getTemplates/getProjectIssueFlags/peekNextProjectNumber/
checkProjectNumberAvailable/getCallSheetDates`.

**Validation (MANDATORY — data/money-critical):** codex-review the wiring + numbering + the
delete-cascade arg-passing HARD. Then **live-smoke on prod**: create a throwaway test project
(exercises createNative browser-direct + numbering), edit it (updateNative), then delete it
(deleteNative cascade) — a clean create→delete round-trip on a NEW project (don't touch real
data). Confirm the number allocates, the project persists, and delete removes it with no
errors + no orphaned rows.

### 2. ★ Independent security re-audit (after Slice B lands — its own step, no code unless it finds something)
Spawn a fresh general-purpose agent (`isolation: worktree`, trust nothing) to adversarially
audit ALL the browser-direct WRITE surface added across this session (line-items singular +
bulk, projects A + B): cross-tenant (every `by_cuid`/`by_modelId`/`by_projectId` fetch
org-re-checked), actor-spoofing (`resolveActor` pins to verified token), money integrity
(lineTotal/discount recomputed in-mutation, never trusted from client), optimistic-by-consequence
(no fake success on gear/quote/pricing/delete-cascade), and the numbering TOCTOU (create/duplicate).
Self-verify its confirmed findings before fixing; fix each as its own small PR.

### 3. Hygiene sweep (low-risk, finishes the story — can be one PR or a few)
- **Dead Convex fns** orphaned by the conversions: `projectLineItems.removeManyCascade`,
  `patchMany`, `listByIdsForOrg` (only the deleted bulk server actions used them), plus any
  `requireService` CRUD mirror mutations that only existed as the old server-action path
  (grep each Convex export for non-test `api.X.y` callers; if 0 → delete). Be careful:
  many `*Native`/core fns are shared — only delete truly-orphaned ones.
- **Stage-5 decommission infra:** delete remaining dead backfill/parity scripts + the
  `createIfMissing` service-mirror mutations + `src/lib/*-mirror.ts` for DROPPED tables.
  ⚠️ **KEEP `member-mirror.ts` + `user-mirror.ts`** (they mirror the KEPT auth tables) and
  the `-read.ts` service helpers. Grep-verify zero runtime callers before deleting each.
- **Vestigial config:** the removed server-side flags (`NATIVE_ASSET/KIT/CREW/PROJECT/
  LINEITEM_WRITES`, `NATIVE_RECALC`) are still set `=true` in the Coolify env (harmless —
  no code reads them) and the `gh` repo variables for the deleted `NEXT_PUBLIC_NATIVE_*`
  flags are now unused. Prune them (Coolify env via the dashboard / prod box; `gh variable
  delete` for the repo vars). Optional but tidy.

### 4. Loose ends (decisions, not blockers — surface to the user)
- **`NATIVE_EMAIL_SIDEEFFECTS`** — the one remaining dormant flag (routes post-write email
  through the Convex durable scheduler instead of inline `sendEmail`). It was NEVER wired into
  prod. Either flip it on after a delivery dogfood (needs `RESEND_API_KEY`+`EMAIL_FROM` on the
  Convex deployment) or delete the dead branch. Product/ops call — ASK.
- **CSV import bulk + benchmark** — the original Phase-3 DoD listed a bulk-import throughput
  benchmark (50/200/500/1000 rows × 1/4/8 concurrency vs the 16k-write/1s-CPU Convex budget).
  Verify whether it was ever done (grep `scripts/` for a benchmark); if still owed, run it.

### KEEP-SERVER-ONLY (never convert — the permanent server layer)
`sso`, `webhooks`, `settings`, `site-admin`, `org-members`, `api-keys`, `woocommerce`,
`test-tag-auditor`, `warehouse-display`, `notification-email-sender`, `csv`, `invitations`,
`user-profile`, `document-templates`, `changelog`, `crew-calendar`/`org-calendar`,
`crew-communication`, `crew-time`, `test-tag-reports`/`test-tag-reminders`, the media +
crew-message carve-outs in `sub-hires`/`project-services`, and all `src/lib/*-read.ts`.
All crypto/email/CSV/external/Better-Auth-bound. These are DONE, not TODO.

## Shipping workflow + environment (unchanged)
- Work from a prod-wired worktree. This session used a DEDICATED one
  `/home/jayden/code/gearflow-decommission` (prod Postgres + prod Convex Cloud
  `useful-cuttlefish-334`, deploy key in `.env.local`, `pnpm` only). `main` is checked out by
  the PRIMARY worktree → branch off `origin/main` directly: `git fetch origin main --force &&
  git checkout -b <branch> origin/main`.
- Per PR: author hook/mutation (or reuse) → `pnpm exec convex dev --once` (⚠️ DEPLOYS to PROD,
  additive/inert until the app ships — MUST run before tsc to update `_generated/api.d.ts`) →
  `npx tsc --noEmit` → `npm test` → `npx next build` (the REAL gate — catches the Turbopack
  barrel footgun tsc/lint miss) → **codex review** (`codex exec --skip-git-repo-check`) → fix →
  commit (end `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`) → push → `gh pr create`
  → `gh pr merge <n> --merge` → watch `build-image.yml` (async Coolify deploy, ~6–8 min) →
  poll the container swap + `curl -s https://flow.rvlt.app -o /dev/null -w "%{http_code}"` = 307
  → live-smoke via the browse tool (build once: `cd /home/jayden/code/gearflow/.claude/skills/
  gstack && bash ./setup`; binary at `.../gstack/browse/dist/browse`; creds
  j.nawotka9@gmail.com / Test1234!).

## Gotchas + patterns confirmed this session (reuse)
- **Expand-contract for ANY change to a live-called mutation** (prod runs native writes) —
  optional-and-ignored for removed args, gate new side-effects behind an optional `=== true`
  signal the old image never sends. Additive new fns are safe.
- **Barrel-import footgun:** in a client module (or a `src/lib` imported by client hooks) NEVER
  import from a barrel that also re-exports server-only code — Turbopack `next build` fails
  (`EcmascriptModuleContent::new_merged failed`); import the concrete module.
- **Delegate-impl → codex-verify** worked well: delegate the mechanical wiring to a
  general-purpose subagent with an EXACT spec (arg shapes, transformation rules, keep-list),
  then codex-review the money/security logic yourself + live-validate. Codex caught a real
  parity issue in nearly every money PR (client-overcounted toast, empty kit label, missing
  enabled-guard) — pre-apply those classes.
- **Recompute money in-mutation** (lineTotal/discount from the fetched doc, never client);
  client-minted-id dup guards must reject cross-org collisions; the RESOLVED/fallback FK must be
  org-validated at the browser boundary.
- **browse headless limits:** Base UI dialog triggers (bulk-edit dialog, the Add▾ menu) don't
  reliably fire under automated click — validate those paths via a driveable proxy (reorder,
  status change, checkbox+bulk-bar) + codex + shared-infra parity, and note the gap honestly.
- **prod validation:** worktree service token isn't trusted by prod Convex → run parity/backfills
  INSIDE the prod app container (`docker exec <ancestor=ghcr.io/twotoned/gearflow:latest> sh -lc
  'cd /app && npx tsx scripts/X.ts'`). Scratch-DB migration rehearsal via the postgres:18-alpine
  container on `root@100.72.165.61`.

## Definition of done (Phase 3 CLOSED)
`projects.ts` is reads-only (write layer browser-direct); the server-action write layer is gone
except the KEEP-SERVER-ONLY set + carve-outs; the independent re-audit is clean; the hygiene
sweep is done (no orphaned Convex fns, dead Stage-5 infra, or vestigial flags); full suite green;
codex clean on every PR; prod healthy (307) on a fresh container after each deploy; the
email-sideeffects + CSV-benchmark decisions are surfaced/resolved. At that point Phase 3 — and
the whole Prisma→Convex-native migration — is **complete**: Postgres holds only Better Auth +
dormant API + audit, and every domain read AND write runs native/browser-direct on Convex.

Start by reading the memory + this file, spot-checking "where things stand", then do projects
Slice B (careful, live-validated), the re-audit, then the hygiene sweep. Ship small, review hard.
