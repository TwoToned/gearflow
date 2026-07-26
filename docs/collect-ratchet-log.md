# Collect-ratchet full-baseline change log

Append-only audit trail for `.collect-ratchet-full-baseline` (POLICY.md R-9.8, #901).
Every raise must carry a `--reason`; decreases are logged automatically as real
remediation — the point is to make "scope widened, ceiling raised" visually
distinct from "debt paid down" instead of both looking like the same baseline commit.

| Date | Old | New | Delta | Reason |
|------|-----|-----|-------|--------|
| 2026-07-26 | 671 | 666 | -5 | (decrease — existing collects bounded/paginated) |
