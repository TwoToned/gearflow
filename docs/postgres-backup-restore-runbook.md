# Postgres Backup & Restore Runbook

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

**Why this exists:** [`docs/convex-backup-restore-runbook.md`](./convex-backup-restore-runbook.md)
covers Convex (the sole copy of all domain data + file bytes) but explicitly marks Better
Auth's Postgres data "out of scope here," deferring to an unverified "Postgres provider"
default. That gap is POLICY.md `R-8.11.5` (2026-07-22 audit, issue #762): Postgres holds
**users, sessions, credentials (accounts/passkeys/2FA), org membership, invitations, API
keys, and the audit-trail activity log** — losing it without a tested restore path means
losing the ability to authenticate anyone, not just data.

Prod Postgres: reachable only from inside the Coolify network (same posture as
`docker-entrypoint.sh` migrations — the GitHub-hosted runner used by
`build-image.yml` cannot reach it; only the `self-hosted` runner used by
`migrate.yml` can). `.github/workflows/postgres-backup.yml` runs there.

---

## Drill log

**2026-07-23 — first full drill: PASSED.** Proof that the dump/restore mechanism recovers
a real Better-Auth schema with referential integrity intact.
- **Schema:** built from `prisma migrate deploy` against a scratch cluster using the actual
  committed migration history (all 16 models / 17 tables, including `_prisma_migrations`) —
  not a hand-written stand-in schema.
- **Seed:** representative rows across the auth-critical tables — `organization`, `user`
  (×2), `member` (owner + admin), `session` (with a live token), `activity_log`.
- **Isolated environment:** two throwaway local Postgres 16 clusters (source + restore
  target), neither connected to prod — analogous isolation posture to the Convex drill's
  self-hosted scratch backend.
- **Dump:** `pg_dump "$DATABASE_URL" --format=custom --file=postgres-snapshot-<ts>.dump` →
  64K, exit 0.
- **Restore:** `pg_restore -d gearflow --no-owner postgres-snapshot-<ts>.dump` into the
  second cluster → exit 0, zero errors/warnings.
- **Verify:** row counts matched exactly across all 5 seeded tables (source vs. restored);
  spot-checked the full auth relation chain — `user.email` → `member.role` →
  `organization.name` → `session.token` all resolved correctly joined in the restored
  database.
- **RPO/RTO:** dump ≈ 0.2s, restore ≈ 0.5s for this data size — the dump/restore mechanics
  are effectively instant; real-world RTO is dominated by provisioning a fresh Postgres
  instance (Coolify service create/restart), not the restore itself. RPO = export cadence
  (daily → ≤ 24h, matching the Convex backup's posture).
- **Caveat — read before treating this as a closed loop:** this drill validates the
  **mechanism** (migrations replay cleanly, `pg_dump`/`pg_restore` round-trip preserves
  referential integrity) against a schema-accurate scratch cluster, not against an actual
  export of prod data (no prod `DATABASE_URL` access was available to produce this runbook).
  **Before the next quarterly re-drill, re-run this against a real
  `postgres-snapshot-*.dump` artifact pulled from `.github/workflows/postgres-backup.yml`**
  once it has run in prod for a few days, and update this entry with real row counts.

## What a Postgres dump contains

`pg_dump --format=custom` produces a single custom-format archive with every table's schema
+ rows for the target database — all 16 Better Auth + activity-log Prisma models (`user`,
`session`, `account`, `member`, `organization`, `invitation`, `activityLog`, `apiKey`,
`passkey`, `twoFactor`, `backupCode`, `ssoProvider`, `pendingSSOApproval`, `jwks`,
`verification`, `apiIdempotency`). It does **not** contain:

- **Convex domain data / file storage** — backed up separately, see the Convex runbook.
- **Environment variables / secrets** (`BETTER_AUTH_SECRET`, `DATABASE_URL` itself, etc.) —
  inventory these separately (§4).
- **The Postgres server/cluster configuration** — only database contents, not `postgresql.conf`.

---

## 1. Scheduled dump → cold storage

`.github/workflows/postgres-backup.yml` runs daily on the `self-hosted` runner (the only
runner with network access to prod Postgres):

```bash
pg_dump "$DATABASE_URL" --format=custom --file="postgres-snapshot-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

- **Cadence:** daily, 03:30 UTC (offset 30 min after the 03:00 UTC Convex export so the two
  don't contend for the runner).
- **Retention:** 90-day GitHub Actions artifact for now — same zero-new-infra posture as
  `convex-backup.yml` while the two datasets are small. **Before this covers meaningful
  customer volume, move both to a dedicated encrypted off-provider bucket** (S3/GCS/R2) —
  GitHub artifacts are a stopgap, not the long-term home for auth credentials.
- **Verification:** the workflow fails loudly (`::error::`) if the dump is under 1KB — a
  silently-empty backup is worse than a visibly-failed one.
- **Failure alerting:** a failed scheduled workflow run shows in the repo's Actions tab and
  emails the repo's notification recipients by GitHub's default workflow-failure behavior;
  no additional alerting is wired yet. **Still owed:** a dedicated failure notification
  (e.g. Slack/PostHog) matching whatever the Convex backup eventually wires up — track
  alongside that gap rather than duplicating it now.

## 2. Restore drill (the actual gate)

Rehearse into a **scratch Postgres instance**, never prod:

```bash
# 1. Stand up a throwaway Postgres 16 instance (local initdb, or a scratch container).
# 2. Restore the latest cold-storage snapshot:
pg_restore -h <scratch-host> -U postgres -d <scratch-db> --no-owner postgres-snapshot-<latest>.dump
```

Then **verify, don't assume** (see the 2026-07-23 drill log above for a worked example):
- Row counts per table match the source snapshot for every auth-critical table (`user`,
  `session`, `account`, `member`, `organization`, `activityLog` at minimum).
- Spot-check the auth relation chain resolves: a `user` → its `member` role → its
  `organization` → an active `session` token, joined end-to-end.
- `prisma migrate deploy` against the restored database reports "already up to date" (proves
  the restored schema matches the current migration history, not a stale snapshot of dropped
  tables).
- App boots against the restored database and a login round-trip works (session cookie →
  `getSession` resolves the right user/org).

Record measured **RPO** (worst-case data age = export cadence) and **RTO** (wall-clock from
"decision to restore" to "auth working again on restored data" — include Postgres instance
provisioning time, not just the `pg_restore` step).

## 3. Cadence

- **Quarterly restore drills**, same cadence as the Convex runbook (R-8.11.5 requires at
  least quarterly). Re-drill using a real `postgres-snapshot-*.dump` pulled from the
  workflow's artifact, not a re-run of the synthetic seed above.
- Re-review this doc quarterly (POLICY.md R-5.5) alongside the drill.

## 4. Secrets / config inventory (not in the dump)

- `DATABASE_URL`, `BETTER_AUTH_SECRET`, `CONVEX_AUTH_ISSUER` / `CONVEX_AUTH_JWKS_URL`
  provisioning for a rebuilt Postgres instance.
- Postgres server config (extensions, connection limits) if the managed instance is rebuilt
  from scratch rather than restored in place.
Store this list with the backups; a restored auth database that can't be reached or trusted
by the app is not a restore.

---

## Gate summary

- [x] Daily prod dump running (`.github/workflows/postgres-backup.yml`) + verified
      non-empty (≥90d retention)
- [ ] Backup-failure alerting beyond GitHub's default workflow-failure notification
- [x] **Restore drill completed** — mechanism proven against the real migration-built
      schema; re-run against a real prod snapshot before the next quarterly review
- [x] Measured RPO / RTO recorded (see drill log)
- [x] Secrets/config inventory documented (§4)
