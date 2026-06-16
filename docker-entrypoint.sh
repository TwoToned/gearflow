#!/bin/sh
# Container entrypoint. Runs DB migrations against the RUNTIME DATABASE_URL
# (injected by Coolify, reachable from inside the network — unlike the CI build
# runner) before handing off to the app process.
#
# `prisma migrate deploy` only applies already-committed migrations; it never
# generates or prompts. It's a no-op when the DB is already up to date, so it's
# safe to run on every container start.
set -e

echo "[entrypoint] Applying database migrations..."
pnpm exec prisma migrate deploy

echo "[entrypoint] Starting app: $*"
exec "$@"
