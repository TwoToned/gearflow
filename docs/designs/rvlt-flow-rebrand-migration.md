# Brand Migration: Gearflow → RVLT Flow

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

**Goal (as stated):** Zero mentions of "gearflow" anywhere — code, comments, docs, folders, UI copy, GitHub. Move the repo from the `TwoToned` org to `RVLT-Labs`. Full external + internal rebrand.

**Decisions locked (2026-07-17 review):**
1. **Scope = pragmatic zero + allowlist.** Zero gearflow in all user-facing surfaces + new code/docs; a documented keep-list for identity anchors; a CI guard blocks new occurrences. (Not literal-zero-including-infra.)
2. **Repo renamed** `gearflow` → `rvlt-flow` under `RVLT-Labs` during the org move.
3. **Executing Phase 1 (cosmetic PR) now**; infra/org-move remains a runbook the user runs.
4. **LICENSE:** Licensor → `RVLT Labs`, Licensed Work → `RVLT Flow`.

**Status of the world today:**
- `PLATFORM_NAME` already defaults to `"RVLT Flow"` (`src/lib/platform.ts`) — the user-visible product name is core-migrated.
- Prod already serves on `flow.rvlt.app`; old `home.twotoned.com.au` is dead.
- 206 files / ~735 matches of `gearflow`/`GearFlow` remain (129 `.ts`, 44 `.md`, 15 `.tsx`, 4 `.yml`, plus config/SQL/LICENSE).

---

## The core tension (premise to confirm)

"Zero mentions **anywhere** including infra" collides with production stability. The 735 matches are **not one kind of thing**. They split into:

- **Cosmetic** (~90% of matches): docs, comments, UI copy, LICENSE text, package name. Safe find-replace. No runtime coupling.
- **Load-bearing identifiers** (~10 strings, high blast radius): each names a *live resource holding real state*. Renaming the string without migrating the resource breaks prod or orphans data.

A literal find-replace across all 206 files **will break production**. This plan separates the two and sequences the load-bearing ones as individual cutovers.

---

## Category A — Cosmetic renames (safe, do in one sweep)

Mechanical `Gearflow`/`GearFlow`/`gearflow` → `RVLT Flow`/`RVLTFlow`/`rvlt-flow` (case-appropriate) in:

- **Docs**: `README.md`, `ARCHITECTURE.md`, `CLAUDE.md`, `PROMPT.md`, `FEATUREDOCS/*`, `docs/**`, `TODOS.md`, `CHANGELOG`.
- **UI copy** (hardcoded strings, since `PLATFORM_NAME` covers dynamic ones):
  - `src/app/auditor/[token]/page.tsx` — "Powered by GearFlow"
  - `src/app/api/crew/respond/[token]/route.ts` — email `<title>… — GearFlow`
  - `src/app/api/crew/calendar/[token]/route.ts` — calendar name `GearFlow - …`
  - `src/app/(app)/settings/sso/page.tsx`, `settings/woocommerce/page.tsx` — descriptions
  - `src/app/(admin)/admin/settings/page.tsx` — `platformName: "GearFlow"` fallback (should be `"RVLT Flow"`)
  - `public/manifest.json` — `name`/`short_name` "GearFlow" (installed-PWA / home-screen label; NOT driven by `PLATFORM_NAME`; cached by installed PWAs until manifest re-fetch)
  - `.env.example` — `PLATFORM_NAME=GearFlow` (⚠️ **verify the real Coolify prod value** — if prod copied this, the "already migrated" premise is false and prod currently renders "GearFlow"); fix the example to `RVLT Flow`
  - `src/env.test.ts:52` asserts the `EMAIL_FROM` default — update in lockstep with the fallback change
- **`package.json`** `name: "gearflow-init"` → `"rvlt-flow"`.
- **Code comments / internal symbol names** where `gearflow` appears (e.g. `gearflow-table.ts` in the pdfme plugin dir — a *filename*; renaming is safe but touches imports, treat as a small refactor not a string swap).

**Decision needed:** UI copy default `"GearFlow"` fallbacks should become `"RVLT Flow"` to match `PLATFORM_NAME`.

## Category B — Legal / external identity

- **`LICENSE`** — `Licensor: GearFlow`, `Licensed Work: GearFlow`. Legal text. Rename to the correct legal entity (RVLT Labs? confirm entity name — "RVLT Flow" the product vs the company).
- **Email sender** `EMAIL_FROM="GearFlow <noreply@gearflow.app>"` — external, DNS-coupled (see Category C).

## Category A-HAZARD — Looks cosmetic, is actually load-bearing (found in review)

These `gearflow` strings sit in ordinary `.ts` files and read like copy, but each is a **persisted or cryptographic identifier**. Do NOT include them in the find-replace sweep.

| String | File | Failure mode if renamed | Handling |
|---|---|---|---|
| `"gearflow-secret-vault.v1"` (HKDF info), `"gearflow.secret-vault"` (HKDF salt) | `src/lib/crypto/secret-vault.ts:26-27` | **Data loss.** These derive the vault encryption key. Change them → every stored encrypted secret (integration tokens, etc.) becomes permanently undecryptable | **KEEP verbatim.** Only change via a versioned `.v2` context + re-encrypt-on-read migration if ever needed. Not part of rebrand. |
| `SERVICE_SUBJECT = "gearflow-service"` | `src/lib/convex-auth-constants.ts:19` (+ mirrored checks Convex-side) | **Auth outage across deploy window.** Convex deploys before the app image; if the subject flips, one side rejects the other → all server→Convex calls fail | **Expand-contract only**: make Convex accept both subjects, deploy, flip app, then drop old. Or KEEP (invisible identifier). Recommend KEEP. |
| PDF plugin types `gearflowTable`, `gearflowFinancialSummary`, `gearflowPageHeader/Footer`, `gearflowCheckbox`, `gearflowSignatureLine`, `gearflowCrewTable` | `src/lib/pdfme/plugins/*`, `token-resolver.ts:219-225`, `templates/*` | **Saved templates break.** These `type:` values are persisted in stored template JSON; renaming the registration key orphans them → PDFs render blank/error | Register new names as **aliases** of old, or migrate stored template JSON. Filenames can be renamed freely; the *type string* is the contract. |
| localStorage keys `gearflow-dismissed-notifications`, `gearflow-projects-show-cost`, `gearflow-pref-*` | `notifications/page.tsx`, `layout/notifications.tsx`, `equipment-tab.tsx`, `use-persistent-pref` | Resets users' dismissed-notification + preference state on next visit (UX regression, not data loss) | Migrate-on-read (copy old key → new) or accept the one-time reset. |
| ICS UID suffix `…@gearflow` | `api/crew/calendar/*`, `api/calendar/[token]/[feed]/route.ts` | Subscribed calendar clients treat every event as new → **duplicate events** on users' calendars | KEEP the `@gearflow` UID suffix (invisible identifier), or accept dupes. |
| SSO group-mapping key `gearflowRole` | `src/lib/sso-types.ts:4`, consumed `sso-provisioning.ts:42,64-68` | **Silent SSO breakage.** Stored group→role mappings are JSON keyed by `gearflowRole`; rename the field → existing mappings read `undefined` → SSO users provisioned with no role | KEEP the persisted key, OR ship a settings/JSON migration that renames it in lockstep. |
| Google Maps Map ID `"gearflow-map"` | `src/components/ui/address-map-inner.tsx:72` | If registered in GCP Map Management, renaming loads an unstyled/failed vector map | Verify in GCP; if registered, keep the string or create a new Map ID first and swap. |
| `EMAIL_FROM` fallback `noreply@gearflow.app` (×2) | `src/env.ts:39` **and** `convex/emailActions.ts:60` | Mail from unverified domain → silent spam-foldering | Verify new sending domain in Resend first; update **both** fallbacks. |

## Category C — Load-bearing infra (each is a cutover with its own risk, NOT a text edit)

| Identifier | Where | Failure mode if naively renamed | Recommended handling |
|---|---|---|---|
| **GitHub repo `TwoToned/gearflow`** | remote, all workflows | Org transfer breaks: git remotes, GHCR image path, Coolify GitHub source link, PR-preview auth, branch protection, secret inheritance | Transfer via GitHub org move (§ Org Move Runbook). One-way-ish; do deliberately. |
| **GHCR image `ghcr.io/twotoned/gearflow`** | `build-image.yml:20` | After org move, image path changes → Coolify keeps pulling the old path → deploys silently serve stale image | Update `IMAGE_NAME`, re-point Coolify image source + re-auth GHCR pull token |
| ~~**S3 bucket `gearflow-uploads`**~~ | ~~`.env*`, prod Garage box~~ | **DEAD — not used.** File storage moved to Convex `_storage` (`convex/files.ts`, `src/lib/storage.ts`); no AWS SDK, `env.S3_*` read nowhere. The prod `S3_BUCKET` env var + `gearflow-uploads` bucket are leftovers | **Removed the dead S3 config** from `.env.example`, README, CLAUDE.md, ARCHITECTURE.md, FEATUREDOCS 01/02, and the `docker-db` MinIO service. **User:** delete the dead `S3_BUCKET` Coolify env var + the Garage bucket whenever. |
| **Postgres DB `gearflow` / `gearflow_ci`** | `.env.example`, `ci.yml`, prod | DB name is an internal identifier holding all data. Renaming prod = dump/restore downtime for zero user benefit | **Keep prod DB name**; rename only the dev/CI default if desired (cheap, no data). |
| **Convex prod deployment `useful-cuttlefish-334`** | CLAUDE.md, dashboard | Deployment slug is fixed and holds all domain data. Not renameable losslessly | Rename the Convex *project* label in dashboard (cosmetic); leave the slug/URL. |
| **Convex package `gearflow-init`** | `package.json` | Cosmetic | Rename with package name |
| **Auth TOTP issuer `"GearFlow"`** | `src/lib/auth.ts:119` | Baked into the `otpauth://` URI already provisioned to users' authenticator apps. Existing devices display "GearFlow" **forever** — you literally cannot reach "zero mentions" on already-enrolled devices | Rename to `"RVLT Flow"` for new enrollments. Accept that existing enrollments keep the old label unless users re-enroll. |
| **Email domain `gearflow.app`** | `EMAIL_FROM` | If you switch to `rvlt.app`, that domain needs Resend verification + SPF/DKIM/DMARC or mail silently spam-foldered. Also: retiring `gearflow.app` kills replies/bounces to `noreply@gearflow.app` | Verify `rvlt.app` (or subdomain) in Resend first, then switch `EMAIL_FROM`. Keep old domain's MX/DKIM alive during transition. |
| **pm2 process names `gearflow`, `gearflow-discord-bot`** | `ecosystem.config.js:12`, `ecosystem.config.cjs:23,32` | Deploy runs `pm2 restart gearflow` / `--only gearflow-discord-bot`; rename the config names → next deploy targets a nonexistent process (old keeps serving; bot gets a duplicate Discord gateway connection) | Rename requires coordinated `pm2 delete gearflow* && pm2 start ecosystem` on the box + updating any hardcoded `pm2 restart gearflow`. Runbook step, not a text edit. |
| **Second GHCR image path `ghcr.io/twotoned/gearflow`** | `ops/auth-mirror-reconcile.sh:20` (+ `GEARFLOW_IMAGE` env override), `docs/efficiency-billing-session-prompt.md:50` container filter | Prod cron pulls the dead old-org image after the org move; if `GEARFLOW_IMAGE` env still set by the unit, silently falls back to hardcoded old path | Add to org-move image-path checklist alongside `build-image.yml:20`. |

## Category D — Local / developer environment

- Working directory `/home/jayden/code/gearflow` and worktrees under it — rename the checkout locally; update `CLAUDE.md`'s hardcoded paths (`cp /Users/jayden/code/ttp-assetmanagement/.env` etc. are already stale).
- `.env` / `.env.local` on each dev machine and in Coolify — update non-load-bearing values.

---

## GitHub Org Move Runbook (TwoToned → RVLT-Labs)

Order matters. What breaks the moment the repo transfers:

1. **Pre-move**: Create/confirm `RVLT-Labs` org. Confirm you're an owner. Inventory all repo secrets (`CONVEX_DEPLOY_KEY`, `COOLIFY_TOKEN`, `COOLIFY_DEPLOY_WEBHOOK`, `PREVIEW_DATABASE_URL*`, `PREVIEW_BETTER_AUTH_SECRET`) and variables (`COOLIFY_*`, `CONVEX_DEV_URL`) — **secrets do NOT transfer with the repo** in all cases; re-add them.
2. **Freeze deploys**: merge/park open PRs; announce a short freeze.
3. **Transfer** the repo (GitHub redirects old URLs, but don't rely on redirects for automation).
4. **Immediately after transfer**:
   - Update local remotes: `git remote set-url origin git@github.com:RVLT-Labs/rvlt-flow.git` (rename repo too, if desired).
   - Update `IMAGE_NAME` in `build-image.yml` → `rvlt-labs/rvlt-flow`.
   - Re-connect Coolify's GitHub source to the new org; update the app's image path + GHCR pull credentials.
   - Re-add GitHub Actions secrets/variables in the new org/repo.
   - Re-apply branch protection rules + rulesets + required-check names + CODEOWNERS team refs (none transfer).
   - **Reinstall/authorize the Coolify GitHub App on RVLT-Labs** and reconnect the source repo + webhook. (PR previews are served by the Coolify GitHub App on `preview.lab.rvlt.app`, *not* a workflow — there is no `preview-deploy.yml` in this repo. The transfer drops the app authorization → previews stop until reinstalled.)
   - **Re-register the self-hosted runner** against `RVLT-Labs/rvlt-flow` — `migrate.yml:51` is `runs-on: self-hosted` and does `git pull origin main` in `${{ vars.APP_DIR }}`; also update that box's `origin` remote (don't rely on the redirect for automation).
   - Reissue Coolify's **GHCR pull credential** (a token scoped to `twotoned`) for `rvlt-labs`, and confirm the first `build-push` created the package under the new org with correct visibility.
5. **Verify**: trigger a no-op deploy; confirm image builds under new path, Coolify pulls it, `flow.rvlt.app` returns 200/307.

**Traps that break the moment of transfer (surfaced in review):**
- **GHCR packages do NOT transfer with the repo.** `ghcr.io/twotoned/gearflow` stays owned by TwoToned. After transfer the workflow's `GITHUB_TOKEN` runs as an RVLT-Labs repo and may lose write access to the old package. **Mitigation: dual-publish** `twotoned/gearflow:<sha>` AND `rvlt-labs/rvlt-flow:<sha>` for a transition window, prove the new path pulls in prod, THEN switch Coolify and stop publishing the old tag. `build-image.yml:20` hardcodes the path — make it dynamic or dual-tag.
- **Org-level secrets/variables/runners don't follow the repo.** Anything granted at the TwoToned *org* scope (self-hosted runner groups, org secrets, rulesets, GitHub App installs) must be re-granted in RVLT-Labs. `migrate.yml` uses `runs-on: self-hosted` — that runner group may stop accepting jobs.
- **Coolify GitHub App** is installed against TwoToned; re-authorize it for RVLT-Labs and re-point source repo URL + webhook.
- `ops/auth-mirror-reconcile.sh` references the image path — update with rollback path retained.
- **External identity/redirect URLs** (not in the repo, easy to forget): Google/Microsoft OAuth authorized redirect URIs + JS origins, SAML entity ID/ACS URLs + customer IdP metadata, **passkey RP ID** (`PASSKEY_RP_ID` — changing it invalidates existing passkeys), Convex `CONVEX_AUTH_ISSUER`/`CONVEX_AUTH_JWKS_URL` in **both** prod and shared-dev deployments, Sentry project/allowed-origins/source-map auth, DNS/DKIM/SPF/DMARC for any new mail domain, `X-*` webhook headers + WooCommerce webhook secret/destination, README badges, PWA/manifest cache + installed-app name.

**Shared-dev Convex trust chain (ordering trap):** the shared dev Convex deployment `groovy-koala-475` pins its trusted issuer to `https://preview.lab.rvlt.app` + that host's `/api/auth/jwks`. That preview app is served by the same Coolify GitHub App pipeline the org move disrupts. If the move takes the preview app down, the shared dev Convex rejects **all** tokens → every PR preview, the integration test suite (`BETTER_AUTH_URL=preview.lab.rvlt.app`), and local dev lose Convex auth at once. **Sequence:** re-establish + verify `preview.lab.rvlt.app` and its JWKS host *as part of* the org-move completion, not after.

**Highest-risk coupling (do not fight it):** the deploy chain is `Convex deploy → GHCR push → Coolify webhook → boot-time Prisma migration`. Convex functions go live *before* the new app image. Any rebrand change touching `SERVICE_SUBJECT`, a Convex mutation signature, or the generated API must be **backward-compatible across that partial-deploy window** (expand-contract), or prod breaks between steps. This is a known footgun in this repo.

---

## Proposed phasing

**Phase 1 — Cosmetic sweep (low risk, reversible):** Categories A + B + D-code, **with the entire Category A-HAZARD keep-list excluded from the find-replace** (HKDF contexts, `SERVICE_SUBJECT`, PDF plugin types, SSO `gearflowRole`, localStorage keys, `@gearflow` ICS UIDs, Google Map ID) plus `prisma/migrations/**`. One branch, one PR. Find-replace + filename refactors (filenames OK; the *type strings* stay) + UI fallback strings + `manifest.json` + LICENSE. No infra touched. Ship normally. ⚠️ The "reversible" property only holds *because* the irreversible load-bearing strings (esp. `@gearflow` UIDs and `SERVICE_SUBJECT`) are held out — do not let a broad sed sweep pull them in.

**Phase 2 — Auth issuer + email domain + additive expand-contract (SHIPPED in code):**
- Auth TOTP issuer → "RVLT Flow" (Phase 1).
- `EMAIL_FROM` default flipped to `RVLT Flow <flow@rvlt.app>` in all five spots (`src/env.ts`, `convex/emailActions.ts`, `.env.example`, `CLAUDE.md`, `src/env.test.ts`). **Prod reads its own env**, so this is safe in code — the deliverability step is yours: verify `rvlt.app` in Resend (SPF/DKIM/DMARC), then set prod `EMAIL_FROM`; keep old `gearflow.app` DKIM alive so replies/bounces survive.
- **Webhook headers (expand-contract):** now emit `X-RVLT-Flow-Signature/Event/Delivery-Id` + `user-agent: RVLT-Flow-Webhooks/v1` **alongside** the legacy `X-GearFlow-*` headers (identical values). Consumers migrate to the new names; drop the legacy set in a later release.
- **localStorage migrate-on-read:** all pref keys renamed `gearflow-*` → `rvlt-flow-*` with one-time migration via `src/lib/local-storage-migrate.ts` (no user pref reset).
- **Deploy workflow:** `build-image.yml` GHCR `IMAGE_NAME` now derives from `github.repository` (lowercased) — auto-adapts to `rvlt-labs/rvlt-flow` at the transfer, no hand-edit.
- **PDF plugin type aliases (expand):** every custom pdfme plugin is now registered under its `rvltFlow*` name too (alongside legacy `gearflow*`), mirrored in `token-resolver.ts` `CUSTOM_PLUGIN_TYPES`. New/saved templates can use the rebranded type; existing persisted templates keep rendering. Additive — the legacy keys stay until stored templates are migrated (the eventual "contract" step). Covered by `rebrand-plugin-aliases.test.ts`.

**Phase 3 — GitHub org move (coordinated, one-way-ish):** Run the Org Move Runbook during a deploy freeze. Highest coordination cost; do it as its own discrete event.

**Phase 4 — Optional deep infra renames:** ONLY if "zero mentions" must include invisible internal identifiers. S3 bucket object-copy, prod DB rename, Convex project relabel. Recommend **deferring / declining** the ones with data (S3 bucket, prod DB, Convex slug) — high risk, zero user-visible benefit.

---

## Prod verification (2026-07-17, read-only SSH to ttp-gearflow-prod)

Inspected the running container `ghcr.io/twotoned/gearflow:latest`:
- **`PLATFORM_NAME` is UNSET** → prod uses the code default `"RVLT Flow"`. The "already migrated" premise is **confirmed**; prod is not secretly rendering "GearFlow".
- **`EMAIL_FROM=GearFlow <noreply@twotoned.com.au>`** — the display name "GearFlow" is **live in every email's From field**, and the verified sending domain is **`twotoned.com.au`**, NOT `gearflow.app` (the plan's earlier assumption was wrong). `RESEND_API_KEY` is set.
- Only other `gearflow` in prod env: `S3_BUCKET=gearflow-uploads` and the DB name inside `DATABASE_URL` — both on the intentional keep-list.

**Action (Coolify env var, user):** the code default we set (`flow@rvlt.app`) is never used because prod overrides `EMAIL_FROM`. Fix the live leak by updating the Coolify `EMAIL_FROM`:
- **Interim, zero-DNS:** `RVLT Flow <noreply@twotoned.com.au>` — kills the visible "GearFlow" immediately using the already-verified domain.
- **End state:** `RVLT Flow <flow@rvlt.app>` after verifying `rvlt.app` in Resend (SPF/DKIM/DMARC). Note `twotoned.com.au` is the old company domain — you'll want off it eventually anyway.

## Explicitly NOT in scope (recommend keeping the name)

- S3 bucket `gearflow-uploads` object data (internal; renaming orphans files).
- Prod Postgres DB name (internal; rename = downtime for nothing).
- Convex deployment slug `useful-cuttlefish-334` (fixed, holds data).
- **`prisma/migrations/**` — HARD EXCLUDE.** Editing already-applied migration SQL changes its checksum in `_prisma_migrations` → `prisma migrate deploy` (run at container start) fails → prod won't boot. The `DEFAULT 'GearFlow'` in old migrations is harmless (`platform.ts` ignores the DB column).
- Historical git commit messages / merged PR titles / old GHCR image tags (immutable).
- Vendored `.claude/skills/gstack/**` matches + `~/.gstack/projects/TwoToned-gearflow/…` artifact paths (third-party tool text / external, not our brand).
- **Note:** the Convex prod slug `useful-cuttlefish-334` contains no `gearflow` string — it's a random slug. Keeping it is an org/brand concern, not a "gearflow-mention" one. (The Convex *team* `two-toned` and *project* `gearflow-prod` labels can be relabeled in-dashboard cosmetically; runtime uses the slug URL, so it's safe but docs go stale.)

## Governance: a workable "zero mentions" policy

Literal zero is infeasible without disproportionate cost: the worktree path itself contains `gearflow`, git history/tags/PR titles are immutable, and customer-side artifacts (TOTP labels, calendar subscriptions, saved templates, localStorage) preserve old text until each user's next interaction. Recommended enforceable policy instead:

- **Zero** old branding in: current UI, outbound email/PDF copy, public docs, new code symbols, new filenames, current repo metadata, defaults.
- **Legacy names allowed** only in a small, owned **compatibility allowlist** (HKDF contexts, `SERVICE_SUBJECT`, ICS UID suffix, S3 bucket, DB name, Convex slug, PDF plugin type aliases) — each with a removal criterion.
- **CI guard**: add a check that greps for new `gearflow` occurrences outside the allowlist and fails the build. Prevents regression after the sweep.

## Test / verification plan

- Phase 1: `pnpm build` (typecheck) + `pnpm lint` + `pnpm test`; grep asserts zero `gearflow` outside Category-C keep-list.
- Phase 2: send a test email through Resend from the new domain; enroll a fresh TOTP and confirm issuer label.
- Phase 3: post-transfer, force a deploy and poll `flow.rvlt.app` for 200/307; confirm a PR preview still builds.
