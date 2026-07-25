# Convex Backup & Restore Runbook

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

**Why this exists:** the full-native migration made Convex the **sole copy** of all domain data *and* file bytes, and dropped the Postgres domain tables at cutover. There is **no other recovery path**. A scheduled backup **and a rehearsed restore drill** are the hard operational gate. See [`FEATUREDOCS/54-convex-data-layer.md`](../FEATUREDOCS/54-convex-data-layer.md) for the current data-layer overview.

Prod Convex Cloud deployment: `useful-cuttlefish-334`.

---

## Drill log

**2026-07-12 — first full drill: PASSED.** Proof that a Convex-only world is recoverable (the Phase-4 gate).
- **Export:** `pnpm exec convex export --path … --include-file-storage` against prod (`useful-cuttlefish-334`) → `~/gearflow-convex-backups/prod-snapshot-20260712T114826Z.zip` (1.2M, all tables + `_storage`).
- **Isolated restore target:** local self-hosted backend, `docker run … ghcr.io/get-convex/convex-backend`, admin key via `docker exec … ./generate_admin_key.sh`. **Safety:** import run from a scratch dir whose `.env.local` had ONLY `CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210` + `CONVEX_SELF_HOSTED_ADMIN_KEY` (a `convex-self-hosted|…` key) and **no** `CONVEX_DEPLOY_KEY`, plus `env -u CONVEX_DEPLOY_KEY` — so reaching prod was structurally impossible.
- **Import:** `convex import --replace-all --yes <snapshot>` → **12,939 documents** across every table, exit 0.
- **Verify:** `convex data` listed the full table set; spot-checked `projects` (real docs with client/location/org refs intact).
- **RPO/RTO:** RTO ≈ 1–2 min for this data size (import seconds + backend spin-up); RPO = export cadence (target daily → ≤ 24 h).
- **Still owed:** automate the daily prod export → off-provider cold storage + failure alerting (the export command is proven; wire it as a scheduled job). Re-drill quarterly.

## What a Convex snapshot contains

`convex export` produces a single zip with **every table's documents AND file storage** (the stored bytes behind `storageId`s). That covers both halves of what we're retiring: Postgres domain rows → Convex tables, and S3 files → Convex storage. It does **not** contain:

- **Environment variables / secrets** — inventory + store these separately (§4).
- **Function code** — lives in git + is redeployed by CI.
- **Better Auth data** — that stays in Postgres, covered separately by
  [`docs/postgres-backup-restore-runbook.md`](./postgres-backup-restore-runbook.md)
  (R-8.11.5, issue #762) — don't assume this runbook covers it.

---

## 1. Scheduled export → cold storage (stand up FIRST)

Run a daily export off-provider (S3/GCS/R2 bucket the Convex account can't itself delete). Wire as a GitHub Action (or Coolify cron):

```bash
# needs CONVEX_DEPLOY_KEY for the PROD deployment in the environment
pnpm exec convex export --prod --path "convex-snapshot-$(date -u +%Y%m%dT%H%M%SZ).zip"
# then upload the zip to cold storage (aws s3 cp / rclone / gcloud storage cp)
```

- **Cadence:** daily minimum; add a pre-cutover on-demand export immediately before Phase C.
- **Retention:** ≥ 90 days rolling (matches the plan's retention posture).
- **Verify the upload** (non-zero size + checksum) and **alert on failure** — a silently-failing backup is worse than none.

## 2. Restore drill (the actual gate — rehearse before ANY drop)

A backup you've never restored is a hope, not a recovery plan. Drill it into a **scratch deployment**, never prod:

```bash
# 1. Create/point at a throwaway dev/preview deployment (NOT prod).
# 2. Import the latest cold-storage snapshot:
pnpm exec convex import --path convex-snapshot-<latest>.zip     # to the scratch deployment
# (use --replace-all only against the scratch deployment)
```

Then **verify**, don't assume:
- Row counts per table match the source. No standing `convex-parity-check.ts`
  script exists today — compare `pnpm exec convex data <table>` counts (or the
  Convex dashboard's table view) between source and restored deployment
  table-by-table, or write a one-off script following the pattern in
  `scripts/convex-auth-roundtrip.ts` if you need this repeatedly.
- Spot-check a project → line items → units → asset chain resolves.
- **File bytes:** open a few restored `storageId`s via `storage.getUrl` and confirm the images load (the S3-retirement half fails silently otherwise).
- App boots against the restored deployment and a login → project view works.

Record **measured RPO** (worst-case data age = export cadence) and **RTO** (wall-clock from "decision to restore" to "app serving on restored data"). Both must be acceptable numbers written down, not guesses.

## 3. Cadence

- **Before Phase C drop:** one full rehearsed restore drill, signed off. This is the gate.
- **Ongoing:** quarterly restore drills (backups rot; the restore path breaks silently as schema evolves).

## 4. Secrets / config inventory (not in the snapshot)

Maintain a checklist so a rebuilt deployment is actually functional, not just data-loaded:
- Convex env vars (auth issuer/JWKS URL, WooCommerce HMAC secret once moved, email keys, any component config).
- `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_DEPLOY_KEY` provisioning.
- The Better Auth ↔ Convex bridge config (`CONVEX_AUTH_ISSUER`, `CONVEX_AUTH_JWKS_URL`).
Store this list with the backups; a restore that can't authenticate is not a restore.

---

## Gate summary (copy into the Phase C go/no-go)

- [ ] Daily prod export running + verified to cold storage (≥90d retention)
- [ ] Backup-failure alerting live
- [ ] **Full restore drill completed on a scratch deployment** — parity clean, file bytes load, app boots
- [ ] Measured RPO / RTO recorded and accepted
- [ ] Secrets/config inventory stored alongside backups

**All five checked → the irreversible `DROP TABLE` is permitted. Any unchecked → do not drop.**
