#!/usr/bin/env bash
# Stand up the seeded-auth E2E verification harness (POLICY.md R-8.8.3 / #621).
#
# Runs a SELF-HOSTED Convex backend (docker) on local disk storage (no S3 needed),
# pushes the app's schema/functions, and wires the auth JWKS trust so Better Auth
# JWTs validate against it. After this, start the app (`pnpm dev`) and run authenticated
# Playwright specs — the app talks to the local Convex (NEXT_PUBLIC_CONVEX_URL is written
# to .env.local by the push).
#
# Prereqs: docker, a local Postgres on :5432 (postgres/postgres), pnpm install done.
# Usage:   bash scripts/e2e-harness-up.sh   (tear down: bash scripts/e2e-harness-down.sh)
set -euo pipefail
cd "$(dirname "$0")/.."

CONVEX_URL=http://127.0.0.1:3210
APP_ORIGIN=${APP_ORIGIN:-http://localhost:3000}

echo "==> Postgres db for the Convex backend"
PGPASSWORD=postgres createdb -h localhost -U postgres gearflow_convex 2>/dev/null || true

echo "==> .env.convex.local (local-disk storage, no S3)"
if [ ! -f .env.convex.local ]; then
  cat > .env.convex.local <<ENV
INSTANCE_SECRET=$(openssl rand -hex 32)
POSTGRES_URL=postgres://postgres:postgres@host.docker.internal:5432
DO_NOT_REQUIRE_SSL=1
ENV
fi

echo "==> boot self-hosted Convex backend"
docker compose -f docker-compose.convex.yml up -d backend
for i in $(seq 1 30); do
  curl -sf --max-time 3 "$CONVEX_URL/version" >/dev/null 2>&1 && break
  sleep 2
done

echo "==> admin key"
ADMIN_KEY=$(docker compose -f docker-compose.convex.yml exec -T backend ./generate_admin_key.sh 2>/dev/null | tail -1 | tr -d '\r')

export CONVEX_SELF_HOSTED_URL="$CONVEX_URL"
export CONVEX_SELF_HOSTED_ADMIN_KEY="$ADMIN_KEY"
export CONVEX_TMPDIR="$PWD/.convex-tmp"
mkdir -p "$CONVEX_TMPDIR"

echo "==> auth JWKS trust (Convex validates the app's Better Auth ES256 JWTs)"
pnpm exec convex env set CONVEX_AUTH_ISSUER "$APP_ORIGIN" >/dev/null
pnpm exec convex env set CONVEX_AUTH_JWKS_URL "http://host.docker.internal:3000/api/auth/jwks" >/dev/null

echo "==> push schema + functions"
pnpm exec convex dev --once

echo "==> reset the app's Better Auth JWKS (key is encrypted with BETTER_AUTH_SECRET;"
echo "    a stale row from a different secret breaks sign-up). Regenerated on next use."
PGPASSWORD=postgres psql -h localhost -U postgres -d "${APP_DB:-gearflow}" \
  -c 'DELETE FROM jwks;' >/dev/null 2>&1 || true

echo "==> ready. Convex at $CONVEX_URL (NEXT_PUBLIC_CONVEX_URL written to .env.local)."
echo "    Start the app: pnpm dev   |   Run E2E: pnpm test:e2e --project=chromium"
