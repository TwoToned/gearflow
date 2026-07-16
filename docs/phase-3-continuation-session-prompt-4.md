# Phase-3 continuation — session prompt #4 (partial-keep reduction + DECOMMISSION)

> Hand this file to a fresh session. It assumes the shipping workflow + memory
> `convex-native-phase-progress` are loaded. Prior prompts: `phase-3-continuation-session-prompt{,-2,-3}.md`.
> Authoritative worklist: `docs/phase3-data-layer-deletion-map.md`. Decommission
> procedure: `docs/designs/convex-decommission-RUNBOOK.md`. Backup/restore drill:
> `docs/designs/convex-backup-restore-runbook.md`.

## Where things stand (2026-07-17)

The **entire browser-direct data-layer conversion is done**. Every convertible
`src/server/*` domain has been migrated: the money keystone (line-items/projects/
sub-hires + recalc/availability/suggested-price), all 8 Wave-5 money domains, the
Wave-3 inventory core, the Wave-4 crew cluster, the state-machine cluster
(notifications/collaboration/test-tag-records/maintenance/check-records), and the
**money form-flip (#570)**. Consumer forms call browser-direct mutations behind
`NEXT_PUBLIC_NATIVE_*_BROWSER` flags (default OFF — flip via a rebuild when ready).

**So there is NO "author a new *Writes / re-home a read" domain work left.** What
remains is (A) optionally reducing the partial-keeps, and (B) the DECOMMISSION tail.

### Verified KEEP-SERVER-ONLY (never convert — Node/crypto/Better-Auth/CSV/external)
`webhooks`, `api-keys`, `csv`, `invitations`, `org-members`, `sso`, `site-admin`,
`public-org`, `settings` (member/org half), `woocommerce`, `notification-email-sender`,
`user-profile`, `split-sibling-collapse`, `document-templates`, `changelog` (fs/build),
`crew-calendar` + `org-calendar` (iCal `randomBytes` crypto), `crew-communication`
(email+crypto), `crew-time` (CSV+API-route), `test-tag-reports` (report/CSV+API-route),
`test-tag-reminders` (cron/email), `test-tag-auditor` (crypto token+public API),
`warehouse-display` (crypto token+public), the `src/lib/*-read.ts` service-read helpers.
**Do NOT try to convert these** — each was individually verified. (The last small
convertible one, `warehouse-close-read`, shipped in #579.)

### Partial-keeps (retained for a reason — see the blocker before touching)
| File | exports | Why it's kept | To fully close |
|---|---|---|---|
| `line-items.ts` | 14 | `recalculateProjectTotals` is imported by `woocommerce.ts` (KEEP) + availability reads (`checkAvailability`/`lookupAssetByTag`/`checkKitAvailability`) + non-money tail | move recalc to a lib both can import (or have woo call `recalcNative`) → re-home availability as native queries → move/drop the collab/supplier/webhook readBack tail |
| `projects.ts` | 16 | same recalc/availability coupling + project reads + non-money tail | same as line-items |
| `sub-hires.ts` | 8 | `removeMediaConvex`/`refCountFile` media-delete carve-out (uses `src/lib/media-write.ts`) + reads | move the ref-counted media delete native → re-home the reads |
| `project-services.ts` | 5 | crew-message (email) + CSV carve-outs + reads | re-home the reads; keep the crew-msg/CSV (Node) exports |
| `notifications.ts` | 2 | `getNotifications`' `pending_invitation` branch reads Better-Auth `invitation` + `user.email` (Postgres; the Convex `invitations` table is an **unpopulated** mirror with no writer) | mirror `invitation` into Convex + author a native aggregate, OR drop the invitation-notification type (product decision) |
| `check-records.ts` | 13 | the prep/deprep/pull/read exports are **int-test drivers** (`warehouse-*.int.test.ts` drive the state machine THROUGH these server actions against real PG+Convex) | **decommission-coupled** — delete when the int-tests are removed/rewritten (they exist because the Prisma tables still exist) |
| `warehouse.ts` | 14 | same — `requireService` thin wrappers kept as int-test entrypoints | **decommission-coupled** |

**Recommendation:** the reducible partial-keeps (line-items/projects/sub-hires/
project-services) are real per-domain work with LOW payoff (they're already thin, and
the money math is 100% native). `check-records`/`warehouse` cannot be reduced until the
decommission removes the int-tests. So **do the partial-keep reduction ONLY if you want
the server dir empty for aesthetics; otherwise skip straight to the decommission**, which
is the actual remaining value (retire Postgres domain tables → the whole point of the
migration).

---

## The DECOMMISSION tail — the real remaining work (⚠️ ONE-WAY DOOR)

Goal: retire the Postgres domain tables now that all domain data is Convex-native.
Follow `docs/designs/convex-decommission-RUNBOOK.md` + `convex-native-migration-plan.md`
(Stages 3–5). Keep Postgres ONLY for Better Auth (`user`/`member`/`organization`/
`invitation`/`session`/`account`), `customRole` (0 rows on prod — droppable), and the
frozen `activity_log` if still referenced.

### Hard prerequisites BEFORE any destructive op (non-negotiable)
1. **Backup + REHEARSED restore drill.** `convex-backup-restore-runbook.md` — the
   export works (`pnpm exec convex export --include-file-storage`), but the RESTORE
   drill (import into a scratch deployment + verify) was still OWED as of the memory.
   **Do the restore rehearsal first.** Also `pg_dump` the prod DB (`root@100.72.165.61`,
   `docker exec <postgres:18-alpine> pg_dump -U postgres gearflow`).
2. **Parity re-verify** every table you intend to drop: Convex row-count == Postgres
   row-count, spot-check content (the backfill/parity scripts under `scripts/` +
   `docs/designs/convex-hybrid-migration.md`). A table only drops when Convex is proven
   the sole source of truth AND nothing in `src/` still reads it via `prisma.<model>`.
3. **`prisma.<model>` grep must be clean** for each table: no runtime read/write
   remains (int-test fixtures are the last holdouts — they gate `check-records`/
   `warehouse`; retire those int-tests or repoint them to Convex first).
4. **Show the user the DROP plan and get explicit go-ahead.** Reversible ops
   (additive migrations, backfills, parity, backups) run autonomously; `DROP TABLE
   CASCADE` / data-destroying migrations / prod cutover / S3-Garage retirement are
   one-way doors that need sign-off (see `prod-box-access` memory guardrails).

### Sequence (per the runbook)
- **Stage 3 — strip the dead Prisma schema.** Remove the now-Convex-only models from
  `prisma/schema.prisma`. Hand-author the migration (`prisma migrate dev` demands a
  reset on this drifted DB — use `migrate deploy` with a hand-written migration; see
  `prisma-preexisting-drift` memory). Drop FK columns first (child→root order), then the
  models. ⚠️ **Bulk-data migrations must end with `ANALYZE "<table>";`** (CLAUDE.md).
- **Stage 4 — `DROP TABLE CASCADE`** the retired tables (the irreversible step; after
  the backup+restore drill + go-ahead). Migrations run at container start
  (`docker-entrypoint.sh` → `prisma migrate deploy`), NOT in the CI runner.
- **Stage 5 — delete the backfill/parity/mirror infra**: `scripts/convex-backfill-*.ts`,
  parity scripts, the `src/lib/*-mirror.ts` dual-write helpers, the `createIfMissing`
  service-mirror mutations that only existed for the Prisma→Convex bridge, and the
  `NATIVE_*` runtime flags (now always-on).
- Finally, the `check-records`/`warehouse`/`line-items`/`projects` partial-keep server
  files can be deleted once their int-tests are gone and woo/availability are re-homed.

### ⚠️ Decommission-specific gotchas
- **`convex/schema.ts` is hand-diverged from the generator** (CLAUDE.md): it carries
  hand-added `searchIndex`/composite indexes + Phase-C tables whose Prisma models are
  already stripped. NEVER regenerate it over itself. Dropping a Prisma model does NOT
  require touching the Convex table (it's already the source of truth) — leave the
  Convex schema alone.
- **`by_cuid`/`by_modelId` are GLOBAL Convex indexes** — any cross-tenant audit you do
  must re-check `organizationId` (this bit every state-machine PR this session).
- **Prod is DARK** (1 org `jlrtkbf64z7ogmyzi30uonoe`, 3 users) → blast radius is small,
  but that is NOT a substitute for the backup+restore drill on a one-way door.

---

## Shipping workflow + safety (unchanged — read `convex-prod-push-expand-contract` in full)
- Work from `/home/jayden/code/gearflow-perf-io` (PROD Postgres + PROD Convex Cloud
  `useful-cuttlefish-334`, deploy key in `.env.local`). `git fetch origin main` → branch
  off `origin/main` per change → ship as its own PR → codex-review → CI-green → prod-307.
- `pnpm exec convex dev --once` (NEVER `npx convex`) DEPLOYS to PROD immediately.
  **Expand-contract for ANY change to a live-called mutation** (optional-and-ignored for
  removed args, gate new side-effects behind an optional signal the old image never
  sends). Additive new fns are safe.
- **Barrel-import footgun (new this session):** in a client module — or a `src/lib`
  module imported by client hooks — NEVER import from a barrel (`index.ts`) that also
  re-exports server-only code (`withAction`, Prisma translators). It drags server code
  into the client chunk and `next build` (Turbopack) fails with
  `EcmascriptModuleContent::new_merged failed` — a whack-a-mole error that tsc/Lint/Tests
  do NOT catch. Import the concrete file. (Fixed `src/lib/native-writes.ts` → #570.)
- **Recurring codex classes to pre-apply** (caught a real bug in every state-machine
  PR): client-minted-id dup guards must REJECT cross-org/unrelated collisions (not
  silent-skip); the RESOLVED/fallback FK (e.g. `line.assetId`) must be org-validated at
  the browser boundary, not just the client-supplied one; "which items get side-effects"
  must be re-derived server-side, not trusted from the client.
- **⚠️ Concurrent-workflow hazard:** a second autonomous agent has been sharing this
  worktree (a Phase-3 hardening sweep). It switches branches/HEAD + auto-stages files.
  Commit with EXPLICIT pathspec (`git commit -- <files>`, never `git add -A`); if HEAD
  gets swapped, `git stash --include-untracked -- <your files>` → checkout your branch →
  `git reset --hard origin/main` → `git stash pop`. **Give the decommission session its
  OWN worktree** if the other agent is still running — the decommission touches shared
  schema/migration files and cannot tolerate a mid-op branch switch.
