#!/usr/bin/env bash
# Quarterly hygiene sweep (POLICY.md R-12.1). Runs the automatable checks and prints a
# markdown report to stdout. The CI workflow (.github/workflows/quarterly-sweep.yml) runs
# this and opens a tracking issue from the output. Safe to run locally: `bash scripts/quarterly-sweep.sh`.
# Each check is best-effort — a missing tool degrades to a note, never a hard failure.
set -uo pipefail
cd "$(dirname "$0")/.."

echo "# Quarterly Hygiene Sweep (R-12.1)"
echo
echo "_Generated $(date -u '+%Y-%m-%d') — review each item, tick it off, and file follow-ups._"
echo

section() { echo; echo "## $1"; echo; }

section "1. Dead-code scan (R-4.2)"
if command -v pnpm >/dev/null && [ -f knip.json ]; then
  counts=$(pnpm exec knip --no-progress 2>/dev/null | grep -E "^Unused|^Duplicate" || true)
  echo '```'; echo "${counts:-knip produced no summary}"; echo '```'
else echo "- knip unavailable — run \`pnpm knip\` manually"; fi

section "2. Feature-flag audit (R-4.3)"
flags=$(grep -rhoE "NATIVE_[A-Z_]+" src convex 2>/dev/null | sort -u)
echo "Flags in code (cross-check owner/removal condition in \`docs/feature-flags.md\`):"
echo '```'; echo "${flags:-none}"; echo '```'

section "3. Deprecation-marker check (R-4.4)"
echo "\`@deprecated\` markers — verify none have a met removal condition:"
echo '```'; grep -rn "@deprecated" src convex 2>/dev/null | sed 's/^/  /' || echo "  none"; echo '```'

section "4. Migration-residue check (R-4.5)"
echo "- Legacy write paths gated by NATIVE_* flags — delete once each domain is native in prod (see docs/feature-flags.md)."

section "5. Docs-contradiction grep (R-5.3)"
echo "CI already blocks npm/npx doc contradictions repo-wide on every run (\`pnpm run check-docs-npm-npx\`, .github/workflows/ci.yml \`hygiene\` job — full-repo scan, not diff-scoped). This sweep re-runs the same grep as a belt-and-braces cross-check:"
bad=$(grep -rnE "npm run|npx " --include='*.md' \
  --exclude-dir=.agents --exclude-dir=.claude --exclude-dir=.hermes --exclude-dir=node_modules \
  --exclude-dir=archive . 2>/dev/null \
  | grep -v "docs/audits/" \
  | grep -viE "never .?npm|not .?npx|pnpm|node_modules" || true)
if [ -n "$bad" ]; then echo "⚠ Possible npm/npx references on a pnpm repo:"; echo '```'; echo "$bad"; echo '```'; else echo "- No npm/npx contradictions found."; fi

section "6. Dependency audit (R-6.4/R-6.5/R-6.6)"
if command -v pnpm >/dev/null; then
  echo '```'; pnpm audit --audit-level low 2>/dev/null | tail -4 || echo "audit unavailable"; echo '```'
  echo "Outdated (top 15):"; echo '```'; pnpm outdated 2>/dev/null | head -16 || echo "none"; echo '```'
fi

section "7. Full-history secret sweep (R-7.3)"
if command -v gitleaks >/dev/null; then
  gitleaks detect --redact -c .gitleaks.toml >/tmp/gl.txt 2>&1 && echo "- ✅ gitleaks: no leaks in history." || { echo "⚠ gitleaks findings:"; echo '```'; tail -20 /tmp/gl.txt; echo '```'; }
else echo "- gitleaks not installed — the workflow installs it; locally run gitleaks manually."; fi

section "8. Exception register review (R-15.2)"
if [ -f docs/exceptions.md ]; then
  today=$(date -u '+%Y-%m-%d')
  expired=$(grep -oE "20[0-9]{2}-[0-9]{2}-[0-9]{2}" docs/exceptions.md 2>/dev/null | awk -v t="$today" '$0 < t' || true)
  echo "- Exceptions with expiry dates in the past (convert to failures): ${expired:-none}"
else echo "- docs/exceptions.md missing"; fi

section "9. Critical-doc review cadence (R-5.5 / T-14)"
if command -v pnpm >/dev/null; then
  pnpm run check-docs-review-cadence 2>&1 | sed 's/^/  /' || true
else
  echo "- pnpm unavailable — run \`node scripts/check-docs-review-cadence.mjs\` manually"
fi
echo "(This workflow's own CI step — .github/workflows/quarterly-sweep.yml — fails the run, not just this report, when a critical doc is stale.)"

section "10. Manual review checklist"
cat <<'EOF'
- [ ] Alert-rule audit + flaky-quarantine review (R-8.9.3 / R-8.8.4)
- [ ] Backup-restore test (R-8.11.5) — record the drill result in the runbook
- [ ] PII inventory review (R-8.12.1) — `docs/pii-inventory.md`
- [ ] Docs review-date refresh (R-5.5) — non-critical FEATUREDOCS/docs headers (critical docs are gated automatically above)
- [ ] Budget-registry review (R-0.4) — README thresholds still valid?
EOF
echo
echo "_See POLICY.md §12 for the full sweep definition._"
