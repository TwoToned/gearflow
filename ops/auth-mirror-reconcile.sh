#!/usr/bin/env bash
#
# Versioned cron wrapper for the auth-mirror reconcile (tier-0 authZ backstop).
# Replaces the ad-hoc /root/convex-mirror-reconcile.sh that lived only on the box.
#
# Runs the reconcile INSIDE the running app container, because it needs BOTH prod
# Postgres (source of truth) and prod Convex (the mirror) — neither the GitHub
# Actions runner nor a Convex cron can reach prod Postgres. Output is appended to
# a logfile and the reconcile's exit code is preserved (non-zero = drift/parity
# break, so `cron` / a log monitor can alert).
#
# Install on the prod box (root):
#   install -m 0755 ops/auth-mirror-reconcile.sh /usr/local/bin/auth-mirror-reconcile
#   # then a crontab entry (daily 04:00 UTC):
#   #   0 4 * * * RECONCILE_ALERT_EMAIL=ops@rvlt.app /usr/local/bin/auth-mirror-reconcile >> /var/log/auth-mirror-reconcile.log 2>&1
#
# RECONCILE_ALERT_EMAIL (optional): where drift alerts are emailed (Resend).
set -euo pipefail

IMAGE="${GEARFLOW_IMAGE:-ghcr.io/twotoned/gearflow:latest}"
CID="$(docker ps --filter "ancestor=${IMAGE}" --format '{{.ID}}' | head -1)"

if [ -z "${CID}" ]; then
  echo "[auth-mirror-reconcile] $(date -u +%FT%TZ) FATAL: no running container for ${IMAGE}" >&2
  exit 4
fi

echo "[auth-mirror-reconcile] $(date -u +%FT%TZ) exec in ${CID}"
docker exec \
  ${RECONCILE_ALERT_EMAIL:+-e RECONCILE_ALERT_EMAIL="${RECONCILE_ALERT_EMAIL}"} \
  "${CID}" sh -lc 'cd /app && npx tsx scripts/auth-mirror-reconcile.ts'
