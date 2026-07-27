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
| 2026-07-26 | 643 | 661 | +18 | #957 project lifecycle locks: 18 new .collect() calls, all bounded (indexed by_projectId/by_snapshotId/by_org_user reads for a single project's own snapshot/lock-tier/entity subtree — snapshot capture+restore in convex/lib/projectSnapshots.ts, the shared assertLifecycleGuard's session lookup, and per-file gate-site project/session fetches across projectWrites/lineItemWrites/projectGroupsWrites/projectCategoriesWrites/projectServicesWrites/crewAssignmentsWrites.ts). Zero flagged as unjustified-unbounded by the hazard-shape check (stays at baseline 0) — this bump is pure aggregate growth from legitimately bounded reads, not new hazard debt. |
| 2026-07-26 | 661 | 698 | +37 | Four Tier-2 workstreams landed (WS9 client contacts, WS10 crew charge rates, WS6 preventative maintenance, WS7 sub-hire/PO linkage, #936) — 37 new .collect() calls across new/extended Convex modules, all bounded by-index reads over catalog/config-scale or parent-scoped tables (client contacts, service schedules, crew roles, supplier orders/items), none org-wide-unbounded (see the new R-8.3.3 rows for the 3 that needed explicit registration). |
| 2026-07-26 | 698 | 704 | +6 | Issue #944 WS5 returns station: 6 new bounded .collect() reads (all narrowed by asset/bulk/kit id, project id, or line id — none org-wide) across convex/returnsLookup.ts, convex/returnsWrites.ts, convex/warehouseReturns.ts. See docs/exceptions.md R-9.8 for the one genuinely org-wide-shaped read (bundle's bounded .take()). |
| 2026-07-26 | 704 | 712 | +8 | WS3 #942: 8 new bounded/indexed reads in overbookingBoard.ts (candidate project line items, referenced models/assets/bulkAssets, org bulk assets for sale-stock, services + their assignments, ranged crew assignments + availability blocks) for the new Overbookings & Gaps board — none are hazard-shaped (0 unjustified org-wide/whole-table scans, see that metric). |
| 2026-07-26 | 712 | 714 | +2 | WS3 #942: 2 more bounded/indexed reads (by_projectId crew assignments x2) added to overbookingBoard.ts's new confirmImpact query (the confirm-time gate preview) - 0 unjustified hazard-shape scans, verified separately. |
| 2026-07-26 | 704 | 714 | +10 | merge of WS3 (#942) into post-WS5-main: 8+2=10 new bounded/indexed reads in overbookingBoard.ts, already itemized in docs/collect-ratchet-log.md's two new rows |
| 2026-07-26 | 714 | 715 | +1 | WS4 #943 derived billing: 1 new bounded .collect() for the stale-price recalc flow (recalcAutoPricedLinesNative / projectPricingStaleness — scoped to one project's own line items, not org-wide). |
| 2026-07-27 | 715 | 730 | +15 | WS1 finance model (#940): 15 new indexed .collect() calls across quotesWrites/invoicesWrites/xeroPush/financeSnapshot/xeroSyncLogs/invoices/invoiceLines/quotes (per-project by_projectId, per-invoice by_invoiceId, per-org by_organizationId) — 0 are org-wide-unindexed hazards (hazard-shaped baseline unchanged at 0). |
