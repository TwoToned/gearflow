#!/usr/bin/env bash
# Tear down the seeded-auth E2E harness (see scripts/e2e-harness-up.sh).
set -uo pipefail
cd "$(dirname "$0")/.."
docker compose -f docker-compose.convex.yml down -v 2>&1 | tail -2
echo "Convex harness stopped. (App .env.local still points at the local Convex — remove"
echo "NEXT_PUBLIC_CONVEX_URL from .env.local to point back at your dev deployment.)"
