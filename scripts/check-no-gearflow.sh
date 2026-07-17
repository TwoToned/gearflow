#!/usr/bin/env bash
#
# Brand guard: blocks NEW "GearFlow" brand mentions after the RVLT Flow rebrand.
#
# Policy (see docs/designs/rvlt-flow-rebrand-migration.md):
#   - Zero old branding in user-facing surfaces + new code/docs.
#   - A small ALLOWLIST for load-bearing identity anchors that deliberately keep
#     the legacy name (renaming them breaks live systems / orphans data).
#
# What this checks: the CamelCase brand name `GearFlow` / `Gearflow`. Lowercase
# `gearflow` is almost always a load-bearing identifier (pm2 process, PDF plugin
# symbol/type, storage key, DB/bucket name) and is handled by the ALLOWLIST_PATHS
# / ALLOWLIST_PATTERNS below rather than a blanket ban.
#
# Exit 1 if a non-allowlisted brand mention is found.

set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

# Paths where legacy mentions are permitted (vendored tools, immutable history,
# the migration plan itself, and the webhook header contract that external
# consumers depend on — a Phase-4 expand-contract concern, not cosmetic).
ALLOWLIST_PATHS='^(\.claude/skills/gstack/|prisma/migrations/|node_modules/|\.next/|src/generated/|docs/designs/rvlt-flow-rebrand-migration\.md|scripts/check-no-gearflow\.sh|CHANGELOG\.md|src/lib/webhooks/)'

# Line-level patterns permitted anywhere (identity anchors that keep the legacy
# string). Extend deliberately, with a removal criterion in the plan doc.
ALLOWLIST_PATTERNS='X-GearFlow-|GearFlow-Webhooks'

violations=$(
  git ls-files \
    | grep -vE "$ALLOWLIST_PATHS" \
    | while IFS= read -r f; do
        matches=$(grep -nE 'GearFlow|Gearflow' "$f" 2>/dev/null | grep -vE "$ALLOWLIST_PATTERNS" || true)
        [ -n "$matches" ] && printf '%s\n' "$matches" | sed "s|^|$f:|"
      done
  true
)

if [ -n "$violations" ]; then
  echo "❌ Brand guard: found legacy 'GearFlow' brand mentions outside the allowlist."
  echo "   Use 'RVLT Flow'. If this is a load-bearing identifier, add it to the"
  echo "   ALLOWLIST in scripts/check-no-gearflow.sh with a note in the plan doc."
  echo
  echo "$violations"
  exit 1
fi

echo "✅ Brand guard: no non-allowlisted 'GearFlow' mentions."
