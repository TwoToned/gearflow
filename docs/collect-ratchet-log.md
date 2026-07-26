# Collect-ratchet full-baseline change log

Append-only audit trail for `.collect-ratchet-full-baseline` (POLICY.md R-9.8, #901).
Every raise must carry a `--reason`; decreases are logged automatically as real
remediation — the point is to make "scope widened, ceiling raised" visually
distinct from "debt paid down" instead of both looking like the same baseline commit.

| Date | Old | New | Delta | Reason |
|------|-----|-----|-------|--------|
| 2026-07-26 | 671 | 666 | -5 | (decrease — existing collects bounded/paginated) |
| 2026-07-26 | 666 | 661 | -5 | (decrease — existing collects bounded/paginated) |
| 2026-07-26 | 661 | 662 | +1 | restoring projectMedia.list() — it was incorrectly deleted as dead code; media-read.ts's MEDIA_SPECS dispatch calls it indirectly, caught by CI Type Check on PR #918 |
| 2026-07-26 | 662 | 655 | -7 | (decrease — existing collects bounded/paginated) |
| 2026-07-26 | 655 | 654 | -1 | (decrease — existing collects bounded/paginated) |
| 2026-07-26 | 654 | 650 | -4 | (decrease — existing collects bounded/paginated) |
| 2026-07-26 | 650 | 651 | +1 | assets.ts registryPhotos: split one generic build() helper (1 shared .collect() call site) into two explicit branches so assetMedia could get a real by_organizationId_isPrimary index while modelMedia stays a registered catalog-scale collect — net +1 literal .collect() text occurrence, but the assetMedia one is now indexed/bounded (dropped out of hazard-shape: 0 unjustified unchanged) rather than an org-wide scan |
| 2026-07-26 | 651 | 646 | -5 | (decrease — existing collects bounded/paginated) |
| 2026-07-26 | 646 | 645 | -1 | (decrease — existing collects bounded/paginated) |
| 2026-07-26 | 646 | 643 | -3 | (decrease — existing collects bounded/paginated, issue #794 branch — dedupe accessory-child/model-bulk queries in convex/lib/fulfillment.ts) |
| 2026-07-26 | 643 | 642 | -1 | (decrease — existing collects bounded/paginated) |
| 2026-07-26 | 645 | 646 | +1 | convex/lib/serviceCost.ts recalcServiceCostFromCrew: one new .collect() on crewAssignments by_serviceId (bounded to a single service's own crew — a handful of rows, not org-wide/whole-table) needed to sum a service's rolled-up labour cost from either write path (issue #796). |
| 2026-07-26 | 642 | 643 | +1 | merge of origin/main PR #930 (serviceCost.ts recalcServiceCostFromCrew, +1 bounded collect, already justified) into issue #794 accessories branch |
