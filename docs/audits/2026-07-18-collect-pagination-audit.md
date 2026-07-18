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

## Burn-down plan (guarded, not silent)

The 249 are frozen from growth by the ratchet. Burn them down table-by-table, highest-growth
first — for each: if it's an **aggregation**, leave it (or move the rollup to a counter);
if it's a **client list**, switch to `page`/`pageSize` (clamped via `clampPageSize`) or
`collectCapped`, and update the consuming query/UI. Lower the baseline as each file clears.
Priority order by current count: `testTagAssets` (14), `kits`/`categories`/`locations` (11
each — several are small bounded sets, verify first), `assets` (10), `crewTimeEntries` (9),
`crewAvailability`/`crewDashboard` (8), `suppliers` (8).
