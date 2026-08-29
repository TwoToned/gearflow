#!/usr/bin/env bash
# Inline display-date-format ratchet (I3, #1082). Before this, `date-fns` `format(date, "…")`
# calls were scattered ad hoc across the app and CONTRADICTED each other at the same (AU)
# locale — both day-first ("d MMM") and month-first ("MMM d, yyyy") for what was conceptually
# the same kind of date field. `src/lib/formatters.ts` now has named roles (formatDate,
# formatDateDayMonth, formatDateLong, formatDateWithTime, formatMonthYear) built on `Intl`, so
# every display date should route through one of those instead of a new inline format string.
#
# The count of such inline calls MUST NOT grow. Fails CI if it does. When it drops (a call site
# gets migrated to a named role), lower the baseline to lock in the gain.
#
# Heuristic: a call to `format(x, "…")` whose format string contains a WORD-based date token
# (MMM/MMMM month name, EEE/EEEE weekday name) is a display format — the exact axis that
# flips order per locale. `"yyyy-MM-dd"` / `"yyyy-MM"` MACHINE formats (keys, query params,
# filenames, ical) use only numeric tokens and never match this pattern — correctly left alone,
# per #1082's own scope note. (Every current call site quotes its format string with double
# quotes, so the pattern only looks for those — a single-quoted/backtick one would need adding.)
set -euo pipefail
cd "$(dirname "$0")/.."

BASELINE_FILE=".date-format-ratchet-baseline"
PATTERN='format\([^)]*,[[:space:]]*"[^"]*(MMM|EEE)[^"]*"'
# `grep -c` (not `-l | wc -l`) so a zero-match result exits via grep's own
# "no match" status (1) *inside* this command substitution, not the pipeline —
# under `pipefail`, `grep | wc -l` finding zero matches would otherwise abort
# the whole script before the count is ever reported.
current=$(grep -rInE "$PATTERN" src --include='*.ts' --include='*.tsx' 2>/dev/null \
  | grep -cE -v '\.test\.|\.spec\.|__tests__|src/lib/formatters\.ts' || true)
current=${current:-0}
baseline=$(cat "$BASELINE_FILE" 2>/dev/null || echo 0)

echo "inline display-date-format count: current=$current baseline=$baseline"

if [ "$current" -gt "$baseline" ]; then
  echo "❌ Inline display-date format() calls grew ${baseline} -> ${current}. Route the new"
  echo "   call(s) through a named role in src/lib/formatters.ts (formatDate/formatDateDayMonth/"
  echo "   formatDateLong/formatDateWithTime/formatMonthYear) instead of a new format(x, \"…\") string."
  exit 1
fi
if [ "$current" -lt "$baseline" ]; then
  echo "✅ Inline display-date format() calls dropped ${baseline} -> ${current}. Lock it in:"
  echo "   echo ${current} > ${BASELINE_FILE}"
fi
echo "✅ ratchet holds."
