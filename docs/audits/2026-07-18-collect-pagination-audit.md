# Audit: `.collect()` / unbounded-read pagination (R-9.8, T-24)

**Date:** 2026-07-18 · **Rule:** POLICY.md R-9.8 (bounded reads on growable tables),
threshold T-24 (registered default page size) · **Finding:** #625

## Method

Inventoried every `.collect()` in `convex/*.ts` (non-test) and classified each by the
index that narrows it, since the index bound determines whether the read is bounded.

## Landscape (convex/, non-test)

| Bucket | Count | Bounded? | Action |
|---|---|---|---|
| `.collect()` total | 627 | — | — |
| …narrowed by a **parent/entity index** (`by_projectId`, `by_kitId`, `by_assetId`, `by_lineItemId`, …) | ~350 | **Yes** — bounded by one parent's children | none (correct) |
| …single-doc `by_cuid` lookups (mostly `.first()`/`.unique()`) | large | Yes — ≤1 row | none |
| …**org-wide** (`by_organizationId*`) then `.collect()` | **249** | **No** — grows without bound per org | **the R-9.8 hazard** |
| already `.paginate()` | 6 | Yes | — |
| already page-based (`page`/`pageSize` slicing: activityLog, assets, bulkAssets, crewTimeEntries) | several | Yes | — |

The 249 org-wide scans are the risk set. **They are not uniformly wrong:** many hit
tables with a small bounded per-org working set (categories, suppliers, locations,
models, project-categories) or feed an aggregation that legitimately needs the full set
(counts, availability math, dashboard rollups) — bounding those would return wrong
answers. The genuinely-hazardous ones scan tables that grow without bound per org
(assets, test-tag assets, records, time entries, maintenance, activity) and return a
list to a client.

## Remediation shipped in this PR

1. **T-24 registered defaults** — `convex/lib/pagination.ts`: `DEFAULT_PAGE_SIZE = 50`,
   `MAX_PAGE_SIZE = 200`, `COLLECT_HARD_CAP = 10_000`, plus `clampPageSize()` and
   `collectCapped()` (bounded full-read that reports truncation).
2. **Ratchet guardrail** — `scripts/collect-ratchet.mjs` counts org-wide `.collect()`
   scans and fails CI if the count exceeds the committed baseline (`.collect-ratchet-baseline`,
   currently **249**). New unbounded org-wide reads can't land; as existing ones are
   bounded, lower the baseline. Wired into the `Hygiene` CI job (blocking).

## Burn-down (guarded, in progress)

**Ratchet refinements (batch 1):** the ratchet now (a) counts only reads narrowed by org
**alone** — a compound `by_organizationId_x` with a second `.eq/.gt/.lt` is bounded by that
entity and excluded — which drops the true hazard count from 249 to **237**; and (b) supports
a **`r9.8-ok: <reason>`** justification marker (line-precise: on the `withIndex` line or the
line directly above it). The ratchet tracks **unjustified** org-alone scans; **closing #625 =
driving that to 0** (every org-alone `.collect()` is bounded/paginated or marked justified).

**Definition of "justified":** an aggregation that needs the whole per-org set (dashboard
tallies, counts), a small bounded-by-domain config set (test profiles, categories, crew roles,
templates, locations), or a background/cron read off the request hot path. **Not** justified:
a client-facing list that loads a growable table in full (assets, records, time entries…).

**Batch 1 (this PR):** `testTagAssets.ts` triaged — 7 org-alone reads marked justified
(dashboard aggregation ×4, small profile sets ×2, background reminder/report dump ×1); the 4
remaining are `listPage`, which collects the full org set of assets/records to paginate
**in memory** — the exemplar conversion (paginate at the DB, then load only referenced
enrichment) for a follow-up batch. Baseline: **249 → 237 → 230 → 208** (batch 2: config list()s + verified dashboard/counter aggregations marked).

**Remaining (~230), by queried table** — growable (convert client lists / counter-ise hot
aggregations): `assets` 19, `models` 18, `projects` 17, `crewMembers` 14, `bulkAssets` 11,
`crewAssignments` 9, `testTagRecords` 8, `maintenanceRecords` 5, `crewTimeEntries` 4,
`checkRecords`/`projectLineItems` 2 … · likely-justified config/small sets (verify, then mark):
`locations` 16, `crewRoles` 9, `categories` 8 (minus its `containerAssetSearch` asset scans),
`kits` 6, `testProfiles`/`serviceTemplates`/templates/… Each site is classified individually
(a file is never uniformly one bucket — e.g. `categories` mixes a small list with growable
asset scans).
