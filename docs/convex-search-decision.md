# Global search — design decision + validation (hard gate §4.4)

Hard gate: **Convex search validated against real queries — before the drop
(search breaks otherwise).** This documents what shipped (`#432`), why it's a
range-scan rather than BM25, the SCAN_CAP limitation, the live validation, and the
trigger to migrate to search-indexes.

## What shipped

`convex/globalSearch.ts` `search({ orgId, query })` — one backend-local query that
**range-scans each of 15 org-scoped entities** (`models, kits, assets, bulkAssets,
projects, clients, suppliers, locations, categories, maintenanceRecords, crewMembers,
crewRoles, checkItems, groupTemplates, subHires`) via `by_organizationId`, plus child
drills, then ranks in JS with `convex/lib/searchScore.ts` — a **pg_trgm-parity**
scorer (exact/normalized substring + trigram Jaccard similarity ≥ 0.15 + tag match,
`GREATEST`-style best-field rank). It replaced the frozen-Postgres `pg_trgm`
`globalSearch` engine that was reading stale rows (the live command-palette bug).

## Range-scan vs BM25 search-indexes — the decision

**Chosen: range-scan + JS trigram scorer. Not: Convex `searchIndex` (BM25).**

- **Why range-scan now.** Convex `searchIndex` is single-field, single-table, and
  BM25-ranked — it does **not** reproduce pg_trgm fuzzy similarity, and a federated
  14-entity/multi-field palette would need *many* indexes plus a separate merge/rank
  pass anyway. The range-scan keeps **exact behavioural parity** with the old
  pg_trgm engine (same threshold, same cross-field `GREATEST` rank, same child
  drills) — parity was the requirement, since the palette + the MCP `search` tool
  both depend on it. It is one round-trip, org-scoped, and reactive.
- **The cost.** O(rows-per-entity) per search, JS-side. Fine while entities are
  small; linear growth is the ceiling.

## SCAN_CAP limitation (explicit — no silent cap)

Each entity scan is bounded by **`SCAN_CAP = 5000`** (`convex/globalSearch.ts:45`).
A tenant with >5000 rows in one searched entity would search only the first 5000 of
that entity — a silent recall gap. This is documented in-code and here.

**Current headroom (prod, verified via the whole-org export counts):** the largest
*searched* entity is `assets` at **112** rows (models 61, projects 44, clients 37 …)
— all **~45× under** SCAN_CAP. It is not close to tripping. (High-row tables like
`activityLogs`/`checkRecords` are **not** searched.)

## Live validation (gate evidence)

`scripts/validate-search.ts` is a repeatable, data-driven harness: it pulls a real
entity name per type, derives a query term, and asserts the entity is found — plus
data-agnostic invariants. Run against **prod** (`docker exec <app> npx tsx
scripts/validate-search.ts <orgId>`):

```
models:    "EWDX"     (EW-DX EM 2 Dante)  → 30 hits, target FOUND ✓
clients:   "UNSW"     (UNSW MTS)          → 7 hits,  target FOUND ✓
projects:  "Drum"     (Drum Shield Hire)  → 14 hits, target FOUND ✓
suppliers: "Resolution"(Resolution X)     → 5 hits,  target FOUND ✓
assets:    "TTP00062"                     → 34 hits, target FOUND ✓
min-length 1-char → 0 ✓   gibberish → 0 (no false positives) ✓
org isolation: real term under a bogus org → 0 (no cross-tenant leak) ✓
latency ~524ms (warm, 15-entity scan)
```

Earlier (#432) manual validation also confirmed manufacturer matches (QSC→K10.2),
parent/child drills (assets under a model, project under a client), and sub-hire
item-desc drills — and that the JS trigram impl reproduces a pg_trgm fuzzy hit
(`Yamaha`→a client whose `contactName` trigram-matched, exactly as the old SQL did).

## Migration trigger → BM25 search-indexes

Move a given entity to a Convex `searchIndex` when **either**:
1. its row count approaches **SCAN_CAP/2 (~2500)** — recall risk + scan cost, **or**
2. warm search latency exceeds **~1s** attributable to that entity's scan.

Migration is per-entity and incremental: add a `searchIndex` on the entity's search
field(s), swap that entity's `orgScan` for a `withSearchIndex` read, keep the JS
merge/rank for the rest. The harness above guards against a regression during the
swap. Until a trigger fires, the range-scan is the correct, parity-preserving choice.
