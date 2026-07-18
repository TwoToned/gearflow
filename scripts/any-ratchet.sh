#!/usr/bin/env bash
# `any` ratchet (POLICY.md R-8.2.2): the count of `: any` / `as any` in non-test,
# non-generated source MUST NOT grow. Fails CI if it does. When it drops, lower the
# baseline to lock in the gain. `no-explicit-any` (warn) + ban-ts-comment cover the
# lint side; this enforces the "never grows" ratchet.
set -euo pipefail
cd "$(dirname "$0")/.."

BASELINE_FILE=".any-ratchet-baseline"
current=$(grep -rInE ':[[:space:]]*any\b|\bas[[:space:]]+any\b' src convex \
  --include='*.ts' --include='*.tsx' 2>/dev/null \
  | grep -vE '\.test\.|\.spec\.|/generated/|__tests__' | wc -l | tr -d ' ')
baseline=$(cat "$BASELINE_FILE" 2>/dev/null || echo 0)

echo "any count: current=$current baseline=$baseline"

if [ "$current" -gt "$baseline" ]; then
  echo "❌ 'any' usage grew ${baseline} -> ${current}. Type the new value(s), or — if genuinely"
  echo "   unavoidable — raise the baseline in ${BASELINE_FILE} with justification in the PR."
  exit 1
fi
if [ "$current" -lt "$baseline" ]; then
  echo "✅ 'any' usage dropped ${baseline} -> ${current}. Lock it in: echo ${current} > ${BASELINE_FILE}"
fi
echo "✅ ratchet holds."
